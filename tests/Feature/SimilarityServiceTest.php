<?php

namespace Tests\Feature;

use App\Models\Area;
use App\Models\Node;
use App\Services\SimilarityService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * `SimilarityService::topSimilar()` — oprava N+1 (rozhodnutie #47).
 *
 * Pôvodne robil `Node::find()` v cykle nad CELÝM korpusom: pri 679 uzloch to je
 * 679 dopytov na jedno volanie a nočný `mind:rewire` ich robí ×679. Uzly teraz
 * pochádzajú z korpusu nahriateho v `warmCorpus()` (jeden dopyt).
 *
 * Prahy 0.18 / 0.20 sa NEMENIA — kalibrácia je samostatná vlna W3.
 */
class SimilarityServiceTest extends TestCase
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

    private function node(string $label, ?string $description = null, string $type = 'skill'): Node
    {
        return Node::create([
            'type' => $type,
            'area_id' => $this->area->id,
            'label' => $label,
            'description' => $description,
            'strength' => 1,
            'last_activated_at' => now(),
        ]);
    }

    /** @return array{0: mixed, 1: int} [výsledok, počet SQL dopytov] */
    private function countingQueries(callable $fn): array
    {
        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });

        $result = $fn();

        return [$result, $queries];
    }

    public function test_top_similar_runs_no_query_per_candidate(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery pre vývoj.');
        foreach (range(1, 25) as $i) {
            $this->node("Uzol {$i}", "Docker kontajnery a compose číslo {$i}.");
        }

        $similarity = app(SimilarityService::class);
        $similarity->warmCorpus(Node::query()->get());

        [$top, $queries] = $this->countingQueries(
            fn () => $similarity->topSimilar($target, 3, 0.18),
        );

        $this->assertNotEmpty($top);
        // pôvodná implementácia: 26 dopytov (Node::find za každý uzol v korpuse)
        $this->assertSame(0, $queries, 'topSimilar nad nahriatym korpusom nesmie robiť dopyty');
    }

    public function test_top_similar_still_returns_ranked_hits_above_the_threshold(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery.');
        $close = $this->node('Docker compose', 'Kontajnery cez docker compose.');
        $far = $this->node('Fakturácia', 'Vystavovanie faktúr zákazníkom.');

        $similarity = app(SimilarityService::class);
        $similarity->warmCorpus(Node::query()->get());

        $top = $similarity->topSimilar($target, 5, 0.18);

        $ids = array_column($top, 'node_id');
        $this->assertSame([$close->id], $ids);
        $this->assertNotContains($far->id, $ids);
        $this->assertGreaterThanOrEqual(0.18, $top[0]['score']);
        $this->assertNotContains($target->id, $ids);
    }

    public function test_filter_receives_a_real_node_model(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery.');
        $this->node('Docker compose', 'Kontajnery cez docker compose.', 'core');

        $similarity = app(SimilarityService::class);
        $similarity->warmCorpus(Node::query()->get());

        $seen = [];
        $top = $similarity->topSimilar($target, 5, 0.18, function (Node $candidate) use (&$seen) {
            $seen[] = $candidate->type;

            return $candidate->type !== 'core';
        });

        $this->assertContains('core', $seen);
        $this->assertSame([], $top);
    }

    public function test_top_similar_warms_the_corpus_by_itself_when_needed(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery.');
        $close = $this->node('Docker compose', 'Kontajnery cez docker compose.');

        // bez explicitného warmCorpus — služba si ho nahreje sama
        $top = app(SimilarityService::class)->topSimilar($target, 5, 0.18);

        $this->assertSame([$close->id], array_column($top, 'node_id'));
    }

    public function test_top_similar_respects_k(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery.');
        foreach (range(1, 6) as $i) {
            $this->node("Docker uzol {$i}", 'Docker compose a kontajnery.');
        }

        $similarity = app(SimilarityService::class);
        $similarity->warmCorpus(Node::query()->get());

        $this->assertCount(2, $similarity->topSimilar($target, 2, 0.18));
    }

    public function test_nodes_added_after_warm_are_still_resolvable(): void
    {
        $target = $this->node('Docker kontajnery', 'Docker compose a kontajnery.');
        $close = $this->node('Docker compose', 'Kontajnery cez docker compose.');

        $similarity = app(SimilarityService::class);
        $similarity->warmCorpus(Node::query()->get());

        // korpus nahriaty z ID poľa (bez modelov) musí stále vedieť dohľadať uzly
        $similarity->warmCorpus(Node::query()->get());

        $this->assertSame([$close->id], array_column($similarity->topSimilar($target, 3, 0.18), 'node_id'));
    }
}
