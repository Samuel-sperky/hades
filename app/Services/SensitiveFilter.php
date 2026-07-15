<?php

namespace App\Services;

/**
 * Lokálny bezpečnostný filter (bez LLM). Zachytáva zjavné tajomstvá a citlivé
 * údaje, ktoré Hades NIKDY nesmie uložiť: heslá, API kľúče, finančné a
 * zdravotné údaje, osobné údaje tretích. Čisto vzorové/regexové pravidlá.
 */
class SensitiveFilter
{
    /**
     * @var array<string, string> label => regex
     */
    protected array $patterns = [
        'API kľúč / token' => '/\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\-_]{20,}|xox[baprs]-[0-9A-Za-z-]{10,})\b/',
        'súkromný kľúč' => '/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/',
        'Bearer token' => '/\bBearer\s+[A-Za-z0-9\-\._~\+\/]{20,}=*/i',
        'JWT' => '/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/',
        'heslo' => '/\b(heslo|password|passwd|pass|pwd)\s*[:=]\s*\S{4,}/i',
        'platobná karta' => '/\b(?:\d[ -]?){15,16}\b/',
        'IBAN' => '/\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){2,7}[A-Z0-9]{1,4}\b/',
        'rodné číslo' => '/\b\d{6}\/\d{3,4}\b/',
    ];

    /**
     * @var array<string, string> label => keyword regex (kontextové, opatrné)
     */
    protected array $keywordPatterns = [
        'zdravotný údaj' => '/\b(diagn[óo]za|diagnosis|choroba|liek na|dávkovanie|krvn[ýy] tlak|HIV|depresi[au]|antidepres)\b/i',
    ];

    /**
     * Vráti dôvod odmietnutia (string), ak text obsahuje citlivý údaj; inak null.
     */
    public function scan(?string ...$texts): ?string
    {
        $haystack = trim(implode("\n", array_filter($texts)));
        if ($haystack === '') {
            return null;
        }

        foreach ($this->patterns as $reason => $regex) {
            if (preg_match($regex, $haystack)) {
                return $reason;
            }
        }

        foreach ($this->keywordPatterns as $reason => $regex) {
            if (preg_match($regex, $haystack)) {
                return $reason;
            }
        }

        return null;
    }
}
