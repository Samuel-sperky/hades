<?php

namespace App\Services\Chat;

use App\Services\Brain\SecretScanner;

/**
 * Deterministická brána medzi modelom a používateľom. Vlastník P5.
 *
 * Model smie šablónovú odpoveď najviac PREFORMULOVAŤ, resp. navrhnúť názov vlákna.
 * Túto hranicu vynucuje tento kód, nie prompt — vďaka tomu platí „model nikdy
 * negeneruje čísla" ako vlastnosť implementácie, nie ako prosba v systémovom prompte.
 */
final class RephraseValidator
{
    /** Model uvažujúci nahlas začína takto (meranie 30. 7. 2026). */
    private const THINKING_MARKERS = [
        'okay,', 'okay ', 'alright,', 'let me', "let's", 'let us',
        'the user', 'first, i', 'i need to', 'wait,', 'hmm,',
        'as an ai', 'i cannot', 'sure! here', 'here is the',
    ];

    public function __construct(private readonly SecretScanner $scanner) {}

    /**
     * Preformulovaná odpoveď. Prejde len keď je MULTISET čísel identický so
     * šablónou — ani pridané, ani zmenené, ani vypustené číslo.
     */
    public function validate(string $template, string $candidate): ?string
    {
        $candidate = trim($candidate);

        if (! $this->isClean($candidate)) {
            return null;
        }

        $maxGrowth = (float) config('llm.rephrase.max_growth', 2.0);
        if (mb_strlen($candidate) > max(120, (int) ceil(mb_strlen($template) * $maxGrowth))) {
            return null;
        }

        if ($this->numbers($template) !== $this->numbers($candidate)) {
            return null;
        }

        return $candidate;
    }

    /**
     * Názov vlákna. Titulok smie čísla VYPUSTIŤ (skracuje sa), ale nesmie
     * žiadne pridať — inak by si model vymyslel číslo do názvu.
     */
    public function validateTitle(string $source, string $candidate, int $maxLength = 60): ?string
    {
        $candidate = trim($candidate);

        if (! $this->isClean($candidate) || mb_strlen($candidate) > $maxLength) {
            return null;
        }

        $allowed = $this->numbers($source);
        foreach ($this->numbers($candidate) as $number) {
            if (! in_array($number, $allowed, true)) {
                return null;
            }
        }

        return $candidate;
    }

    /** Neprázdne, bez uvažovania nahlas, bez tajomstva (rozhodnutie #149). */
    private function isClean(string $candidate): bool
    {
        if ($candidate === '') {
            return false;
        }

        $low = mb_strtolower($candidate);
        foreach (self::THINKING_MARKERS as $marker) {
            if (str_contains($low, $marker)) {
                return false;
            }
        }

        return $this->scanner->scan($candidate) === [];
    }

    /**
     * Multiset čísel v texte. Medzery a nezlomiteľné medzery medzi číslicami sa
     * najprv odstránia, aby „2 037" a „2037" boli to isté číslo.
     *
     * @return list<string>
     */
    private function numbers(string $text): array
    {
        $text = preg_replace('/(?<=\d)[\s\x{00A0}\x{202F}](?=\d)/u', '', $text) ?? $text;

        preg_match_all('/\d+/u', $text, $matches);
        $numbers = array_map(fn (string $n) => ltrim($n, '0') ?: '0', $matches[0]);
        sort($numbers);

        return array_values($numbers);
    }
}
