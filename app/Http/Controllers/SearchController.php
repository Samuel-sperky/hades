<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\MindService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class SearchController extends Controller
{
    /**
     * Fulltext naprieč uzlami a playbook súbormi (skills/<oblast>/<slug>.md).
     * Uzly aj playbooky bežia cez TEN ISTÝ SK-aware engine (MindService:
     * stemované korene + doménová expanzia), takže slovenské skloňovanie
     * ('maržu' → 'marža') funguje rovnako na webe aj v recall.
     */
    public function index(Request $request, MindService $mind): JsonResponse
    {
        $validated = $request->validate([
            'q' => 'required|string|min:2',
        ]);

        $q = trim($validated['q']);
        $roots = $mind->queryRoots($q);

        return response()->json([
            'query' => $q,
            'nodes' => $this->searchNodes($mind, $q),
            'playbooks' => $this->searchPlaybooks($q, $roots),
        ]);
    }

    protected function searchNodes(MindService $mind, string $q): array
    {
        return $mind->searchNodes($q, 10)
            ->map(fn (array $row) => [
                'kind' => 'node',
                'id' => $row['node']->id,
                'label' => $row['node']->label,
                'type' => $row['node']->type,
                'source' => $row['node']->source,
                'area_id' => $row['node']->area_id,
                'snippet' => $row['snippet'],
            ])
            ->all();
    }

    /**
     * @param  Collection<int, string>  $roots  stemované korene z toho istého enginu
     */
    protected function searchPlaybooks(string $q, Collection $roots): array
    {
        // hľadaj podľa koreňov (SK skloňovanie) + surového dopytu ako fallback
        $needles = $roots->push(mb_strtolower($q))
            ->map(fn ($n) => trim((string) $n))
            ->filter(fn ($n) => $n !== '')
            ->unique()
            ->values();

        $results = [];

        foreach ($this->playbookContents() as $relPath => $content) {
            if (count($results) >= 10) {
                break;
            }

            $lowerContent = mb_strtolower($content);
            $lowerName = mb_strtolower(basename($relPath));

            $pos = null;
            $inName = false;
            foreach ($needles as $needle) {
                if (! $inName && mb_strpos($lowerName, $needle) !== false) {
                    $inName = true;
                }
                $p = mb_strpos($lowerContent, $needle);
                if ($p !== false) {
                    $pos = $pos === null ? $p : min($pos, $p);
                }
            }

            if (! $inName && $pos === null) {
                continue;
            }

            $results[] = [
                'kind' => 'playbook',
                'path' => $relPath,
                'title' => $this->firstHeading($content) ?? Str::headline(pathinfo($relPath, PATHINFO_FILENAME)),
                'snippet' => $this->snippetAround($content, $pos ?? 0, $q),
                'node_id' => $this->playbookNodeId($relPath),
            ];
        }

        return $results;
    }

    /** Obsahy playbookov — statická cache v rámci requestu + zdieľaná cache podľa mtime. */
    protected function playbookContents(): array
    {
        static $cache = null;
        if ($cache !== null) {
            return $cache;
        }

        $files = glob(base_path('skills').'/*/*.md') ?: [];
        $stamp = $files ? (max(array_map('filemtime', $files)) ?: 0) : 0;
        $key = 'hades.playbooks.'.count($files).'.'.$stamp;

        return $cache = Cache::remember($key, 3600, function () use ($files) {
            $contents = [];
            foreach ($files as $file) {
                $content = @file_get_contents($file);
                if ($content === false) {
                    continue;
                }
                $rel = 'skills/'.basename(dirname($file)).'/'.basename($file);
                $contents[$rel] = $content;
            }

            return $contents;
        });
    }

    protected function firstHeading(string $content): ?string
    {
        if (preg_match('/^#\s+(.+)$/m', $content, $m)) {
            return trim($m[1]);
        }

        return null;
    }

    /** ±90 znakov okolo prvého výskytu (znakový offset), zbalené na jeden riadok. */
    protected function snippetAround(string $content, int $charPos, string $q): string
    {
        // $charPos je ZNAKOVÝ offset (z mb_strpos) — priamo použiteľný pre mb_substr
        $start = max(0, $charPos - 90);
        $chunk = mb_substr($content, $start, 180 + mb_strlen($q));

        return trim(preg_replace('/\s+/u', ' ', $chunk));
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
