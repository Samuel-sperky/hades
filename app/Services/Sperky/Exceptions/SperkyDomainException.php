<?php

namespace App\Services\Sperky\Exceptions;

/**
 * DOMÉNOVÁ chyba: e-shop funguje, len naša požiadavka nemá zmysel.
 *
 * `not found` sa výnimkou NEHLÁSI — klient vráti `null`, lebo neexistujúce id je
 * bežný stav vyhľadávania. Výnimkou sa hlási `no id`, čo je chyba programátora
 * (endpoint sa zavolal bez povinného parametra), nie porucha e-shopu.
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
}
