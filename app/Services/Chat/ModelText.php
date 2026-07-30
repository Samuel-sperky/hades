<?php

namespace App\Services\Chat;

/**
 * Rozbalenie JSON obalu modelovej odpovede. Vlastník P5.
 *
 * MERANIE 30. 7. 2026 (docs/BENCHMARK-LLM.md §5): `think:false` sám nestačí —
 * qwen3:4b bez `format:"json"` vylieva uvažovanie do `message.content`
 * v angličtine („Okay, let's see. The user wants…"). S vynúteným JSON obalom
 * `{"text":"…"}` je výstup čistý. Preto má každá modelová vetva JSON obal
 * a tu sa z neho vyberá text.
 *
 * Model môže obal aj tak pokaziť — v tom prípade sa vráti null a volajúci
 * použije deterministickú šablónu.
 */
final class ModelText
{
    /** Text z `{"text": "..."}`; null keď obal nie je platný. */
    public static function extract(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $text = $decoded['text'] ?? null;

            return is_string($text) && trim($text) !== '' ? trim($text) : null;
        }

        return null;
    }

    /** Trieda zámeru z `{"intent": "..."}`; null keď obal nie je platný. */
    public static function intent(string $raw): ?string
    {
        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }

        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return null;
        }

        $intent = $decoded['intent'] ?? null;

        return is_string($intent) && trim($intent) !== '' ? trim($intent) : null;
    }
}
