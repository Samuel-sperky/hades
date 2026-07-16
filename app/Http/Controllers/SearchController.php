<?php

namespace App\Http\Controllers;

use App\Models\Node;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SearchController extends Controller
{
    /** Fulltext naprieč uzlami a playbook súbormi (skills/<oblast>/<slug>.md). */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => 'required|string|min:2',
        ]);

        $q = trim($validated['q']);

        return response()->json([
            'query' => $q,
            'nodes' => $this->searchNodes($q),
            'playbooks' => $this->searchPlaybooks($q),
        ]);
    }

    protected function searchNodes(string $q): array
    {
        $like = '%'.$q.'%';

        return Node::query()
            ->where(fn ($w) => $w->where('label', 'like', $like)->orWhere('description', 'like', $like))
            ->orderByRaw("CASE WHEN type = 'core' THEN 1 ELSE 0 END")
            ->orderByDesc('strength')
            ->limit(10)
            ->get()
            ->map(fn (Node $n) => [
                'kind' => 'node',
                'id' => $n->id,
                'label' => $n->label,
                'type' => $n->type,
                'source' => $n->source,
                'area_id' => $n->area_id,
                'snippet' => $n->description ? Str::limit(trim(preg_replace('/\s+/', ' ', $n->description)), 90) : null,
            ])
            ->values()
            ->all();
    }

    protected function searchPlaybooks(string $q): array
    {
        $results = [];

        foreach ($this->playbookContents() as $relPath => $content) {
            if (count($results) >= 10) {
                break;
            }

            $inName = stripos(basename($relPath), $q) !== false;
            $pos = stripos($content, $q);

            if (! $inName && $pos === false) {
                continue;
            }

            $results[] = [
                'kind' => 'playbook',
                'path' => $relPath,
                'title' => $this->firstHeading($content) ?? Str::headline(pathinfo($relPath, PATHINFO_FILENAME)),
                'snippet' => $this->snippetAround($content, $pos === false ? 0 : $pos, $q),
                'node_id' => $this->playbookNodeId($relPath),
            ];
        }

        return $results;
    }

    /** Obsahy playbookov — statická cache len v rámci jedného requestu. */
    protected function playbookContents(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }

        $cache = [];
        foreach (glob(base_path('skills').'/*/*.md') ?: [] as $file) {
            $content = @file_get_contents($file);
            if ($content === false) {
                continue;
            }
            $rel = 'skills/'.basename(dirname($file)).'/'.basename($file);
            $cache[$rel] = $content;
        }

        return $cache;
    }

    protected function firstHeading(string $content): ?string
    {
        if (preg_match('/^#\s+(.+)$/m', $content, $m)) {
            return trim($m[1]);
        }

        return null;
    }

    /** ±90 znakov okolo prvého výskytu, zbalené na jeden riadok. */
    protected function snippetAround(string $content, int $pos, string $q): string
    {
        // $pos je bajtový offset zo stripos — preveď na znakový, aby mb_substr nerozsekol diakritiku
        $charPos = mb_strlen(substr($content, 0, $pos));
        $start = max(0, $charPos - 90);
        $chunk = mb_substr($content, $start, 180 + mb_strlen($q));

        return trim(preg_replace('/\s+/', ' ', $chunk));
    }

    /** ID skill uzla podľa external_key 'skill:<oblast>/<slug>' (bez N+1). */
    protected function playbookNodeId(string $relPath): ?int
    {
        static $map = null;
        if ($map === null) {
            $map = Node::where('type', 'skill')
                ->whereNotNull('external_key')
                ->pluck('id', 'external_key')
                ->all();
        }

        // 'skills/marketing/seo-analyza.md' → 'skill:marketing/seo-analyza'
        $key = 'skill:'.preg_replace('/^skills\//', '', preg_replace('/\.md$/', '', $relPath));

        return $map[$key] ?? null;
    }
}
