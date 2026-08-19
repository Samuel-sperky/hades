<?php

namespace Tests\Feature;

use App\Models\Activation;
use App\Models\Area;
use App\Models\Edge;
use App\Models\Node;
use App\Models\Tag;
use App\Services\GraphService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Strop na počet SQL dopytov (19. 8. 2026).
 *
 * `Node::toApi()` si tagy pri nenaloženej relácii dotiahne SAM, takže mapovanie
 * kolekcie uzlov bez `with('tags')` je N+1, ktorý nič nezhodí — odpoveď je
 * správna, len stojí 1093 dopytov namiesto 7 (merané na /api/mind). Taká
 * regresia sa nedá odhaliť assertom na obsah; jediné, čo ju zastaví, je strop
 * na počet dopytov, ktorý NESMIE rásť s počtom riadkov. Preto sa tu každý
 * endpoint meria dvakrát nad rôzne veľkou sadou a porovnáva sa počet dopytov,
 * nie len absolútne číslo — konštanta by sa dala „opraviť" jej zdvihnutím.
 *
 * Druhá polovica súboru drží poradie tagov. `toApi()` má dve vetvy (naložená vs
 * nenaložená relácia) a eager-load ich mohol rozísť — /api/v1/* je bit-za-bit
 * kontrakt, takže tiché preusporiadanie polia `tags` je chyba, aj keď sú v ňom
 * tie isté mená.
 */
class PayloadPerformanceTest extends TestCase
{
    use RefreshDatabase;

    private string $token = 'test-secret-token';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'hades.api_token' => $this->token,
            'hades.allow_brain_write' => false,
            'cache.default' => 'array',
        ]);

        Area::create(['name' => 'Vývoj / kód', 'slug' => 'vyvoj-kod', 'color' => '#03797e', 'angle' => 0]);
    }

    // ---- strop dopytov -----------------------------------------------------

    public function test_graph_payload_query_count_does_not_grow_with_nodes(): void
    {
        $this->seedNodes(5);
        $small = $this->countQueries(fn () => app(GraphService::class)->payload('live'));

        $this->seedNodes(40);
        $big = $this->countQueries(fn () => app(GraphService::class)->payload('live'));

        $this->assertSame(
            $small,
            $big,
            "Počet dopytov grafu rastie s počtom uzlov ({$small} → {$big}) — vrátil sa N+1 na tagoch.",
        );

        // Strop je tu aj v absolútnej podobe: 7 dopytov (aktivácie, uzly, tagy,
        // hrany, posledná aktivácia, oblasti, oddelenia). Rezerva je jeden dopyt,
        // nie desať — inak by sa pod strop schoval nový N+1 nad malou sadou.
        $this->assertLessThanOrEqual(8, $big, "Graf robí {$big} dopytov, strop je 8.");
    }

    public function test_graph_payload_scope_all_query_count_does_not_grow_with_nodes(): void
    {
        $this->seedNodes(5);
        $small = $this->countQueries(fn () => app(GraphService::class)->payload('all'));

        $this->seedNodes(40);
        $big = $this->countQueries(fn () => app(GraphService::class)->payload('all'));

        $this->assertSame($small, $big, "Scope 'all' rastie s počtom uzlov ({$small} → {$big}).");
        $this->assertLessThanOrEqual(7, $big, "Scope 'all' robí {$big} dopytov, strop je 7.");
    }

    public function test_review_queue_query_count_does_not_grow_with_rows(): void
    {
        $this->seedNodes(5, needsReview: true);
        $small = $this->countQueries(fn () => $this->getJson('/api/review/queue')->assertOk());

        $this->seedNodes(40, needsReview: true);
        $big = $this->countQueries(fn () => $this->getJson('/api/review/queue')->assertOk());

        $this->assertSame($small, $big, "Fronta kontroly rastie s počtom uzlov ({$small} → {$big}).");
    }

    public function test_knowledge_index_query_count_does_not_grow_with_rows(): void
    {
        $this->seedNodes(5);
        $small = $this->countQueries(
            fn () => $this->withToken($this->token)->getJson('/api/v1/knowledge?limit=100')->assertOk(),
        );

        $this->seedNodes(40);
        $big = $this->countQueries(
            fn () => $this->withToken($this->token)->getJson('/api/v1/knowledge?limit=100')->assertOk(),
        );

        $this->assertSame($small, $big, "Knowledge listing rastie s počtom uzlov ({$small} → {$big}).");
    }

    public function test_library_query_count_does_not_grow_with_rows(): void
    {
        $this->seedNodes(5, type: 'skill');
        $small = $this->countQueries(fn () => $this->getJson('/api/library')->assertOk());

        $this->seedNodes(40, type: 'skill');
        $big = $this->countQueries(fn () => $this->getJson('/api/library')->assertOk());

        $this->assertSame($small, $big, "Knižnica rastie s počtom uzlov ({$small} → {$big}).");
    }

    // ---- poradie tagov (bit-za-bit kontrakt) -------------------------------

    public function test_graph_tags_keep_the_order_of_the_lazy_branch(): void
    {
        // Mená sú zámerne v inom poradí než id a pripájajú sa v treťom poradí:
        // keby sa niektorá vetva prepla na radenie podľa mena alebo na poradie
        // pripojenia, test to rozlíši.
        $zebra = Tag::forName('zebra');
        $alpha = Tag::forName('alpha');
        $mid = Tag::forName('mid');

        $node = $this->node('uzol s tagmi');
        $node->tags()->attach([$mid->id, $zebra->id, $alpha->id]);

        $payload = app(GraphService::class)->payload('live');
        $tags = collect($payload['nodes'])->firstWhere('id', $node->id)['tags'];

        // nenaložená relácia = pôvodné chovanie endpointov pred eager-loadom
        $lazy = Node::findOrFail($node->id)->toApi()['tags'];

        $this->assertSame($lazy, $tags, 'Eager-load preusporiadal tagy — payload nie je bit-za-bit.');
        $this->assertSame(['zebra', 'alpha', 'mid'], $tags, 'Tagy sa neradia podľa tags.id.');
    }

    public function test_review_queue_tags_match_the_lazy_branch(): void
    {
        $node = $this->node('uzol na kontrolu', needsReview: true);
        $node->tags()->attach([Tag::forName('zebra')->id, Tag::forName('alpha')->id]);

        $queue = $this->getJson('/api/review/queue')->assertOk()->json('queue');

        $this->assertSame(
            Node::findOrFail($node->id)->toApi()['tags'],
            collect($queue)->firstWhere('id', $node->id)['tags'],
        );
    }

    // ---- hrany po presune filtra do SQL ------------------------------------

    public function test_graph_returns_only_edges_between_returned_nodes(): void
    {
        $a = $this->node('uzol A');
        $b = $this->node('uzol B');
        $gone = $this->node('zmazaný uzol');
        $quietSkill = $this->node('nepoužitý skill', type: 'skill');

        $kept = Edge::create(['source_id' => $a->id, 'target_id' => $b->id, 'weight' => 1.0]);
        $toDeleted = Edge::create(['source_id' => $a->id, 'target_id' => $gone->id, 'weight' => 1.0]);
        $toQuietSkill = Edge::create(['source_id' => $a->id, 'target_id' => $quietSkill->id, 'weight' => 1.0]);

        $gone->delete();

        $ids = collect(app(GraphService::class)->payload('live')['edges'])->pluck('id')->all();

        $this->assertContains($kept->id, $ids);
        // soft-zmazaný uzol v payloade nie je → jeho hrana tam nesmie byť ani po
        // presune filtra do SQL (whereIn nad vrátenými id, nie join na `nodes`)
        $this->assertNotContains($toDeleted->id, $ids, 'Hrana na soft-zmazaný uzol prešla.');
        // skill bez aktivácie do scope 'live' nepatrí → jeho hrana tiež nie
        $this->assertNotContains($toQuietSkill->id, $ids, 'Hrana na neaktivovaný skill prešla.');
    }

    public function test_graph_edges_are_ordered_by_id(): void
    {
        $nodes = collect(range(1, 4))->map(fn (int $i) => $this->node("uzol {$i}"));

        // hrany zakladáme v poradí, ktoré nekopíruje ani source_id ani target_id
        Edge::create(['source_id' => $nodes[3]->id, 'target_id' => $nodes[0]->id, 'weight' => 1.0]);
        Edge::create(['source_id' => $nodes[1]->id, 'target_id' => $nodes[2]->id, 'weight' => 1.0]);
        Edge::create(['source_id' => $nodes[2]->id, 'target_id' => $nodes[0]->id, 'weight' => 1.0]);

        $ids = collect(app(GraphService::class)->payload('live')['edges'])->pluck('id')->all();

        $sorted = $ids;
        sort($sorted);
        $this->assertSame($sorted, $ids, 'Poradie hrán závisí od plánu dopytu, nie od id.');
    }

    // ---- pomôcky -----------------------------------------------------------

    /**
     * Počet SQL dopytov jedného behu. Query log (nie DB::listen) je tu zámerne:
     * listener sa nedá odregistrovať a closure viaže SLOT premennej, takže
     * merač postavený na `DB::listen` v cykle počíta násobky — presne to nafúklo
     * pôvodný baseline tejto vlny.
     */
    private function countQueries(callable $run): int
    {
        DB::flushQueryLog();
        DB::enableQueryLog();

        $run();

        $count = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $count;
    }

    /** Jeden uzol s minimom povinných polí. */
    private function node(string $label, string $type = 'memory', bool $needsReview = false): Node
    {
        return Node::create([
            'type' => $type,
            'label' => $label,
            'area_id' => Area::value('id'),
            'strength' => 1.0,
            'needs_review' => $needsReview,
            'description' => 'popis '.$label,
        ]);
    }

    /**
     * Sada uzlov s tagmi a hranami — vždy tri tagy na uzol, aby N+1 na tagoch
     * rástol viditeľne, a hrana na predchádzajúci uzol, aby rástli aj hrany.
     * Skilly dostanú aktiváciu, inak by v scope 'live' neboli.
     */
    private function seedNodes(int $count, string $type = 'memory', bool $needsReview = false): void
    {
        $offset = Node::withTrashed()->count();
        $previous = Node::query()->orderByDesc('id')->first();

        for ($i = 0; $i < $count; $i++) {
            $node = $this->node("uzol {$offset}-{$i}", $type, $needsReview);

            $node->tags()->attach(collect(['docker', 'laravel', "tag-{$offset}-{$i}"])
                ->map(fn (string $name) => Tag::forName($name)->id)
                ->all());

            if ($type === 'skill') {
                Activation::record($node, 'activate', 'test');
            }

            if ($previous) {
                Edge::create(['source_id' => $previous->id, 'target_id' => $node->id, 'weight' => 1.0]);
            }

            $previous = $node;
        }
    }
}
