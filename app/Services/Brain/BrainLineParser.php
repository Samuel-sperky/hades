<?php

namespace App\Services\Brain;

/**
 * Parsuje obsah jedného `- …` bulletu (bez úvodnej pomlčky) z mozgu.
 *
 * Rozpoznávané tvary (tolerantné):
 *   ✅ 2026-07-10 (zdroj) — text     → štruktúrované, certainty + dátum + zdroj
 *   ⚠️ 2026-07-10 — text             → štruktúrované (emoji s FE0F variantom)
 *   2026-07-10 — text                 → štruktúrované, certainty=null
 *   čokoľvek iné                      → neštruktúrované + needs_review
 *   (zatiaľ nič) / (n/a) / (doplniť…) → placeholder, vracia null (preskočí sa)
 *
 * Tolerancia oddeľovača: em-dash „—", en-dash „–" alebo obyčajné „-".
 * Emoji → certainty: ✅=overene, 🧪=hypoteza, ⚠️/⚠=pasca.
 */
final class BrainLineParser
{
    // ⚠️ (s FE0F) MUSÍ byť v alternácii pred holým ⚠, inak by regex zjedol len
    // základný codepoint a FE0F by zostal visieť v texte.
    private const EMOJI = '✅|🧪|⚠️|⚠';

    private const DATE = '\d{4}-\d{2}-\d{2}';

    private const DASH = '—|–|-';

    /**
     * Emoji istoty → Hades certainty string.
     */
    public static function certaintyFromEmoji(string $emoji): ?string
    {
        return match (trim($emoji)) {
            '✅' => 'overene',
            '🧪' => 'hypoteza',
            '⚠️', '⚠' => 'pasca',
            default => null,
        };
    }

    /**
     * @return BrainLine|null null = placeholder bullet, preskočiť celý
     */
    public function parse(string $content): ?BrainLine
    {
        $content = trim($content);

        if ($content === '') {
            return null;
        }

        // Placeholder bullety: celý obsah zabalený v zátvorkách,
        // napr. „(zatiaľ nič)", „(n/a)", „(doplniť … pri prvom zápise)".
        if (preg_match('/^\(.*\)$/su', $content)) {
            return null;
        }

        $emoji = self::EMOJI;
        $date = self::DATE;
        $dash = self::DASH;

        // Plný štruktúrovaný riadok: emoji [dátum] [(zdroj)] pomlčka text
        if (preg_match(
            "/^(?<emoji>{$emoji})\\s*(?<date>{$date})?\\s*(?:\\((?<source>[^()]*)\\))?\\s*(?:{$dash})\\s*(?<text>.+)$/su",
            $content,
            $m
        )) {
            return new BrainLine(
                text: trim($m['text']),
                certainty: self::certaintyFromEmoji($m['emoji']),
                notedOn: ($m['date'] ?? '') !== '' ? $m['date'] : null,
                source: $this->cleanSource($m['source'] ?? ''),
                isStructured: true,
                needsReview: false,
            );
        }

        // Dátum bez emoji (napr. „- 2026-07-10 — text" v „Rozhodnutiach")
        if (preg_match(
            "/^(?<date>{$date})\\s*(?:\\((?<source>[^()]*)\\))?\\s*(?:{$dash})\\s*(?<text>.+)$/su",
            $content,
            $m
        )) {
            return new BrainLine(
                text: trim($m['text']),
                certainty: null,
                notedOn: $m['date'],
                source: $this->cleanSource($m['source'] ?? ''),
                isStructured: true,
                needsReview: false,
            );
        }

        // Všetko ostatné: zachovaj, ale označ na kontrolu (NIC sa nezahadzuje).
        return new BrainLine(
            text: $content,
            certainty: null,
            notedOn: null,
            source: null,
            isStructured: false,
            needsReview: true,
        );
    }

    private function cleanSource(string $source): ?string
    {
        $source = trim($source);

        return $source === '' ? null : $source;
    }
}
