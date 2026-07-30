<?php

namespace Tests\Feature;

use App\Llm\ChatOptions;
use App\Llm\ChatProvider;
use App\Llm\ChatResult;
use App\Llm\EmbedOptions;
use App\Llm\NullProvider;
use App\Llm\ProviderHealth;
use App\Models\Area;
use App\Models\Node;
use App\Services\Embeddings\EmbeddingService;
use App\Services\Embeddings\EmbeddingStore;
use App\Services\Embeddings\EmbeddingVector;
use App\Services\MindService;
use App\Services\Recall\RecallEngine;
use App\Services\Recall\VectorSearch;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Support\FakeProvider;
use Tests\TestCase;

/**
 * Embeddingová vrstva (balík P1, rozhodnutie #30 + #112b).
 *
 * Meria to, čo je akceptačné kritérium 28 a železné pravidlo #10:
 *   - `aura:embed` vyplní `nodes.embedding`, je IDEMPOTENTNÝ a `--force` funguje
 *   - s `NullProvider` (Ollama nebeží) príkaz NESPADNE a recall funguje ďalej
 *   - vektorová vetva je druhé skóre navrch lexikálnej, nikdy ju nenahrádza
 *   - žiadny z prahov 0.92 / 0.20 / 0.08 / 0.18 sa nepoužíva na embeddingoch
 */
class EmbeddingsTest extends TestCase
{
    use RefreshDatabase;

    private Area $area;

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'cache.default' => 'array',
            'recall.embed.model' => 'bge-m3',
            'recall.embed.dimensions' => 8,   // malá dimenzia = čitateľné testy
            'recall.embed.batch' => 3,
            'recall.vector.enabled' => null,  // auto — riadi to health() providera
            'recall.vector.mode' => 'rerank',
        ]);

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

    private function fake(): FakeProvider
    {
        $provider = new FakeProvider;
        $this->app->instance(ChatProvider::class, $provider);

        return $provider;
    }

    /** Provider s vektormi, ktoré si test určí — na overenie poradia. */
    private function controlled(array $map): StubEmbedProvider
    {
        $provider = new StubEmbedProvider($map);
        $this->app->instance(ChatProvider::class, $provider);

        return $provider;
    }

    // ---- aura:embed: naplnenie ---------------------------------------------

    public function test_embed_command_fills_vectors_for_every_node(): void
    {
        $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');
        $this->node('Kubernetes Ingress', 'Routovanie HTTP.');

        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame(2, app(EmbeddingStore::class)->count('bge-m3'));

        foreach (Node::all() as $node) {
            $row = DB::table('nodes')->where('id', $node->id)->first();
            $this->assertNotNull($row->embedding);
            $this->assertSame('bge-m3', $row->embedding_model);
            $this->assertSame(32, strlen($row->embedding));   // 8 × float32
            $this->assertNotNull($row->embedded_at);
            $this->assertSame(64, strlen((string) $row->embedding_hash));
        }
    }

    public function test_stored_vector_is_l2_normalized(): void
    {
        $this->fake();
        $node = $this->node('Redis caching', 'Cache-aside vzor.');

        $this->artisan('aura:embed')->assertSuccessful();

        $vector = app(EmbeddingStore::class)->get($node->id);
        $norm = sqrt(array_sum(array_map(fn ($v) => $v * $v, $vector)));

        $this->assertEqualsWithDelta(1.0, $norm, 1e-6);
    }

    public function test_node_without_any_text_is_skipped_not_failed(): void
    {
        $this->fake();
        $this->node('', null);

        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame(0, app(EmbeddingStore::class)->count());
    }

    // ---- idempotencia -------------------------------------------------------

    public function test_second_run_changes_nothing_and_sends_no_request(): void
    {
        $provider = $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');
        $this->node('Kubernetes Ingress', 'Routovanie HTTP.');

        $this->artisan('aura:embed')->assertSuccessful();

        $before = DB::table('nodes')->orderBy('id')
            ->get(['id', 'embedding', 'embedding_hash', 'embedded_at'])->toArray();
        $callsAfterFirstRun = $provider->embedCalls;

        $this->artisan('aura:embed')->assertSuccessful();

        $after = DB::table('nodes')->orderBy('id')
            ->get(['id', 'embedding', 'embedding_hash', 'embedded_at'])->toArray();

        $this->assertEquals($before, $after);
        $this->assertSame($callsAfterFirstRun, $provider->embedCalls, 'druhý beh nesmie volať provider');
    }

    public function test_force_recomputes_everything(): void
    {
        $provider = $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');

        $this->artisan('aura:embed')->assertSuccessful();
        $calls = $provider->embedCalls;

        $this->artisan('aura:embed --force')->assertSuccessful();

        $this->assertGreaterThan($calls, $provider->embedCalls);
        $this->assertSame(1, app(EmbeddingStore::class)->count('bge-m3'));
    }

    public function test_only_a_changed_node_is_recomputed(): void
    {
        $this->fake();
        $stable = $this->node('Redis caching', 'Cache-aside vzor.');
        $changing = $this->node('Kubernetes Ingress', 'Routovanie HTTP.');

        $this->artisan('aura:embed')->assertSuccessful();
        $stableBefore = DB::table('nodes')->where('id', $stable->id)->first();
        $changingBefore = DB::table('nodes')->where('id', $changing->id)->first();

        $changing->forceFill(['description' => 'Úplne iný popis.'])->save();

        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertEquals(
            $stableBefore->embedding_hash,
            DB::table('nodes')->where('id', $stable->id)->value('embedding_hash'),
        );
        $this->assertNotEquals(
            $changingBefore->embedding_hash,
            DB::table('nodes')->where('id', $changing->id)->value('embedding_hash'),
        );
    }

    public function test_model_change_makes_every_vector_stale(): void
    {
        $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');

        $this->artisan('aura:embed')->assertSuccessful();

        config(['recall.embed.model' => 'iny-model']);
        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame(0, app(EmbeddingStore::class)->count('bge-m3'));
        $this->assertSame(1, app(EmbeddingStore::class)->count('iny-model'));
    }

    // ---- Ollama nebeží ------------------------------------------------------

    public function test_command_with_null_provider_succeeds_and_writes_nothing(): void
    {
        $this->app->instance(ChatProvider::class, new NullProvider('test: Ollama nebeží'));
        $this->node('Redis caching', 'Cache-aside vzor.');

        $this->artisan('aura:embed')
            ->expectsOutputToContain('Embeddingy sa preskočili')
            ->assertSuccessful();

        $this->assertSame(0, app(EmbeddingStore::class)->count());
    }

    public function test_command_with_broken_provider_succeeds(): void
    {
        $this->app->instance(ChatProvider::class, (new FakeProvider)->broken());
        $this->node('Redis caching', 'Cache-aside vzor.');

        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame(0, app(EmbeddingStore::class)->count());
    }

    public function test_embedding_service_returns_empty_list_when_unavailable(): void
    {
        $this->app->instance(ChatProvider::class, new NullProvider);

        $service = app(EmbeddingService::class);

        $this->assertFalse($service->available());
        $this->assertSame([], $service->embed(['čokoľvek']));
        $this->assertSame([], $service->embedOne('čokoľvek'));
    }

    public function test_recall_still_works_when_embeddings_are_unavailable(): void
    {
        $this->app->instance(ChatProvider::class, new NullProvider);
        $hit = $this->node('Redis caching', 'Cache-aside vzor s TTL.');
        $this->node('Fakturácia', 'Vystavovanie faktúr.');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$hit->id], $rows->pluck('node.id')->all());
        $this->assertSame(0.0, $rows->first()['vector']);
    }

    public function test_vector_branch_is_skipped_when_no_vectors_are_stored(): void
    {
        $this->fake();   // provider je zdravý, ale v DB nie je ani jeden vektor
        $hit = $this->node('Redis caching', 'Cache-aside vzor.');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$hit->id], $rows->pluck('node.id')->all());
        $this->assertSame(0.0, $rows->first()['vector']);
    }

    // ---- hybridné skóre -----------------------------------------------------

    public function test_vector_reranks_nodes_with_the_same_lexical_score(): void
    {
        // oba uzly trafia práve jeden koncept ('redis'); silnejší uzol by pri
        // čistom TF-IDF vyhral, ale vektor hovorí, že relevantnejší je ten slabý
        $near = $this->node('Redis alfa', 'Redis.', 2.0);
        $far = $this->node('Redis beta', 'Redis.', 90.0);

        $this->controlled([
            'query:redis' => [1, 0, 0, 0, 0, 0, 0, 0],
            'node:'.$near->id => [1, 0, 0, 0, 0, 0, 0, 0],
            'node:'.$far->id => [0, 1, 0, 0, 0, 0, 0, 0],
        ]);

        $store = app(EmbeddingStore::class);
        $store->put($near->id, [1, 0, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');
        $store->put($far->id, [0, 1, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h2');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$near->id, $far->id], $rows->pluck('node.id')->all());
        $this->assertEqualsWithDelta(1.0, $rows->first()['vector'], 1e-6);
        $this->assertEqualsWithDelta(0.0, $rows->last()['vector'], 1e-6);
    }

    public function test_lexical_score_still_outranks_the_vector(): void
    {
        // dva zhodné koncepty bez vektorovej podpory musia zostať pred jedným
        // konceptom s perfektným vektorom — lexikálna vetva je prvotriedna
        $twoConcepts = $this->node('Redis a objednávky', 'Redis, objednávky.', 1.0);
        $oneConcept = $this->node('Redis samotný', 'Redis.', 1.0);

        $this->controlled([
            'query:redis objednávky' => [1, 0, 0, 0, 0, 0, 0, 0],
        ]);

        $store = app(EmbeddingStore::class);
        $store->put($oneConcept->id, [1, 0, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');
        $store->put($twoConcepts->id, [0, 1, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h2');

        $rows = app(RecallEngine::class)->search('redis objednávky', 5);

        $this->assertSame($twoConcepts->id, $rows->first()['node']->id);
    }

    public function test_rerank_mode_never_adds_a_node_the_lexical_branch_rejected(): void
    {
        $lexical = $this->node('Redis caching', 'Cache-aside.');
        $vectorOnly = $this->node('Úplne iná téma', 'Faktúry a dodávatelia.');

        $this->controlled(['query:redis' => [1, 0, 0, 0, 0, 0, 0, 0]]);

        $store = app(EmbeddingStore::class);
        $store->put($vectorOnly->id, [1, 0, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$lexical->id], $rows->pluck('node.id')->all());
    }

    public function test_expand_mode_adds_vector_only_candidates_behind_the_lexical_ones(): void
    {
        config(['recall.vector.mode' => 'expand', 'recall.vector.min_score' => 0.55]);

        $lexical = $this->node('Redis caching', 'Cache-aside.');
        $vectorOnly = $this->node('Vyrovnávacia pamäť', 'O ničom inom.');
        $unrelated = $this->node('Fakturácia', 'Faktúry.');

        $this->controlled(['query:redis' => [1, 0, 0, 0, 0, 0, 0, 0]]);

        $store = app(EmbeddingStore::class);
        $store->put($vectorOnly->id, [1, 0, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');
        $store->put($unrelated->id, [0, 1, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h2');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$lexical->id, $vectorOnly->id], $rows->pluck('node.id')->all());
        $this->assertSame(0, $rows->last()['score']);
    }

    public function test_expand_mode_respects_the_minimum_score(): void
    {
        config(['recall.vector.mode' => 'expand', 'recall.vector.min_score' => 0.99]);

        $lexical = $this->node('Redis caching', 'Cache-aside.');
        $weak = $this->node('Vyrovnávacia pamäť', 'O ničom inom.');

        $this->controlled(['query:redis' => [1, 0, 0, 0, 0, 0, 0, 0]]);
        app(EmbeddingStore::class)->put($weak->id, [0.7, 0.7, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$lexical->id], $rows->pluck('node.id')->all());
    }

    public function test_vectors_from_another_model_are_ignored(): void
    {
        $node = $this->node('Redis alfa', 'Redis.', 2.0);
        $other = $this->node('Redis beta', 'Redis.', 90.0);

        $this->controlled(['query:redis' => [1, 0, 0, 0, 0, 0, 0, 0]]);

        // vektor z iného modelu sa nesmie miešať do jedného porovnania
        app(EmbeddingStore::class)->put($node->id, [1, 0, 0, 0, 0, 0, 0, 0], 'iny-model', 'h1');

        $rows = app(RecallEngine::class)->search('redis', 5);

        $this->assertSame([$other->id, $node->id], $rows->pluck('node.id')->all());
    }

    // ---- text a hash --------------------------------------------------------

    public function test_node_text_covers_label_description_and_domain_meta(): void
    {
        $node = $this->node('Redis caching', 'Cache-aside vzor.');
        $node->forceFill(['meta' => ['project' => 'AuraAI', 'tools' => ['Bash' => 3]]])->save();

        $text = app(EmbeddingService::class)->textForNode($node->fresh());

        $this->assertStringContainsString('Redis caching', $text);
        $this->assertStringContainsString('Cache-aside vzor.', $text);
        $this->assertStringContainsString('AuraAI', $text);
        $this->assertStringContainsString('Bash', $text);
    }

    public function test_hash_ignores_whitespace_noise_but_not_content(): void
    {
        $service = app(EmbeddingService::class);

        $this->assertSame($service->hash('Redis  caching'), $service->hash("Redis \n caching"));
        $this->assertNotSame($service->hash('Redis caching'), $service->hash('Redis clustering'));
    }

    public function test_store_round_trip_keeps_the_vector(): void
    {
        $node = $this->node('Redis caching');
        $vector = EmbeddingVector::normalize([1, 2, 3, 4, 5, 6, 7, 8]);

        $store = app(EmbeddingStore::class);
        $store->put($node->id, $vector, 'bge-m3', 'hash');

        foreach ($store->get($node->id) as $i => $value) {
            $this->assertEqualsWithDelta($vector[$i], $value, 1e-6);
        }
    }

    public function test_embedding_never_touches_the_node_updated_at(): void
    {
        $this->fake();
        $node = $this->node('Redis caching', 'Cache-aside.');
        $updatedAt = DB::table('nodes')->where('id', $node->id)->value('updated_at');

        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame($updatedAt, DB::table('nodes')->where('id', $node->id)->value('updated_at'));
    }

    public function test_learn_keeps_working_with_the_embedding_layer_present(): void
    {
        $this->fake();

        $result = app(MindService::class)->learn('skill', 'Nový skill', 'popis', 'vyvoj-kod');

        $this->assertSame('created', $result['action']);
        $this->assertNull(DB::table('nodes')->where('id', $result['node']['id'])->value('embedding'));
    }

    // ---- dávkovanie a prerušený beh -----------------------------------------

    public function test_limit_bounds_the_run_and_the_rest_follows_next_time(): void
    {
        $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');
        $this->node('Kubernetes Ingress', 'Routovanie HTTP.');
        $this->node('MariaDB indexy', 'B-tree a pokrytie.');

        $this->artisan('aura:embed --limit=1')->assertSuccessful();
        $this->assertSame(1, app(EmbeddingStore::class)->count('bge-m3'));

        // pokračovanie po prerušení: ďalší beh dopočíta zvyšok a nič neprepisuje
        $this->artisan('aura:embed')->assertSuccessful();
        $this->assertSame(3, app(EmbeddingStore::class)->count('bge-m3'));
    }

    public function test_provider_dying_mid_run_keeps_what_was_written_and_next_run_finishes(): void
    {
        // batch = 3 (setUp), 6 uzlov = 2 dávky; provider prežije len prvú
        $flaky = new FlakyEmbedProvider(succeedCalls: 1);
        $this->app->instance(ChatProvider::class, $flaky);

        for ($i = 1; $i <= 6; $i++) {
            $this->node('Uzol '.$i, 'Popis uzla číslo '.$i);
        }

        $this->artisan('aura:embed')->assertSuccessful();

        $store = app(EmbeddingStore::class);
        $this->assertSame(3, $store->count('bge-m3'), 'prvá dávka musí zostať zapísaná');

        // zdravý provider dopočíta zvyšok — nič sa medzitým nezmazalo
        $this->app->instance(ChatProvider::class, new FakeProvider);
        $this->artisan('aura:embed')->assertSuccessful();
        $this->assertSame(6, $store->count('bge-m3'));
    }

    // ---- zúženie skórovania na kandidátov -----------------------------------

    public function test_narrowed_vector_scores_match_the_full_corpus_scores(): void
    {
        $this->fake();
        $a = $this->node('Redis caching', 'Cache-aside vzor.');
        $b = $this->node('Redis clustering', 'Sharding kľúčov.');
        $this->node('Fakturácia', 'Faktúry a DPH.');

        $this->artisan('aura:embed')->assertSuccessful();

        $full = (new VectorSearch)->scores('redis');
        $narrow = (new VectorSearch)->scores('redis', [$a->id, $b->id]);

        $this->assertCount(3, $full, 'bez zúženia sa skóruje celý korpus');
        $this->assertSame([$a->id, $b->id], array_keys($narrow));

        // zúženie nesmie zmeniť ani jedno skóre — inak by sa zmenilo poradie
        $this->assertSame($full[$a->id], $narrow[$a->id]);
        $this->assertSame($full[$b->id], $narrow[$b->id]);
    }

    public function test_empty_candidate_list_scores_nothing(): void
    {
        $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');
        $this->artisan('aura:embed')->assertSuccessful();

        $this->assertSame([], (new VectorSearch)->scores('redis', []));
    }

    public function test_store_all_can_be_narrowed_to_node_ids(): void
    {
        $a = $this->node('Alfa');
        $b = $this->node('Beta');
        $store = app(EmbeddingStore::class);
        $store->put($a->id, [1, 0, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h1');
        $store->put($b->id, [0, 1, 0, 0, 0, 0, 0, 0], 'bge-m3', 'h2');

        $this->assertCount(2, $store->all('bge-m3', 8));
        $this->assertSame([$a->id], array_keys($store->all('bge-m3', 8, [$a->id])));
        $this->assertSame([], $store->all('bge-m3', 8, []));
    }

    public function test_vector_branch_is_skipped_when_the_lexical_branch_finds_nothing(): void
    {
        $provider = $this->fake();
        $this->node('Redis caching', 'Cache-aside vzor.');
        $this->artisan('aura:embed')->assertSuccessful();
        $callsAfterEmbed = $provider->embedCalls;

        $rows = (new RecallEngine)->search('zzzqqqxyz neexistujuce', 12);

        $this->assertTrue($rows->isEmpty());
        $this->assertSame(
            $callsAfterEmbed,
            $provider->embedCalls,
            'bez lexikálnych kandidátov sa dopyt nemá vôbec embedovať',
        );
    }

    public function test_stored_vector_with_a_wrong_dimension_is_ignored(): void
    {
        $node = $this->node('Redis alfa', 'Redis.', 2.0);
        $other = $this->node('Redis beta', 'Redis.', 90.0);

        $this->controlled(['query:redis' => [1, 0, 0, 0, 0, 0, 0, 0]]);

        // 4 zložky pri nakonfigurovanej dimenzii 8 — vektor sa musí zahodiť
        app(EmbeddingStore::class)->put($node->id, [1, 0, 0, 0], 'bge-m3', 'h1');

        $rows = app(RecallEngine::class)->search('redis', 5);

        // poradie rozhodne strength, presne ako pri čistom TF-IDF
        $this->assertSame([$other->id, $node->id], $rows->pluck('node.id')->all());
        $this->assertSame(0.0, $rows->first()['vector']);
    }

    // ---- cache vektora dopytu -----------------------------------------------

    public function test_query_vector_is_cached_across_service_instances(): void
    {
        $provider = $this->fake();

        $first = (new EmbeddingService)->embedOneCached('redis caching');
        $callsAfterFirst = $provider->embedCalls;
        $second = (new EmbeddingService)->embedOneCached('redis caching');

        $this->assertNotSame([], $first);
        $this->assertEquals($first, $second);
        $this->assertSame($callsAfterFirst, $provider->embedCalls, 'druhý rovnaký dopyt nesmie ísť na provider');
    }

    public function test_unavailable_query_vector_is_never_cached(): void
    {
        $broken = (new FakeProvider)->broken();
        $service = new EmbeddingService($broken);

        $this->assertSame([], $service->embedOneCached('redis'));
        $this->assertSame([], $service->embedOneCached('redis'));

        // prázdny vektor sa NESMIE cachovať — sekundový výpadok Ollamy by inak
        // vypol vektorovú vetvu na celý TTL
        $this->assertSame(2, $broken->embedCalls);
    }

    public function test_query_cache_can_be_turned_off(): void
    {
        config(['recall.embed.query_cache_ttl' => 0]);
        $provider = $this->fake();

        (new EmbeddingService)->embedOneCached('redis caching');
        $calls = $provider->embedCalls;
        (new EmbeddingService)->embedOneCached('redis caching');

        $this->assertGreaterThan($calls, $provider->embedCalls);
    }

    public function test_cached_query_vector_is_not_reused_for_another_model(): void
    {
        $provider = $this->fake();

        $first = (new EmbeddingService)->embedOneCached('redis caching');

        config(['recall.embed.model' => 'iny-model']);
        $calls = $provider->embedCalls;
        $second = (new EmbeddingService)->embedOneCached('redis caching');

        $this->assertGreaterThan($calls, $provider->embedCalls, 'iný model = iný kľúč cache');
        $this->assertNotSame([], $second);
        $this->assertCount(count($first), $second);
    }
}

/**
 * Provider, ktorý po `$succeedCalls` dávkach „umrie" (vráti prázdno, bez výnimky).
 * Simuluje spadnutú Ollamu v polovici dávkového behu `aura:embed`.
 */
final class FlakyEmbedProvider implements ChatProvider
{
    public int $embedCalls = 0;

    public function __construct(private int $succeedCalls) {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        return ChatResult::failed('flaky', 'flaky nechatuje');
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        return ChatResult::failed('flaky', 'flaky nechatuje');
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        $this->embedCalls++;

        if ($this->embedCalls > $this->succeedCalls) {
            return [];
        }

        $out = [];
        foreach ($texts as $i => $text) {
            $vector = array_fill(0, $opts->dimensions, 0.0);
            $vector[$i % $opts->dimensions] = 1.0;
            $out[] = $vector;
        }

        return $out;
    }

    public function health(): ProviderHealth
    {
        return new ProviderHealth(ok: true, chat: false, embed: true, models: ['flaky'], latencyMs: 1);
    }

    public function name(): string
    {
        return 'flaky';
    }
}

/**
 * Provider s vektormi, ktoré si test určí. `FakeProvider` (#12) dáva hashové
 * pseudo-vektory — deterministické, ale nedá sa nimi riadiť poradie, preto je
 * pre testy hybridného skóre potrebný riadený stub. Nikdy nevyhodí výnimku,
 * rovnako ako každý `ChatProvider` (#11).
 */
final class StubEmbedProvider implements ChatProvider
{
    public int $embedCalls = 0;

    /** @param array<string, list<float>> $map  'query:<text>' => vektor */
    public function __construct(private array $map) {}

    public function chat(array $messages, ChatOptions $opts): ChatResult
    {
        return ChatResult::failed('stub', 'stub nechatuje');
    }

    public function stream(array $messages, ChatOptions $opts, callable $onDelta): ChatResult
    {
        return ChatResult::failed('stub', 'stub nechatuje');
    }

    public function embed(array $texts, EmbedOptions $opts): array
    {
        $this->embedCalls++;

        $out = [];
        foreach ($texts as $text) {
            // dopyt sa hľadá pod kľúčom 'query:<text>'; neznámy text dá nulový vektor
            $out[] = $this->map['query:'.$text] ?? array_fill(0, $opts->dimensions, 0.0);
        }

        return $out;
    }

    public function health(): ProviderHealth
    {
        return new ProviderHealth(ok: true, chat: false, embed: true, models: ['stub'], latencyMs: 1);
    }

    public function name(): string
    {
        return 'stub';
    }
}
