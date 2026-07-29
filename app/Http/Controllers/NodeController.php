<?php

namespace App\Http\Controllers;

use App\Events\MindPulse;
use App\Models\Department;
use App\Models\Edge;
use App\Models\Node;
use App\Services\NodeMarkdownResolver;
use App\Services\SimilarityService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NodeController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'label' => 'required|string|max:255',
            'type' => 'sometimes|in:memory,skill,project',
            'description' => 'nullable|string|max:5000',
            'area_id' => 'nullable|exists:areas,id',
            'department_id' => 'nullable|exists:departments,id',
        ]);

        // oddelenie musí patriť do zvolenej oblasti; bez oblasti sa odvodí z oddelenia
        if (! empty($validated['department_id'])) {
            $department = Department::find($validated['department_id']);

            if ($department) {
                if (! empty($validated['area_id']) && (int) $validated['area_id'] !== (int) $department->area_id) {
                    return response()->json([
                        'message' => 'Oddelenie nepatrí do zvolenej oblasti.',
                    ], 422);
                }

                if (empty($validated['area_id'])) {
                    $validated['area_id'] = $department->area_id;
                }
            }
        }

        $node = Node::create([
            'label' => $validated['label'],
            'type' => $validated['type'] ?? 'memory',
            'description' => $validated['description'] ?? null,
            'area_id' => $validated['area_id'] ?? null,
            'department_id' => $validated['department_id'] ?? null,
            'source' => null,
            'strength' => 1,
            'last_activated_at' => now(),
        ]);

        MindPulse::dispatch('node.created', ['node' => $node->toApi()]);

        return response()->json(['node' => $node->toApi()], 201);
    }

    public function show(Node $node): JsonResponse
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
                'meta' => $node->meta,
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

        // oddelenie musí patriť do zvolenej oblasti; bez oblasti sa odvodí z oddelenia
        if (! empty($validated['department_id'])) {
            $department = Department::find($validated['department_id']);

            if ($department) {
                if (! empty($validated['area_id']) && (int) $validated['area_id'] !== (int) $department->area_id) {
                    return response()->json([
                        'message' => 'Oddelenie nepatrí do zvolenej oblasti.',
                    ], 422);
                }

                if (empty($validated['area_id'])) {
                    $validated['area_id'] = $department->area_id;
                }
            }
        }

        $node->update($validated);

        MindPulse::dispatch('node.updated', ['node' => $node->fresh()->toApi()]);

        return response()->json(['node' => $node->fresh()->toApi()]);
    }

    /**
     * A8 „Možno súvisí" — najpodobnejšie uzly, ktoré ešte NIE sú prepojené
     * (ani jadro). Deterministické TF-IDF cez SimilarityService.
     */
    public function suggestions(Node $node, SimilarityService $similarity): JsonResponse
    {
        // ID uzlov už prepojených s týmto uzlom (oba smery hrán)
        $linkedIds = Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => (int) $id === (int) $node->id)
            ->unique()
            ->flip();

        // vyhoď už prepojené a jadro
        $filter = fn (Node $candidate) => $candidate->type !== 'core'
            && ! $linkedIds->has($candidate->id);

        $top = $similarity->topSimilar($node, 5, 0.20, $filter);

        $suggestions = collect($top)
            ->map(function (array $row) {
                $n = Node::find($row['node_id']);
                if (! $n) {
                    return null;
                }

                return [
                    'id' => $n->id,
                    'label' => $n->label,
                    'type' => $n->type,
                    'area_id' => $n->area_id,
                    'score' => round((float) $row['score'], 2),
                ];
            })
            ->filter()
            ->values();

        return response()->json(['suggestions' => $suggestions]);
    }

    /**
     * C4/E6 — zdrojový markdown uzla (session/skill/claude-memory summary),
     * inak fallback na popis. Cesty sú chránené proti path traversal.
     */
    public function markdown(Node $node, NodeMarkdownResolver $resolver): JsonResponse
    {
        $resolved = $resolver->resolve($node);

        return response()->json([
            'markdown' => $resolved['markdown'],
            'source_path' => $resolved['source_path'],
        ]);
    }

    public function destroy(Node $node): JsonResponse
    {
        if ($node->type === 'core' && $node->label === config('auraai.name')) {
            return response()->json(['message' => 'Jadro vedomia sa nedá zmazať.'], 422);
        }

        $id = $node->id;
        $node->delete();

        MindPulse::dispatch('node.deleted', ['node_id' => $id]);

        return response()->json(['deleted' => $id]);
    }
}
