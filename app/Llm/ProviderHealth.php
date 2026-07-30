<?php

namespace App\Llm;

/** ZAMKNUTÉ DTO (#11). */
final readonly class ProviderHealth
{
    public function __construct(
        public bool $ok,
        public bool $chat = false,
        public bool $embed = false,
        /** @var list<string> */
        public array $models = [],
        public ?int $latencyMs = null,
        /** Text chyby pre UI; NIKDY nesmie obsahovať kľúč ani token. */
        public ?string $error = null,
    ) {}

    public static function down(?string $error = null): self
    {
        return new self(ok: false, error: $error);
    }
}
