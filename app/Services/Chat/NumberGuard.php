<?php

namespace App\Services\Chat;

/**
 * Vynútenie pravidla „model nikdy negeneruje čísla" POČAS streamovania. Vlastník P5.
 *
 * Eskalačná vetva streamuje voľný text token po tokene, takže odpoveď sa nedá
 * skontrolovať až na konci — čo raz odošleme, to už používateľ videl. Guard preto
 * ZADRŽÍ každý beh číslic, kým nie je celé číslo známe, a pustí ho ďalej len keď
 * sa nachádza v podklade (vybavené uzly, priložený kontext, otázka používateľa).
 * Číslo, ktoré si model vymyslel, sa nahradí značkou a nikdy sa nezobrazí.
 *
 * Vďaka tomu je streamovanie plnohodnotné a pravidlo zostáva vlastnosťou kódu.
 */
final class NumberGuard
{
    private const MARKER = '[?]';

    /** @var list<string> */
    private array $allowed;

    private string $digits = '';

    private int $dropped = 0;

    public function __construct(string ...$sources)
    {
        $this->allowed = self::extract(implode(' ', $sources));
    }

    /** Text pripravený na odoslanie klientovi (číslice na konci zostávajú zadržané). */
    public function push(string $chunk): string
    {
        $out = '';

        foreach (preg_split('//u', $chunk, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $char) {
            if ($char >= '0' && $char <= '9') {
                $this->digits .= $char;

                continue;
            }

            // Medzera medzi číslicami je oddeľovač tisícov („2 037") — počkáme,
            // či za ňou ešte prídu číslice, inak by sa jedno číslo rozpadlo na dve.
            if ($this->digits !== '' && ($char === ' ' || $char === "\u{00A0}" || $char === "\u{202F}")) {
                $this->digits .= ' ';

                continue;
            }

            $out .= $this->flushDigits().$char;
        }

        return $out;
    }

    /** Zvyšok po skončení streamu. */
    public function flush(): string
    {
        return $this->flushDigits();
    }

    /** Koľko čísel guard zahodil — ide do `meta` a do llm_runs ako signál. */
    public function dropped(): int
    {
        return $this->dropped;
    }

    private function flushDigits(): string
    {
        if ($this->digits === '') {
            return '';
        }

        $raw = $this->digits;
        $this->digits = '';

        // Zadržaná koncová medzera nepatrí k číslu.
        $trailing = '';
        if (str_ends_with($raw, ' ')) {
            $raw = rtrim($raw, ' ');
            $trailing = ' ';
        }

        if ($raw === '') {
            return $trailing;
        }

        $normalized = self::normalize($raw);

        if (in_array($normalized, $this->allowed, true)) {
            return $raw.$trailing;
        }

        $this->dropped++;

        return self::MARKER.$trailing;
    }

    /**
     * Povolené čísla z podkladu. Berie aj tvar so oddeľovačom tisícov, aj bez neho,
     * aby „2 037" v šablóne povolilo „2037" v odpovedi a naopak.
     *
     * @return list<string>
     */
    private static function extract(string $source): array
    {
        $joined = preg_replace('/(?<=\d)[\s\x{00A0}\x{202F}](?=\d)/u', '', $source) ?? $source;

        $numbers = [];
        foreach ([$source, $joined] as $variant) {
            preg_match_all('/\d+/u', $variant, $matches);
            foreach ($matches[0] as $number) {
                $numbers[] = self::normalize($number);
            }
        }

        return array_values(array_unique($numbers));
    }

    private static function normalize(string $number): string
    {
        $number = preg_replace('/[\s\x{00A0}\x{202F}]/u', '', $number) ?? $number;

        return ltrim($number, '0') ?: '0';
    }
}
