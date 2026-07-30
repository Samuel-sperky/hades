<?php

namespace App\Services\Chat;

use Illuminate\Support\Str;

/**
 * Detekcia zámeru „zapamätaj si". Vlastník P5.
 *
 * Prenesené 1:1 z `ChatController::detectRememberIntent()` — chovanie sa
 * nemení, len sa vymanilo z controlleru. Detekcia beží aj bez modelu.
 *
 * DÔLEŽITÉ: uzol sa tu NEVYTVÁRA. Vracia sa len návrh a potvrdzuje ho
 * frontend (karta „Zapamätať", rozhodnutie #94).
 */
final class RememberIntentDetector
{
    private const CUES = [
        'zapamätaj', 'zapamataj', 'zapíš si', 'zapis si', 'zapíš', 'zapis',
        'ulož', 'uloz', 'pridaj do', 'remember', 'save this',
    ];

    /** @return array{label: string, type: string, description: string}|null */
    public function detect(string $message): ?array
    {
        $low = mb_strtolower($message);

        $pos = null;
        $matched = null;
        foreach (self::CUES as $cue) {
            $p = mb_strpos($low, $cue);
            if ($p !== false) {
                $pos = $p;
                $matched = $cue;
                break;
            }
        }

        if ($matched === null) {
            return null;
        }

        // Text za návestím = to, čo si treba zapamätať.
        $after = mb_substr($message, $pos + mb_strlen($matched));
        $after = ltrim($after, " :,-–—\t\r\n");
        // Zahoď úvodné spojky typu „si, že" / „that" / „this" (aj reťaz „si že").
        $after = preg_replace('/^((si|that|this|že|ze)\b[\s:,]*)+/iu', '', $after) ?? $after;

        $description = trim($after) !== '' ? trim($after) : trim($message);

        $label = trim((string) Str::limit($description, 60, ''));
        if ($label === '') {
            $label = trim((string) Str::limit($message, 60, ''));
        }

        return [
            'label' => $label,
            'type' => 'memory',
            'description' => $description,
        ];
    }
}
