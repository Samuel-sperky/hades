<?php

namespace App\Services\Console\Tools;

/**
 * Tool, pri ktorom „povoliť vždy" NESMIE znamenať „povoliť všetko".
 *
 * Prečo to existuje: `allow_always` v konzole doteraz zapínalo `auto_accept` na
 * celé vlákno, teda jedno kliknutie povolilo bez pýtania aj `mind_delete` a
 * `write_file`. Pri tooloch, ktorých argument je z uzavretej množiny (uzol, cesta
 * v repe), to je ešte obhájiteľné. Pri `bash` nie: jeho argument je celý jazyk,
 * takže „povoľ vždy" pri `php artisan test` by ticho povolilo aj `git diff` —
 * a hlavne všetko ostatné, čo klietka pustí.
 *
 * Tool, ktorý toto rozhranie implementuje, si preto k svojim argumentom vypočíta
 * ÚZKY kľúč a povolenie sa uloží len preň. Ďalší príkaz s iným kľúčom sa spýta
 * znova.
 *
 * Prečo samostatné rozhranie a nie metóda v {@see ConsoleTool}: fake tooly v
 * `ConsoleRunTest` implementujú `ConsoleTool` priamo (nie cez `BaseTool`), takže
 * nová metóda v kontrakte by ich rozbila — a test, ktorý po rozšírení nepadne
 * kvôli logike, ale kvôli syntaxi, sa opravuje naslepo. `instanceof` je tu
 * lacnejšie a čitateľnejšie než rozšírenie, ktoré sa dotkne všetkých toolov.
 */
interface NarrowsAllowance
{
    /**
     * Kľúč, na ktorý sa povolenie zúži — alebo `null`, keď sa z týchto argumentov
     * nedá vypočítať (vtedy sa nepovolí nič a beh sa spýta znova).
     *
     * @param  array<string, mixed>  $args
     */
    public function allowanceKey(array $args): ?string;
}
