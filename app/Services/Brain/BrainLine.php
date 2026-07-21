<?php

namespace App\Services\Brain;

/**
 * Výsledok parsovania jedného `- …` bulletu zo znalostnej sekcie mozgu.
 *
 * `certainty` je Hades string ('overene' | 'hypoteza' | 'pasca' | null),
 * nie DB enum (§4.10). `needsReview` = riadok síce zachovaný, ale nerozpoznaný
 * ako štruktúrovaný → ide do kontrolnej fronty (NIC sa ticho nezahadzuje).
 */
final readonly class BrainLine
{
    public function __construct(
        public string $text,
        public ?string $certainty,
        public ?string $notedOn,
        public ?string $source,
        public bool $isStructured,
        public bool $needsReview,
    ) {}
}
