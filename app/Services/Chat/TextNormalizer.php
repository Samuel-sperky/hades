<?php

namespace App\Services\Chat;

/**
 * Zloženie textu pre deterministický router. Vlastník P5.
 *
 * Používateľ píše s diakritikou aj bez nej („objednávka" / „objednavka") —
 * router preto pracuje na zloženom texte a v `config/prompts.php` je každý
 * vzor napísaný bez diakritiky práve raz.
 */
final class TextNormalizer
{
    /** Slovenské a české znaky, ktoré `iconv` na tomto obraze nemusí zvládnuť. */
    private const FOLD = [
        'á' => 'a', 'ä' => 'a', 'â' => 'a', 'à' => 'a', 'ă' => 'a', 'å' => 'a',
        'č' => 'c', 'ć' => 'c', 'ç' => 'c',
        'ď' => 'd', 'đ' => 'd',
        'é' => 'e', 'ě' => 'e', 'ë' => 'e', 'è' => 'e', 'ê' => 'e',
        'í' => 'i', 'ï' => 'i', 'ì' => 'i', 'î' => 'i',
        'ĺ' => 'l', 'ľ' => 'l', 'ł' => 'l',
        'ň' => 'n', 'ń' => 'n', 'ñ' => 'n',
        'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'ò' => 'o', 'ő' => 'o', 'ø' => 'o',
        'ŕ' => 'r', 'ř' => 'r',
        'š' => 's', 'ś' => 's', 'ş' => 's',
        'ť' => 't', 'ţ' => 't',
        'ú' => 'u', 'ů' => 'u', 'ü' => 'u', 'ù' => 'u', 'û' => 'u',
        'ý' => 'y', 'ÿ' => 'y',
        'ž' => 'z', 'ź' => 'z', 'ż' => 'z',
        'ß' => 'ss',
    ];

    /** Malé písmená, bez diakritiky, jedna medzera, bez interpunkcie na okrajoch slov. */
    public function fold(string $text): string
    {
        $text = mb_strtolower(trim($text));
        $text = strtr($text, self::FOLD);

        // Interpunkcia sa mení na medzeru, aby „objednávky:" trafilo `objednavk\w*`.
        // Bodka pri „č." a lomka v cestách zostávajú — router ich používa.
        $text = preg_replace('/[^\p{L}\p{N}\.\/#\-\s]+/u', ' ', $text) ?? $text;
        $text = preg_replace('/\s+/u', ' ', $text) ?? $text;

        return trim($text);
    }
}
