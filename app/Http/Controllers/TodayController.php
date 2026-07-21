<?php

namespace App\Http\Controllers;

use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;

class TodayController extends Controller
{
    /**
     * Zdroj pre obrazovku Dnes — prehľad posledných dní práce vedomia:
     *   - recent_sessions: posledných 8 session/digest záznamov (dátum + projekt)
     *   - week_added: koľko uzlov a sessions pribudlo za 7 dní
     *   - top_projects: projekty podľa počtu záznamov
     *   - recent_records: posledné záznamy s titulom a úryvkom
     */
    public function index(): JsonResponse
    {
        $weekAgo = now()->subDays(7);

        $recentSessions = Node::whereIn('source', ['session', 'digest'])
            ->orderByDesc('created_at')
            ->limit(8)
            ->get()
            ->map(fn (Node $n) => [
                'id' => $n->id,
                'label' => $n->label,
                'source' => $n->source,
                'project' => is_array($n->meta) ? ($n->meta['project'] ?? null) : null,
                'created_at' => $n->created_at?->toIso8601String(),
            ]);

        $topProjects = Node::where('source', 'session')
            ->selectRaw("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(meta, '$.project')), 'projekt') as project, COUNT(*) as c")
            ->groupBy('project')
            ->orderByDesc('c')
            ->limit(6)
            ->get()
            ->map(fn ($row) => ['project' => $row->project, 'count' => (int) $row->c]);

        $recentRecords = Node::whereIn('source', ['session', 'digest'])
            ->orderByDesc('created_at')
            ->limit(6)
            ->get()
            ->map(fn (Node $n) => [
                'id' => $n->id,
                'label' => $n->label,
                'project' => is_array($n->meta) ? ($n->meta['project'] ?? null) : null,
                'snippet' => $n->description
                    ? Str::limit(trim(preg_replace('/\s+/u', ' ', $n->description)), 140)
                    : null,
                'created_at' => $n->created_at?->toIso8601String(),
            ]);

        return response()->json([
            'recent_sessions' => $recentSessions,
            'week_added' => [
                'nodes' => Node::where('created_at', '>=', $weekAgo)->count(),
                'sessions' => Node::where('created_at', '>=', $weekAgo)
                    ->whereIn('source', ['session', 'digest'])->count(),
            ],
            'top_projects' => $topProjects,
            'recent_records' => $recentRecords,
        ]);
    }
}
