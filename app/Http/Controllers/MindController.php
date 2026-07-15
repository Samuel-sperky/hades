<?php

namespace App\Http\Controllers;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class MindController extends Controller
{
    public function graph(): JsonResponse
    {
        return response()->json([
            'name' => config('hades.name'),
            'state' => $this->state(),
            'ws' => [
                'key' => config('broadcasting.connections.reverb.key'),
                'host' => config('hades.public_ws_host'),
                'port' => config('hades.public_ws_port'),
            ],
            'areas' => Area::orderBy('angle')->get(),
            'departments' => Department::all(),
            'nodes' => Node::all()->map->toApi(),
            'edges' => Edge::all()->map->toApi(),
        ]);
    }

    public function stats(): JsonResponse
    {
        $byType = Node::select('type', DB::raw('COUNT(*) as count'))
            ->groupBy('type')->pluck('count', 'type');

        $byArea = Node::select('area_id', DB::raw('COUNT(*) as count'))
            ->whereNotNull('area_id')
            ->groupBy('area_id')->pluck('count', 'area_id');

        $topNodes = Node::where('type', '!=', 'core')
            ->orderByDesc('strength')
            ->limit(8)
            ->get()
            ->map(fn (Node $node) => [
                'id' => $node->id,
                'label' => $node->label,
                'type' => $node->type,
                'strength' => (float) $node->strength,
            ]);

        $growth = Activation::select(
            DB::raw('DATE(created_at) as day'),
            DB::raw('COUNT(*) as count'),
        )
            ->where('created_at', '>=', now()->subDays(30))
            ->groupBy('day')
            ->orderBy('day')
            ->get();

        return response()->json([
            'state' => $this->state(),
            'totals' => [
                'nodes' => Node::count(),
                'edges' => Edge::count(),
                'activations' => Activation::count(),
            ],
            'by_type' => $byType,
            'by_area' => $byArea,
            'top_nodes' => $topNodes,
            'growth' => $growth,
        ]);
    }

    /**
     * Denný súhrn — čo sa Hades naučil/aktivoval dnes a za týždeň.
     */
    public function summary(): JsonResponse
    {
        $today = now()->startOfDay();
        $week = now()->subDays(7);

        $recent = Node::where('type', '!=', 'core')
            ->where('created_at', '>=', $week)
            ->with('area')
            ->latest('created_at')
            ->limit(10)
            ->get()
            ->map(fn (Node $n) => [
                'id' => $n->id,
                'label' => $n->label,
                'type' => $n->type,
                'area' => $n->area?->name,
                'created_at' => $n->created_at?->toIso8601String(),
            ]);

        $weekByArea = Node::select('area_id', DB::raw('COUNT(*) as count'))
            ->where('created_at', '>=', $week)
            ->whereNotNull('area_id')
            ->groupBy('area_id')
            ->pluck('count', 'area_id');

        return response()->json([
            'today' => [
                'learned' => Node::where('created_at', '>=', $today)->count(),
                'activations' => Activation::where('created_at', '>=', $today)->count(),
                'active_nodes' => Activation::where('created_at', '>=', $today)->distinct('node_id')->count('node_id'),
            ],
            'week' => [
                'learned' => Node::where('created_at', '>=', $week)->count(),
                'activations' => Activation::where('created_at', '>=', $week)->count(),
            ],
            'recent' => $recent,
            'week_by_area' => $weekByArea,
        ]);
    }

    /**
     * Pasívne návrhy (bez LLM): možné duplicity, medzery, spiace uzly.
     */
    public function suggestions(): JsonResponse
    {
        return response()->json([
            'gaps' => $this->gaps(),
            'sleeping' => $this->sleeping(),
            'duplicates' => $this->duplicates(),
        ]);
    }

    /** Zanedbané oblasti — najmenej uzlov / najdlhšie bez aktivity. */
    protected function gaps(): array
    {
        return Area::withCount('nodes')
            ->with(['nodes' => fn ($q) => $q->orderByDesc('last_activated_at')->limit(1)])
            ->get()
            ->map(fn (Area $a) => [
                'id' => $a->id,
                'name' => $a->name,
                'nodes' => $a->nodes_count,
                'last_activity_at' => $a->nodes->first()?->last_activated_at?->toIso8601String(),
            ])
            ->sortBy([['nodes', 'asc']])
            ->take(5)
            ->values()
            ->all();
    }

    /** Uzly dlho bez aktivácie (spiace). */
    protected function sleeping(): array
    {
        return Node::where('type', '!=', 'core')
            ->whereNotNull('last_activated_at')
            ->where('last_activated_at', '<', now()->subDays(30))
            ->orderBy('last_activated_at')
            ->limit(8)
            ->get()
            ->map(fn (Node $n) => [
                'id' => $n->id,
                'label' => $n->label,
                'type' => $n->type,
                'last_activated_at' => $n->last_activated_at?->toIso8601String(),
            ])
            ->all();
    }

    /** Možné duplicity — dvojice uzlov rovnakého typu s veľmi podobným labelom. */
    protected function duplicates(): array
    {
        $nodes = Node::where('type', '!=', 'core')->get(['id', 'label', 'type']);
        $pairs = [];

        foreach ($nodes as $i => $a) {
            foreach ($nodes as $j => $b) {
                if ($j <= $i || $a->type !== $b->type) {
                    continue;
                }
                similar_text(mb_strtolower($a->label), mb_strtolower($b->label), $pct);
                if ($pct >= 80) {
                    $pairs[] = ['a' => ['id' => $a->id, 'label' => $a->label],
                        'b' => ['id' => $b->id, 'label' => $b->label], 'similarity' => round($pct)];
                }
            }
        }

        usort($pairs, fn ($x, $y) => $y['similarity'] <=> $x['similarity']);

        return array_slice($pairs, 0, 8);
    }

    protected function state(): array
    {
        $lastActivation = Activation::latest('created_at')->first();
        $awake = $lastActivation
            && $lastActivation->created_at->gt(now()->subMinutes(config('hades.awake_minutes')));

        return [
            'awake' => (bool) $awake,
            'last_activity_at' => $lastActivation?->created_at->toIso8601String(),
        ];
    }
}
