<?php

namespace App\Http\Controllers;

use App\Events\MindPulse;
use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EdgeController extends Controller
{
    public function store(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'source_id' => 'required|integer|exists:nodes,id|different:target_id',
            'target_id' => 'required|integer|exists:nodes,id',
        ]);

        $source = Node::findOrFail($validated['source_id']);
        $target = Node::findOrFail($validated['target_id']);

        // MindService::connect normalizuje pár (min, max), posilní existujúcu hranu
        // alebo vytvorí novú a odošle 'edge.strengthened' / 'edge.created' pulse.
        $edge = $mind->connect($source, $target, 'manual', false);

        return response()->json([
            'edge' => [
                'id' => $edge->id,
                'source_id' => $edge->source_id,
                'target_id' => $edge->target_id,
                'weight' => (float) $edge->weight,
            ],
        ]);
    }

    public function destroy(Edge $edge): JsonResponse
    {
        $id = $edge->id;
        $edge->delete();

        MindPulse::dispatch('edge.deleted', ['id' => $id]);

        return response()->json(['deleted' => $id]);
    }
}
