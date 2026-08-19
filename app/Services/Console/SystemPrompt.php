<?php

namespace App\Services\Console;

use Illuminate\Support\Facades\DB;

/**
 * Smernica konzoly — systémový prompt agentovej smyčky.
 *
 * Cena je tu hlavné návrhové kritérium, nie úplnosť. Lokálny model beží na CPU
 * (namerané ~9 tok/s na qwen3:8b) a systémový prompt sa posiela ZNOVA pri každom
 * kole smyčky, takže dvanásťkrolový ťah zaplatí každý token dvanásťkrát. Preto
 * je text vedomo krátky a všetko, čo si agent vie zistiť toolom, tu NIE JE.
 *
 * Štruktúra pamäte je výnimka a je tu úmyselne: bez nej by prvý krok každého ťahu
 * bol „zisti, aké oblasti existujú", čo je jedno celé kolo modelu za informáciu,
 * ktorá stojí jeden SQL dopyt. Preto jeden `GROUP BY` a nie recall.
 *
 * Dátum je tu tiež úmyselne a je to dôvod, prečo sa prompt skladá pri každom
 * ťahu nanovo, nie raz pri založení vlákna: uložená smernica by o týždeň tvrdila
 * nesprávny dnešný deň a agent by podľa nej počítal „pred tromi dňami".
 */
final class SystemPrompt
{
    /**
     * Koľko oddelení vypísať pri jednej oblasti; zvyšok sa spočíta, nezmizne.
     *
     * Namerané na živých dátach (2673 uzlov, qwen3:8b): pri strope 8 a s počtami
     * pri každom oddelení stál výpis štruktúry 427 tokenov zo 729 celého promptu
     * — 59 % smernice na vetu, ktorú model dostane pri každom kole. Preto strop 6
     * a pri oddeleniach už len mená: poradie od najväčšieho nesie tú istú
     * informáciu ako čísla, a nesie ju zadarmo.
     */
    private const DEPT_CAP = 6;

    public function build(): string
    {
        $structure = $this->structure();

        return <<<TXT
        Si Hades — pamäť tohto používateľa. Si sieť uzlov (jadro, skilly, spomienky, projekty) pospájaná hranami a rozdelená do oblastí a oddelení. Beží v Laravel appke a ty si agent v jej konzole.

        Dnes je {$this->today()}.

        Pamäť ani súbory projektu nevidíš priamo — jediná cesta k nim sú tvoje tooly. Nič si nedomýšľaj: keď fakt, číslo alebo cestu nemáš z toolu, zisti to toolom; keď tool nič nevrátil, povedz to.

        Zápis do pamäte a do súborov schvaľuje človek. Zápisový tool preto zavolaj priamo — konzola si povolenie vyžiada sama a rozhodnutie ti vráti ako výsledok toolu. Zamietnutý zápis neskúšaj znova, skús inú cestu alebo sa spýtaj.

        {$structure}

        Odpovedaj po slovensky, krátko a vecne, bez úvodov a bez opakovania otázky.
        TXT;
    }

    /**
     * Oblasti, oddelenia a počty uzlov — JEDNÝM dopytom.
     *
     * `leftJoin` a nie `join`: uzol bez oblasti alebo bez oddelenia existuje
     * (MCP učenie ich vie nechať prázdne) a keby vypadol z tohto výpisu, agent
     * by o tej časti pamäte nevedel a hlásil by, že tam nič nie je.
     */
    public function structure(): string
    {
        $rows = DB::table('nodes')
            ->leftJoin('areas', 'areas.id', '=', 'nodes.area_id')
            ->leftJoin('departments', 'departments.id', '=', 'nodes.department_id')
            ->whereNull('nodes.deleted_at')
            ->groupBy('areas.name', 'departments.name')
            ->orderBy('areas.name')
            ->selectRaw('areas.name as area, departments.name as dept, count(*) as total')
            ->get();

        if ($rows->isEmpty()) {
            return 'Pamäť je zatiaľ prázdna — žiadne uzly.';
        }

        $areas = [];
        $nodes = 0;

        foreach ($rows as $row) {
            $area = $row->area ?? 'bez oblasti';
            $total = (int) $row->total;
            $nodes += $total;

            $areas[$area]['total'] = ($areas[$area]['total'] ?? 0) + $total;

            if ($row->dept !== null) {
                $areas[$area]['depts'][$row->dept] = $total;
            }
        }

        uasort($areas, fn (array $a, array $b) => $b['total'] <=> $a['total']);

        $lines = [];

        foreach ($areas as $name => $area) {
            $depts = $area['depts'] ?? [];
            arsort($depts);

            $shown = array_slice($depts, 0, self::DEPT_CAP, true);
            $rest = count($depts) - count($shown);

            $tail = array_keys($shown);

            if ($rest > 0) {
                $tail[] = "+{$rest} ďalších";
            }

            $lines[] = "- {$name} {$area['total']}".($tail === [] ? '' : ': '.implode(', ', $tail));
        }

        return "Štruktúra pamäte ({$nodes} uzlov, oblasť počet: oddelenia od najväčšieho):\n".implode("\n", $lines);
    }

    /** Slovenský dátum bez lokalizačného balíka — mesiac číslom, aby sa nedal prečítať dvojako. */
    private function today(): string
    {
        return now()->format('j. n. Y');
    }
}
