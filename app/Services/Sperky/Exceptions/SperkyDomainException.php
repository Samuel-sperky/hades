<?php

namespace App\Services\Sperky\Exceptions;

/**
 * DOMÉNOVÁ chyba: e-shop funguje, len naša požiadavka nemá zmysel.
 *
 * `not found` sa výnimkou NEHLÁSI — klient vráti `null`, lebo neexistujúce id je
 * bežný stav vyhľadávania. Výnimkou sa hlási `no id`, čo je chyba programátora
 * (endpoint sa zavolal bez povinného parametra), nie porucha e-shopu.
 *
 * Sem patria aj neplatné FILTRE objednávok. E-shop neznámy alebo nezmyselný
 * parameter tichým spôsobom zahodí — presne to spôsobilo, že v1 vyhlásila
 * dátumový filter za neexistujúci. Chybu preto hlásime my sami, radšej než aby
 * sa prejavila nesprávnym číslom.
 */
class SperkyDomainException extends SperkyException
{
    public function isInfrastructure(): bool
    {
        return false;
    }

    /** Chýbajúci povinný parameter `id`. */
    public static function noId(): self
    {
        return new self('no_id', 'Požiadavka na e-shop neobsahovala povinné id.', 400);
    }

    /**
     * ROZHODNUTIE 8: `total_min`/`total_max` bez `country`. „Nad 100" znamená pri
     * HUF drobné a pri EUR veľkú objednávku, takže filter cez všetky meny naraz
     * vyrobí zavádzajúce číslo.
     */
    public static function totalWithoutCountry(): self
    {
        return new self(
            'filter_needs_country',
            'Filter podľa sumy sa dá použiť len spolu s krajinou — bez nej by miešal meny.',
            400,
        );
    }

    public static function invalidDate(string $key): self
    {
        return new self('bad_filter', "Parameter {$key} musí byť dátum vo formáte YYYY-MM-DD.", 400);
    }

    public static function badDateRange(): self
    {
        return new self('bad_filter', 'date_from nesmie byť neskôr než date_to.', 400);
    }

    public static function invalidCountry(): self
    {
        return new self('bad_filter', 'Parameter country musí byť dvojpísmenový ISO kód krajiny.', 400);
    }

    public static function invalidAmount(string $key): self
    {
        return new self('bad_filter', "Parameter {$key} musí byť nezáporné číslo.", 400);
    }

    public static function badTotalRange(): self
    {
        return new self('bad_filter', 'total_min nesmie byť väčšie než total_max.', 400);
    }

    /** Neznámy kľúč vo filtroch — chyba programátora, nie stav e-shopu. */
    public static function unknownFilter(string $keys): self
    {
        return new self('bad_filter', "Neznámy filter objednávok: {$keys}.", 400);
    }
}
