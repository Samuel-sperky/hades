<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Console\Command;

class MindDigest extends Command
{
    protected $signature = 'mind:digest';

    protected $description = 'Vytvorí týždenný súhrnný uzol mozgu (kódová agregácia, bez modelu)';

    public function handle(): int
    {
        $from = now()->subDays(7);

        $newNodes = Node::where('created_at', '>=', $from)->whereNull('source')->count();
        $sessions = Node::where('created_at', '>=', $from)->where('source', 'session')->count();

        $topSkills = Node::where('type', 'skill')
            ->orderByDesc('strength')->limit(5)->pluck('label')->all();

        $projects = Node::where('source', 'session')
            ->where('created_at', '>=', $from)
            ->get()
            ->groupBy(fn (Node $n) => $n->meta['project'] ?? 'projekt')
            ->map->count()
            ->sortDesc()
            ->take(5);

        // ISO týždeň + ISO rok (format 'o') — na prelome roka sedí s kľúčom
        $week = now()->format('W/o');
        $key = 'digest:'.now()->format('o-\WW');

        $lines = [];
        $lines[] = now()->format('j.n.Y').' — týždenný súhrn';
        $lines[] = "Nové poznatky: {$newNodes} · session záznamy: {$sessions}";
        if ($projects->isNotEmpty()) {
            $lines[] = 'Najviac práce: '.$projects->map(fn ($c, $p) => "{$p} ({$c})")->implode(', ');
        }
        if ($topSkills) {
            $lines[] = 'Top skills: '.implode(', ', $topSkills);
        }

        $core = Node::where('type', 'core')->where('label', config('auraai.name'))->first();

        // súhrn ide rovno do oddelenia "Súhrny" v oblasti jadra (fallback osobne-preferencie)
        $area = $core?->area_id ? Area::find($core->area_id) : null;
        $area ??= Area::where('slug', 'osobne-preferencie')->first() ?? Area::orderBy('id')->first();
        $dept = $area
            ? Department::firstOrCreate(
                ['area_id' => $area->id, 'slug' => 'suhrny'],
                ['name' => 'Súhrny'],
            )
            : null;

        $node = Node::updateOrCreate(
            ['external_key' => $key],
            [
                'type' => 'memory',
                'source' => 'digest',
                'area_id' => $area?->id,
                'department_id' => $dept?->id,
                'label' => "Súhrn týždňa {$week}",
                'description' => implode("\n", $lines),
                'meta' => [
                    'week' => $week,
                    'new_nodes' => $newNodes,
                    'sessions' => $sessions,
                    'top_skills' => $topSkills,
                    'projects' => $projects->toArray(),
                    'generated_at' => now()->toIso8601String(),
                ],
                'strength' => 2,
                'last_activated_at' => now(),
            ],
        );

        if ($core && $core->id !== $node->id) {
            [$s, $t] = $node->id < $core->id ? [$node->id, $core->id] : [$core->id, $node->id];
            Edge::firstOrCreate(
                ['source_id' => $s, 'target_id' => $t],
                ['weight' => 1, 'last_activated_at' => now()],
            );
        }

        MindPulse::dispatch('node.created', ['node' => $node->toApi()]);

        $this->info("Digest {$week}: {$newNodes} poznatkov, {$sessions} sessions.");

        return self::SUCCESS;
    }
}
