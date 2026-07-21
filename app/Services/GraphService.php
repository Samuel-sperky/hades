<?php

namespace App\Services;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * Zdroj pravdy pre graf vedomia — zdieľaný medzi interným /api/mind
 * (MindController) a externým /api/v1/graph (Api\GraphController), aby sa
 * logika (scope, hrany, hidden-split, stav) NEDUPLIKOVALA. Payload je bit-za-bit
 * ten istý pre oba vstupy.
 */
class GraphService
{
    /**
     * Postaví celý graf payload. ?scope určuje rozsah:
     *   - 'live' (default) — len „živé" uzly: jadro + projekty + spomienky PLUS
     *     skilly s reálnou aktiváciou ('activate'/'skill-used');
     *   - 'all' — všetky uzly.
     * Hrany sa vždy vracajú len medzi vrátenými uzlami. Listing bez popisu.
     *
     * @return array<string, mixed>
     */
    public function payload(string $scope = 'live'): array
    {
        $scope = $scope === 'all' ? 'all' : 'live';

        if ($scope === 'all') {
            $nodes = Node::all();
        } else {
            $usedSkillIds = Activation::query()
                ->whereIn('kind', ['activate', 'skill-used'])
                ->distinct()
                ->pluck('node_id')
                ->all();

            $nodes = Node::query()
                ->where(function ($q) use ($usedSkillIds) {
                    $q->where('type', '!=', 'skill')
                        ->orWhereIn('id', $usedSkillIds);
                })
                ->get();
        }

        $nodeIds = $nodes->pluck('id')->flip();

        $edges = Edge::all()->filter(
            fn (Edge $e) => $nodeIds->has($e->source_id) && $nodeIds->has($e->target_id)
        )->values();

        $hiddenSplit = $this->deriveHiddenSplit($nodes, $edges);

        return [
            'name' => config('hades.name'),
            'scope' => $scope,
            'state' => $this->state(),
            'ws' => [
                'key' => config('broadcasting.connections.reverb.key'),
                'host' => config('hades.public_ws_host'),
                'port' => config('hades.public_ws_port'),
            ],
            'areas' => Area::orderBy('angle')->get(),
            'departments' => Department::all(),
            'nodes' => $nodes->map(function (Node $node) use ($hiddenSplit) {
                $api = $node->toApi();
                if (isset($hiddenSplit[$node->id])) {
                    $api['layer_role'] = $hiddenSplit[$node->id];
                }
                $api['description'] = null;

                return $api;
            }),
            'edges' => $edges->map->toApi(),
        ];
    }

    /**
     * Stav vedomia (awake + posledná aktivita) — zdieľané aj v grafe.
     *
     * @return array{awake: bool, last_activity_at: ?string}
     */
    public function state(): array
    {
        $lastActivation = Activation::latest('created_at')->first();
        $awake = $lastActivation
            && $lastActivation->created_at->gt(now()->subMinutes(config('hades.awake_minutes')));

        return [
            'awake' => (bool) $awake,
            'last_activity_at' => $lastActivation?->created_at->toIso8601String(),
        ];
    }

    /**
     * Spresní vrstvovú rolu skill-uzlov z coarse 'hidden' na 'hidden_in' /
     * 'hidden_out' podľa VÁŽENÉHO náklonu ich väzieb (memory vs core/project).
     * Semantika zhodná s pôvodným MindController::deriveHiddenSplit.
     *
     * @param  Collection<int, Node>  $nodes
     * @param  Collection<int, Edge>  $edges
     * @return array<int, string>  node_id → 'hidden_in' | 'hidden_out'
     */
    private function deriveHiddenSplit(Collection $nodes, Collection $edges): array
    {
        $typeOf = [];
        foreach ($nodes as $node) {
            $typeOf[$node->id] = $node->type;
        }

        $inW = [];
        $outW = [];
        $inC = [];
        $outC = [];
        foreach ($nodes as $node) {
            if ($node->layerRole() === 'hidden') {
                $inW[$node->id] = 0.0;
                $outW[$node->id] = 0.0;
                $inC[$node->id] = 0;
                $outC[$node->id] = 0;
            }
        }

        if ($inW === []) {
            return [];
        }

        foreach ($edges as $edge) {
            $weight = (float) $edge->weight;
            foreach ([[$edge->source_id, $edge->target_id], [$edge->target_id, $edge->source_id]] as [$self, $other]) {
                if (! array_key_exists($self, $inW)) {
                    continue;
                }
                $otherType = $typeOf[$other] ?? null;
                if ($otherType === 'memory') {
                    $inW[$self] += $weight;
                    $inC[$self]++;
                } elseif ($otherType === 'core' || $otherType === 'project') {
                    $outW[$self] += $weight;
                    $outC[$self]++;
                }
            }
        }

        $roles = [];
        $unresolved = [];
        foreach ($inW as $id => $in) {
            $out = $outW[$id];
            if ($in > $out) {
                $roles[$id] = 'hidden_in';
            } elseif ($out > $in) {
                $roles[$id] = 'hidden_out';
            } elseif ($inC[$id] > $outC[$id]) {
                $roles[$id] = 'hidden_in';
            } elseif ($outC[$id] > $inC[$id]) {
                $roles[$id] = 'hidden_out';
            } else {
                $unresolved[] = $id;
            }
        }

        sort($unresolved);
        foreach ($unresolved as $i => $id) {
            $roles[$id] = ($i % 2 === 0) ? 'hidden_in' : 'hidden_out';
        }

        return $roles;
    }
}
