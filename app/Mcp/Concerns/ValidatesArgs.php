<?php

namespace App\Mcp\Concerns;

use App\Mcp\Exceptions\ToolValidationException;

/**
 * Validácia argumentov toolu. Vyhadzuje {@see ToolValidationException}, teda
 * chybu, ktorá sa NEreportuje do error logu — je to bežná odpoveď protokolu.
 *
 * Chybové hlásenia nikdy neopakujú prijatú hodnotu (mohla by to byť tá, ktorú
 * blacklist práve odmietol).
 */
trait ValidatesArgs
{
    /** Povinný neprázdny string. */
    protected function requireString(array $args, string $key): string
    {
        if (blank($args[$key] ?? null)) {
            throw new ToolValidationException("Missing required argument: {$key}");
        }

        return (string) $args[$key];
    }

    /** Voliteľný string; prázdny/chýbajúci → null. */
    protected function optionalString(array $args, string $key): ?string
    {
        if (! isset($args[$key])) {
            return null;
        }

        $value = trim((string) $args[$key]);

        return $value === '' ? null : $value;
    }

    /** Voliteľný integer zovretý do rozsahu; chýbajúci → $default. */
    protected function clampInt(array $args, string $key, int $default, int $min, int $max): int
    {
        $value = isset($args[$key]) ? (int) $args[$key] : $default;

        return max($min, min($value, $max));
    }

    /** Zoznam neprázdnych orezaných stringov (tags, connections). */
    protected function stringList(array $args, string $key): array
    {
        return array_values(array_filter(
            array_map(fn ($item): string => trim((string) $item), (array) ($args[$key] ?? [])),
            fn (string $item): bool => $item !== '',
        ));
    }

    /** Hodnota musí byť z enumu, inak validačná chyba (nikdy tichý fallback). */
    protected function requireEnum(array $args, string $key, array $allowed): ?string
    {
        $value = $this->optionalString($args, $key);

        if ($value === null) {
            return null;
        }

        if (! in_array($value, $allowed, true)) {
            throw new ToolValidationException(
                "Invalid value for {$key} — allowed: ".implode(', ', $allowed),
            );
        }

        return $value;
    }
}
