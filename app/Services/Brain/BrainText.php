<?php

namespace App\Services\Brain;

/**
 * Textové pomôcky zdieľané parserom mozgov a sync vrstvou.
 *
 * Port z Apollo\Services\Brain\Text — prispôsobený Hades štýlu (SK komentáre,
 * sha256 identita riadku, [[wiki]] extrakcia).
 */
final class BrainText
{
    /**
     * Normalizácia pre hashovanie obsahu: trim + zbalenie všetkých bielych
     * znakov (vrátane nových riadkov) na jednu medzeru. Vďaka nej dva súbory
     * s rovnakým obsahom (líšiace sa len whitespace-om) dostanú rovnaký hash.
     */
    public static function normalize(string $text): string
    {
        return trim(preg_replace('/\s+/u', ' ', $text) ?? $text);
    }

    /** sha256 normalizovaného textu — upsert identita uzla (content_hash). */
    public static function hash(string $text): string
    {
        return hash('sha256', self::normalize($text));
    }

    /**
     * Vytiahne [[wiki-link]] ciele z textu. Podporuje aj alias `[[cieľ|text]]`
     * (berie sa cieľ). Vracia unikátne, orezané hodnoty v poradí výskytu.
     *
     * @return list<string>
     */
    public static function wikiLinks(string $text): array
    {
        preg_match_all('/\[\[([^\[\]|]+)(?:\|[^\[\]]*)?\]\]/u', $text, $matches);

        return array_values(array_unique(array_map('trim', $matches[1])));
    }
}
