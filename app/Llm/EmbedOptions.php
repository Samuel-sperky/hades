<?php

namespace App\Llm;

/**
 * ZAMKNUTÉ DTO (#11).
 *
 * 384 dimenzií je multilingual-e5-small (rozhodnutie #111). Zmena dimenzie
 * znamená prepočet všetkých embeddingov — nerobí sa bez migrácie a dry-runu.
 */
final readonly class EmbedOptions
{
    public function __construct(
        public ?string $model = null,
        public int $dimensions = 384,
    ) {}
}
