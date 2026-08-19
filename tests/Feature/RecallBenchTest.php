<?php

namespace Tests\Feature;

use App\Console\Commands\RecallBench;
use App\Models\Area;
use App\Models\Node;
use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Merací príkaz `mind:recall-bench`.
 *
 * Dve časti a každá odpovedá na inú otázku:
 *
 *  1. **Počíta metrika správne?** pass@k, MRR a latencie sa overujú na poradiach
 *     spočítaných RUČNE. Toto je jediná časť, ktorá musí platiť aj na sqlite —
 *     keby sa mýlila, celé meranie fúzie by hlásilo vymyslené čísla a nikto by
 *     to nespoznal, pretože „hybrid je lepší" je presne to, čo každý očakáva.
 *  2. **Beží príkaz nad korpusom?** Na malej zasiatej sieti s FAKE modelom, kde
 *     je odpoveď známa dopredu: jeden dopyt trafí kľúčová vetva aj hybrid,
 *     druhý NEMÁ v texte uzla ani jedno slovo, takže ho môže nájsť len vektor.
 *     Bench to musí vidieť ako `win` a označiť zásah ako semantický.
 *
 * Fake model je nutnosť, nie pohodlie: skutočná inferencia by z testu urobila
 * meranie CPU a jeho výsledok by závisel od toho, ktorý model je stiahnutý.
 */
class RecallBenchTest extends TestCase
{
    use RefreshDatabase;

    /** Ortogonálne jednotkové vektory — kosínus medzi dvoma rôznymi je 0, teda pod podlahou. */
    private const V_CACHE = [1.0, 0.0, 0.0, 0.0];

    private const V_BROWSER = [0.0, 1.0, 0.0, 0.0];

    private const V_JEWEL = [0.0, 0.0, 1.0, 0.0];

    private const V_NONE = [0.0, 0.0, 0.0, 1.0];

    /** @var array<int, string> */
    private array $tempFiles = [];

    protected function tearDown(): void
    {
        foreach ($this->tempFiles as $file) {
            is_file($file) && @unlink($file);
        }

        parent::tearDown();
    }

    public function test_rank_of_first_expected_node(): void
    {
        $this->assertSame(1, RecallBench::rankOf([7, 8, 9], [7]));
        $this->assertSame(3, RecallBench::rankOf([7, 8, 9], [9, 42]));
        $this->assertNull(RecallBench::rankOf([7, 8, 9], [42]));
        $this->assertNull(RecallBench::rankOf([], [7]));
    }

    public function test_verdict_treats_missing_node_as_worse_than_any_rank(): void
    {
        $this->assertSame('win', RecallBench::verdict(7, 3));
        $this->assertSame('win', RecallBench::verdict(null, 12));
        $this->assertSame('loss', RecallBench::verdict(1, 2));
        $this->assertSame('loss', RecallBench::verdict(4, null));
        $this->assertSame('same', RecallBench::verdict(2, 2));
        $this->assertSame('same', RecallBench::verdict(null, null));
    }

    /**
     * Poradia 1, 4 a „nenašlo" — čísla sú spočítané rukou:
     * pass@1 = 1/3, pass@3 = 1/3, pass@5 = 2/3, MRR = (1 + 0,25 + 0)/3 = 0,4167.
     */
    public function test_aggregate_computes_pass_at_k_and_mrr_by_hand(): void
    {
        $agg = RecallBench::aggregate([
            ['rank' => 1, 'returned' => 5, 'semantic' => 0, 'semantic_expected' => 0, 'ms' => 10.0],
            ['rank' => 4, 'returned' => 5, 'semantic' => 2, 'semantic_expected' => 1, 'ms' => 20.0],
            ['rank' => null, 'returned' => 0, 'semantic' => 0, 'semantic_expected' => 0, 'ms' => 30.0],
        ]);

        $this->assertSame(3, $agg['queries']);
        $this->assertSame(0.3333, $agg['pass'][1]);
        $this->assertSame(0.3333, $agg['pass'][3]);
        $this->assertSame(0.6667, $agg['pass'][5]);
        $this->assertSame([1 => 1, 3 => 1, 5 => 2], $agg['hits']);
        $this->assertSame(0.4167, $agg['mrr']);
        $this->assertSame(1, $agg['misses']);
        $this->assertSame(1, $agg['empty']);
        $this->assertSame(2, $agg['semantic_hits']);
        $this->assertSame(1, $agg['semantic_expected']);
        $this->assertSame(20.0, $agg['latency']['mean']);
        $this->assertSame(20.0, $agg['latency']['median']);
        $this->assertSame(30.0, $agg['latency']['p95']);
        $this->assertSame(10.0, $agg['latency']['min']);
    }

    /** Prázdna sada nesmie deliť nulou — príkaz sa pustí aj s `--only`, ktoré nič netrafí. */
    public function test_aggregate_survives_empty_mode(): void
    {
        $agg = RecallBench::aggregate([]);

        $this->assertSame(0, $agg['queries']);
        $this->assertSame(0.0, $agg['mrr']);
        $this->assertSame(0.0, $agg['latency']['p95']);
    }

    /**
     * Celý príkaz nad zasiatou sieťou.
     *
     * Dopyt 1 („stampede cache") je v labeli uzla — trafí ho kľúčová vetva aj
     * vektor, poradie sa nesmie zmeniť. Dopyt 2 („ako overiť vzhľad appky")
     * nemá s uzlom „Puppeteer harness" ani jedno spoločné slovo, takže kľúčová
     * vetva nemá čo nájsť a hybrid ho musí nájsť ako čisto semantický zásah.
     */
    public function test_bench_measures_hybrid_win_on_seeded_corpus(): void
    {
        $this->requireMariaDb();
        $this->fakeModel();

        $area = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);

        $cache = $this->node($area, 'Cache::flexible proti stampede', 'Stampede lock: stale-while-revalidate namiesto prepočtu v každom requeste.');
        $browser = $this->node($area, 'Puppeteer harness', 'Headless chrome vykreslí lokálne HTML a uloží PNG.');
        $jewel = $this->node($area, 'Šperky a kamene', 'Zlato, striebro a osadenie kameňov.');

        $embeddings = app(EmbeddingService::class);
        foreach ([$cache, $browser, $jewel] as $node) {
            $embeddings->embedNode($node->fresh());
        }
        $this->assertSame(3, $embeddings->count());

        $report = $this->runBench([
            ['q' => 'stampede cache', 'expect' => [$cache->id], 'why' => 'presné meno'],
            ['q' => 'ako overiť vzhľad appky', 'expect' => [$browser->id], 'why' => 'opísaný dopyt bez zhody v texte'],
        ]);

        $byQuery = collect($report['queries'])->keyBy('q');

        // Dopyt 1: obe vetvy ho majú prvý, fúzia to nesmie prehodiť.
        $this->assertSame(1, $byQuery['stampede cache']['keyword']['rank']);
        $this->assertSame(1, $byQuery['stampede cache']['hybrid']['rank']);
        $this->assertSame('same', $byQuery['stampede cache']['verdict']);

        // Dopyt 2: kľúčová vetva nemá čo nájsť, vektor áno — a označí sa ako semantický.
        $second = $byQuery['ako overiť vzhľad appky'];
        $this->assertNull($second['keyword']['rank']);
        $this->assertSame(1, $second['hybrid']['rank']);
        $this->assertSame('win', $second['verdict']);
        $this->assertSame(1, $second['hybrid']['semantic_expected']);
        $this->assertNotContains($jewel->id, $second['hybrid']['ids']);

        // Agregát: kľúčová vetva 1 z 2, hybrid 2 z 2. MRR: 0,5 vs 1,0.
        // JSON z príkazu vracia 1.0 ako `1`, preto (float) a nie assertSame na literál.
        $this->assertSame(0.5, (float) $report['keyword']['pass'][1]);
        $this->assertSame(1.0, (float) $report['hybrid']['pass'][1]);
        $this->assertSame(0.5, (float) $report['keyword']['mrr']);
        $this->assertSame(1.0, (float) $report['hybrid']['mrr']);
        $this->assertSame(1, $report['keyword']['misses']);
        $this->assertSame(0, $report['hybrid']['misses']);
        $this->assertSame(3, $report['corpus']['vectors']);
        $this->assertNull($report['model_warm_error']);

        // Cena vektorizácie dopytu musí byť v správe samostatne — bez nej sa
        // rozhodnutie „nechať HADES_EMBEDDINGS=true" robí bez ceny.
        $this->assertNotNull($byQuery['stampede cache']['embed_ms']);
    }

    /**
     * Nevektorizovaný korpus: hybrid sa skratuje na COUNT(*) a musí vrátiť
     * PRESNE to isté, čo kľúčová vetva. Toto je hlavná poistka celej vlny —
     * meranie nesmie hlásiť zlepšenie tam, kde sa nič nestalo.
     */
    public function test_bench_reports_identical_modes_on_unvectorised_corpus(): void
    {
        $this->requireMariaDb();
        $this->fakeModel();

        $area = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $node = $this->node($area, 'Cache::flexible proti stampede', 'Stampede lock namiesto prepočtu v každom requeste.');

        $report = $this->runBench([
            ['q' => 'stampede cache', 'expect' => [$node->id], 'why' => 'presné meno'],
        ]);

        $this->assertSame(0, $report['corpus']['vectors']);
        $this->assertNotNull($report['model_warm_error']);
        $this->assertSame($report['keyword']['pass'], $report['hybrid']['pass']);
        $this->assertSame($report['keyword']['mrr'], $report['hybrid']['mrr']);
        $this->assertSame(0, $report['hybrid']['semantic_hits']);
        $this->assertSame(
            $report['queries'][0]['keyword']['ids'],
            $report['queries'][0]['hybrid']['ids'],
        );
        $this->assertNull($report['queries'][0]['embed_ms']);
    }

    /** Správa v `storage/app` je súčasťou kontraktu príkazu, nie vedľajší efekt. */
    public function test_bench_writes_markdown_report(): void
    {
        $this->requireMariaDb();
        $this->fakeModel();

        $area = Area::create(['name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
        $node = $this->node($area, 'Cache::flexible proti stampede', 'Stampede lock namiesto prepočtu.');

        $suite = $this->suiteFile([['q' => 'stampede cache', 'expect' => [$node->id], 'why' => 'presné meno']]);

        Artisan::call('mind:recall-bench', ['--suite' => $suite, '--json' => true]);
        $report = json_decode(Artisan::output(), true);

        $this->assertIsString($report['report_path']);
        $this->tempFiles[] = $report['report_path'];

        $markdown = (string) file_get_contents($report['report_path']);
        $this->assertStringContainsString('# Recall bench', $markdown);
        $this->assertStringContainsString('| pass@1 |', $markdown);
        $this->assertStringContainsString('stampede cache', $markdown);
    }

    /**
     * @param  array<int, array{q: string, expect: array<int, int>, why: string}>  $suite
     * @return array<string, mixed>
     */
    private function runBench(array $suite): array
    {
        Artisan::call('mind:recall-bench', [
            '--suite' => $this->suiteFile($suite),
            '--json' => true,
            '--no-file' => true,
        ]);

        $report = json_decode(Artisan::output(), true);

        $this->assertIsArray($report, 'Príkaz nevrátil JSON: '.Artisan::output());

        return $report;
    }

    /**
     * @param  array<int, array<string, mixed>>  $suite
     */
    private function suiteFile(array $suite): string
    {
        $path = (string) tempnam(sys_get_temp_dir(), 'bench');
        file_put_contents($path, (string) json_encode($suite, JSON_UNESCAPED_UNICODE));
        $this->tempFiles[] = $path;

        return $path;
    }

    private function node(Area $area, string $label, string $description): Node
    {
        return Node::create([
            'label' => $label,
            'description' => $description,
            'type' => 'skill',
            'area_id' => $area->id,
            'strength' => 1.0,
            'origin' => 'session',
        ]);
    }

    /**
     * Fake modelu: vektor sa vyberá podľa toho, aká TÉMA je vo vstupnom texte —
     * a slová témy sú v dopyte iné než v uzle. Práve tým sa dá overiť semantický
     * zásah, ktorý kľúčová vetva nemá ako nájsť.
     *
     * Pasca (rovnaká ako v HybridRecallTest): `Http::fake()` sa nedá zavolať
     * dvakrát s inou odpoveďou, preto je stub jeden a rozhoduje mapa v ňom.
     */
    private function fakeModel(): void
    {
        $map = [
            'stampede' => self::V_CACHE,
            'cache' => self::V_CACHE,
            'Puppeteer' => self::V_BROWSER,
            'vzhľad' => self::V_BROWSER,
            'šperk' => self::V_JEWEL,
            'Šperk' => self::V_JEWEL,
        ];

        config([
            'cache.default' => 'array',
            'hades.embeddings.enabled' => true,
            'hades.embeddings.model' => 'fake-embed',
            'hades.embeddings.candidates' => 10,
            'hades.embeddings.min_similarity' => 0.35,
            'hades.embeddings.rrf_k' => 60,
            'hades.console.ollama.host' => 'http://ollama.test:11434',
            'hades.console.ollama.timeout' => 5,
        ]);

        Http::preventStrayRequests();

        Http::fake(function (Request $request) use ($map) {
            $input = (string) ($request->data()['input'] ?? '');

            foreach ($map as $needle => $vector) {
                if (str_contains($input, (string) $needle)) {
                    return Http::response(['embeddings' => [$vector]]);
                }
            }

            return Http::response(['embeddings' => [self::V_NONE]]);
        });
    }

    /**
     * searchNodes stojí na MariaDB `COLLATE utf8mb4_unicode_ci`, ktoré sqlite
     * nepozná — bez kľúčovej vetvy nie je čo fúzovať ani merať.
     */
    private function requireMariaDb(): void
    {
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE.');
        }
    }
}
