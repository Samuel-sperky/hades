<?php

namespace App\Services\Brain;

/**
 * Jeden `.md` súbor „mozgu" rozparsovaný do jedného uzla (1 súbor = 1 uzol).
 *
 * DTO nesie všetko, čo BrainSyncService potrebuje na `updateOrCreate` podľa
 * `external_key`: identitu (external_key, content_hash), zaradenie (type/source/
 * area/department), obsah (label/description/certainty/tags), stopu do súboru
 * (source_file) a [[wiki]] ciele na tvorbu hrán.
 */
final readonly class BrainNode
{
    /**
     * @param  list<string>  $tags
     * @param  list<string>  $wikiLinks
     * @param  array<string, mixed>  $meta
     */
    public function __construct(
        public string $externalKey,
        public string $type,
        public string $source,
        public ?string $areaSlug,
        public ?string $departmentName,
        public string $label,
        public ?string $description,
        public ?string $certainty,
        public array $tags,
        public string $sourceFile,
        public string $contentHash,
        public array $wikiLinks,
        public bool $needsReview,
        public array $meta = [],
    ) {}
}
