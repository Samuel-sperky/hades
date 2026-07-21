<?php

namespace App\Services;

use App\Models\Node;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * Zdroj pravdy pre fulltext naprieč uzlami a playbook súbormi — zdieľaný medzi
 * interným /api/search (SearchController) a externým /api/v1/search
 * (Api\SearchController), aby sa logika NEDUPLIKOVALA. Uzly aj playbooky bežia
 * cez ten istý SK-aware engine (MindService: stemované korene + doménová
 * expanzia), takže slovenské skloňovanie funguje na oboch vstupoch rovnako.
 */
class SearchService
{
    public function __construct(private readonly MindService $mind) {}

    /**
     * @return array{query: string, nodes: list<array<string, mixed>>, playbooks: list<array<string, mixed>>}
     */
    public function search(string $q): array
    {
        $q = trim($q);
        $roots = $this->mind->queryRoots($q);

        return [
            'query' => $q,
            'nodes' => $this->searchNodes($q),
            'playbooks' => $this->searchPlaybooks($q, $roots),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    protected function searchNodes(string $q): array
    {
        return $this->mind->searchNodes($q, 10)
            ->map(fn (array $row) => [
                'kind' => 'node',
                'id' => $row['node']->id,
                'label' => $row['node']->label,
                'type' => $row['node']->type,
                'source' => $row['node']->source,
                'area_id' => $row['node']->area_id,
                'origin' => $row['node']->origin,
                'certainty' => $row['node']->certainty,
                'tags' => $row['node']->tags->pluck('name')->all(),
                'snippet' => $row['snippet'],
            ])
            ->all();
    }

    /**
     * @param  Collection<int, string>  $roots  stemované korene z toho istého enginu
     * @return list<array<string, mixed>>
     */
    protected function searchPlaybooks(string $q, Collection $roots): array
    {
        $needles = $roots->push($this->mind->fold($q))
            ->map(fn ($n) => trim((string) $n))
            ->filter(fn ($n) => $n !== '')
            ->unique()
            ->values();

        $results = [];

        foreach ($this->playbookContents() as $relPath => $content) {
            if (count($results) >= 10) {
                break;
            }

            $lowerContent = $this->mind->fold($content);
            $lowerName = $this->mind->fold(basename($relPath));

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

        $key = 'skill:'.preg_replace('/^skills\//', '', preg_replace('/\.md$/', '', $relPath));

        return $map[$key] ?? null;
    }
}
