<?php

namespace App\Services\Console\Tools;

use App\Services\Console\ToolResult;

/**
 * Jeden tool Charóna.
 *
 * Tri veci, ktoré tento kontrakt drží a ktoré sa inak rozsypú:
 *
 *  1. **`description()` píšeme MODELU, nie človeku.** Lokálny model beží na CPU
 *     ~9 tok/s, takže si nemôže dovoliť tri pokusy — popis musí povedať KEDY
 *     tool použiť a ČO vráti. Toto je najsilnejšia páka na to, či slabý model
 *     tool použije správne; komentár k triede je proti nej bezcenný.
 *  2. **`schema()` je plochá a malá.** Slabý model si vnorené objekty vymýšľa:
 *     dá `{"args":{"path":…}}` namiesto `{"path":…}`. Preto len skalárne
 *     parametre a čo najmenej voliteľných.
 *  3. **`isWrite()` rozhoduje o povolení.** `true` = beh sa PARKUJE a čaká na
 *     človeka. Nový tool zaradený omylom na čítaciu stranu je diera, nie
 *     preklep — a preto to testuje `ConsoleToolsTest`.
 */
interface ConsoleTool
{
    /** snake_case meno, ktoré vidí model. */
    public function name(): string;

    /** Popis PRE MODEL: kedy tool použiť a čo vráti. */
    public function description(): string;

    /**
     * JSON schema argumentov — plochá, s `required` zoznamom.
     *
     * @return array{type: string, properties: array<string, mixed>, required: array<int, string>}
     */
    public function schema(): array;

    /** `true` = zápis, musí ho pred vykonaním potvrdiť človek. */
    public function isWrite(): bool;

    /**
     * Čo uvidí človek pred povolením zápisu — unified diff pri súboroch, pole
     * pred/po pri pamäti. `null` pri čítacích tooloch (nie je čo potvrdzovať).
     *
     * Náhľad sa počíta PRED vykonaním; po zápise už nie je z čoho.
     *
     * @param  array<string, mixed>  $args
     *
     * @throws ToolRefusal keď sú argumenty také, že zápis by sa aj tak odmietol
     */
    public function preview(array $args): ?string;

    /**
     * @param  array<string, mixed>  $args
     *
     * @throws ToolRefusal odmietnutie s dôvodom pre model
     */
    public function execute(array $args): ToolResult;
}
