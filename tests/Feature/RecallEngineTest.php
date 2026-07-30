<?php

namespace Tests\Feature;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;
use App\Services\Recall\RecallEngine;
use App\Services\Recall\RecallResult;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Recall proti REÁLNEJ MariaDB (balík P1, rozhranie #13).
 *
 * Toto je brána refaktoru: `RecallEngine` je vyčlenený z `MindService`
 * (rozhodnutie #40) a chovanie sa NESMIE zmeniť. Test preto meria vlastnosti,
 * ktoré tvoria kontrakt recallu, nie implementáciu:
 *
 *   - tvrdý prah (uzol bez term-hitu sa nikdy nevráti)
 *   - accent-insensitive LIKE cez `COLLATE utf8mb4_unicode_ci` (MariaDB-only)
 *   - SK stemming + doménová expanzia (SK↔EN slovník `canon`)
 *   - graph-walk hĺbky 1 a strop `ceil(limit × 1.5)`
 *   - aktivácie `recall` / `recall-neighbor` so `session_key`
 *   - `MindService::recall()` naďalej vracia plochú Collection<Node>
 */
class RecallEngineTest extends TestCase
{
    use RefreshDatabase;

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cache.default' => 'array', 'recall.vector.enabled' => false]);

        $this->area = Area::create([
            'name' => 'Vývoj & kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 342,
        ]);
    }

    private function node(string $label, ?string $description = null, float $strength = 1.0): Node
    {
        return Node::create([
            'type' => 'skill',
            'area_id' => $this->area->id,
            'label' => $label,
            'description' => $description,
            'strength' => $strength,
            'last_activated_at' => now(),
        ]);
    }

    private function engine(): RecallEngine
    {
        return app(RecallEngine::class);
    }

    // ---- tvrdý prah ---------------------------------------------------------

    public function test_search_never_returns_node_without_a_real_term_hit(): void
    {
        $hit = $this->node('Redis caching', 'Cache-aside vzor s TTL a jitterom.');
        $this->node('Kubernetes Ingress', 'Routovanie HTTP do klastra.', 99.0);

        $rows = $this->engine()->search('redis', 10);

        $this->assertSame([$hit->id], $rows->pluck('node.id')->all());
        $this->assertGreaterThan(0, $rows->first()['score']);
    }

    public function test_search_on_empty_query_returns_nothing(): void
    {
        $this->node('Redis caching');

        $this->assertTrue($this->engine()->search('   ', 10)->isEmpty());
    }

    // ---- SK špecifiká: diakritika + stemming + doménový slovník -------------

    public function test_query_without_diacritics_finds_node_with_diacritics(): void
    {
        $hit = $this->node('Šperky fotografia', 'Retuš šperkov na bielom pozadí.');

        $rows = $this->engine()->search('sperky', 10);

        $this->assertSame([$hit->id], $rows->pluck('node.id')->all());
    }

    public function test_inflected_query_finds_the_node(): void
    {
        $hit = $this->node('Objednávky v eshope', 'Stavy objednávok a ich prechody.');

        $rows = $this->engine()->search('objednávok', 10);

        $this->assertContains($hit->id, $rows->pluck('node.id')->all());
    }

    public function test_english_query_finds_slovak_node_through_canon_dictionary(): void
    {
        $hit = $this->node('Cenotvorba šperkov', 'Cenotvorba a marže pri šperkoch.');

        $rows = $this->engine()->search('pricing', 10);

        $this->assertContains($hit->id, $rows->pluck('node.id')->all());
    }

    // ---- skóre a poradie ---------------------------------------------------

    public function test_more_matched_concepts_outrank_higher_strength(): void
    {
        $weakButRelevant = $this->node('Redis cache pre objednávky', 'Cache objednávok v Redise.', 1.0);
        $strongButNarrow = $this->node('Redis monitoring', 'Sledovanie Redisu.', 500.0);

        $rows = $this->engine()->search('redis objednávky', 10);
        $ids = $rows->pluck('node.id')->all();

        $this->assertSame($weakButRelevant->id, $ids[0]);
        $this->assertContains($strongButNarrow->id, $ids);
    }

    public function test_strength_breaks_ties_when_concept_count_is_equal(): void
    {
        $weak = $this->node('Redis alfa', 'Redis.', 2.0);
        $strong = $this->node('Redis beta', 'Redis.', 40.0);

        $ids = $this->engine()->search('redis', 10)->pluck('node.id')->all();

        $this->assertSame([$strong->id, $weak->id], $ids);
        $this->assertNotSame($weak->id, $ids[0]);
    }

    public function test_search_respects_the_limit(): void
    {
        foreach (range(1, 8) as $i) {
            $this->node("Redis uzol {$i}", 'Redis.');
        }

        $this->assertCount(3, $this->engine()->search('redis', 3));
    }

    // ---- graph-walk hĺbky 1 -------------------------------------------------

    public function test_recall_adds_direct_neighbours_behind_the_primaries(): void
    {
        $primary = $this->node('Redis caching', 'Cache-aside vzor.');
        $neighbour = $this->node('Fronta úloh', 'Spracovanie na pozadí.');
        $stranger = $this->node('Fakturácia', 'Vystavovanie faktúr.');

        Edge::create([
            'source_id' => $primary->id,
            'target_id' => $neighbour->id,
            'weight' => 1,
            'last_activated_at' => now(),
        ]);

        $result = $this->engine()->recall('redis', 4);

        $this->assertInstanceOf(RecallResult::class, $result);
        $this->assertSame([$primary->id], $result->primaries->pluck('id')->all());
        $this->assertSame([$neighbour->id], $result->neighbours->pluck('id')->all());
        $this->assertSame(2, $result->total);
        $this->assertSame([$primary->id, $neighbour->id], $result->ids());
        $this->assertNotContains($stranger->id, $result->ids());
    }

    public function test_recall_caps_the_result_at_limit_and_a_half(): void
    {
        $primaries = collect(range(1, 4))->map(fn ($i) => $this->node("Redis uzol {$i}", 'Redis.'));
        $neighbours = collect(range(1, 6))->map(fn ($i) => $this->node("Sused {$i}", 'Nič spoločné.'));

        foreach ($neighbours as $n) {
            Edge::create([
                'source_id' => $primaries->first()->id,
                'target_id' => $n->id,
                'weight' => 1,
                'last_activated_at' => now(),
            ]);
        }

        $result = $this->engine()->recall('redis', 4);

        // strop = ceil(4 × 1.5) = 6 → 4 primárne + 2 susedia
        $this->assertSame(4, $result->primaries->count());
        $this->assertSame(2, $result->neighbours->count());
        $this->assertSame(6, $result->total);
    }

    public function test_recall_on_no_match_returns_empty_result(): void
    {
        $this->node('Redis caching');

        $result = $this->engine()->recall('kompletne nesuvisiaci dopyt zzz', 5);

        $this->assertSame(0, $result->total);
        $this->assertTrue($result->all()->isEmpty());
        $this->assertSame(0, Activation::count());
    }

    // ---- aktivácie a session_key -------------------------------------------

    public function test_recall_records_activations_with_the_session_key(): void
    {
        $primary = $this->node('Redis caching', 'Cache-aside.');
        $neighbour = $this->node('Fronta úloh', 'Na pozadí.');
        Edge::create([
            'source_id' => $primary->id,
            'target_id' => $neighbour->id,
            'weight' => 1,
            'last_activated_at' => now(),
        ]);

        $this->engine()->recall('redis', 4, 'sess-p1');

        $this->assertSame('recall', Activation::where('node_id', $primary->id)->value('kind'));
        $this->assertSame('recall-neighbor', Activation::where('node_id', $neighbour->id)->value('kind'));
        $this->assertSame(2, Activation::where('session_key', 'sess-p1')->count());
    }

    public function test_recall_does_not_change_node_strength(): void
    {
        $node = $this->node('Redis caching', 'Cache-aside.', 3.0);

        $this->engine()->recall('redis', 4);

        $this->assertSame(3.0, (float) $node->fresh()->strength);
    }

    // ---- fasáda MindService (7 konzumentov) --------------------------------

    public function test_mind_service_recall_still_returns_a_flat_node_collection(): void
    {
        $primary = $this->node('Redis caching', 'Cache-aside.');
        $neighbour = $this->node('Fronta úloh', 'Na pozadí.');
        Edge::create([
            'source_id' => $primary->id,
            'target_id' => $neighbour->id,
            'weight' => 1,
            'last_activated_at' => now(),
        ]);

        $nodes = app(MindService::class)->recall('redis', 4);

        $this->assertSame([$primary->id, $neighbour->id], $nodes->pluck('id')->all());
        $this->assertInstanceOf(Node::class, $nodes->first());
    }

    public function test_mind_service_search_nodes_keeps_its_row_shape(): void
    {
        $this->node('Redis caching', 'Cache-aside vzor s TTL a jitterom v Redise.');

        $row = app(MindService::class)->searchNodes('redis', 5)->first();

        $this->assertArrayHasKey('node', $row);
        $this->assertArrayHasKey('score', $row);
        $this->assertArrayHasKey('snippet', $row);
        $this->assertInstanceOf(Node::class, $row['node']);
        $this->assertIsInt($row['score']);
        $this->assertStringContainsString('Cache-aside', (string) $row['snippet']);
    }

    public function test_mind_service_still_delegates_the_query_helpers(): void
    {
        $mind = app(MindService::class);

        $this->assertSame('sperky', $mind->fold('Šperky'));
        $this->assertSame('šperk', $mind->skStem('šperky'));
        $this->assertTrue($mind->queryRoots('cenotvorba')->contains('pricing'));
        $this->assertSame(2, $mind->queryConcepts('redis objednávky')->count());
    }
}
