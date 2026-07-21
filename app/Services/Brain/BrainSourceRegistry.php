<?php

namespace App\Services\Brain;

use Illuminate\Support\Str;

/**
 * Register zdrojov `.md` „mozgov" + enumerácia ich súborov na deskriptory.
 *
 * Zlučuje `config('hades.brain_sources')` (skills, claude-memory), externé cesty
 * z `config('hades.brain_paths')` (`.env` HADES_BRAIN_PATHS) a per-typ adaptéry.
 *
 * KĽÚČOVÉ pre adopciu (Risk #2): external_key sa ZACHOVÁVA presne v tvare, ktorý
 * už používajú MindSeedSkills a ClaudeMemoryIngestService, aby brain-sync
 * NEZDVOJIL existujúce skill/memory uzly, len im preklopil origin na 'brain':
 *   skills        → skill:<folder>/<slug>
 *   claude-memory → memory:<substr(sha1(rel), 16)>
 *   externé       → brain:<sourceKey>:<substr(sha1(rel), 16)>
 */
class BrainSourceRegistry
{
    /** Priečinok oblasti skills → [slug oblasti, názov oddelenia] — zrkadlo MindSeedSkills. */
    protected array $skillAreaMap = [
        'it' => ['vyvoj-kod', 'IT'],
        'ai-nastroje' => ['vyvoj-kod', 'AI nástroje'],
        'marketing' => ['marketing-seo', 'Marketing'],
        'design' => ['dizajn-kreativa', 'Design'],
        'biznis-sperky' => ['biznis-projekty', 'Biznis šperky'],
        'produktivita' => ['osobne-preferencie', 'Produktivita'],
    ];

    /**
     * Nakonfigurované zdroje (bez enumerácie súborov). Zlúči config zdroje a
     * externé `.env` cesty do jednotného tvaru deskriptora.
     *
     * @return list<array<string, mixed>>
     */
    public function sources(): array
    {
        $sources = [];

        foreach ((array) config('hades.brain_sources', []) as $key => $def) {
            $sources[] = [
                'key' => (string) $key,
                'type' => $def['type'] ?? 'external',
                'label' => $def['label'] ?? Str::headline((string) $key),
                'path' => $def['path'] ?? null,
                'writable' => (bool) ($def['writable'] ?? false),
                'area_slug' => $def['area'] ?? null,
                'enabled' => (bool) ($def['enabled'] ?? true),
            ];
        }

        foreach ((array) config('hades.brain_paths', []) as $path) {
            $path = trim((string) $path);
            if ($path === '') {
                continue;
            }
            $key = 'brain:'.Str::slug(basename(rtrim($path, '/\\'))) ?: 'brain:external';
            $sources[] = [
                'key' => $key,
                'type' => 'external',
                'label' => Str::headline(basename(rtrim($path, '/\\'))),
                'path' => $path,
                'writable' => (bool) config('hades.allow_brain_write', false),
                'area_slug' => config('hades.brain_paths_area', null),
                'enabled' => true,
            ];
        }

        return $sources;
    }

    /**
     * external_key prefix zdroja — pre R7 scoping (zmiznuté súbory → needs_review).
     */
    public function keyPrefix(array $source): string
    {
        return match ($source['type']) {
            'skills' => 'skill:',
            'claude-memory' => 'memory:',
            default => $source['key'].':',
        };
    }

    /**
     * Enumeruje súbory zdrojov na deskriptory. Ak $onlySourceKey nie je null,
     * spracuje len ten jeden zdroj.
     *
     * @return list<array<string, mixed>>
     */
    public function files(?string $onlySourceKey = null): array
    {
        $out = [];

        foreach ($this->sources() as $source) {
            if (! ($source['enabled'] ?? true)) {
                continue;
            }
            if ($onlySourceKey !== null && $source['key'] !== $onlySourceKey) {
                continue;
            }

            $descriptors = match ($source['type']) {
                'skills' => $this->skillsFiles($source),
                'claude-memory' => $this->memoryFiles($source),
                default => $this->externalFiles($source),
            };

            foreach ($descriptors as $d) {
                $out[] = $d;
            }
        }

        return $out;
    }

    /**
     * skills/<oblast>/*.md → skill:<folder>/<slug> (zrkadlo MindSeedSkills).
     *
     * @return list<array<string, mixed>>
     */
    protected function skillsFiles(array $source): array
    {
        $base = $source['path'] ?: base_path('skills');
        if (! is_dir($base)) {
            return [];
        }

        $out = [];
        foreach (glob(rtrim($base, '/\\').'/*/*.md') ?: [] as $file) {
            $folder = basename(dirname($file));
            $slug = pathinfo($file, PATHINFO_FILENAME);
            [$areaSlug, $dept] = $this->skillAreaMap[$folder] ?? ['vyvoj-kod', ucfirst($folder)];

            $out[] = [
                'source_key' => $source['key'],
                'type' => 'skill',
                'source' => 'skill',
                'external_key' => 'skill:'.$folder.'/'.$slug,
                'abs_path' => $file,
                'rel_path' => 'skills/'.$folder.'/'.$slug.'.md',
                'area_slug' => $areaSlug,
                'department' => $dept,
                'fallback_label' => Str::headline($slug),
                'writable' => $source['writable'],
                'root' => base_path(),
            ];
        }

        return $out;
    }

    /**
     * <transcripts>/*&#47;memory/*.md → memory:<substr(sha1(rel),16)>
     * (zrkadlo ClaudeMemoryIngestService — MEMORY.md rozcestníky sa preskakujú).
     *
     * @return list<array<string, mixed>>
     */
    protected function memoryFiles(array $source): array
    {
        // claude-memory sa VŽDY číta z transcripts mountu — tam žijú existujúce
        // memory uzly, takže rel (a teda external_key) presne sedí a adopcia
        // nezdvojí. Configovaná `path` slúži len na evidenciu zdroja.
        $base = rtrim((string) config('hades.transcripts_path', '/transcripts'), '/');
        if (! is_dir($base)) {
            return [];
        }

        $out = [];
        foreach (glob($base.'/*/memory/*.md') ?: [] as $file) {
            if (strcasecmp(basename($file), 'MEMORY.md') === 0) {
                continue;
            }

            $rel = $this->relativeTo($file, $base);

            $out[] = [
                'source_key' => $source['key'],
                'type' => 'memory',
                'source' => 'claude-memory',
                'external_key' => 'memory:'.substr(sha1($rel), 0, 16),
                'abs_path' => $file,
                'rel_path' => $rel,
                'area_slug' => $source['area_slug'] ?? 'osobne-preferencie',
                'department' => 'Claude memory',
                'fallback_label' => Str::headline(pathinfo($file, PATHINFO_FILENAME)),
                'writable' => $source['writable'],
                'root' => $base,
            ];
        }

        return $out;
    }

    /**
     * Externá cesta rekurzívne → brain:<sourceKey>:<substr(sha1(rel),16)>.
     * external_key je z RELATÍVNEJ CESTY (stabilný cez edity obsahu — edit textu
     * = nový content_hash, nie nový uzol).
     *
     * @return list<array<string, mixed>>
     */
    protected function externalFiles(array $source): array
    {
        $base = $source['path'] ? rtrim((string) $source['path'], '/\\') : null;
        if ($base === null || ! is_dir($base)) {
            return [];
        }

        $out = [];
        foreach ($this->rglob($base) as $file) {
            $rel = $this->relativeTo($file, $base);

            $out[] = [
                'source_key' => $source['key'],
                'type' => 'memory',
                'source' => 'brain',
                'external_key' => $source['key'].':'.substr(sha1($rel), 0, 16),
                'abs_path' => $file,
                'rel_path' => $rel,
                'area_slug' => $source['area_slug'] ?? null,
                'department' => null,
                'fallback_label' => Str::headline(pathinfo($file, PATHINFO_FILENAME)),
                'writable' => $source['writable'],
                'root' => $base,
            ];
        }

        return $out;
    }

    /**
     * Rekurzívny glob *.md pod koreňom (bez závislosti na SORT/scandir poradí OS).
     *
     * @return list<string>
     */
    protected function rglob(string $base): array
    {
        $files = [];
        $it = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($base, \FilesystemIterator::SKIP_DOTS),
        );
        foreach ($it as $file) {
            if ($file->isFile() && strtolower($file->getExtension()) === 'md') {
                $files[] = $file->getPathname();
            }
        }
        sort($files);

        return $files;
    }

    /** Cesta relatívna ku koreňu, unixové lomky. */
    protected function relativeTo(string $path, string $base): string
    {
        $norm = str_replace('\\', '/', $path);
        $base = str_replace('\\', '/', $base);
        if (str_starts_with($norm, $base)) {
            $norm = substr($norm, strlen($base));
        }

        return ltrim($norm, '/');
    }
}
