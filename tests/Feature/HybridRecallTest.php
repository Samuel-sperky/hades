<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Services\EmbeddingService;
use App\Services\MindService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Fúzia dvoch vetiev recallu: kľúčové slová + vektory (RRF).
 *
 * Model je fake s deterministickými 4-rozmernými vektormi — inak by test meral
 * CPU inferenciu a jeho výsledok by závisel od toho, ktorý model je práve
 * stiahnutý. Poradie musí byť známe DOPREDU z konštrukcie vektorov, nie odvodené
 * z toho, čo služba vráti.
 *
 * Najdôležitejšia vec, ktorú tento test drží, nie je semantika, ale jej ABSENCIA:
 * `mind_recall` volajú živé sessions a keď je vektorová vetva vypnutá, nedostupná
 * alebo je korpus nevektorizovaný, odpoveď musí byť ZNAK NA ZNAK tá istá ako pred
 * fúziou. Spadnutý lokálny model nesmie urobiť z pamäte prázdno.
 */
class HybridRecallTest extends TestCase
{
    use RefreshDatabase;

    /** Jednotkové vektory, pri ktorých je kosínus voči [1,0,0,0] vidieť z hlavy. */
    private const V_HIT = [1.0, 0.0, 0.0, 0.0];      // podobnosť 1,0

    private const V_NEAR = [0.6, 0.8, 0.0, 0.0];     // podobnosť 0,6

    private const V_MISS = [0.0, 0.0, 0.0, 1.0];     // podobnosť 0,0 — pod podlahou

    private MindService $mind;

    private EmbeddingService $embeddings;

    private Area $area;

    /** @var array<string, array<int, float>> */
    private array $vectorMap = [];

    /** @var array<int, float> */
    private array $vectorDefault = self::V_HIT;

    private bool $modelDown = false;

    private bool $faked = false;

    protected function setUp(): void
    {
        parent::setUp();

        // searchNodes stojí na MariaDB `COLLATE utf8mb4_unicode_ci` (accent-insensitive
        // LIKE), ktoré sqlite nepozná — na predvolenej sade sa preto preskočí.
        // Kľúčová vetva je polovica fúzie, takže bez nej nie je čo fúzovať.
        if (DB::connection()->getDriverName() === 'sqlite') {
            $this->markTestSkipped('recall/searchNodes vyžaduje MariaDB COLLATE.');
        }

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

        $this->mind = app(MindService::class);
        $this->embeddings = app(EmbeddingService::class);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    /**
     * Fake modelu: vektor sa vyberá podľa toho, čo je vo vstupnom texte.
     *
     * Pasca: `Http::fake()` sa NEDÁ zavolať druhý raz s inou odpoveďou —
     * registruje ďalší stub a vyhrá ten prvý, ktorý odpoveď vráti. Preto je stub
     * jeden a mapa aj „model je dole" žijú v propertách, ktoré test prepisuje.
     *
     * @param  array<string, array<int, float>>  $map
     * @param  array<int, float>  $default
     */
    private function fakeModel(array $map = [], array $default = self::V_HIT): void
    {
        $this->vectorMap = $map;
        $this->vectorDefault = $default;

        if ($this->faked) {
            return;
        }

        $this->faked = true;

        Http::preventStrayRequests();

        Http::fake(function (Request $request) {
            if ($this->modelDown) {
                return Http::response(['error' => 'model not found'], 404);
            }

            $input = (string) ($request->data()['input'] ?? '');

            foreach ($this->vectorMap as $needle => $vector) {
                if (str_contains($input, (string) $needle)) {
                    return Http::response(['embeddings' => [$vector]]);
                }
            }

            return Http::response(['embeddings' => [$this->vectorDefault]]);
        });
    }

    private function node(string $label, string $description = '', ?Area $area = null): Node
    {
        return Node::create([
            'type' => 'skill',
            'label' => $label,
            'description' => $description,
            'area_id' => ($area ?? $this->area)->id,
            'strength' => 1,
        ]);
    }

    /** @param  array<int, Node>  $nodes */
    private function embed(array $nodes): void
    {
        foreach ($nodes as $node) {
            $this->embeddings->embedNode($node->fresh());
        }
    }

    /**
     * Odpoveď zbalená na to, čo je kontrakt: poradie labelov + celá meta.
     *
     * Porovnávať sa musí meta CELÁ, nie len relevancia — „bez vektorov to
     * vyzerá ako predtým" znamená aj to, že v nej nepribudol žiaden kľúč.
     *
     * @return array<int, array<string, mixed>>
     */
    private function shape(string $query, int $limit = 6, ?array $areas = null): array
    {
        $out = $this->mind->recallWithMeta($query, $limit, null, $areas);

        return $out['nodes']->map(fn (Node $n) => [
            'label' => $n->label,
            'meta' => $out['meta'][$n->id],
        ])->all();
    }

    /** @return array<int, string> */
    private function keywordOrder(string $query, int $limit = 6): array
    {
        return $this->mind->searchNodes($query, $limit)
            ->map(fn (array $row) => (string) $row['node']->label)
            ->all();
    }

    public function test_a_node_with_no_shared_word_is_found_through_its_vector(): void
    {
        // Celý zmysel vektorovej vetvy: „Prenosné prostredie appky" nenesie ani
        // jeden koreň dopytu „docker" (ani cez doménový slovník: container,
        // kontajner…), takže kľúčová vetva ho nemá ako nájsť.
        $lexical = $this->node('Docker kontajnery v Hadesovi', 'Vývojové kontajnery sa rebuildujú voľne.');
        $semantic = $this->node('Prenosné prostredie appky', 'Appka beží v izolovanom obraze systému, takže sa rovnako spustí kdekoľvek.');

        $this->fakeModel([
            'Prenosné prostredie' => self::V_HIT,
            'Docker kontajnery' => self::V_MISS,
        ]);
        $this->embed([$lexical, $semantic]);

        $this->assertNotContains('Prenosné prostredie appky', $this->keywordOrder('docker'));

        $out = $this->mind->recallWithMeta('docker', 6);
        $labels = $out['nodes']->pluck('label')->all();

        $this->assertContains('Prenosné prostredie appky', $labels);
        $this->assertContains('Docker kontajnery v Hadesovi', $labels);

        // `semantic` je aditívny príznak a je LEN tam, kde uzol netrafil ani jedno
        // slovo dopytu. Na lexikálnom zásahu kľúč vôbec nesmie byť.
        $this->assertTrue($out['meta'][$semantic->id]['semantic']);
        $this->assertArrayNotHasKey('semantic', $out['meta'][$lexical->id]);
    }

    public function test_disabled_embeddings_leave_recall_exactly_as_it_was(): void
    {
        [$a, $b, $c] = $this->corpus();

        // Vektory sú zámerne také, že BY poradie prehodili — keby vypnutie
        // nefungovalo, test to uvidí ako inú odpoveď, nie ako rovnakú.
        $this->fakeModel([
            'Fronta bez Dockeru' => self::V_HIT,
            'Docker a Redis' => self::V_MISS,
            'Vývojové prostredie' => self::V_MISS,
        ]);
        $this->embed([$a, $b, $c]);

        $withVectors = $this->shape('docker redis');

        config(['hades.embeddings.enabled' => false]);

        $calls = count(Http::recorded());
        $withoutVectors = $this->shape('docker redis');

        // 1. model sa vôbec nezavolal
        $this->assertSame($calls, count(Http::recorded()));

        // 2. poradie je poradie kľúčovej vetvy
        $this->assertSame(
            $this->keywordOrder('docker redis'),
            array_column($withoutVectors, 'label'),
        );

        // 3. v mete nie je nič nové — presne päť kľúčov, ktoré tam boli vždy
        foreach ($withoutVectors as $row) {
            $this->assertSame(['relevance', 'snippet', 'noise', 'related', 'via'], array_keys($row['meta']));
        }

        // 4. a fixtura nie je jalová: so vektormi to naozaj vyzerá inak
        $this->assertNotSame($withoutVectors, $withVectors);
    }

    public function test_an_unvectorised_corpus_changes_nothing_and_never_calls_the_model(): void
    {
        $this->corpus();
        $this->fakeModel();

        $hybrid = $this->shape('docker redis');

        // Prázdny korpus riešime bez modelu — inak by každý recall na
        // nevektorizovanej sieti platil sekundy CPU inferencie za istú nulu.
        $this->assertSame(0, count(Http::recorded()));
        $this->assertSame($this->keywordOrder('docker redis'), array_column($hybrid, 'label'));

        config(['hades.embeddings.enabled' => false]);
        $this->assertSame($hybrid, $this->shape('docker redis'));
    }

    public function test_an_unreachable_model_degrades_to_keyword_only(): void
    {
        [$a, $b, $c] = $this->corpus();

        $this->fakeModel(['Fronta bez Dockeru' => self::V_HIT]);
        $this->embed([$a, $b, $c]);

        $baseline = $this->keywordOrder('docker redis');

        // Model spadol PO vektorizácii: korpus je plný, takže sa naozaj ide na
        // sieť a chyba priletí z dopytu, nie z prázdneho korpusu.
        $this->modelDown = true;
        $calls = count(Http::recorded());

        $degraded = $this->shape('docker redis');

        $this->assertGreaterThan($calls, count(Http::recorded()), 'dopyt sa mal o model pokúsiť');
        $this->assertSame($baseline, array_column($degraded, 'label'));
        $this->assertNotSame([], $degraded);

        foreach ($degraded as $row) {
            $this->assertArrayNotHasKey('semantic', $row['meta']);
        }
    }

    public function test_noise_nodes_still_rank_after_clean_ones(): void
    {
        $clean = $this->node('Docker kontajnery', 'Rebuild kontajnerov je bezpečný a robí sa voľne.');
        // stub = uzol bez popisu; nenesie znalosť, hoci jeho label dopyt trafí
        $noise = $this->node('Docker init', '');

        // Odpadu dávame LEPŠÍ vektor než čistému uzlu. Semantika nesmie vytiahnuť
        // odpad na začiatok kontextu — to je celý zmysel `noiseOf`.
        $this->fakeModel([
            'Docker init' => self::V_HIT,
            'Docker kontajnery' => self::V_NEAR,
        ]);
        $this->embed([$clean, $noise]);

        $out = $this->mind->recallWithMeta('docker', 6);
        $labels = $out['nodes']->pluck('label')->all();

        $this->assertSame('stub', $out['meta'][$noise->id]['noise']);
        $this->assertContains('Docker init', $labels, 'odpad sa označuje, nezahadzuje');
        $this->assertLessThan(
            array_search('Docker init', $labels, true),
            array_search('Docker kontajnery', $labels, true),
        );
    }

    public function test_relevance_stays_in_range_and_full_coverage_wins(): void
    {
        // Plné pokrytie dopytu, ale bez zhody v labeli → relevancia 0,67, teda
        // MINIMUM, aké môže mať uzol, čo trafil všetky pojmy.
        $all = $this->node('Vývojové prostredie', 'Beží tu docker aj redis, oboje v kontejneri.');
        // Jeden pojem z dvoch → 0,5 z kľúčových slov, ale PERFEKTNÝ vektor.
        $one = $this->node('Redis fronta', 'Fronta správ v pamäti, bez ďalších závislostí.');

        $this->fakeModel([
            'Redis fronta' => self::V_HIT,
            'Vývojové prostredie' => self::V_MISS,
        ]);
        $this->embed([$all, $one]);

        $out = $this->mind->recallWithMeta('docker redis', 6);
        $meta = $out['meta'];

        foreach ($meta as $row) {
            $this->assertGreaterThanOrEqual(0.0, $row['relevance']);
            $this->assertLessThanOrEqual(1.0, $row['relevance']);
        }

        $this->assertSame(0.67, $meta[$all->id]['relevance']);

        // Vektorová relevancia sa zaokrúhľuje DOLU práve preto, aby sa tu
        // nedotkla 0,67 — 2/3 nahor by dalo remízu a vlastnosť „plné pokrytie je
        // vždy nad čiastočným" by padla.
        $this->assertSame(0.66, $meta[$one->id]['relevance']);
        $this->assertGreaterThan($meta[$one->id]['relevance'], $meta[$all->id]['relevance']);
    }

    public function test_a_purely_semantic_hit_cannot_reach_a_full_lexical_match(): void
    {
        $semantic = $this->node('Obraz systému', 'Izolované prostredie appky, spustiteľné kdekoľvek.');

        $this->fakeModel(['Obraz systému' => self::V_HIT]);
        $this->embed([$semantic]);

        $out = $this->mind->recallWithMeta('docker', 6);

        // Tretina za zhodu v LABELI je pre čisto semantický zásah nedosiahnuteľná
        // z definície: netrafil ani jedno slovo dopytu, teda ani v labeli.
        $this->assertSame(0.66, $out['meta'][$semantic->id]['relevance']);
    }

    public function test_a_fused_result_never_repeats_a_node(): void
    {
        // Uzol v OBOCH vetvách je presne ten prípad, kde by naivná konkatenácia
        // vrátila to isté dvakrát a AI by platila dva popisy za jeden poznatok.
        $both = $this->node('Docker kontajnery', 'Rebuild kontajnerov je bezpečný a robí sa voľne.');
        $semantic = $this->node('Obraz systému', 'Izolované prostredie appky, spustiteľné kdekoľvek.');

        $this->fakeModel([
            'Docker kontajnery' => self::V_HIT,
            'Obraz systému' => self::V_NEAR,
        ]);
        $this->embed([$both, $semantic]);

        $out = $this->mind->recallWithMeta('docker', 6);
        $ids = $out['nodes']->pluck('id')->all();

        $this->assertSame(array_values(array_unique($ids)), $ids);
        $this->assertContains($both->id, $ids);
        $this->assertContains($semantic->id, $ids);
        $this->assertCount(count($ids), $out['meta']);
    }

    public function test_the_area_scope_also_binds_the_vector_branch(): void
    {
        $other = Area::create([
            'name' => 'Biznis & projekty', 'slug' => 'biznis-projekty', 'color' => '#d8b878', 'angle' => 90,
        ]);

        $inScope = $this->node('Docker kontajnery', 'Rebuild kontajnerov je bezpečný a robí sa voľne.');
        $outOfScope = $this->node('Obraz systému', 'Izolované prostredie appky, spustiteľné kdekoľvek.', $other);

        $this->fakeModel([
            'Obraz systému' => self::V_HIT,
            'Docker kontajnery' => self::V_NEAR,
        ]);
        $this->embed([$inScope, $outOfScope]);

        $scoped = $this->mind->recallWithMeta('docker', 6, null, ['Vývoj & kód']);
        $this->assertSame(['Docker kontajnery'], $scoped['nodes']->pluck('label')->all());

        // Neznámy rozsah nesmie ticho vrátiť celú sieť — ani cez vektory, ktoré
        // o oblastiach nevedia nič.
        $unknown = $this->mind->recallWithMeta('docker', 6, null, ['Neexistujúca oblasť']);
        $this->assertCount(0, $unknown['nodes']);
    }

    /**
     * Tri uzly s rôznym pokrytím dopytu „docker redis" — spoločná fixtúra pre
     * testy degradácie, kde ide o TVAR odpovede, nie o obsah uzlov.
     *
     * @return array<int, Node>
     */
    private function corpus(): array
    {
        return [
            $this->node('Docker a Redis v Hadesovi', 'Kontajnery aj cache bežia v jednom compose súbore.'),
            $this->node('Vývojové prostredie', 'Beží tu docker, rebuild je voľný a nič sa nemaže.'),
            $this->node('Fronta bez Dockeru', 'Redis drží frontu správ aj mimo kontajnerov.'),
        ];
    }
}
