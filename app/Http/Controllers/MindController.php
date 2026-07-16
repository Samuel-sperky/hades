<?php

namespace App\Http\Controllers;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

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
            // listing nesie skrátený popis — plný text vracia detail /api/nodes/{id}
            'nodes' => Node::all()->map(function (Node $node) {
                $api = $node->toApi();
                $api['description'] = $api['description'] === null
                    ? null
                    : Str::limit($api['description'], 200);

                return $api;
            }),
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
            && $lastActivation->created_at->gt(now()->subMinutes(config('hades.awake_minutes')));

        return [
            'awake' => (bool) $awake,
            'last_activity_at' => $lastActivation?->created_at->toIso8601String(),
        ];
    }
}
