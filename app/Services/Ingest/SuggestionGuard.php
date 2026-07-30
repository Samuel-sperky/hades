<?php

namespace App\Services\Ingest;

use App\Services\Brain\SecretScanner;

/**
 * Deterministická brána pre návrhy modelu (rozhodnutie #112: „model navrhne,
 * deterministický kód rozhodne").
 *
 * Guard nikdy nič neopravuje „aby to prešlo" — buď návrh po normalizácii splní
 * všetky podmienky a použije sa, alebo vráti null a volajúci zoberie svoj
 * dnešný deterministický výsledok. Preto je aj pri zapnutom modeli nemožné,
 * aby sa do pamäte dostal prázdny titulok, odsek s tajomstvom alebo `<think>`
 * blok routera.
 */
class SuggestionGuard
{
    /** Titulok session — rovnaké hranice ako heuristika: 15–60 znakov. */
    public const TITLE_MIN = 15;

    public const TITLE_MAX = 60;

    /** Zhrnutie session — kratšie než extraktívne nemá zmysel, dlhšie sa nezobrazí. */
    public const SUMMARY_MIN = 40;

    public const SUMMARY_MAX = 1_200;

    public function __construct(
        protected SecretScanner $secrets = new SecretScanner(),
    ) {}

    /**
     * Návrh titulku → použiteľný titulok alebo null.
     *
     * Zamietne: prázdny, príliš krátky/dlhý, s tajomstvom, začínajúci URL alebo
     * lomkou (rovnaké pravidlo ako heuristika), so zvyškom redakčnej značky.
     */
    public function title(?string $raw): ?string
    {
        $text = $this->normalize((string) $raw);
        if ($text === '') {
            return null;
        }

        // len prvý riadok, bez obaľujúcich úvodzoviek a markdown nadpisu
        $text = trim((string) preg_split('/\r?\n/', $text, 2)[0]);
        $text = ltrim($text, "#* \t");
        $text = trim($text, " \t\"'„“»«");
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        if ($text === '' || mb_strlen($text) < self::TITLE_MIN || mb_strlen($text) > self::TITLE_MAX) {
            return null;
        }
        if (preg_match('/^(https?:|www\.|\/)/iu', $text)) {
            return null;
        }
        if (! $this->clean($text)) {
            return null;
        }

        return $text;
    }

    /**
     * Návrh zhrnutia → použiteľné zhrnutie alebo null.
     */
    public function summary(?string $raw): ?string
    {
        $text = $this->normalize((string) $raw);
        if ($text === '') {
            return null;
        }

        // najviac jeden prázdny riadok medzi odsekmi
        $text = trim((string) preg_replace('/\n{3,}/', "\n\n", $text));

        if (mb_strlen($text) < self::SUMMARY_MIN || mb_strlen($text) > self::SUMMARY_MAX) {
            return null;
        }
        if (! $this->clean($text)) {
            return null;
        }

        return $text;
    }

    /**
     * Normalizácia spoločná pre všetky návrhy: preč `<think>` bloky uvažujúcich
     * modelov, preč JSON obal, preč riadiace znaky.
     */
    protected function normalize(string $raw): string
    {
        $text = (string) preg_replace('~<think>.*?</think>~is', '', $raw);
        // neuzavretý think blok (model dosiahol strop tokenov) = celé preč
        $text = (string) preg_replace('~<think>.*$~is', '', $text);
        $text = (string) preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/', '', $text);

        return $this->unwrapJson(trim($text));
    }

    /**
     * Modelové vetvy majú v `config/llm.php` vynútený `format: "json"` (inak sa
     * uvažovanie qwen3 vylieva do obsahu), takže návrh môže prísť ako JSON objekt.
     * Vyberieme z neho jedno textové pole. Keď je to JSON objekt bez použiteľného
     * poľa, vrátime prázdny reťazec — surové JSON sa nikdy nesmie stať titulkom.
     */
    protected function unwrapJson(string $text): string
    {
        if (! str_starts_with($text, '{')) {
            return $text;
        }

        $data = json_decode($text, true);
        if (! is_array($data)) {
            return $text;
        }

        foreach (['title', 'titulok', 'summary', 'zhrnutie', 'text', 'answer'] as $field) {
            if (isset($data[$field]) && is_string($data[$field]) && trim($data[$field]) !== '') {
                return trim($data[$field]);
            }
        }

        // jediná textová hodnota v objekte je jednoznačná aj bez známeho kľúča
        $strings = array_values(array_filter($data, fn ($v) => is_string($v) && trim($v) !== ''));

        return count($strings) === 1 ? trim($strings[0]) : '';
    }

    /**
     * Text neobsahuje tajomstvo ani zvyšok redakčnej značky.
     * Značka v návrhu znamená, že model prepisoval už redigovaný vstup — taký
     * titulok/zhrnutie do pamäte nepustíme.
     */
    protected function clean(string $text): bool
    {
        if (str_contains($text, '[REDAKTOVANÉ')) {
            return false;
        }

        return ! $this->secrets->looksLikeSecret($text);
    }
}
