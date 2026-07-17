<?php

namespace App\Services;

use App\Events\MindPulse;
use App\Models\Area;
use App\Models\Department;
use App\Models\Node;
use App\Models\Tombstone;
use Illuminate\Support\Str;

/**
 * Most Claude memory → Hades. Načíta markdown memory súbory aktuálneho aj
 * súrodeneckých projektov (glob /transcripts/*&#47;memory/*.md) a spraví z nich
 * memory uzly. Read-only mount — súbory sa len čítajú.
 *
 * MEMORY.md indexy sa ako uzly nevytvárajú (sú to len rozcestníky), ale čítajú
 * sa kvôli názvom odkazovaných súborov (fallback label).
 */
class ClaudeMemoryIngestService
{
    protected string $base;

    public function __construct()
    {
        $this->base = rtrim((string) config('hades.transcripts_path', '/transcripts'), '/');
    }

    /**
     * Prejde všetky memory .md súbory naprieč projektmi.
     *
     * @return array{scanned:int, created:int, updated:int, skipped:int}
     */
    public function sync(): array
    {
        $summary = ['scanned' => 0, 'created' => 0, 'updated' => 0, 'skipped' => 0];

        $files = glob($this->base.'/*/memory/*.md') ?: [];
        if ($files === []) {
            return $summary;
        }

        [$area, $dept] = $this->resolveContainer();

        // rozcestníky (MEMORY.md) — mapa cesta → titulok odkazu pre fallback label
        $linkTitles = $this->collectIndexTitles($files);

        foreach ($files as $path) {
            $summary['scanned']++;

            if (strcasecmp(basename($path), 'MEMORY.md') === 0) {
                $summary['skipped']++;

                continue;
            }

            $result = $this->ingestFile($path, $area, $dept, $linkTitles);
            if ($result === null) {
                $summary['skipped']++;

                continue;
            }

            $summary[$result]++;
        }

        return $summary;
    }

    /** @return array{0: ?Area, 1: ?Department} */
    protected function resolveContainer(): array
    {
        // claude-memory uzly sú prierezové → oblasť osobne-preferencie, oddelenie "Claude memory"
        $area = Area::where('slug', 'osobne-preferencie')->first() ?? Area::orderBy('id')->first();
        if (! $area) {
            return [null, null];
        }

        $dept = Department::firstOrCreate(
            ['area_id' => $area->id, 'slug' => 'claude-memory'],
            ['name' => 'Claude memory'],
        );

        return [$area, $dept];
    }

    /**
     * Z MEMORY.md indexov vytiahne mapu relatívna-cesta → titulok markdown odkazu.
     *
     * @param  array<int, string>  $files
     * @return array<string, string>
     */
    protected function collectIndexTitles(array $files): array
    {
        $titles = [];
        foreach ($files as $path) {
            if (strcasecmp(basename($path), 'MEMORY.md') !== 0) {
                continue;
            }
            $raw = @file_get_contents($path);
            if ($raw === false) {
                continue;
            }
            $dir = str_replace('\\', '/', dirname($path));
            if (preg_match_all('/\[([^\]]+)\]\(([^)]+\.md)\)/i', $raw, $m, PREG_SET_ORDER)) {
                foreach ($m as $link) {
                    $target = trim($link[2]);
                    // relatívny odkaz → absolútna cesta v rámci memory adresára
                    $abs = $dir.'/'.ltrim($target, './');
                    $rel = $this->relative($abs);
                    $titles[$rel] = trim($link[1]);
                }
            }
        }

        return $titles;
    }

    /**
     * @param  array<string, string>  $linkTitles
     * @return 'created'|'updated'|null
     */
    protected function ingestFile(string $path, ?Area $area, ?Department $dept, array $linkTitles): ?string
    {
        $raw = @file_get_contents($path);
        if ($raw === false) {
            return null;
        }

        $rel = $this->relative($path);
        $key = 'memory:'.substr(sha1($rel), 0, 16);

        // náhrobok — zlúčený uzol sa už nesmie vrátiť
        if (Tombstone::where('external_key', $key)->exists()) {
            return null;
        }

        $fm = $this->frontmatter($raw);
        $body = $this->stripFrontmatter($raw);

        $label = $fm['name']
            ?? $this->firstHeading($body)
            ?? ($linkTitles[$rel] ?? null)
            ?? pathinfo($path, PATHINFO_FILENAME);

        $description = $fm['description'] ?? $this->firstParagraph($body);

        $existing = Node::where('external_key', $key)->first();

        $node = Node::updateOrCreate(
            ['external_key' => $key],
            [
                'type' => 'memory',
                'source' => 'claude-memory',
                'area_id' => $area?->id,
                'department_id' => $dept?->id,
                'label' => Str::limit(trim((string) $label), 120, ''),
                'description' => $description !== null ? Str::limit(trim($description), 500, '…') : null,
                'meta' => [
                    'path' => $rel,
                    'memory_type' => $fm['metadata_type'] ?? null,
                ],
                // silu existujúceho uzla nikdy neresetuj späť na 1
                'strength' => $existing?->strength ?? 1,
                'last_activated_at' => now(),
            ],
        );

        if (! $existing) {
            MindPulse::dispatch('node.created', ['node' => $node->toApi()]);

            return 'created';
        }

        return 'updated';
    }

    /** Cesta relatívna k mount root-u (/transcripts), s unixovými lomkami. */
    protected function relative(string $path): string
    {
        $norm = str_replace('\\', '/', $path);
        $base = str_replace('\\', '/', $this->base);
        if (str_starts_with($norm, $base)) {
            $norm = substr($norm, strlen($base));
        }

        return ltrim($norm, '/');
    }

    /**
     * Minimalistický parser YAML frontmatteru (name, description, metadata.type).
     *
     * @return array<string, string>
     */
    protected function frontmatter(string $raw): array
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
        if (! preg_match('/^---\r?\n(.*?)\r?\n---/s', $raw, $m)) {
            return [];
        }

        $out = [];
        $parent = null;
        foreach (preg_split('/\r?\n/', $m[1]) as $line) {
            if (trim($line) === '') {
                continue;
            }
            if (! preg_match('/^(\s*)([\w.-]+):\s*(.*)$/', $line, $mm)) {
                continue;
            }
            $indent = strlen($mm[1]);
            $k = $mm[2];
            $v = trim($mm[3], " \t\"'");

            if ($indent === 0) {
                $parent = $k;
                if ($v !== '') {
                    $out[$k] = $v;
                }
            } elseif ($parent === 'metadata' && $k === 'type' && $v !== '') {
                $out['metadata_type'] = $v;
            }
        }

        return $out;
    }

    protected function stripFrontmatter(string $raw): string
    {
        $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);

        return preg_replace('/^---\r?\n.*?\r?\n---\r?\n?/s', '', $raw) ?? $raw;
    }

    protected function firstHeading(string $body): ?string
    {
        foreach (preg_split('/\r?\n/', $body) as $line) {
            if (preg_match('/^#{1,6}\s+(.+?)\s*$/', $line, $m)) {
                return $m[1];
            }
        }

        return null;
    }

    protected function firstParagraph(string $body): ?string
    {
        foreach (preg_split('/\r?\n/', $body) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            return $line;
        }

        return null;
    }
}
