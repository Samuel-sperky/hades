<?php

namespace App\Services\Chat;

/**
 * Výsledok klasifikácie zámeru. Vlastník P5.
 *
 * `source` hovorí, KTO rozhodol — 'deterministic' (vrstva 1, zdroj pravdy),
 * 'model' (vrstva 2, len keď vrstva 1 nenašla zhodu) alebo 'fallback'
 * (nikto nerozhodol → zámer 'none'). Diagnostika v `meta.intent_source`.
 */
final readonly class Intent
{
    /** @param  array<string, string>  $params */
    public function __construct(
        public string $name,
        public array $params = [],
        public string $source = 'deterministic',
    ) {}

    public static function none(string $source = 'fallback'): self
    {
        return new self('none', [], $source);
    }

    public function isNone(): bool
    {
        return $this->name === 'none';
    }

    public function isShop(): bool
    {
        return str_starts_with($this->name, 'shop.');
    }

    public function param(string $key, ?string $default = null): ?string
    {
        $value = $this->params[$key] ?? null;

        return is_string($value) && trim($value) !== '' ? trim($value) : $default;
    }
}
