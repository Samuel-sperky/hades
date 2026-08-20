<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Vektorová vetva prewiringu (A12 v `mind:rewire`) bez modelu.
 *
 * Vektory sú tu nafabrikované priamo do `node_embeddings` — 4-rozmerné, ručne
 * zvolené tak, aby bol kosínus vidieť z hlavy. Volať Ollamu by znamenalo, že test
 * meria CPU inferenciu a jeho výsledok závisí od toho, ktorý model je práve
 * stiahnutý.
 *
 * Pasca, na ktorej stojí celý tento súbor: `mind:rewire` má DVANÁSŤ krokov a
 * jedenásť z nich zapisuje hrany tiež. Keby fixtúry spustili čo i len jeden z
 * nich, test by tvrdil niečo o vektoroch a merať by pritom TF-IDF. Preto sú
 * labely tokenovo disjunktné (A3/A5 nemajú čo zdieľať), neobsahujú ani jeden
 * klastrový tag z CLUSTERS (A6), uzly nemajú `department_id` (A8 skenuje len
 * whereNotNull) ani `meta.project` (A7) a nie sú to session záznamy (A4).
 * Poistkou je {@see assertEdgeCount()} nad CELOU tabuľkou — nie len nad párom,
 * ktorý test čaká.
 */
class EmbeddingPrewiringTest extends TestCase
{
    use RefreshDatabase;

    private Area $area;

    /** Jednotkové vektory: kosínus voči V_BASE je pri každom uvedený. */
    private const V_BASE = [1.0, 0.0, 0.0, 0.0];

    private const V_NEAR = [0.96, 0.28, 0.0, 0.0];   // ≈ 0,96 — nad prahom

    private const V_MID = [0.6, 0.8, 0.0, 0.0];      // ≈ 0,60 — pod prahom 0,75

    private const V_FAR = [0.0, 0.0, 0.0, 1.0];      // 0,0

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.embeddings.enabled' => true,
            'hades.embeddings.model' => 'fake-embed',
            'hades.embeddings.candidates' => 40,
            'hades.embeddings.min_similarity' => 0.35,
            'hades.embeddings.prewire' => true,
            'hades.embeddings.prewire_min_similarity' => 0.75,
        ]);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0,
        ]);
    }

    public function test_similar_vectors_get_a_synapse(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        $this->rewire();

        $this->assertEdgeCount(1);
        $this->assertTrue($this->linked($a, $b));

        $edge = $this->edge($a, $b);
        $this->assertSame('similarity', $edge->kind);
        $this->assertTrue((bool) $edge->auto);
    }

    /**
     * Záznamy o Claude Code sessions sa nespájajú, ani keď sú ich vektory blízko.
     *
     * Nález prvého merania na živých dátach (20. 8. 2026): medzi 566 pármi bol
     * `intelligent-gould-a0ae51 ↔ intelligent-murdock-c8bcce` s podobnosťou 0,85.
     * Nespája ich téma, ale to, že sumár session má vždy tú istú štruktúru — takže
     * si ich embeddingy sadnú blízko bez ohľadu na obsah. Pri ~8 % takých párov by
     * job pridal do siete ~45 hrán, ktoré nesú len „oba sú záznam".
     */
    public function test_session_records_are_never_paired_by_vectors(): void
    {
        $a = $this->node('intelligent-gould-a0ae51');
        $b = $this->node('intelligent-murdock-c8bcce');

        // Zámerne TIE ISTÉ vektory, teda podobnosť 1,0: keby filter nebol, hrana
        // vznikne určite a test by prešiel len omylom.
        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_BASE);

        $this->rewire();

        $this->assertEdgeCount(0);

        // A skutočný projekt s pomlčkami vzoru nesedí — filter nesmie byť taký
        // široký, aby zmietol aj `sperky-ai` alebo `feat-hades-klient`.
        $c = $this->node('sperky-ai');
        $d = $this->node('hades-klient-web');

        $this->vector($c, self::V_BASE);
        $this->vector($d, self::V_NEAR);

        $this->rewire();

        $this->assertTrue($this->linked($c, $d), 'projekt s pomlčkami sa spájať MÁ');
    }

    public function test_similarity_below_the_threshold_creates_nothing(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kvetinárstvo');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_MID);

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_second_run_adds_nothing_and_does_not_duplicate(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        $this->rewire();
        $this->assertEdgeCount(1);

        $weight = (float) $this->edge($a, $b)->weight;

        $this->rewire();

        // idempotencia je aj o VÁHE: connect() existujúcu hranu inkrementuje,
        // takže druhý beh, ktorý pár „znova navrhne", by ju tichom posilnil
        $this->assertEdgeCount(1);
        $this->assertSame($weight, (float) $this->edge($a, $b)->weight);
    }

    public function test_existing_edge_is_left_alone(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        Edge::create([
            'source_id' => min($a->id, $b->id),
            'target_id' => max($a->id, $b->id),
            'weight' => 3.0,
            'kind' => 'manual',
            'auto' => false,
        ]);

        $this->rewire();

        $this->assertEdgeCount(1);

        // ručná hrana sa nesmie preklopiť na 'similarity' ani zosilniť
        $edge = $this->edge($a, $b);
        $this->assertSame('manual', $edge->kind);
        $this->assertSame(3.0, (float) $edge->weight);
    }

    public function test_a_node_never_connects_to_itself(): void
    {
        // jediný vektorizovaný uzol: sám sebou je najbližší sused s kosínom 1,0
        $only = $this->node('Docker');
        $this->vector($only, self::V_BASE);

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_soft_deleted_node_is_not_connected(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        // vektor zmazaného uzla v tabuľke ostáva (cascade patrí forceDelete),
        // takže bez filtra by prewiring spájal uzol, ktorý už nikto neuvidí
        $b->delete();

        $this->rewire();

        $this->assertEdgeCount(0);
        $this->assertDatabaseCount('node_embeddings', 2);
    }

    public function test_branch_is_skipped_when_embeddings_are_disabled(): void
    {
        config(['hades.embeddings.enabled' => false]);

        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_branch_is_skipped_when_the_switch_is_off(): void
    {
        config(['hades.embeddings.prewire' => false]);

        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_empty_embedding_table_finishes_without_error(): void
    {
        $this->node('Docker');
        $this->node('Kontejnery');

        $this->rewire();

        $this->assertEdgeCount(0);
        $this->assertDatabaseCount('node_embeddings', 0);
    }

    public function test_vector_of_another_model_is_ignored(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR, model: 'other-embed');

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_vector_of_another_dimension_is_ignored(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        // ten istý model, kratší vektor (výmena modelu pod rovnakým menom):
        // skalárny súčin dvoch rôznych dĺžok je nezmysel, nie slabá podobnosť
        $this->vector($b, [1.0, 0.0, 0.0]);

        $this->rewire();

        $this->assertEdgeCount(0);
    }

    public function test_dry_run_writes_no_edge(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);

        $this->artisan('mind:rewire', ['--dry-run' => true])
            ->expectsOutputToContain('Porovnanie prewiring vetiev')
            ->assertSuccessful();

        $this->assertEdgeCount(0);
    }

    public function test_dry_run_counts_the_pair_the_vector_branch_would_add(): void
    {
        $a = $this->node('Docker');
        $b = $this->node('Kontejnery');
        $far = $this->node('Kvetinárstvo');

        $this->vector($a, self::V_BASE);
        $this->vector($b, self::V_NEAR);
        $this->vector($far, self::V_FAR);

        $this->artisan('mind:rewire', ['--dry-run' => true, '--sample' => 5])
            ->expectsOutputToContain('|vektor \\ TF-IDF|:  1')
            ->expectsOutputToContain('Docker')
            ->assertSuccessful();

        $this->assertEdgeCount(0);
    }

    public function test_per_node_cap_limits_new_vector_edges(): void
    {
        // päť takmer identických vektorov: bez stropu by hub dostal štyri hrany
        $hub = $this->node('Docker');
        $this->vector($hub, self::V_BASE);

        foreach (['Kontejnery', 'Obraz', 'Zväzok', 'Register'] as $i => $label) {
            $peer = $this->node($label);
            // mierne odlišné vektory, aby bolo poradie deterministické a všetky
            // ostali vysoko nad prahom
            $this->vector($peer, [1.0 - ($i * 0.001), 0.02 * ($i + 1), 0.0, 0.0]);
        }

        $this->rewire();

        // MAX_VECTOR_LINKS_PER_NODE = 3 na uzol; hub ich nesmie mať viac
        $degree = Edge::query()
            ->where('source_id', $hub->id)
            ->orWhere('target_id', $hub->id)
            ->count();

        $this->assertLessThanOrEqual(3, $degree);
        $this->assertGreaterThan(0, $degree);
    }

    // -----------------------------------------------------------------------

    private function rewire(): void
    {
        $this->artisan('mind:rewire')->assertSuccessful();
    }

    /**
     * Uzol bez oddelenia, bez popisu a bez meta — fixtúra, ktorá nespustí žiadny
     * iný krok rewiringu (pozri docblock triedy).
     */
    private function node(string $label): Node
    {
        return Node::create([
            'type' => 'skill',
            'label' => $label,
            'description' => '',
            'area_id' => $this->area->id,
            'strength' => 1,
        ])->fresh();
    }

    /**
     * Zapíše vektor priamo do tabuľky — packed float32 ('g' je little endian, tá
     * istá voľba ako v EmbeddingService; s 'f' by test na inom stroji čítal šum).
     *
     * @param  array<int, float>  $vector
     */
    private function vector(Node $node, array $vector, ?string $model = null, ?int $dimensions = null): void
    {
        $norm = sqrt(array_sum(array_map(fn (float $v) => $v * $v, $vector)));

        DB::table('node_embeddings')->insert([
            'node_id' => $node->id,
            'model' => $model ?? 'fake-embed',
            'dimensions' => $dimensions ?? count($vector),
            'vector' => pack('g*', ...$vector),
            'norm' => $norm,
            'source_hash' => str_repeat('a', 64),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function assertEdgeCount(int $expected): void
    {
        $this->assertSame($expected, Edge::query()->count(), 'Iný počet hrán, než čaká test.');
    }

    private function linked(Node $a, Node $b): bool
    {
        return Edge::query()
            ->where('source_id', min($a->id, $b->id))
            ->where('target_id', max($a->id, $b->id))
            ->exists();
    }

    private function edge(Node $a, Node $b): Edge
    {
        return Edge::query()
            ->where('source_id', min($a->id, $b->id))
            ->where('target_id', max($a->id, $b->id))
            ->firstOrFail();
    }
}
