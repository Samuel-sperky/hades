<?php

namespace App\Serializers\Screen;

use App\Serializers\ScreenSerializer;
use Illuminate\Support\Facades\Artisan;

/**
 * Hygiena pamäti — sekcia obrazovky Kontrola a zároveň jediný zdroj pre
 * `mind_hygiene`.
 *
 * **Prečo trieda vznikla (nález A3):** `grep -rn "hygiene\|noise\|odpad"` nad
 * `public/js/mind/` a `mind.blade.php` dal **0 zásahov** — odpad v pamäti teda
 * videla AI (cez `mind_hygiene`) a človek nie. Fronta na Kontrole pritom hovorí
 * presne o tom istom: čo v pamäti čaká na rozhodnutie človeka.
 *
 * **Klasifikátor sa tu NEPÍŠE druhý raz.** Je jeden a je v `mind:hygiene` (ten
 * zase stojí na `MindService::noiseOf()`), takže sa príkaz volá. Druhý detektor
 * odpadu by sa rozišiel a obrazovka by hlásila iné čísla než CLI aj než AI — to
 * je presne tá chyba, ktorú vlna E opravovala na šiestich miestach.
 *
 * **Čo je dáta a čo slová:** počty, váhy, podiely, záťaž, skupiny a **skrátenie
 * labelu** sú dáta a idú odtiaľ. Slovenské popisky tried odpadu („Surová veta
 * ako label"), formát trvania a šírka baru v pixeloch sú slová a vizuál — tie sú
 * v `public/js/mind/screens/kontrola.js`. Výnimka, ktorá tú hranicu nelomí:
 * `example_nodes[].note` je **nález nad konkrétnym uzlom** vypočítaný z prahov
 * („12 tagov (strop recallu je 8)"), nie popisok triedy — prepočítať ho
 * v prehliadači by znamenalo preniesť tam prahy aj klasifikátor.
 *
 * **Sekcia nič nemaže a mazať nebude.** Recall odpad označí a zaradí za čisté
 * uzly; oprava je premenovanie alebo presun uzla, teda existujúca cesta (detail
 * uzla v grafe, resp. `mind_rename` / `mind_move`). `--fix` príkazu sa odtiaľ
 * nepodáva vôbec — ani z endpointu, ani z MCP.
 *
 * Tvar odpovede pre AI je **znak po znaku ten, ktorý `mind_hygiene` vracal
 * predtým** (`nodes`, `edges`, `dirty_nodes`, `classes[]` s `examples` ako
 * zoznamom id, `worst[]` s labelom). Preto tu vedľa `examples` žije aj
 * `example_nodes`: plocha človeka potrebuje label, typ, oblasť a nález, plocha
 * AI len id — a `fieldsForAi()` je výber kľúčov, nie transformácia, takže tie
 * dva pohľady musia byť dva kľúče. Id sa tým v odpovedi pre človeka zopakuje;
 * to je pár bajtov proti tomu, aby živé sessions dostali iný payload než včera.
 */
class HygienaScreen extends ScreenSerializer
{
    /** Koľko príkladov na triedu. Pôvodné hodnoty `toolHygiene`: default 3, max 10. */
    public const DEFAULT_LIMIT = 3;

    public const MAX_LIMIT = 10;

    /** Správa sa počíta raz — je to prechod celou sieťou, nie dopyt. */
    private ?array $reportCache = null;

    /**
     * @param  array<string, mixed>  $filters  class, limit
     */
    public function __construct(private array $filters = []) {}

    public function data(): array
    {
        $report = $this->report();

        return [
            'generated_at' => $report['generated_at'] ?? null,
            'nodes' => (int) ($report['nodes'] ?? 0),
            'edges' => (int) ($report['edges'] ?? 0),
            'dirty_nodes' => (int) ($report['dirty_nodes'] ?? 0),
            'thresholds' => $report['thresholds'] ?? [],
            'classes' => $this->classes($report),
            'worst' => $this->worst($report),
        ];
    }

    /**
     * Čo z toho dostane AI — **presne to, čo dostávala doteraz.**
     *
     * `share`, `burden`, `thresholds` a `generated_at` sa nedávajú: sú to
     * veličiny, z ktorých obrazovka kreslí bar a vetu „zmerané pred 3 min",
     * a AI si poradie tried aj tak dostane hotové (najdrahšie prvé).
     * `example_nodes` nie: label a oblasť si AI dotiahne cez `mind_read`, keď sa
     * pre konkrétny uzol rozhodne — a to bol pôvodný, zámerný kompromis o tokeny.
     */
    public function fieldsForAi(): array
    {
        return [
            'nodes', 'edges', 'dirty_nodes',
            'classes[].class', 'classes[].count', 'classes[].weight', 'classes[].examples',
            'worst[].id', 'worst[].label', 'worst[].classes',
        ];
    }

    /**
     * Triedy odpadu, najdrahšie prvé (poradie drží príkaz).
     *
     * **Trieda s nulou vypadne z OBOCH plôch.** Nula nenesie informáciu — to je
     * zdravý stav — a keby ju zahodila len plocha AI, `ScreenParityTest` by
     * padol na rôznom počte riadkov, a padol by správne: obrazovka a tool by
     * potom hovorili o inom zozname.
     *
     * @param  array<string, mixed>  $report
     * @return list<array<string, mixed>>
     */
    private function classes(array $report): array
    {
        $out = [];

        foreach ($report['classes'] ?? [] as $class) {
            if (! is_array($class) || (int) ($class['count'] ?? 0) <= 0) {
                continue;
            }

            $examples = array_values(array_filter(
                (array) ($class['examples'] ?? []),
                static fn ($example): bool => is_array($example) && ($example['id'] ?? null) !== null,
            ));

            $out[] = [
                'class' => (string) $class['class'],
                'count' => (int) $class['count'],
                'weight' => (int) ($class['weight'] ?? 0),
                // podiel v sieti a záťaž (váha × počet) — z nich obrazovka kreslí bar
                'share' => (float) ($class['share'] ?? 0),
                'burden' => (int) ($class['burden'] ?? 0),
                'examples' => array_map(static fn (array $e): int => (int) $e['id'], $examples),
                'example_nodes' => array_map(fn (array $e): array => [
                    'id' => (int) $e['id'],
                    // label príkaz kráti na 60 znakov — krátenie textu je dáta
                    'label' => (string) ($e['label'] ?? ''),
                    'type' => $e['type'] ?? null,
                    'area' => $e['area'] ?? null,
                    'note' => $e['note'] ?? null,
                ], $examples),
            ];
        }

        return $out;
    }

    /**
     * Najdrahšie jednotlivé uzly — o týchto sa rozhoduje prvé, tak nesú aj label.
     *
     * @param  array<string, mixed>  $report
     * @return list<array<string, mixed>>
     */
    private function worst(array $report): array
    {
        $out = [];

        foreach ($report['worst'] ?? [] as $node) {
            if (! is_array($node) || ($node['id'] ?? null) === null) {
                continue;
            }

            $out[] = [
                'id' => (int) $node['id'],
                'label' => (string) ($node['label'] ?? ''),
                'classes' => array_values((array) ($node['classes'] ?? [])),
                'cost' => (int) ($node['cost'] ?? 0),
                'strength' => (float) ($node['strength'] ?? 0),
            ];
        }

        return $out;
    }

    /**
     * Strojová správa z `mind:hygiene`.
     *
     * `--no-file` je povinné: správa vyžiadaná obrazovkou ani AI nesmie po
     * každom volaní zakladať súbor v `storage/app`. `--fix` sa nepodáva nikdy —
     * opravy idú cez detail uzla, `mind_rename` / `mind_move`, teda tam, kde je
     * vidieť, čo presne sa deje s ktorým uzlom.
     *
     * Neznámu triedu odmieta príkaz a jeho chyba UŽ menuje platné triedy, takže
     * sa tu druhá kópia zoznamu nedrží. Je to vedomý rozdiel proti
     * {@see KontrolaScreen::active()}, kde sa neznámy filter ignoruje: tam bol
     * parameter dávno v odpovedi externého mirroru a 422 by mu zmenila chovanie,
     * kým `class` sem prichádza len z MCP a odmietnutie je jeho kontrakt
     * (`McpToolsTest::test_hygiene_refuses_an_unknown_class_and_names_the_valid_ones`).
     *
     * @return array<string, mixed>
     */
    private function report(): array
    {
        if ($this->reportCache !== null) {
            return $this->reportCache;
        }

        $options = [
            '--json' => true,
            '--no-file' => true,
            '--limit' => $this->limit(),
        ];

        // `is_scalar` nie je opatrnosť navyše: query string umí poslať `?class[]=x`
        // a `(string) []` je v PHP 8 warning, ktorý Laravel premení na výnimku —
        // teda 500 tam, kde patrí „neznáma trieda". Z MCP prichádza JSON, ktorý
        // vie to isté.
        $raw = $this->filters['class'] ?? '';
        $class = is_scalar($raw) ? trim((string) $raw) : '';

        if ($class !== '') {
            $options['--class'] = $class;
        }

        $exit = Artisan::call('mind:hygiene', $options);
        $output = trim(Artisan::output());

        if ($exit !== 0) {
            throw new \InvalidArgumentException($output !== '' ? $output : 'mind:hygiene failed.');
        }

        $report = json_decode($output, true);

        if (! is_array($report)) {
            throw new \RuntimeException('mind:hygiene returned no machine-readable report.');
        }

        return $this->reportCache = $report;
    }

    private function limit(): int
    {
        $raw = $this->filters['limit'] ?? self::DEFAULT_LIMIT;
        $limit = is_scalar($raw) ? (int) $raw : self::DEFAULT_LIMIT;

        return max(1, min($limit, self::MAX_LIMIT));
    }
}
