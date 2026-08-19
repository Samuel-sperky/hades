<?php

namespace App\Services\Console\Tools;

/**
 * Spoločná drobnosť pre všetky tooly: čítanie argumentov a strop na výstup.
 *
 * Prečo vôbec: slabý model posiela argumenty v tvare, v akom si ich pamätá —
 * číslo ako string, chýbajúci povinný parameter, `null` namiesto vynechania.
 * Keby to riešil každý tool sám, polovica by na to zabudla a spadla na
 * `TypeError` uprostred agentovej smyčky, kde chyba nemá kam ísť.
 */
abstract class BaseTool implements ConsoleTool
{
    /** Väčšina toolov je čítacia; zápisové to prebijú a tým to aj priznajú. */
    public function isWrite(): bool
    {
        return false;
    }

    /** Čítací tool nemá čo potvrdzovať. */
    public function preview(array $args): ?string
    {
        return null;
    }

    /**
     * @param  array<string, mixed>  $args
     *
     * @throws ToolRefusal
     */
    protected function requiredString(array $args, string $key): string
    {
        $value = $args[$key] ?? null;

        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }

        // Skalár, ktorý model poslal ako číslo (`id: 12`) je platná odpoveď na
        // otázku „daj string" — odmietnuť ju by bolo pedantstvo za jedno kolo
        // smyčky, teda ~20 sekúnd na CPU.
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        throw new ToolRefusal("Missing required argument `{$key}`.");
    }

    /**
     * Povinný argument, ktorý smie byť aj prázdny string (`new_string` pri
     * mazaní riadku, `content` pri vyprázdnení súboru) — chýbajúci kľúč však
     * nie.
     *
     * @param  array<string, mixed>  $args
     *
     * @throws ToolRefusal
     */
    protected function requiredText(array $args, string $key): string
    {
        $value = $args[$key] ?? null;

        if (is_string($value)) {
            return $value;
        }

        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }

        throw new ToolRefusal("Missing required argument `{$key}`.");
    }

    /**
     * @param  array<string, mixed>  $args
     */
    protected function optionalString(array $args, string $key): ?string
    {
        $value = $args[$key] ?? null;

        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $args
     */
    protected function optionalInt(array $args, string $key): ?int
    {
        $value = $args[$key] ?? null;

        if (is_int($value)) {
            return $value;
        }

        // `"12"` aj `12.0`: model diktuje JSON po tokenoch a typ v ňom je nehoda,
        // nie zámer.
        if (is_string($value) && preg_match('/^-?\d+$/', trim($value)) === 1) {
            return (int) trim($value);
        }

        if (is_float($value) && $value === floor($value)) {
            return (int) $value;
        }

        return null;
    }

    /**
     * Zoznam stringov z čohokoľvek, čo model poslal — vrátane jedného stringu
     * namiesto poľa (to robí pri `tags` a `areas` pravidelne).
     *
     * @param  array<string, mixed>  $args
     * @return array<int, string>
     */
    protected function stringList(array $args, string $key): array
    {
        $value = $args[$key] ?? null;

        if (is_string($value)) {
            // „docker, laravel" je zjavne zoznam a odmietnuť ho by znamenalo
            // spáliť kolo smyčky na formalitu
            $value = preg_split('/\s*,\s*/u', $value) ?: [];
        }

        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn ($v) => is_scalar($v) ? trim((string) $v) : '', $value),
            fn (string $v): bool => $v !== '',
        ));
    }

    /**
     * Strop na text pre model. Skrátenie sa VŽDY prizná — model, ktorý nevie, že
     * mu chýba koniec, si ho domyslí, a domyslený kód je horší než chýbajúci.
     *
     * @return array{0: string, 1: bool}
     */
    protected function cap(string $text, int $cap, string $hint = ''): array
    {
        $length = mb_strlen($text);

        if ($cap <= 0 || $length <= $cap) {
            return [$text, false];
        }

        $marker = "\n\n... [truncated: {$cap} of {$length} characters shown"
            .($hint === '' ? '' : ' — '.$hint).']';

        return [mb_substr($text, 0, $cap).$marker, true];
    }
}
