<?php

namespace App\Console\Commands;

use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Services\TranscriptIngestService;
use Illuminate\Console\Command;

/**
 * Jednorazová / opakovateľná reorganizácia uzlov podľa foldering pravidiel v2.
 * Idempotentné — druhý beh nič nepresunie.
 */
class MindReorganize extends Command
{
    protected $signature = 'mind:reorganize';

    protected $description = 'Preusporiada uzly mozgu: playbooky do Knižnice, záznamy podľa projektu, súhrny do Súhrnov, nezaradené do Nezaradených';

    public function handle(TranscriptIngestService $ingest): int
    {
        $moved = [
            'playbooky → Knižnica' => $this->reorganizePlaybooks(),
            'záznamy → Záznamy — <projekt>' => $this->reorganizeSessions($ingest),
            'súhrny → Súhrny' => $this->reorganizeDigests(),
            'bez oblasti → Nezaradené' => $this->reorganizeUnassigned(),
        ];

        $this->table(
            ['Pravidlo', 'Presunuté'],
            collect($moved)->map(fn ($count, $rule) => [$rule, $count])->values()->all(),
        );

        return self::SUCCESS;
    }

    /** Playbook uzly (source=skill) → oddelenie "Knižnica" v ich existujúcej oblasti. */
    protected function reorganizePlaybooks(): int
    {
        $moved = 0;
        $deptCache = [];

        $nodes = Node::where('source', 'skill')->whereNotNull('area_id')->get();
        foreach ($nodes as $node) {
            $dept = $deptCache[$node->area_id] ??= Department::firstOrCreate(
                ['area_id' => $node->area_id, 'slug' => 'kniznica'],
                ['name' => 'Knižnica'],
            );

            if ($node->department_id !== $dept->id) {
                $node->update(['department_id' => $dept->id]);
                $moved++;
            }
        }

        return $moved;
    }

    /** Session záznamy → oblasť + oddelenie podľa v2 logiky (meta.project). */
    protected function reorganizeSessions(TranscriptIngestService $ingest): int
    {
        $moved = 0;
        $cache = [];

        $nodes = Node::where('source', 'session')->get();
        foreach ($nodes as $node) {
            $project = $node->meta['project'] ?? null;
            $cacheKey = mb_strtolower((string) $project);

            [$area, $dept] = $cache[$cacheKey] ??= $ingest->classify($project);
            if (! $area) {
                continue;
            }

            if ($node->area_id !== $area->id || $node->department_id !== $dept?->id) {
                $node->update(['area_id' => $area->id, 'department_id' => $dept?->id]);
                $moved++;
            }
        }

        return $moved;
    }

    /** Digest uzly → oddelenie "Súhrny" v oblasti core uzla (fallback osobne-preferencie). */
    protected function reorganizeDigests(): int
    {
        $core = Node::where('type', 'core')->where('label', config('hades.name'))->first();
        $area = null;
        if ($core?->area_id) {
            $area = Area::find($core->area_id);
        }
        $area ??= Area::where('slug', 'osobne-preferencie')->first() ?? Area::orderBy('id')->first();

        if (! $area) {
            return 0;
        }

        $dept = Department::firstOrCreate(
            ['area_id' => $area->id, 'slug' => 'suhrny'],
            ['name' => 'Súhrny'],
        );

        $moved = 0;
        foreach (Node::where('source', 'digest')->get() as $node) {
            if ($node->area_id !== $area->id || $node->department_id !== $dept->id) {
                $node->update(['area_id' => $area->id, 'department_id' => $dept->id]);
                $moved++;
            }
        }

        return $moved;
    }

    /** Ne-core uzly bez oblasti → vyvoj-kod / Nezaradené. Core sa nedotýkame. */
    protected function reorganizeUnassigned(): int
    {
        $area = Area::where('slug', 'vyvoj-kod')->first() ?? Area::orderBy('id')->first();
        if (! $area) {
            return 0;
        }

        $dept = Department::firstOrCreate(
            ['area_id' => $area->id, 'slug' => 'nezaradene'],
            ['name' => 'Nezaradené'],
        );

        $moved = 0;
        $nodes = Node::whereNull('area_id')->where('type', '!=', 'core')->get();
        foreach ($nodes as $node) {
            $node->update(['area_id' => $area->id, 'department_id' => $dept->id]);
            $moved++;
        }

        return $moved;
    }
}
