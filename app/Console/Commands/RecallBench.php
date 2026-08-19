<?php

namespace App\Console\Commands;

use App\Models\Node;
use App\Services\EmbeddingService;
use App\Services\MindService;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Throwable;

/**
 * Meria, či semantický recall (fúzia kľúčových slov a vektorov) naozaj pomáha —
 * ten istý dopyt raz s vypnutou a raz so zapnutou vektorovou vetvou.
 *
 * Prečo vlastný príkaz a nie „vyzerá to lepšie": fúzia sa dá pokaziť tichom.
 * Vektorová vetva vždy niečo najde, takže odpoveď je po zapnutí VŽDY plnšia a
 * subjektívne lepšia — aj keď zhodou okolností vytlačila uzol pomenovaný presne
 * podľa dopytu. Presné meno je to, v čom je kľúčová vetva neprekonateľná, takže
 * jeho strata je regresia, nie kompromis. Preto sa tu neráta len pass@k, ale
 * aj PREHRY po jednotlivých dopytoch.
 *
 * Sada dopytov je odvodená zo ŽIVEJ pamäte (labely a popisy uzlov, ktoré v sieti
 * naozaj sú), nie vymyslená — a je zapísaná v {@see SUITE}, aby bolo meranie
 * opakovateľné. Očakávané uzly sú tie, ktoré by na dopyt ukázal človek po
 * prečítaní uzla; pri rozcestníkoch je správnych viac ako jeden, preto je
 * `expect` pole a stačí trafiť ktorýkoľvek z nich.
 *
 * Pasce, ktoré toto meranie stáli čísla:
 *
 *  - **Koncepty dopytu sú cachované.** Prvý beh dopytu ich vypočíta, druhý ich
 *    dostane zadarmo — a keďže sa merajú dva režimy toho istého dopytu za sebou,
 *    ten druhý by vyhral latenciu bez akejkoľvek zásluhy. Preto ide pred obe
 *    merania jeden ZAHODENÝ beh, ktorý cache zahreje.
 *  - **Prvé volanie modelu načítava model** (~4,4 s na CPU proti ~260 ms na
 *    ďalší dopyt). Bez zahriatia pred cyklom by celý rozdiel režimov sedel
 *    v prvom riadku tabuľky.
 *  - Recall zapisuje aktiváciu ku každému vrátenému uzlu, presne ako živý
 *    `mind_recall`. Beh teda pridá telemetriu (nič nemaže) — meria sa skutočná
 *    cesta, nie jej laboratórna kópia.
 *
 * Použitie:
 *   php artisan mind:recall-bench
 *   php artisan mind:recall-bench --json
 *   php artisan mind:recall-bench --only=ngrok --limit=12
 */
class RecallBench extends Command
{
    protected $signature = 'mind:recall-bench
        {--json : Strojový výstup namiesto tabuliek}
        {--limit=12 : Koľko uzlov si recall vyžiada (default = to, čo posiela mind_recall)}
        {--only= : Len dopyty obsahujúce tento podreťazec}
        {--suite= : JSON súbor s vlastnou sadou dopytov (pole {q, expect, why}) — pre testy}
        {--no-file : Nezapisovať správu do storage/app}
        {--no-embed-probe : Nemerať samostatne cenu vektorizácie dopytu}';

    protected $description = 'Porovná recall bez vektorov a s vektormi: pass@k, MRR, latencia, výhry a prehry fúzie';

    /** Pri akých k sa počíta pass@k. Päť je strop toho, čo AI reálne prečíta zhora. */
    private const KS = [1, 3, 5];

    /**
     * Sada dopytov nad ŽIVOU pamäťou. `expect` sú id uzlov, ktoré by na dopyt
     * ukázal človek — odvodené čítaním uzlov, nie hádaním.
     *
     * Zámerne sú v sade oba druhy dopytov:
     *  - dopyt s PRESNÝM menom („Heureka bidding", „dbt", „BigQuery") — tam má
     *    kľúčová vetva vyhrať a fúzia to nesmie pokaziť,
     *  - opísaný dopyt bez jediného slova z labelu („veľa requestov naraz
     *    prepočítava ten istý cache kľúč" → „Cache::flexible proti stampede") —
     *    tam je celý zmysel vektorov.
     *
     * @var array<int, array{q: string, expect: array<int, int>, why: string}>
     */
    private const SUITE = [
        ['q' => 'ako sa overuje UI v prehliadači keď file:// nefunguje', 'expect' => [557, 2696, 2617], 'why' => 'opísaný dopyt, label je anglický slug'],
        ['q' => 'čím sa dá dokázať že CSS refaktor nič nezmenil', 'expect' => [2696], 'why' => 'opísaný dopyt'],
        ['q' => 'ngrok domény appiek a ktoré porty', 'expect' => [617, 2193, 9, 579], 'why' => 'presné meno technológie'],
        ['q' => 'git worktree pasce pri paralelných sessions', 'expect' => [24, 34, 676], 'why' => 'presné meno + opis'],
        ['q' => 'ikonový font self-hosted a subset glyfov', 'expect' => [2690, 1364], 'why' => 'presné meno'],
        ['q' => 'prečo sa slovenská diakritika rozpadne vo fontoch', 'expect' => [1029, 2550], 'why' => 'opísaný dopyt'],
        ['q' => 'ako stavať farebné rampy aby boli kroky rovnomerné', 'expect' => [296, 844, 1340], 'why' => 'opísaný dopyt, labely hovoria OKLCH'],
        ['q' => 'aký kontrast musí mať text aby sa dal čítať', 'expect' => [1055, 287], 'why' => 'opísaný dopyt, labely hovoria APCA'],
        ['q' => 'ako počítame ceny a marže šperkov na sklade', 'expect' => [2078, 45, 157], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'Heureka bidding a overené zákazníkmi', 'expect' => [2066, 2069], 'why' => 'presné meno'],
        ['q' => 'čo spôsobil Consent Mode v2 v meraní', 'expect' => [1078, 2058], 'why' => 'presné meno'],
        ['q' => 'GA4 export do BigQuery a nested event_params', 'expect' => [2100, 2330, 2033], 'why' => 'presné meno'],
        ['q' => 'dbt testy a snapshoty histórie cien', 'expect' => [1964, 1982], 'why' => 'presné meno'],
        ['q' => 'ako delegovať prácu ľuďom v tíme', 'expect' => [60, 1543, 1548, 1553], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'aký máme rytmus porád počas týždňa', 'expect' => [762, 2108, 1563, 752], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'veľa requestov naraz prepočítava ten istý cache kľúč', 'expect' => [2050, 1189], 'why' => 'opísaný dopyt, label hovorí stampede'],
        ['q' => 'zmena schémy databázy bez výpadku', 'expect' => [192], 'why' => 'opísaný dopyt, label je anglický'],
        ['q' => 'appka na generovanie marketingových bannerov', 'expect' => [62, 171, 148], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'do kedy treba vybaviť reklamáciu', 'expect' => [1400], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'manko v trezore a inventúra zásob', 'expect' => [1444, 1830, 1848], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'Black Friday zľavy a čo to urobí s maržou', 'expect' => [1138, 2352, 1797], 'why' => 'presné meno + opis'],
        ['q' => 'prečo nesledovať ROAS ale MER', 'expect' => [1082, 2076], 'why' => 'presné meno'],
        ['q' => 'Figma cez MCP a design system', 'expect' => [149, 13], 'why' => 'presné meno'],
        ['q' => 'session replay nahráva osobné údaje v checkoute', 'expect' => [1298, 437], 'why' => 'presné meno + opis'],
        ['q' => 'produktové fotky v dark mode', 'expect' => [1049], 'why' => 'zhoda v slovách labelu'],
        ['q' => 'dva stacky v Compose majú službu s tým istým menom', 'expect' => [706], 'why' => 'opísaný dopyt, label je anglický'],
        ['q' => 'prompt caching v Claude API a koľko stojí', 'expect' => [321], 'why' => 'presné meno'],
        ['q' => 'ako sa píše MCP server v Laraveli', 'expect' => [5, 43], 'why' => 'presné meno'],
    ];

    public function handle(MindService $mind, EmbeddingService $embeddings): int
    {
        $suite = $this->resolveSuite();

        if ($suite === []) {
            $this->error('Sada dopytov je prázdna — niet čo merať.');

            return self::FAILURE;
        }

        $limit = max(1, (int) $this->option('limit'));
        $wasEnabled = (bool) config('hades.embeddings.enabled');
        $vectors = $this->corpusState($embeddings);

        if (! $this->option('json')) {
            $this->intro($vectors, count($suite), $limit);
        }

        // Model sa načítava pri prvom volaní (~4,4 s na CPU). Keby sa to stalo
        // vnútri cyklu, celá cena studeného štartu by sedela v latencii prvého
        // dopytu a tabuľka by tvrdila, že hybrid je desaťnásobne drahší.
        $probe = ! $this->option('no-embed-probe') && $vectors['vectors'] > 0;
        $warmError = $this->warmModel($embeddings, $vectors);

        $rows = [];

        foreach ($suite as $case) {
            $query = (string) $case['q'];
            $expect = array_map('intval', $case['expect']);

            // Zahodený beh: zahreje cache konceptov dopytu, aby ju nedostal
            // zadarmo až druhý meraný režim.
            $this->recall($mind, $query, $limit, false);

            $keyword = $this->recall($mind, $query, $limit, false);
            $hybrid = $this->recall($mind, $query, $limit, true);

            $embedMs = null;
            if ($probe) {
                // Samostatné meranie tej istej práce, ktorú platí hybrid vnútri:
                // vektorizácia dopytu. Nezapočítava sa nikam, len pomenúva, koľko
                // z rozdielu režimov je CPU inferencia a koľko sken korpusu.
                try {
                    $started = hrtime(true);
                    $embeddings->embedText($query);
                    $embedMs = (hrtime(true) - $started) / 1e6;
                } catch (Throwable $e) {
                    $embedMs = null;
                }
            }

            $rows[] = [
                'q' => $query,
                'why' => (string) ($case['why'] ?? ''),
                'expect' => $expect,
                'keyword' => $this->score($keyword, $expect),
                'hybrid' => $this->score($hybrid, $expect),
                'embed_ms' => $embedMs === null ? null : round($embedMs, 1),
            ];
        }

        foreach ($rows as $i => $row) {
            $rows[$i]['verdict'] = self::verdict($row['keyword']['rank'], $row['hybrid']['rank']);
            $rows[$i]['displacers'] = $rows[$i]['verdict'] === 'loss'
                ? $this->displacers($row['keyword'], $row['hybrid'], $row['expect'])
                : [];
            $rows[$i]['kw_top1'] = self::top1Fate($row['keyword'], $row['hybrid']);
        }

        config(['hades.embeddings.enabled' => $wasEnabled]);

        $report = [
            'generated_at' => now()->toIso8601String(),
            'limit' => $limit,
            'corpus' => $vectors,
            'model_warm_error' => $warmError,
            'keyword' => self::aggregate(array_column($rows, 'keyword')),
            'hybrid' => self::aggregate(array_column($rows, 'hybrid')),
            'queries' => $rows,
        ];

        $path = $this->option('no-file') ? null : $this->writeReport($report);
        $report['report_path'] = $path;

        if ($this->option('json')) {
            $this->line((string) json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

            return self::SUCCESS;
        }

        $this->render($report);

        if ($path !== null) {
            $this->newLine();
            $this->line("Správa: {$path}");
        }

        return self::SUCCESS;
    }

    /**
     * Poradie (1-based) prvého očakávaného uzla vo výsledku, alebo `null`, keď
     * tam nie je ani jeden.
     *
     * @param  array<int, int>  $ids
     * @param  array<int, int>  $expect
     */
    public static function rankOf(array $ids, array $expect): ?int
    {
        foreach (array_values($ids) as $i => $id) {
            if (in_array((int) $id, $expect, true)) {
                return $i + 1;
            }
        }

        return null;
    }

    /**
     * Agregát nad jedným režimom.
     *
     * `pass@k` je podiel dopytov, kde bol očakávaný uzol v prvých k. `mrr` je
     * priemer z 1/poradie (0 pri nenájdení) — na rozdiel od pass@k odmeňuje aj
     * to, že správny uzol je vyššie, nie len že vôbec je.
     *
     * @param  array<int, array{rank: ?int, returned: int, semantic: int}>  $modeRows
     * @return array{queries: int, pass: array<int, float>, hits: array<int, int>, mrr: float, misses: int, empty: int, semantic_hits: int, semantic_expected: int, latency: array<string, float>}
     */
    public static function aggregate(array $modeRows): array
    {
        $n = max(1, count($modeRows));
        $pass = [];
        $hits = [];

        foreach (self::KS as $k) {
            $hit = 0;
            foreach ($modeRows as $row) {
                if ($row['rank'] !== null && $row['rank'] <= $k) {
                    $hit++;
                }
            }
            $hits[$k] = $hit;
            $pass[$k] = round($hit / $n, 4);
        }

        $mrr = 0.0;
        $misses = 0;
        $empty = 0;
        $semantic = 0;
        $semanticExpected = 0;
        $latencies = [];

        foreach ($modeRows as $row) {
            $mrr += $row['rank'] === null ? 0.0 : 1 / $row['rank'];
            $row['rank'] === null && $misses++;
            $row['returned'] === 0 && $empty++;
            $semantic += (int) ($row['semantic'] ?? 0);
            $semanticExpected += (int) ($row['semantic_expected'] ?? 0);
            $latencies[] = (float) ($row['ms'] ?? 0);
        }

        return [
            'queries' => count($modeRows),
            'pass' => $pass,
            'hits' => $hits,
            'mrr' => round($mrr / $n, 4),
            'misses' => $misses,
            'empty' => $empty,
            'semantic_hits' => $semantic,
            'semantic_expected' => $semanticExpected,
            'latency' => self::latencyStats($latencies),
        ];
    }

    /**
     * Čo sa stalo s uzlom, ktorý mala kľúčová vetva na 1. mieste.
     *
     * Toto je jediný detektor regresie, ktorý nezávisí od `expect`: pass@k môže
     * vyjsť lepšie a fúzia môže PRITOM zhodiť uzol pomenovaný presne podľa
     * dopytu — stačí, že bol v `expect` aj niekto iný. Presné meno je to, v čom
     * je kľúčová vetva neprekonateľná, takže jeho pád je vždy nález, nie detail.
     *
     * @param  array<string, mixed>  $keyword
     * @param  array<string, mixed>  $hybrid
     * @return array{id: int, label: string, hybrid_rank: ?int}|null
     */
    public static function top1Fate(array $keyword, array $hybrid): ?array
    {
        $id = $keyword['ids'][0] ?? null;

        if ($id === null) {
            return null;
        }

        return [
            'id' => (int) $id,
            'label' => (string) ($keyword['top'][0] ?? '?'),
            'hybrid_rank' => self::rankOf($hybrid['ids'], [(int) $id]),
        ];
    }

    /** `win` / `loss` / `same` z dvoch poradí. Nenájdené je nekonečno, nie nula. */
    public static function verdict(?int $keywordRank, ?int $hybridRank): string
    {
        $a = $keywordRank ?? PHP_INT_MAX;
        $b = $hybridRank ?? PHP_INT_MAX;

        return match (true) {
            $b < $a => 'win',
            $b > $a => 'loss',
            default => 'same',
        };
    }

    /**
     * @param  array<int, float>  $values
     * @return array{mean: float, median: float, p95: float, min: float, max: float}
     */
    private static function latencyStats(array $values): array
    {
        if ($values === []) {
            return ['mean' => 0.0, 'median' => 0.0, 'p95' => 0.0, 'min' => 0.0, 'max' => 0.0];
        }

        sort($values);
        $n = count($values);

        return [
            'mean' => round(array_sum($values) / $n, 1),
            'median' => round($values[(int) floor(($n - 1) / 2)], 1),
            // p95 ako index, nie interpolácia — pri 28 dopytoch je interpolovaný
            // percentil presnosť, ktorú dáta neunesú
            'p95' => round($values[(int) ceil(0.95 * $n) - 1], 1),
            'min' => round($values[0], 1),
            'max' => round($values[$n - 1], 1),
        ];
    }

    /**
     * Jeden recall v danom režime. Config sa prepína tu a nikde inde — `.env`
     * sa nedotýkame, inak by meranie zmenilo nastavenie živého servera.
     *
     * @return array{ids: array<int, int>, labels: array<int, string>, meta: array<int, array<string, mixed>>, ms: float}
     */
    private function recall(MindService $mind, string $query, int $limit, bool $embeddings): array
    {
        config(['hades.embeddings.enabled' => $embeddings]);

        $started = hrtime(true);
        $result = $mind->recallWithMeta($query, $limit);
        $ms = (hrtime(true) - $started) / 1e6;

        /** @var Collection<int, Node> $nodes */
        $nodes = $result['nodes'];

        return [
            'ids' => $nodes->pluck('id')->map(fn ($id) => (int) $id)->all(),
            'labels' => $nodes->pluck('label')->map(fn ($l) => (string) $l)->all(),
            'meta' => $result['meta'],
            'ms' => $ms,
        ];
    }

    /**
     * Výsledok jedného režimu → čísla, ktoré vstupujú do agregátu.
     *
     * @param  array{ids: array<int, int>, labels: array<int, string>, meta: array<int, array<string, mixed>>, ms: float}  $result
     * @param  array<int, int>  $expect
     * @return array<string, mixed>
     */
    private function score(array $result, array $expect): array
    {
        $semantic = 0;
        $semanticExpected = 0;

        foreach ($result['ids'] as $id) {
            if (($result['meta'][$id]['semantic'] ?? false) === true) {
                $semantic++;
                in_array((int) $id, $expect, true) && $semanticExpected++;
            }
        }

        return [
            'ms' => round($result['ms'], 1),
            'rank' => self::rankOf($result['ids'], $expect),
            'returned' => count($result['ids']),
            'semantic' => $semantic,
            'semantic_expected' => $semanticExpected,
            'ids' => $result['ids'],
            'top' => array_slice($result['labels'], 0, 3),
            'meta' => $result['meta'],
        ];
    }

    /**
     * Uzly, ktoré v hybride stoja NAD očakávaným (alebo celý jeho zoznam, keď
     * očakávaný vypadol) a v kľúčovej vetve nad ním nestáli. Toto je jadro
     * diagnostiky prehry: keď je medzi nimi čisto semantický zásah, fúzia
     * vymenila presné meno za podobný zmysel.
     *
     * @param  array<string, mixed>  $keyword
     * @param  array<string, mixed>  $hybrid
     * @param  array<int, int>  $expect
     * @return array<int, array{id: int, label: string, semantic: bool, new: bool}>
     */
    private function displacers(array $keyword, array $hybrid, array $expect): array
    {
        $cut = $hybrid['rank'] ?? (count($hybrid['ids']) + 1);
        $above = array_slice($hybrid['ids'], 0, $cut - 1);
        $keywordAbove = array_slice($keyword['ids'], 0, ($keyword['rank'] ?? 1) - 1);

        $out = [];
        foreach ($above as $id) {
            if (in_array($id, $keywordAbove, true) || in_array($id, $expect, true)) {
                continue;
            }

            $out[] = [
                'id' => (int) $id,
                'label' => (string) (Node::withTrashed()->find($id)?->label ?? '?'),
                'semantic' => ($hybrid['meta'][$id]['semantic'] ?? false) === true,
                'new' => ! in_array($id, $keyword['ids'], true),
            ];

            if (count($out) === 4) {
                break;
            }
        }

        return $out;
    }

    /**
     * @return array<int, array{q: string, expect: array<int, int>, why: string}>
     */
    private function resolveSuite(): array
    {
        $suite = self::SUITE;
        $file = (string) $this->option('suite');

        if ($file !== '') {
            $decoded = json_decode((string) @file_get_contents($file), true);

            if (! is_array($decoded)) {
                $this->error("Sada sa nedá prečítať: {$file}");

                return [];
            }

            $suite = $decoded;
        }

        $only = mb_strtolower(trim((string) $this->option('only')));

        if ($only !== '') {
            $suite = array_values(array_filter(
                $suite,
                fn (array $case) => str_contains(mb_strtolower((string) $case['q']), $only),
            ));
        }

        return $suite;
    }

    /**
     * @return array{model: string, vectors: int, nodes: int, coverage: float}
     */
    private function corpusState(EmbeddingService $embeddings): array
    {
        $nodes = Node::query()->count();
        $vectors = $embeddings->count();

        return [
            'model' => $embeddings->model(),
            'vectors' => $vectors,
            'nodes' => $nodes,
            'coverage' => $nodes === 0 ? 0.0 : round($vectors / $nodes, 4),
        ];
    }

    /**
     * @param  array{vectors: int, nodes: int, model: string, coverage: float}  $vectors
     */
    private function warmModel(EmbeddingService $embeddings, array $vectors): ?string
    {
        if ($vectors['vectors'] === 0) {
            return 'korpus je nevektorizovaný — hybrid sa skratuje na COUNT(*) a meria to isté, čo kľúčová vetva';
        }

        try {
            config(['hades.embeddings.enabled' => true]);
            $embeddings->embedText('zahrievací dopyt');

            return null;
        } catch (Throwable $e) {
            return $e->getMessage();
        }
    }

    /**
     * @param  array{model: string, vectors: int, nodes: int, coverage: float}  $vectors
     */
    private function intro(array $vectors, int $queries, int $limit): void
    {
        $this->line("Model: {$vectors['model']}");
        $this->line("Korpus: {$vectors['vectors']} vektorov / {$vectors['nodes']} uzlov ("
            .round($vectors['coverage'] * 100, 1).' %)');
        $this->line("Sada: {$queries} dopytov, limit {$limit}");

        if ($vectors['vectors'] < $vectors['nodes'] * 0.9) {
            $this->warn('Korpus nie je dovektorizovaný — meranie hovorí o polovičnom indexe, nie o hybride.');
        }

        $this->newLine();
    }

    /**
     * @param  array<string, mixed>  $report
     */
    private function render(array $report): void
    {
        $kw = $report['keyword'];
        $hy = $report['hybrid'];

        if ($report['model_warm_error'] !== null) {
            $this->warn('Vektorová vetva: '.$report['model_warm_error']);
            $this->newLine();
        }

        $rows = [];
        foreach (self::KS as $k) {
            $rows[] = [
                "pass@{$k}",
                $this->pct($kw['pass'][$k])." ({$kw['hits'][$k]}/{$kw['queries']})",
                $this->pct($hy['pass'][$k])." ({$hy['hits'][$k]}/{$hy['queries']})",
                $this->delta($hy['pass'][$k] - $kw['pass'][$k], true),
            ];
        }

        $rows[] = ['MRR', number_format($kw['mrr'], 3), number_format($hy['mrr'], 3), $this->delta($hy['mrr'] - $kw['mrr'])];
        $rows[] = ['nenašlo očakávané', (string) $kw['misses'], (string) $hy['misses'], $this->delta($kw['misses'] - $hy['misses'])];
        $rows[] = ['vrátilo NIČ', (string) $kw['empty'], (string) $hy['empty'], $this->delta($kw['empty'] - $hy['empty'])];
        $rows[] = ['semantických zásahov', (string) $kw['semantic_hits'], (string) $hy['semantic_hits'], '—'];
        $rows[] = ['z toho očakávaných', (string) $kw['semantic_expected'], (string) $hy['semantic_expected'], '—'];

        foreach (['median' => 'latencia medián', 'mean' => 'latencia priemer', 'p95' => 'latencia p95', 'max' => 'latencia max'] as $key => $label) {
            $rows[] = [
                $label,
                $kw['latency'][$key].' ms',
                $hy['latency'][$key].' ms',
                '+'.round($hy['latency'][$key] - $kw['latency'][$key], 1).' ms',
            ];
        }

        $embed = array_values(array_filter(array_column($report['queries'], 'embed_ms'), fn ($v) => $v !== null));
        if ($embed !== []) {
            $stats = self::latencyStats($embed);
            $rows[] = ['z toho vektorizácia dopytu', '—', $stats['median'].' ms (medián)', '—'];
        }

        $this->table(['Metrika', 'Kľúčové slová', 'Hybrid (fúzia)', 'Δ'], $rows);

        $this->section('Výhry fúzie', $report['queries'], 'win');
        $this->section('Prehry fúzie', $report['queries'], 'loss');
        $this->top1Section($report['queries']);
    }

    /**
     * @param  array<int, array<string, mixed>>  $queries
     * @return array{kept: int, moved: int, out_of_three: int, gone: int, total: int}
     */
    private static function top1Stats(array $queries): array
    {
        $stats = ['kept' => 0, 'moved' => 0, 'out_of_three' => 0, 'gone' => 0, 'total' => 0];

        foreach ($queries as $row) {
            if (($row['kw_top1'] ?? null) === null) {
                continue;
            }

            $stats['total']++;
            $rank = $row['kw_top1']['hybrid_rank'];

            $rank === 1 && $stats['kept']++;
            $rank !== 1 && $stats['moved']++;
            $rank === null && $stats['gone']++;
            ($rank === null || $rank > 3) && $stats['out_of_three']++;
        }

        return $stats;
    }

    /**
     * @param  array<int, array<string, mixed>>  $queries
     */
    private function top1Section(array $queries): void
    {
        $stats = self::top1Stats($queries);
        $rows = [];

        foreach ($queries as $row) {
            $fate = $row['kw_top1'] ?? null;

            if ($fate === null || $fate['hybrid_rank'] === 1) {
                continue;
            }

            $rows[] = [
                Str::limit($row['q'], 42),
                '['.$fate['id'].'] '.Str::limit($fate['label'], 28),
                $this->rank($fate['hybrid_rank']),
                Str::limit($row['hybrid']['top'][0] ?? '—', 28)
                    .(($row['hybrid']['meta'][$row['hybrid']['ids'][0] ?? -1]['semantic'] ?? false) === true ? ' (semantic)' : ''),
            ];
        }

        $this->newLine();
        $this->line("#1 kľúčovej vetvy ostal #1 aj v hybride: {$stats['kept']}/{$stats['total']}"
            .", vypadol z prvej trojky: {$stats['out_of_three']}, z výsledku úplne: {$stats['gone']}");

        if ($rows !== []) {
            $this->table(['Dopyt', '#1 kľúčovej vetvy', 'jeho poradie v hybride', 'Hybrid #1'], $rows);
        }
    }

    /**
     * @param  array<int, array<string, mixed>>  $queries
     */
    private function section(string $title, array $queries, string $verdict): void
    {
        $rows = [];

        foreach ($queries as $row) {
            if ($row['verdict'] !== $verdict) {
                continue;
            }

            $note = $row['displacers'] === []
                ? ($row['hybrid']['rank'] === null ? 'očakávaný uzol vypadol z výsledku' : '')
                : implode(' · ', array_map(
                    fn (array $d) => '['.$d['id'].'] '.Str::limit($d['label'], 34).($d['semantic'] ? ' (semantic)' : ''),
                    $row['displacers'],
                ));

            $rows[] = [
                Str::limit($row['q'], 46),
                $this->rank($row['keyword']['rank']).' → '.$this->rank($row['hybrid']['rank']),
                Str::limit($row['hybrid']['top'][0] ?? '—', 30),
                Str::limit($note, 62),
            ];
        }

        $this->newLine();

        if ($rows === []) {
            $this->line("{$title}: žiadne.");

            return;
        }

        $this->line($title.' ('.count($rows).')');
        $this->table(['Dopyt', 'poradie kw → hybrid', 'Hybrid #1', 'Kto sa dostal nad očakávaný / pozn.'], $rows);
    }

    private function rank(?int $rank): string
    {
        return $rank === null ? '—' : (string) $rank;
    }

    private function pct(float $share): string
    {
        return round($share * 100, 1).' %';
    }

    private function delta(float $value, bool $percent = false): string
    {
        if (abs($value) < 1e-9) {
            return '0';
        }

        $out = $percent ? round($value * 100, 1).' pb' : (string) round($value, 3);

        return ($value > 0 ? '+' : '').$out;
    }

    /**
     * @param  array<string, mixed>  $report
     */
    private function writeReport(array $report): string
    {
        $kw = $report['keyword'];
        $hy = $report['hybrid'];

        $lines = [
            '# Recall bench — kľúčové slová vs. hybrid',
            '',
            '- Beh: '.$report['generated_at'],
            '- Model: '.$report['corpus']['model'].', korpus '.$report['corpus']['vectors'].' / '
                .$report['corpus']['nodes'].' uzlov ('.round($report['corpus']['coverage'] * 100, 1).' %)',
            '- Limit recallu: '.$report['limit'].', dopytov: '.$kw['queries'],
        ];

        if ($report['model_warm_error'] !== null) {
            $lines[] = '- Vektorová vetva: '.$report['model_warm_error'];
        }

        $lines[] = '';
        $lines[] = '| Metrika | Kľúčové slová | Hybrid | Δ |';
        $lines[] = '|---|---|---|---|';

        foreach (self::KS as $k) {
            $lines[] = "| pass@{$k} | ".$this->pct($kw['pass'][$k]).' | '.$this->pct($hy['pass'][$k])
                .' | '.$this->delta($hy['pass'][$k] - $kw['pass'][$k], true).' |';
        }

        $lines[] = '| MRR | '.number_format($kw['mrr'], 3).' | '.number_format($hy['mrr'], 3)
            .' | '.$this->delta($hy['mrr'] - $kw['mrr']).' |';
        $lines[] = '| nenašlo očakávané | '.$kw['misses'].' | '.$hy['misses'].' | |';
        $lines[] = '| vrátilo nič | '.$kw['empty'].' | '.$hy['empty'].' | |';
        $lines[] = '| semantických zásahov | '.$kw['semantic_hits'].' | '.$hy['semantic_hits'].' | |';
        $lines[] = '| latencia medián | '.$kw['latency']['median'].' ms | '.$hy['latency']['median'].' ms | +'
            .round($hy['latency']['median'] - $kw['latency']['median'], 1).' ms |';
        $lines[] = '| latencia p95 | '.$kw['latency']['p95'].' ms | '.$hy['latency']['p95'].' ms | +'
            .round($hy['latency']['p95'] - $kw['latency']['p95'], 1).' ms |';
        $top1 = self::top1Stats($report['queries']);
        $lines[] = '| #1 kľúčovej vetvy ostal #1 | — | '.$top1['kept'].' / '.$top1['total']
            .' | vypadol z prvej trojky: '.$top1['out_of_three'].', z výsledku: '.$top1['gone'].' |';
        $lines[] = '';
        $lines[] = '## Dopyt po dopyte';
        $lines[] = '';
        $lines[] = '| Dopyt | očakávané | kw | hybrid | kw ms | hybrid ms | embed ms | verdikt |';
        $lines[] = '|---|---|---|---|---|---|---|---|';

        foreach ($report['queries'] as $row) {
            $lines[] = '| '.$row['q'].' | '.implode(', ', $row['expect'])
                .' | '.$this->rank($row['keyword']['rank'])
                .' | '.$this->rank($row['hybrid']['rank'])
                .' | '.$row['keyword']['ms']
                .' | '.$row['hybrid']['ms']
                .' | '.($row['embed_ms'] ?? '—')
                .' | '.$row['verdict'].' |';
        }

        foreach (['win' => 'Kde fúzia vyhrala', 'loss' => 'Kde fúzia prehrala'] as $verdict => $title) {
            $lines[] = '';
            $lines[] = "## {$title}";
            $lines[] = '';

            $any = false;
            foreach ($report['queries'] as $row) {
                if ($row['verdict'] !== $verdict) {
                    continue;
                }

                $any = true;
                $lines[] = '- **'.$row['q'].'** ('.$row['why'].'): '
                    .$this->rank($row['keyword']['rank']).' → '.$this->rank($row['hybrid']['rank'])
                    .'; hybrid #1 = '.($row['hybrid']['top'][0] ?? '—');

                foreach ($row['displacers'] as $d) {
                    $lines[] = '  - nad očakávaným: `['.$d['id'].']` '.$d['label']
                        .($d['semantic'] ? ' — čisto semantický zásah' : '')
                        .($d['new'] ? ' — v kľúčovej vetve vôbec nebol' : '');
                }
            }

            if (! $any) {
                $lines[] = '- žiadne';
            }
        }

        $lines[] = '';
        $lines[] = '## Čo sa stalo s #1 kľúčovej vetvy';
        $lines[] = '';
        $lines[] = 'Detektor regresie nezávislý od `expect`: presné meno je to, v čom je kľúčová vetva '
            .'neprekonateľná, takže jeho pád je nález aj vtedy, keď pass@k vyjde lepšie.';
        $lines[] = '';

        $moved = false;
        foreach ($report['queries'] as $row) {
            $fate = $row['kw_top1'] ?? null;

            if ($fate === null || $fate['hybrid_rank'] === 1) {
                continue;
            }

            $moved = true;
            $lines[] = '- **'.$row['q'].'**: `['.$fate['id'].']` '.$fate['label']
                .' → poradie '.$this->rank($fate['hybrid_rank']).' v hybride; hybrid #1 = '
                .($row['hybrid']['top'][0] ?? '—');
        }

        if (! $moved) {
            $lines[] = '- žiadny #1 kľúčovej vetvy neklesol';
        }

        $lines[] = '';
        $lines[] = '> Meranie nič nezmenilo okrem telemetrie aktivácií — recall zapisuje aktiváciu ku každému '
            .'vrátenému uzlu, presne ako živý `mind_recall`.';
        $lines[] = '';

        $path = storage_path('app/recall-bench-'.now()->format('Y-m-d-Hi').'.md');

        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0775, true);
        }

        file_put_contents($path, implode("\n", $lines));

        return $path;
    }
}
