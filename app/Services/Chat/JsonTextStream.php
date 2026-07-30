<?php

namespace App\Services\Chat;

/**
 * Inkrementálne rozbalenie `{"text":"…"}` počas streamovania. Vlastník P5.
 *
 * Modelová vetva má vynútený `format:"json"` (inak sa uvažovanie vylieva do
 * obsahu — viď ModelText). Klient však chce vidieť tokeny textu, nie JSON.
 * Tento stavový automat berie surové delty a vracia len tie znaky, ktoré už
 * patria hodnote kľúča `text`.
 *
 * Zámerne to nie je JSON parser — je to najmenší možný automat, ktorý zvládne
 * escapovanie (`\"`, `\\`, `\n`, `\uXXXX`) a nikdy nevyhodí výnimku.
 */
final class JsonTextStream
{
    private const SEEK_KEY = 0;

    private const IN_VALUE = 1;

    private const DONE = 2;

    private int $state = self::SEEK_KEY;

    private string $pending = '';

    /** Vráti novo dostupný čistý text (môže byť prázdny string). */
    public function push(string $chunk): string
    {
        if ($this->state === self::DONE || $chunk === '') {
            return '';
        }

        $this->pending .= $chunk;
        $out = '';

        if ($this->state === self::SEEK_KEY) {
            // Hľadáme `"text"` … `:` … `"`. Kým nie je celý úvod v bufferi, čakáme.
            if (! preg_match('/"text"\s*:\s*"/', $this->pending, $m, PREG_OFFSET_CAPTURE)) {
                return '';
            }

            $this->pending = substr($this->pending, $m[0][1] + strlen($m[0][0]));
            $this->state = self::IN_VALUE;
        }

        while ($this->pending !== '') {
            $char = $this->pending[0];

            if ($char === '"') {
                $this->pending = '';
                $this->state = self::DONE;
                break;
            }

            if ($char !== '\\') {
                // Multibyte znak môže byť rozdelený medzi dve delty — vezmeme
                // len úplné znaky a zvyšok necháme v bufferi.
                $len = $this->utf8Length($char);
                if (strlen($this->pending) < $len) {
                    break;
                }
                $out .= substr($this->pending, 0, $len);
                $this->pending = substr($this->pending, $len);

                continue;
            }

            // Escape sekvencia — potrebujeme aspoň 2 znaky, pri \u až 6.
            if (strlen($this->pending) < 2) {
                break;
            }

            $escape = $this->pending[1];

            if ($escape === 'u') {
                if (strlen($this->pending) < 6) {
                    break;
                }
                $decoded = json_decode('"'.substr($this->pending, 0, 6).'"');
                $out .= is_string($decoded) ? $decoded : '';
                $this->pending = substr($this->pending, 6);

                continue;
            }

            $out .= match ($escape) {
                'n' => "\n",
                't' => "\t",
                'r' => "\r",
                'b', 'f' => '',
                default => $escape,
            };
            $this->pending = substr($this->pending, 2);
        }

        return $out;
    }

    public function finished(): bool
    {
        return $this->state === self::DONE;
    }

    /** Nič sa nerozbalilo — model obal nedodržal. */
    public function empty(): bool
    {
        return $this->state === self::SEEK_KEY;
    }

    private function utf8Length(string $firstByte): int
    {
        $byte = ord($firstByte);

        return match (true) {
            $byte >= 0xF0 => 4,
            $byte >= 0xE0 => 3,
            $byte >= 0xC0 => 2,
            default => 1,
        };
    }
}
