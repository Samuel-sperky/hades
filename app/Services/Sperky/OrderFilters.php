<?php

namespace App\Services\Sperky;

use App\Services\Sperky\Exceptions\SperkyDomainException;

/**
 * Filtre zoznamu objednávok — overené proti živej produkcii 31. 7. 2026
 * (08b-SPERKY-API-SPEC-V2.md, §1).
 *
 * `date_from` / `date_to` (`YYYY-MM-DD`, vrátane), `country` (ISO dodacej adresy),
 * `total_min` / `total_max`. Merané: `date_from=2026-07-30&date_to=2026-07-30`
 * vrátilo `total=220`, bez filtra `1 764 133`. Filtre teda NIE SÚ tichým spôsobom
 * zahodené — to bol nález N3 zo v1 a už neplatí.
 *
 * ROZHODNUTIE 8: `total_min` a `total_max` sa smú poslať LEN spolu s `country`.
 * „Nad 100" znamená pri HUF drobné a pri EUR veľkú objednávku, takže filter cez
 * všetky meny naraz vyrobí zavádzajúce číslo. Bez krajiny sa preto zamietne
 * doménovou chybou, nie tichým ignorovaním.
 *
 * Neznámy kľúč sa ZAMIETNE. E-shop neznámy parameter tichým spôsobom zahodí, a
 * presne to spôsobilo, že v1 vyhlásila dátumový filter za neexistujúci — chybu
 * si radšej zapíšeme sami, než aby sa prejavila nesprávnym číslom.
 */
final readonly class OrderFilters
{
    /** Kľúče, ktoré API pozná. Čokoľvek iné je chyba programátora. */
    public const KEYS = ['date_from', 'date_to', 'country', 'total_min', 'total_max'];

    private function __construct(
        public ?string $dateFrom = null,
        public ?string $dateTo = null,
        public ?string $country = null,
        public ?float $totalMin = null,
        public ?float $totalMax = null,
    ) {}

    public static function none(): self
    {
        return new self;
    }

    /**
     * @param  self|array<string, mixed>|null  $filters
     *
     * @throws SperkyDomainException
     */
    public static function from(self|array|null $filters): self
    {
        if ($filters instanceof self) {
            return $filters;
        }

        $filters = array_filter(
            $filters ?? [],
            fn (mixed $value) => $value !== null && $value !== '',
        );

        $unknown = array_diff(array_keys($filters), self::KEYS);
        if ($unknown !== []) {
            throw SperkyDomainException::unknownFilter(implode(', ', $unknown));
        }

        $dateFrom = self::date($filters, 'date_from');
        $dateTo = self::date($filters, 'date_to');
        $country = self::country($filters);
        $totalMin = self::amount($filters, 'total_min');
        $totalMax = self::amount($filters, 'total_max');

        if ($dateFrom !== null && $dateTo !== null && $dateFrom > $dateTo) {
            throw SperkyDomainException::badDateRange();
        }

        // ROZHODNUTIE 8 — suma bez krajiny mieša meny, takže sa nepošle nikdy.
        if (($totalMin !== null || $totalMax !== null) && $country === null) {
            throw SperkyDomainException::totalWithoutCountry();
        }

        if ($totalMin !== null && $totalMax !== null && $totalMin > $totalMax) {
            throw SperkyDomainException::badTotalRange();
        }

        return new self($dateFrom, $dateTo, $country, $totalMin, $totalMax);
    }

    /** Okno podľa dátumov (obe hranice vrátane). */
    public static function window(?string $from, ?string $to, ?string $country = null): self
    {
        return self::from(array_filter([
            'date_from' => $from,
            'date_to' => $to,
            'country' => $country,
        ], fn (mixed $v) => $v !== null));
    }

    public function withCountry(?string $iso): self
    {
        return self::from($this->toQuery() + ['country' => $iso]);
    }

    /**
     * Query parametre pre e-shop. Prázdne hodnoty sa neposielajú vôbec —
     * `country=` by e-shop mohol vyhodnotiť ako „žiadna krajina".
     *
     * @return array<string, string>
     */
    public function toQuery(): array
    {
        $query = [];

        if ($this->dateFrom !== null) {
            $query['date_from'] = $this->dateFrom;
        }
        if ($this->dateTo !== null) {
            $query['date_to'] = $this->dateTo;
        }
        if ($this->country !== null) {
            $query['country'] = $this->country;
        }
        if ($this->totalMin !== null) {
            $query['total_min'] = self::formatAmount($this->totalMin);
        }
        if ($this->totalMax !== null) {
            $query['total_max'] = self::formatAmount($this->totalMax);
        }

        return $query;
    }

    public function isEmpty(): bool
    {
        return $this->toQuery() === [];
    }

    /**
     * @param  array<string, mixed>  $filters
     *
     * @throws SperkyDomainException
     */
    private static function date(array $filters, string $key): ?string
    {
        if (! array_key_exists($key, $filters)) {
            return null;
        }

        $raw = trim((string) $filters[$key]);

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $raw, $m) !== 1
            || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw SperkyDomainException::invalidDate($key);
        }

        return $raw;
    }

    /**
     * @param  array<string, mixed>  $filters
     *
     * @throws SperkyDomainException
     */
    private static function country(array $filters): ?string
    {
        if (! array_key_exists('country', $filters)) {
            return null;
        }

        $iso = strtoupper(trim((string) $filters['country']));

        if (preg_match('/^[A-Z]{2}$/', $iso) !== 1) {
            throw SperkyDomainException::invalidCountry();
        }

        return $iso;
    }

    /**
     * @param  array<string, mixed>  $filters
     *
     * @throws SperkyDomainException
     */
    private static function amount(array $filters, string $key): ?float
    {
        if (! array_key_exists($key, $filters)) {
            return null;
        }

        $raw = $filters[$key];

        if (! is_numeric($raw) || (float) $raw < 0) {
            throw SperkyDomainException::invalidAmount($key);
        }

        return (float) $raw;
    }

    /** Bez exponentu a bez zbytočných nul — e-shop dostane číslo, nie `1.0E+3`. */
    private static function formatAmount(float $value): string
    {
        $formatted = rtrim(rtrim(number_format($value, 2, '.', ''), '0'), '.');

        return $formatted === '' ? '0' : $formatted;
    }
}
