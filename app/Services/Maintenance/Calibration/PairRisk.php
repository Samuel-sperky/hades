<?php

namespace App\Services\Maintenance\Calibration;

use App\Models\Node;

/**
 * Ohodnotí, či by konkrétne zlúčenie bolo RIZIKOVÉ — teda či prah prekročili dve
 * rôzne veci, nie dva zápisy tej istej veci.
 *
 * Prečo to vôbec existuje: v projekte je zapísaná poučka („Canva" nesmie splynúť
 * s „Canvas visualization", viď MindService::findByLabel riadok 289). Tú poučku
 * ale stráži IBA cesta mind_learn → findByLabel. `mind:automerge` ju NEMÁ —
 * rozhoduje sa výhradne podľa kosínusu, takže pri dosť nízkom prahu vie presne
 * ten istý bug vyrobiť znova, len nad celou sieťou naraz.
 *
 * Táto trieda preto aplikuje ten istý test (lengthRatio >= 0.6 || similar_text >= 85)
 * na páry, ktoré prah prekročili, a k tomu doménové signály (iná oblasť, žiadny
 * spoločný token, pohltenie silného uzla). Nič nefiltruje — len ZNAČKUJE, aby
 * človek v reporte videl, o čom rozhoduje.
 */
class PairRisk
{
    /** Slová, ktoré nesú príliš málo významu na to, aby robily pár „príbuzným". */
    private const STOPWORDS = [
        'a', 'aj', 'ako', 'the', 'and', 'for', 'pre', 'na', 'do', 'sa', 'je', 'to',
        'v', 'vo', 'z', 'zo', 's', 'so', 'o', 'od', 'po', 'pri', 'za', 'of', 'in',
    ];

    /**
     * @return array{level: string, reasons: list<string>}
     */
    public function assess(Node $winner, Node $loser): array
    {
        $reasons = [];
        $high = false;

        $a = mb_strtolower(trim((string) $winner->label));
        $b = mb_strtolower(trim((string) $loser->label));

        // 1) Ten istý test, ktorým findByLabel zastavil Canva/Canvas. Keď ho pár
        //    nezvládne, automerge by prepísal rozhodnutie, ktoré už raz padlo.
        if ($a !== '' && $b !== '' && ! $this->passesLabelGuard($a, $b)) {
            $reasons[] = 'labely neprejdú guardom z findByLabel (lengthRatio < 0.6 a similar_text < 85 %) — presne vzor „Canva" vs „Canvas visualization"';
            $high = true;
        }

        // 2) Substring, ale výrazne iná dĺžka — doslovný Canva/Canvas prípad.
        if ($a !== '' && $b !== '' && $a !== $b) {
            $shorter = mb_strlen($a) <= mb_strlen($b) ? $a : $b;
            $longer = mb_strlen($a) <= mb_strlen($b) ? $b : $a;
            if (str_contains($longer, $shorter) && mb_strlen($shorter) / max(1, mb_strlen($longer)) < 0.6) {
                $reasons[] = 'kratší label je podstringom dlhšieho, ale je o viac než 40 % kratší — špecifickejší uzol by pohltil všeobecnejší';
                $high = true;
            }
        }

        // 3) Žiadny spoločný významový token — labely hovoria o inom, skóre ťahá popis.
        $shared = $this->sharedTokens($a, $b);
        $noSharedToken = $shared === [];
        if ($noSharedToken && $a !== $b) {
            $reasons[] = 'labely nemajú ani jeden spoločný token (>= 4 znaky) — vysoké skóre pochádza z popisu, nie z toho, že ide o tú istú vec';
        }

        // 4) Rôzne čísla/dátumy v labeli = rôzne ZÁZNAMY, nie duplikát. Dva reporty
        //    z rôznych dní opisujú to isté rovnakými slovami, takže kosínus je vysoký,
        //    ale zlúčením sa jeden deň dát nevratne stratí.
        $na = $this->numericTokens($a);
        $nb = $this->numericTokens($b);
        if ($na !== [] && $nb !== [] && $na !== $nb) {
            $reasons[] = 'labely obsahujú RÔZNE čísla/dátumy ('.implode(', ', $na).' vs '.implode(', ', $nb)
                .') — ide o dva rôzne záznamy (iné obdobie/verzia), nie o duplikát';
            $high = true;
        }

        // 5) Obe strany majú vlastný rozlišujúci token = súrodenci z jednej menovacej
        //    šablóny („… Studio (A1 skeleton)"). Pri projektoch je to takmer vždy
        //    dvojica RÔZNYCH projektov, ktoré si len podobne opísal.
        $exclusiveA = array_values(array_diff($this->tokens($a), $this->tokens($b)));
        $exclusiveB = array_values(array_diff($this->tokens($b), $this->tokens($a)));
        if ($exclusiveA !== [] && $exclusiveB !== [] && $shared !== []) {
            $reasons[] = 'každá strana má vlastný rozlišujúci token ('.implode('/', $exclusiveA).' vs '
                .implode('/', $exclusiveB).') pri zhodnom zvyšku labelu — vzor „súrodenci z jednej šablóny"';
            if ((string) $winner->type === 'project') {
                $reasons[] = 'sú to PROJEKTY — dva projekty s odlišným menom nie sú duplikát';
                $high = true;
            }
        }

        // 6) Iná oblasť / iný útvar = kurátorské rozhodnutie, ktoré merge zahodí.
        $diffArea = $winner->area_id !== null && $loser->area_id !== null
            && (int) $winner->area_id !== (int) $loser->area_id;
        if ($diffArea) {
            $reasons[] = 'uzly sú v RÔZNYCH oblastiach — zlúčenie zahodí ručné zaradenie';
        }
        if ($winner->department_id !== null && $loser->department_id !== null
            && (int) $winner->department_id !== (int) $loser->department_id) {
            $reasons[] = 'uzly sú v rôznych útvaroch';
        }

        // Kombinácia „iná oblasť + nič spoločné v labeli" je sama o sebe dosť.
        if ($noSharedToken && $diffArea) {
            $high = true;
        }

        // 7) Pohltenie zabehnutého uzla je drahšie než pohltenie čerstvého duplikátu.
        if ((float) $loser->strength >= 5.0) {
            $reasons[] = sprintf('pohltený uzol má silu %.1f — nie je to čerstvý duplikát, ale zabehnutá pamäť', (float) $loser->strength);
            $high = true;
        }

        // 8) Pripnutý uzol nesmie zaniknúť tichým behom.
        if ((bool) $loser->pinned) {
            $reasons[] = 'pohltený uzol je PRIPNUTÝ (pinned) — používateľ ho označil ako dôležitý';
            $high = true;
        }

        // 9) Overený uzol pohltený neovereným.
        if ($loser->verified_at !== null && $winner->verified_at === null) {
            $reasons[] = 'pohltený uzol je overený, víťaz nie — merge by stratil verifikáciu';
            $high = true;
        }

        if ($reasons === []) {
            return ['level' => 'ok', 'reasons' => []];
        }

        return ['level' => $high ? 'high' : 'medium', 'reasons' => $reasons];
    }

    /**
     * Guard prevzatý 1:1 z MindService::findByLabel — jediné miesto, kde dnes
     * poučka o Canve reálne žije.
     */
    public function passesLabelGuard(string $a, string $b): bool
    {
        $lengthRatio = min(mb_strlen($a), mb_strlen($b)) / max(1, max(mb_strlen($a), mb_strlen($b)));

        similar_text($a, $b, $percent);

        return $lengthRatio >= 0.6 || $percent >= 85;
    }

    /**
     * Spoločné tokeny labelov (>= 4 znaky, bez diakritiky, bez stopwordov).
     *
     * @return list<string>
     */
    public function sharedTokens(string $a, string $b): array
    {
        $ta = $this->tokens($a);
        $tb = $this->tokens($b);

        return array_values(array_intersect($ta, $tb));
    }

    /**
     * Čísla a dátumy v labeli, normalizované na porovnanie (zoradené, unikátne).
     * „CEO SEO report 27.7.2026" → ['2026','27','7'].
     *
     * @return list<string>
     */
    public function numericTokens(string $label): array
    {
        preg_match_all('/\d+/', $label, $m);
        $out = array_values(array_unique($m[0] ?? []));
        sort($out);

        return $out;
    }

    /** @return list<string> */
    private function tokens(string $label): array
    {
        $ascii = $this->deaccent(mb_strtolower($label));
        $parts = preg_split('/[^a-z0-9]+/u', $ascii) ?: [];

        $out = [];
        foreach ($parts as $p) {
            if (mb_strlen($p) >= 4 && ! in_array($p, self::STOPWORDS, true)) {
                $out[$p] = true;
            }
        }

        return array_keys($out);
    }

    private function deaccent(string $s): string
    {
        return strtr($s, [
            'á' => 'a', 'ä' => 'a', 'č' => 'c', 'ď' => 'd', 'é' => 'e', 'ě' => 'e',
            'í' => 'i', 'ľ' => 'l', 'ĺ' => 'l', 'ň' => 'n', 'ó' => 'o', 'ô' => 'o',
            'ö' => 'o', 'ŕ' => 'r', 'š' => 's', 'ť' => 't', 'ú' => 'u', 'ů' => 'u',
            'ü' => 'u', 'ý' => 'y', 'ž' => 'z',
        ]);
    }
}
