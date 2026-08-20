<?php

namespace App\Services\Console\Tools;

/**
 * Unified diff pre náhľad zápisu do súboru.
 *
 * Vlastný, hoci `sebastian/diff` je v kontejneri — ten je závislosť PHPUnitu
 * (`require-dev`). Náhľad zápisu je bezpečnostný prvok bežiaci v produkcii a
 * `composer install --no-dev` by ho ticho zhodil na `Class not found`
 * v okamihu, keď má človek rozhodnúť o prepísaní súboru.
 *
 * LCS je O(n·m), takže sa najprv odstrihne spoločný začiatok a koniec — pri
 * reálnej úprave (`edit_file` mení niekoľko riadkov) zostane okno rádu desiatok
 * riadkov. Keby aj tak zostalo príliš veľké okno, {@see self::TOO_BIG} prepne
 * na hrubý náhľad: klamať o obsahu je horšie než priznať, že diff sa nezmestil.
 */
final class UnifiedDiff
{
    /** Riadkov kontextu okolo zmeny — tri sú konvencia `diff -u`. */
    private const CONTEXT = 3;

    /** Nad týmto súčinom (riadky × riadky) sa LCS nepočíta. */
    private const TOO_BIG = 4_000_000;

    /**
     * @param  string  $label  cesta relatívna ku koreňu (hlavička `---`/`+++`)
     */
    public static function between(string $before, string $after, string $label): string
    {
        if ($before === $after) {
            return "Bez zmeny: {$label}";
        }

        $a = self::lines($before);
        $b = self::lines($after);

        $header = "--- a/{$label}\n+++ b/{$label}\n";

        if (count($a) * count($b) > self::TOO_BIG) {
            return $header.self::coarse($a, $b);
        }

        $hunks = self::hunks($a, $b);

        // Bajty sa líšia, ale riadky nie — zmena je teda LEN v koncoch riadkov
        // alebo na konci súboru (`\n` navyše/menej, CRLF → LF). Vrátiť tu „Bez
        // zmeny" bola pasca v tom jedinom mieste, kde náhľad nesie váhu: človek
        // dostal kartu s vetou „nič sa nestane", povolil ju — a zápis prepísal
        // konce riadkov v celom súbore. Pri `write_file` nad windowsovým
        // checkoutom servovaným do linuxového kontejnera je to presne tento repo.
        // Náhľad preto musí povedať, že sa mení niečo neviditeľné, a čo presne.
        if ($hunks === '') {
            return "Zmena len v koncoch riadkov alebo na konci súboru: {$label}\n"
                .self::invisibleDelta($before, $after);
        }

        return $header.$hunks;
    }

    /**
     * Popis zmeny, ktorú diff riadkov neuvidí. Vypisuje sa v znakoch a v počte
     * konkrétnych zakončení, nie ako „whitespace" — človek sa rozhoduje o zápise
     * a potrebuje vedieť, či mu to prepíše celý súbor, alebo ubralo jeden znak.
     */
    protected static function invisibleDelta(string $before, string $after): string
    {
        $count = static fn (string $s, string $needle): int => substr_count($s, $needle);

        $crlfBefore = $count($before, "\r\n");
        $crlfAfter = $count($after, "\r\n");

        // Osamotené CR (staré Mac konce) — CRLF sa musí odpočítať, inak by sa
        // každý windowsový riadok počítal dvakrát.
        $crBefore = $count($before, "\r") - $crlfBefore;
        $crAfter = $count($after, "\r") - $crlfAfter;

        $lines = [];

        if ($crlfBefore !== $crlfAfter) {
            $lines[] = "  CRLF zakončení: {$crlfBefore} → {$crlfAfter}";
        }

        if ($crBefore !== $crAfter) {
            $lines[] = "  samotných CR: {$crBefore} → {$crAfter}";
        }

        $tailBefore = str_ends_with($before, "\n") ? 'áno' : 'nie';
        $tailAfter = str_ends_with($after, "\n") ? 'áno' : 'nie';

        if ($tailBefore !== $tailAfter) {
            $lines[] = "  nový riadok na konci: {$tailBefore} → {$tailAfter}";
        }

        $lines[] = sprintf('  veľkosť: %d → %d bajtov', strlen($before), strlen($after));

        return implode("\n", $lines);
    }

    /**
     * Náhľad pre novo zakladaný súbor — nie je proti čomu diffovať, takže sa
     * ukáže celý obsah ako pridaný.
     */
    public static function forNewFile(string $content, string $label): string
    {
        $lines = self::lines($content);
        $count = count($lines);

        $out = "--- /dev/null\n+++ b/{$label}\n@@ -0,0 +1,{$count} @@\n";

        foreach ($lines as $line) {
            $out .= '+'.$line."\n";
        }

        return $out;
    }

    /**
     * Rozdelenie na riadky, ktoré NEvyrobí falošný prázdny riadok na konci:
     * "a\n" sú v diffe jeden riadok, nie dva. Ináč by každý náhľad hlásil zmenu
     * na poslednom riadku aj tam, kde žiadna nie je.
     *
     * @return array<int, string>
     */
    private static function lines(string $text): array
    {
        if ($text === '') {
            return [];
        }

        $lines = preg_split("/\r\n|\n|\r/", $text) ?: [];

        if ($lines !== [] && end($lines) === '') {
            array_pop($lines);
        }

        return array_values($lines);
    }

    /**
     * @param  array<int, string>  $a
     * @param  array<int, string>  $b
     */
    private static function hunks(array $a, array $b): string
    {
        $ops = self::diffOps($a, $b);

        // Zoskupenie do hunkov: zmenené riadky + CONTEXT okolo. Súvislé bloky sa
        // spájajú, aby dva riadky od seba nedali dva hunky s rovnakým kontextom.
        $changed = [];
        foreach ($ops as $i => $op) {
            if ($op[0] !== ' ') {
                $changed[] = $i;
            }
        }

        if ($changed === []) {
            return '';
        }

        $groups = [];
        $start = $changed[0];
        $end = $changed[0];

        foreach (array_slice($changed, 1) as $i) {
            if ($i - $end <= self::CONTEXT * 2) {
                $end = $i;

                continue;
            }

            $groups[] = [$start, $end];
            $start = $end = $i;
        }
        $groups[] = [$start, $end];

        $out = '';
        foreach ($groups as [$from, $to]) {
            $from = max(0, $from - self::CONTEXT);
            $to = min(count($ops) - 1, $to + self::CONTEXT);

            $oldStart = $newStart = 0;
            for ($i = 0; $i < $from; $i++) {
                if ($ops[$i][0] !== '+') {
                    $oldStart++;
                }
                if ($ops[$i][0] !== '-') {
                    $newStart++;
                }
            }

            $oldCount = $newCount = 0;
            $body = '';
            for ($i = $from; $i <= $to; $i++) {
                [$op, $line] = $ops[$i];
                $body .= $op.$line."\n";
                if ($op !== '+') {
                    $oldCount++;
                }
                if ($op !== '-') {
                    $newCount++;
                }
            }

            $out .= '@@ -'.($oldStart + 1).",{$oldCount} +".($newStart + 1).",{$newCount} @@\n".$body;
        }

        return $out;
    }

    /**
     * Zoznam operácií (' ', '-', '+') nad riadkami.
     *
     * @param  array<int, string>  $a
     * @param  array<int, string>  $b
     * @return array<int, array{0: string, 1: string}>
     */
    private static function diffOps(array $a, array $b): array
    {
        $prefix = 0;
        $lenA = count($a);
        $lenB = count($b);

        while ($prefix < $lenA && $prefix < $lenB && $a[$prefix] === $b[$prefix]) {
            $prefix++;
        }

        $suffix = 0;
        while (
            $suffix < ($lenA - $prefix)
            && $suffix < ($lenB - $prefix)
            && $a[$lenA - 1 - $suffix] === $b[$lenB - 1 - $suffix]
        ) {
            $suffix++;
        }

        $midA = array_slice($a, $prefix, $lenA - $prefix - $suffix);
        $midB = array_slice($b, $prefix, $lenB - $prefix - $suffix);

        $ops = [];
        for ($i = 0; $i < $prefix; $i++) {
            $ops[] = [' ', $a[$i]];
        }

        foreach (self::lcsOps($midA, $midB) as $op) {
            $ops[] = $op;
        }

        for ($i = $lenA - $suffix; $i < $lenA; $i++) {
            $ops[] = [' ', $a[$i]];
        }

        return $ops;
    }

    /**
     * @param  array<int, string>  $a
     * @param  array<int, string>  $b
     * @return array<int, array{0: string, 1: string}>
     */
    private static function lcsOps(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);

        if ($n === 0 || $m === 0) {
            $ops = [];
            foreach ($a as $line) {
                $ops[] = ['-', $line];
            }
            foreach ($b as $line) {
                $ops[] = ['+', $line];
            }

            return $ops;
        }

        // Klasická LCS tabuľka. Okno je po odstrihnutí prefixu/suffixu malé;
        // strop na súčin drží {@see self::TOO_BIG} vyššie.
        $table = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));

        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                $table[$i][$j] = $a[$i] === $b[$j]
                    ? $table[$i + 1][$j + 1] + 1
                    : max($table[$i + 1][$j], $table[$i][$j + 1]);
            }
        }

        $ops = [];
        $i = $j = 0;

        while ($i < $n && $j < $m) {
            if ($a[$i] === $b[$j]) {
                $ops[] = [' ', $a[$i]];
                $i++;
                $j++;
            } elseif ($table[$i + 1][$j] >= $table[$i][$j + 1]) {
                $ops[] = ['-', $a[$i]];
                $i++;
            } else {
                $ops[] = ['+', $b[$j]];
                $j++;
            }
        }

        while ($i < $n) {
            $ops[] = ['-', $a[$i++]];
        }

        while ($j < $m) {
            $ops[] = ['+', $b[$j++]];
        }

        return $ops;
    }

    /**
     * Hrubý náhľad pre súbory, na ktoré je LCS priveľká: povie počty a ukáže
     * začiatok oboch strán. Človek tak vidí, ČO sa deje, aj keď nevidí presne kde.
     *
     * @param  array<int, string>  $a
     * @param  array<int, string>  $b
     */
    private static function coarse(array $a, array $b): string
    {
        $head = static fn (array $lines, string $sign): string => implode('', array_map(
            fn (string $l) => $sign.$l."\n",
            array_slice($lines, 0, 40),
        ));

        return '@@ celý súbor @@ '.count($a).' riadkov → '.count($b)
            ." riadkov (súbor je príliš veľký na presný diff)\n"
            .$head($a, '-')."...\n".$head($b, '+')."...\n";
    }
}
