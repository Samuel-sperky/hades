<?php

namespace App\Services\Brain;

/**
 * Validovaný payload pre brain-write create/update jedného uzla („1 súbor = 1
 * uzol"). Zdieľa ho REST API (B4) aj verify/review (B5). Polia sa premapujú na
 * frontmatter + telo `.md` súboru, ktorý {@see BrainWriter} zapíše.
 *
 * `sourceKey`+`relPath` určujú CIEĽ zápisu:
 *   - create: kam sa nový súbor založí (musí ísť o writable zdroj),
 *   - update: ak sa líšia od súčasného umiestnenia uzla → presun (move).
 * Ak `relPath` nie je zadané pri create, {@see BrainWriter} ho odvodí zo slug-u.
 */
final readonly class NodeDraft
{
    /**
     * @param  list<string>  $tags   metadáta uzla (frontmatter `tags`)
     */
    public function __construct(
        public string $label,
        public ?string $description = null,
        public ?string $certainty = null,   // overene | hypoteza | pasca | null
        public array $tags = [],
        public string $type = 'memory',      // memory | skill | project | core
        public ?string $area = null,         // area slug (frontmatter `area`)
        public ?string $sourceKey = null,    // cieľový writable zdroj
        public ?string $relPath = null,      // cieľová rel. cesta v koreni zdroja
        public ?string $body = null,         // explicitné telo; inak sa poskladá z description
    ) {}

    /**
     * "docker, mariadb , x" → ['docker', 'mariadb', 'x'].
     *
     * @return list<string>
     */
    public static function parseTags(?string $csv): array
    {
        return array_values(array_unique(array_filter(array_map('trim', explode(',', (string) $csv)))));
    }

    /** Text, ktorý sa skenuje na tajomstvá (label + description/body + tagy). */
    public function scannableText(): string
    {
        return trim($this->label."\n".($this->body ?? $this->description ?? '')."\n".implode(' ', $this->tags));
    }
}
