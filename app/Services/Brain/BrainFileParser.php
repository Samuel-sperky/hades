<?php

namespace App\Services\Brain;

use Illuminate\Support\Str;

/**
 * Rozparsuje jeden `.md` súbor „mozgu" na jeden {@see BrainNode} DTO.
 *
 * Zdroj metadát v poradí priority:
 *   label       = frontmatter `name` → prvý H1/heading → headline(filename)
 *   description = frontmatter `description` → prvý odsek tela
 *   certainty   = frontmatter `certainty` (validované) → certainty prvého
 *                 štruktúrovaného bulletu (cez {@see BrainLineParser})
 *   tags        = frontmatter `tags`
 *   needs_review= frontmatter `needs_review` truthy
 *   content_hash= sha256 normalizovaného CELÉHO súboru (frontmatter + telo) —
 *                 akákoľvek zmena obsahu = nový hash = mirror sa preindexuje
 *   wikiLinks   = [[odkazy]] z tela
 */
final class BrainFileParser
{
    private const CERTAINTIES = ['overene', 'hypoteza', 'pasca'];

    public function __construct(
        private readonly BrainLineParser $lineParser = new BrainLineParser,
    ) {}

    /**
     * @param  array<string, mixed>  $descriptor  Deskriptor súboru z BrainSourceRegistry.
     */
    public function parse(string $rawContent, array $descriptor): BrainNode
    {
        $fm = Frontmatter::parse($rawContent);
        $body = Frontmatter::body($rawContent);

        $label = $fm['name']
            ?? $this->firstHeading($body)
            ?? ($descriptor['fallback_label'] ?? null)
            ?? Str::headline((string) pathinfo($descriptor['rel_path'], PATHINFO_FILENAME));

        $description = $fm['description'] ?? $this->firstParagraph($body);

        /** @var list<string> $tags */
        $tags = array_values(array_filter(
            (array) ($fm['tags'] ?? []),
            fn ($t) => is_string($t) && trim($t) !== '',
        ));

        $certainty = $this->certainty($fm, $body);

        $needsReview = $this->truthy($fm['needs_review'] ?? null);

        $meta = [
            'path' => $descriptor['rel_path'],
            'source_key' => $descriptor['source_key'],
        ];
        if (isset($descriptor['root'])) {
            $meta['root'] = $descriptor['root'];
        }
        if ($descriptor['department'] ?? null) {
            $meta['department'] = $descriptor['department'];
        }

        return new BrainNode(
            externalKey: $descriptor['external_key'],
            type: $descriptor['type'],
            source: $descriptor['source'],
            areaSlug: $descriptor['area_slug'] ?? null,
            departmentName: $descriptor['department'] ?? null,
            label: Str::limit(trim((string) $label), 120, ''),
            description: $description !== null ? Str::limit(trim($description), 500, '…') : null,
            certainty: $certainty,
            tags: $tags,
            sourceFile: $descriptor['rel_path'],
            contentHash: BrainText::hash($rawContent),
            wikiLinks: BrainText::wikiLinks($body),
            needsReview: $needsReview,
            meta: $meta,
        );
    }

    /**
     * Certainty uzla: frontmatter má prednosť; inak certainty prvého
     * štruktúrovaného bulletu s emoji istoty (BrainLineParser je tak reálne
     * zapojený a NIC z tela sa ticho neignoruje).
     *
     * @param  array<string, mixed>  $fm
     */
    private function certainty(array $fm, string $body): ?string
    {
        $fmCert = is_string($fm['certainty'] ?? null) ? strtolower(trim($fm['certainty'])) : null;
        if ($fmCert !== null && in_array($fmCert, self::CERTAINTIES, true)) {
            return $fmCert;
        }

        foreach (preg_split('/\r?\n/', $body) as $line) {
            $line = ltrim($line);
            if (! str_starts_with($line, '- ') && ! str_starts_with($line, '* ')) {
                continue;
            }
            $parsed = $this->lineParser->parse(substr($line, 2));
            if ($parsed !== null && $parsed->certainty !== null) {
                return $parsed->certainty;
            }
        }

        return null;
    }

    private function firstHeading(string $body): ?string
    {
        foreach (preg_split('/\r?\n/', $body) as $line) {
            if (preg_match('/^#{1,6}\s+(.+?)\s*$/', $line, $m)) {
                return $m[1];
            }
        }

        return null;
    }

    private function firstParagraph(string $body): ?string
    {
        foreach (preg_split('/\r?\n/', $body) as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            return ltrim($line, '-* ');
        }

        return null;
    }

    private function truthy(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower(trim((string) $value)), ['1', 'true', 'yes', 'on'], true);
    }
}
