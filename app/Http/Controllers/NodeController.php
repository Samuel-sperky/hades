<?php

namespace App\Http\Controllers;

use App\Events\MindPulse;
use App\Models\Node;
use App\Services\MindMirror;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NodeController extends Controller
{
    public function show(Node $node, MindMirror $mirror): JsonResponse
    {
        $node->load(['area', 'department']);

        $neighbors = Node::query()
            ->whereIn('id', function ($q) use ($node) {
                $q->select('target_id')->from('edges')->where('source_id', $node->id);
            })
            ->orWhereIn('id', function ($q) use ($node) {
                $q->select('source_id')->from('edges')->where('target_id', $node->id);
            })
            ->orderByDesc('strength')
            ->limit(12)
            ->get()
            ->map(fn (Node $n) => ['id' => $n->id, 'label' => $n->label, 'type' => $n->type]);

        $activations = $node->activations()
            ->latest('created_at')
            ->limit(20)
            ->get(['kind', 'session_key', 'created_at']);

        return response()->json([
            'node' => $node->toApi() + [
                'area_name' => $node->area?->name,
                'department_name' => $node->department?->name,
                'file_path' => config('hades.mirror_enabled', true) ? $mirror->relativePathFor($node) : null,
            ],
            'neighbors' => $neighbors,
            'activations' => $activations,
        ]);
    }

    public function update(Request $request, Node $node): JsonResponse
    {
        $validated = $request->validate([
            'label' => 'sometimes|required|string|max:255',
            'description' => 'sometimes|nullable|string|max:5000',
            'area_id' => 'sometimes|nullable|exists:areas,id',
            'department_id' => 'sometimes|nullable|exists:departments,id',
        ]);

        $node->update($validated);

        MindPulse::dispatch('node.updated', ['node' => $node->fresh()->toApi()]);

        return response()->json(['node' => $node->fresh()->toApi()]);
    }

    public function destroy(Node $node): JsonResponse
    {
        if ($node->type === 'core' && $node->label === config('hades.name')) {
            return response()->json(['message' => 'Jadro vedomia sa nedá zmazať.'], 422);
        }

        $id = $node->id;
        $node->delete();

        MindPulse::dispatch('node.deleted', ['node_id' => $id]);

        return response()->json(['deleted' => $id]);
    }
}
