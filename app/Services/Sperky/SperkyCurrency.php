<?php

namespace App\Services\Sperky;

/**
 * Odhad meny z `country_iso` (nález N1).
 *
 * SPERKY API vracia `total_paid` v mene objednávky, ale samotnú menu NEVRACIA.
 * Zmerané na živých dátach: 11215 HU = HUF (~28 €), 4253 CZ = CZK (~170 €),
 * 14.85 SK = EUR. Na 100 objednávkach bolo 37 hodnôt nad 1000.
 *
 * Táto trieda je preto HEURISTIKA a nič viac. Každá suma, ktorá cez ňu prejde,
 * musí byť v odpovedi označená `currency_is_estimate: true`.
 *
 * Čo je tu ZAKÁZANÉ a preto sa to tu nenachádza:
 *   - prepočet medzi menami (appka nemá kurzy),
 *   - akýkoľvek súčet naprieč menami alebo krajinami.
 */
final class SperkyCurrency
{
    /** @param  array<string, string>  $map  country_iso → kód meny (config sperky.currencies) */
    public function __construct(private readonly array $map) {}

    public static function fromConfig(): self
    {
        /** @var array<string, string> $map */
        $map = (array) config('sperky.currencies', []);

        return new self($map);
    }

    /**
     * Odhad meny pre krajinu. `null` znamená „menu nevieme" — NIE EUR.
     * Neznáma krajina sa nikdy nezlúči s inou, práve preto sa vracia null.
     */
    public function guess(?string $countryIso): ?string
    {
        $iso = strtoupper(trim((string) $countryIso));

        if ($iso === '') {
            return null;
        }

        $currency = $this->map[$iso] ?? null;

        return is_string($currency) && $currency !== '' ? $currency : null;
    }
}
