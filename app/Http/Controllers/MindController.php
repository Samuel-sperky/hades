<?php

namespace App\Http\Controllers;

use App\Models\Activation;
use App\Models\Edge;
use App\Models\Node;
use App\Services\GraphService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MindController extends Controller
{
    /**
     * Graf vedomia. ?scope určuje rozsah:
     *   - 'live' (default) — len „živé" uzly: jadro + projekty + spomienky PLUS
     *     skilly, ktoré sa reálne použili (majú aktiváciu 'activate'/'skill-used').
     *     Typicky ~80–120 uzlov namiesto vyše 550 → čitateľný denný pohľad.
     *   - 'all' — všetky uzly (spätná kompatibilita).
     * Hrany sa vždy vracajú len medzi vrátenými uzlami. Listing NEnesie popis
     * (detail ho dotiahne cez /api/nodes/{id}) — menší payload.
     *
     * Logika žije v GraphService — zdieľaná s externým /api/v1/graph, aby sa
     * scope/hrany/hidden-split NEDUPLIKOVALI (payload je bit-za-bit ten istý).
     */
    public function graph(Request $request, GraphService $graph): JsonResponse
    {
        return response()->json($graph->payload((string) $request->query('scope', 'live')));
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

        $weekAgo = now()->subDays(7);

        return response()->json([
            'state' => $this->state(),
            'totals' => [
                'nodes' => Node::count(),
                'edges' => Edge::count(),
                'activations' => Activation::count(),
                'skills' => Node::where('type', 'skill')->count(),
                'sessions' => Node::where('source', 'session')->count(),
            ],
            'week' => [
                'new_nodes' => Node::where('created_at', '>=', $weekAgo)->whereNull('source')->count(),
                'new_sessions' => Node::where('created_at', '>=', $weekAgo)->where('source', 'session')->count(),
                'activations' => Activation::where('created_at', '>=', $weekAgo)->count(),
            ],
            'by_type' => $byType,
            'by_area' => $byArea,
            'top_nodes' => $topNodes,
            'growth' => $growth,
            'recent_records' => Node::where('source', 'session')
                ->orderByDesc('created_at')->limit(4)
                ->get()
                ->map(fn (Node $n) => [
                    'id' => $n->id,
                    'label' => $n->label,
                    'project' => $n->meta['project'] ?? null,
                    'created_at' => $n->created_at?->toIso8601String(),
                ]),
        ]);
    }

    protected function state(): array
    {
        $lastActivation = Activation::latest('created_at')->first();
        $awake = $lastActivation
            && $lastActivation->created_at->gt(now()->subMinutes(config('auraai.awake_minutes')));

        return [
            'awake' => (bool) $awake,
            'last_activity_at' => $lastActivation?->created_at->toIso8601String(),
        ];
    }
}
