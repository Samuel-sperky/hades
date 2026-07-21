<?php

namespace App\Services\Brain;

/**
 * Imunitný sken: deteguje vzory pripomínajúce tajomstvo v texte PREDTÝM, než sa
 * zapíše do mozgu alebo do vedomia (MCP `mind_learn`). Jediný zdroj pravdy pre
 * detekciu tajomstiev — volá ho brain-write ({@see BrainWriter}) aj
 * {@see \App\Http\Controllers\McpController}.
 *
 * Vzory sú portované VERBATIM z Apollo\Services\Writer\SecretScanner (spoločný
 * kánon redakcie) a doplnené o Hades vzor „dlhý hex ≥40" (SHA/API kľúč), ktorý
 * mal pôvodný `McpController::looksLikeSecret`.
 *
 * Vracia LEN NÁZVY VZOROV. Matched hodnota sa nikdy nevystaví, neloguje ani
 * nevráti nikam.
 */
class SecretScanner
{
    /** @var array<string, string> názov vzoru → regulárny výraz */
    private const PATTERNS = [
        // --- Apollo patterny (verbatim) ---
        'anthropic-key' => '/sk-ant-[A-Za-z0-9_\-]{10,}/',
        'openai-key' => '/sk-[A-Za-z0-9_\-]{40,}/',
        'aws-key' => '/AKIA[0-9A-Z]{16}/',
        'github-token' => '/(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/',
        'slack-token' => '/xox[baprs]-[A-Za-z0-9\-]{10,}/',
        'private-key' => '/-----BEGIN [A-Z ]*PRIVATE KEY-----/',
        'jwt' => '/eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/',
        'conn-string' => '#(?:mysql|postgres|postgresql|redis|mongodb(?:\+srv)?|amqp)://[^\s:@/]+:[^\s@/]+@#',
        'url-basic-auth' => '#https?://[^\s:@/]+:[^\s@/]+@#',
        'bearer' => '/bearer\s+[A-Za-z0-9_\-.=]{15,}/i',
        'password-assign' => '/\b(?:password|passwd|pwd|heslo|secret|token|api[_-]?key|salt)\b\s*[:=]\s*["\']?[^\s"\'<\[\]]{6,}/iu',

        // --- Hades doplnok: dlhý hex ≥40 (SHA / API kľúč) ---
        'long-hex' => '/\b[0-9a-f]{40,}\b/i',
    ];

    /**
     * @return list<string>  názvy zhodných vzorov (unikátne, hodnota NIKDY nie je súčasťou)
     */
    public function scan(string $text): array
    {
        $found = [];

        foreach (self::PATTERNS as $name => $regex) {
            if (preg_match($regex, $text) === 1) {
                $found[] = $name;
            }
        }

        return $found;
    }

    /**
     * Pohodlný boolean guard pre volajúcich, ktorým stačí „áno/nie" (napr.
     * MCP blacklist). Stále nevracia hodnotu.
     */
    public function looksLikeSecret(string $text): bool
    {
        return $this->scan($text) !== [];
    }
}
