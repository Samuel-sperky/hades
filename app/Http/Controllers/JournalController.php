<?php

namespace App\Http\Controllers;

use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class JournalController extends Controller
{
    /** Denník automatických záznamov zo sessions (+ týždenné súhrny). */
    public function index(Request $request): JsonResponse
    {
        $query = Node::query()
            ->whereIn('source', ['session', 'digest'])
            ->orderByDesc('created_at');

        if ($project = $request->query('project')) {
            $query->where('meta->project', $project);
        }

        $records = $query->limit((int) $request->query('limit', 60))->get()->map(function (Node $n) {
            $m = $n->meta ?? [];

            return [
                'id' => $n->id,
                'source' => $n->source,
                'label' => $n->label,
                'description' => $n->description,
                'project' => $m['project'] ?? null,
                'created_at' => $n->created_at?->toIso8601String(),
                'prompt_count' => $m['prompt_count'] ?? null,
                'file_count' => $m['file_count'] ?? null,
                'commits' => $m['commits'] ?? [],
                'files' => $m['files'] ?? [],
                'tools' => $m['tools'] ?? [],
                'prompts' => $m['prompts'] ?? [],
                'final' => $m['final'] ?? null,
            ];
        });

        $projects = Node::where('source', 'session')
            ->get()
            ->groupBy(fn (Node $n) => $n->meta['project'] ?? 'projekt')
            ->map->count()
            ->sortDesc();

        return response()->json([
            'records' => $records,
            'projects' => $projects,
            'total' => Node::whereIn('source', ['session', 'digest'])->count(),
        ]);
    }
}
