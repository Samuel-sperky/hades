<?php

namespace App\Services\Chat;

/**
 * Voliteľný zdroj odpovedí pre doménové zámery (dnes `shop.*` z balíka P11).
 * Vlastník rozhrania P5, implementácia P11.
 *
 * Toto je backendový ekvivalent `data-*` hooku z §5 kontraktu: P11 svoju
 * implementáciu naviaže na `DomainAnswerer::class` v kontejneri a nemusí
 * otvoriť ani jeden súbor chatu. Keď väzba neexistuje, chat odpovie čestnou
 * šablónou „napojenie ešte nie je aktívne" a NIKDY si čísla nevymyslí.
 */
interface DomainAnswerer
{
    /** Vie tento answerer obslúžiť daný zámer? */
    public function handles(Intent $intent): bool;

    /**
     * Odpoveď zložená z reálnych dát. `null` = nedokázal odpovedať
     * (napr. API nedostupné) → volajúci použije šablónu.
     */
    public function answer(Intent $intent, string $message): ?ChatAnswer;
}
