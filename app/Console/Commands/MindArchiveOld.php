<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

/**
 * Archivácia starých session záznamov: záznamy staršie ako 90 dní sa zlúčia
 * do mesačných archívnych uzlov (jeden na mesiac + projekt) a originály sa zmažú.
 */
class MindArchiveOld extends Command
{
    protected $signature = 'mind:archive-old {--days=90 : Vek záznamov v dňoch}';

    protected $description = 'Zbalí session záznamy staršie ako 90 dní do mesačných archívnych uzlov';

    /** Slovenské názvy mesiacov pre label archívu. */
    protected array $months = [
        1 => 'Január', 2 => 'Február', 3 => 'Marec', 4 => 'Apríl',
        5 => 'Máj', 6 => 'Jún', 7 => 'Júl', 8 => 'August',
        9 => 'September', 10 => 'Október', 11 => 'November', 12 => 'December',
    ];

    public function handle(): int
    {
        $cutoff = now()->subDays((int) $this->option('days'));

        $old = Node::where('source', 'session')
            ->where('created_at', '<', $cutoff)
            ->orderBy('created_at')
            ->get();

        if ($old->isEmpty()) {
            $this->info('Žiadne záznamy na archiváciu.');

            return self::SUCCESS;
        }

        $groups = $old->groupBy(function (Node $n) {
            $month = $n->created_at?->format('Y-m') ?? 'unknown';
            $project = $n->meta['project'] ?? 'projekt';

            return $month.'|'.$project;
        });

        $archived = 0;
        $deleted = 0;

        foreach ($groups as $groupKey => $records) {
            [$month, $project] = explode('|', $groupKey, 2);
            $this->archiveGroup($month, $project, $records);
            $archived++;
            $deleted += $records->count();
        }

        $this->info("Archívnych uzlov: {$archived} · zbalených záznamov: {$deleted}");

        return self::SUCCESS;
    }

    /** @param  Collection<int, Node>  $records */
    protected function archiveGroup(string $month, string $project, Collection $records): void
    {
        $first = $records->first();
        $key = 'archive:'.$month.':'.Str::slug($project);

        // pri opakovanom behu zachovaj tituly už zbalené v existujúcom archíve
        $previous = Node::where('external_key', $key)->first();
        $titles = collect($previous?->meta['titles'] ?? [])
            ->merge($records->pluck('label'))
            ->unique()
            ->take(30)
            ->values();
        $count = (int) ($previous?->meta['count'] ?? 0) + $records->count();
        $monthNum = (int) substr($month, 5, 2);
        $year = substr($month, 0, 4);
        $monthName = $this->months[$monthNum] ?? $month;

        // kľúče pohltených originálov — zlúč naprieč behmi, bez duplicít
        $absorbedKeys = collect($previous?->meta['absorbed_keys'] ?? [])
            ->merge($records->pluck('external_key')->filter())
            ->unique()
            ->values();

        $archive = Node::updateOrCreate(
            ['external_key' => $key],
            [
                'type' => 'memory',
                'source' => 'archive',
                'area_id' => $first->area_id,
                'department_id' => $first->department_id,
                'label' => "{$monthName} {$year} — {$project}",
                'description' => $titles->map(fn ($t) => '• '.$t)->implode("\n"),
                'meta' => [
                    'month' => $month,
                    'project' => $project,
                    'count' => $count,
                    'titles' => $titles->all(),
                    'absorbed_keys' => $absorbedKeys->all(),
                ],
                'strength' => 1,
                'last_activated_at' => now(),
            ],
        );

        // náhrobky — zmazané originály sa už nikdy nesmú znovu zapísať
        foreach ($records->pluck('external_key')->filter() as $externalKey) {
            Tombstone::firstOrCreate(
                ['external_key' => $externalKey],
                ['reason' => 'archive', 'created_at' => now()],
            );
        }

        $originalIds = $records->pluck('id')->all();

        // prepoj hrany originálov na archívny uzol (bez duplicít a self-hrán)
        $edges = Edge::whereIn('source_id', $originalIds)
            ->orWhereIn('target_id', $originalIds)
            ->get();

        foreach ($edges as $edge) {
            $otherId = in_array($edge->source_id, $originalIds, true) ? $edge->target_id : $edge->source_id;

            // hrana medzi dvoma originálmi alebo na samotný archív → zahodiť
            if (in_array($otherId, $originalIds, true) || $otherId === $archive->id) {
                $edge->delete();

                continue;
            }

            [$s, $t] = $archive->id < $otherId ? [$archive->id, $otherId] : [$otherId, $archive->id];

            $existing = Edge::where('source_id', $s)->where('target_id', $t)->first();
            if ($existing) {
                // duplicita — váhu prenes do existujúcej hrany
                $existing->forceFill([
                    'weight' => (float) $existing->weight + (float) $edge->weight,
                    'last_activated_at' => now(),
                ])->save();
                $edge->delete();
            } else {
                $edge->forceFill(['source_id' => $s, 'target_id' => $t])->save();
            }
        }

        // aktivácie preneste na archív, potom originály zmazať
        Activation::whereIn('node_id', $originalIds)->update(['node_id' => $archive->id]);

        foreach ($records as $record) {
            $id = $record->id;
            $record->delete();
            MindPulse::dispatch('node.deleted', ['node_id' => $id]);
        }

        MindPulse::dispatch('node.created', ['node' => $archive->toApi()]);
    }
}
