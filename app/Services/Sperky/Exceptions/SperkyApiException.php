<?php

namespace App\Services\Sperky\Exceptions;

/**
 * INFRASTRUKTÚRNA chyba: e-shop je nedostupný, odmieta kľúč, obmedzuje nás
 * rate limitom alebo vracia niečo, čo sa nedá prečítať.
 *
 * Odlíšenie od {@see SperkyDomainException} je celý point nálezu N6 — HTTP status
 * NIE JE zdroj pravdy, `forbidden` prichádza s kódom 200 a chybou v tele, takže
 * bez parsovania tela by sa „zlý kľúč" javil ako úspech.
 *
 * Správy sú fixné konštanty. Žiadny reťazec z odpovede sa do nich nedostane —
 * inak by echo hlavičky v tele odpovede vypustilo API kľúč do logu.
 */
class SperkyApiException extends SperkyException
{
    /** Chyby, pri ktorých má opakovanie zmysel (timeout, 5xx, rate limit). */
    private const RETRYABLE = ['unavailable', 'timeout', 'server', 'rate_limited'];

    public function isInfrastructure(): bool
    {
        return true;
    }

    public function isRetryable(): bool
    {
        return in_array($this->errorCode, self::RETRYABLE, true);
    }

    /** Zlý, chýbajúci alebo nedostatočne oprávnený kľúč. Neopakovať. */
    public static function forbidden(): self
    {
        return new self('forbidden', 'E-shop odmietol prístup (forbidden).', 502);
    }

    /** Prekročený rate limit e-shopu. */
    public static function rateLimited(): self
    {
        return new self('rate_limited', 'E-shop dočasne obmedzil počet požiadaviek.', 429);
    }

    /** Spojenie sa nepodarilo nadviazať. */
    public static function unavailable(): self
    {
        return new self('unavailable', 'E-shop neodpovedá.', 503);
    }

    /** Požiadavka prekročila timeout. */
    public static function timeout(): self
    {
        return new self('timeout', 'E-shop neodpovedal v časovom limite.', 504);
    }

    /** 5xx na strane e-shopu. */
    public static function server(): self
    {
        return new self('server', 'E-shop vrátil chybu servera.', 502);
    }

    /** Odpoveď nie je platný JSON alebo nemá očakávanú obálku `{"result":…}`. */
    public static function malformed(): self
    {
        return new self('malformed', 'Odpoveď e-shopu sa nedá prečítať.', 502);
    }

    /** `unknown_controller` / `invalid_action` / `method_not_allowed` — zlá cesta. */
    public static function badRoute(): self
    {
        return new self('bad_route', 'Volaná cesta e-shopu neexistuje.', 502);
    }

    /** Neznámy chybový kód v tele — text z odpovede sa ZÁMERNE nepreberá. */
    public static function unexpected(): self
    {
        return new self('unexpected', 'E-shop vrátil neznámu chybu.', 502);
    }
}
