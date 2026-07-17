<?php

namespace App\Services;

use App\Models\Node;

/**
 * Zdrojový markdown uzla — vyrieši, kde má uzol svoj .md súbor, prečíta ho
 * bezpečne (bez path traversal) a vráti obsah + relatívnu cestu. Ak zdroj
 * neexistuje, fallbackuje na popis uzla.
 *
 * Zdieľané NodeController@markdown (detail) aj ChatController (priložený kontext).
 */
class NodeMarkdownResolver
{
    /**
     * @return array{markdown: string, source_path: ?string}
     */
    public function resolve(Node $node): array
    {
        $meta = is_array($node->meta) ? $node->meta : [];

        // 1) session/digest/archive → summaries/…/*.md v repo (base_path)
        $summaryPath = $meta['summary_path'] ?? null;
        if (is_string($summaryPath) && $summaryPath !== '') {
            $md = $this->readInside(base_path(), $summaryPath);
            if ($md !== null) {
                return ['markdown' => $md, 'source_path' => $summaryPath];
            }
        }

        // 2) skill → skills/<area>/<slug>.md v repo (base_path)
        if ($node->source === 'skill') {
            $path = $meta['path'] ?? null;
            if (is_string($path) && $path !== '') {
                $md = $this->readInside(base_path(), $path);
                if ($md !== null) {
                    return ['markdown' => $md, 'source_path' => $path];
                }
            }
        }

        // 3) claude-memory → súbor pod /transcripts (read-only mount).
        //    meta.path môže byť absolútna container cesta alebo relatívna k transcripts.
        if ($node->source === 'claude-memory') {
            $path = $meta['path'] ?? null;
            if (is_string($path) && $path !== '') {
                $transcripts = rtrim((string) config('hades.transcripts_path', '/transcripts'), '/');
                $md = $this->readInside($transcripts, $path);
                if ($md !== null) {
                    return ['markdown' => $md, 'source_path' => $path];
                }
            }
        }

        // 4) fallback — popis uzla ako markdown
        return ['markdown' => (string) ($node->description ?? ''), 'source_path' => null];
    }

    /**
     * Bezpečne prečíta súbor, len ak leží vnútri povoleného koreňa. Odmietne
     * čokoľvek s '..' a čokoľvek, čo po realpath uniká mimo koreňa.
     */
    protected function readInside(string $root, string $path): ?string
    {
        if (str_contains($path, '..')) {
            return null;
        }

        $full = $this->isAbsolute($path)
            ? $path
            : rtrim($root, '/\\').'/'.ltrim($path, '/\\');

        $realRoot = realpath($root);
        $realFull = realpath($full);
        if ($realRoot === false || $realFull === false) {
            return null;
        }

        $realRoot = str_replace('\\', '/', $realRoot);
        $realFull = str_replace('\\', '/', $realFull);

        // musí byť koreň sám alebo pod koreňom — nie iba prefix-string zhoda
        if ($realFull !== $realRoot && ! str_starts_with($realFull, $realRoot.'/')) {
            return null;
        }

        if (! is_file($realFull)) {
            return null;
        }

        $contents = @file_get_contents($realFull);

        return $contents === false ? null : $contents;
    }

    /** Absolútna cesta na Linuxe (/…) aj Windows (X:\…). */
    protected function isAbsolute(string $path): bool
    {
        return str_starts_with($path, '/')
            || preg_match('#^[A-Za-z]:[\\\\/]#', $path) === 1;
    }
}
