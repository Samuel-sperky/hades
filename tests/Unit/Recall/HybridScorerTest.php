<?php

namespace Tests\Unit\Recall;

use App\Services\Recall\HybridScorer;
use PHPUnit\Framework\TestCase;

/**
 * Hybridné skóre: lexikálna vetva je PRVOTRIEDNA, vektor je druhé skóre,
 * strength tretie. Kľúčový je posledný test — bez vektora musí kľúč dávať
 * IDENTICKÉ poradie ako pôvodný `score × 1000 + min(strength, 999)`, inak by
 * refaktor ticho zmenil chovanie recallu.
 */
class HybridScorerTest extends TestCase
{
    private HybridScorer $scorer;

    protected function setUp(): void
    {
        parent::setUp();
        $this->scorer = new HybridScorer;
    }

    public function test_more_concepts_always_win_over_a_better_vector(): void
    {
        $twoConceptsNoVector = $this->scorer->key(2, 0.0, 1.0);
        $oneConceptPerfectVector = $this->scorer->key(1, 1.0, 999.0);

        $this->assertGreaterThan($oneConceptPerfectVector, $twoConceptsNoVector);
    }

    public function test_vector_breaks_ties_between_equal_concept_counts(): void
    {
        $better = $this->scorer->key(1, 0.80, 1.0);
        $worse = $this->scorer->key(1, 0.40, 1.0);

        $this->assertGreaterThan($worse, $better);
    }

    public function test_vector_outweighs_strength(): void
    {
        $goodVectorWeakNode = $this->scorer->key(1, 0.50, 1.0);
        $noVectorStrongNode = $this->scorer->key(1, 0.0, 999.0);

        $this->assertGreaterThan($noVectorStrongNode, $goodVectorWeakNode);
    }

    public function test_strength_still_breaks_ties_when_vectors_are_equal(): void
    {
        $this->assertGreaterThan(
            $this->scorer->key(1, 0.5, 2.0),
            $this->scorer->key(1, 0.5, 40.0),
        );
    }

    public function test_fractional_strength_is_not_truncated(): void
    {
        // uzly po `mind:decay` majú hodnoty ako 2.91 — celočíselný kľúč by
        // ich zlial dohromady a zmenil poradie
        $this->assertGreaterThan(
            $this->scorer->key(1, 0.0, 2.10),
            $this->scorer->key(1, 0.0, 2.91),
        );
    }

    public function test_strength_is_capped_at_999_like_before(): void
    {
        $this->assertSame(
            $this->scorer->key(1, 0.0, 5000.0),
            $this->scorer->key(1, 0.0, 999.0),
        );
    }

    public function test_vector_score_is_clamped_to_zero_one(): void
    {
        $this->assertSame($this->scorer->key(1, -5.0, 1.0), $this->scorer->key(1, 0.0, 1.0));
        $this->assertSame($this->scorer->key(1, 9.0, 1.0), $this->scorer->key(1, 1.0, 1.0));
    }

    /**
     * Bez vektora musí nové poradie presne kopírovať pôvodné.
     */
    public function test_without_vectors_the_order_matches_the_original_formula(): void
    {
        $rows = [
            ['concepts' => 2, 'strength' => 1.0],
            ['concepts' => 1, 'strength' => 500.0],
            ['concepts' => 3, 'strength' => 0.5],
            ['concepts' => 1, 'strength' => 2.91],
            ['concepts' => 2, 'strength' => 40.0],
            ['concepts' => 1, 'strength' => 2.10],
        ];

        $legacy = $rows;
        usort($legacy, fn ($a, $b) => ($b['concepts'] * 1000 + min($b['strength'], 999))
            <=> ($a['concepts'] * 1000 + min($a['strength'], 999)));

        $modern = $rows;
        usort($modern, fn ($a, $b) => $this->scorer->key($b['concepts'], 0.0, $b['strength'])
            <=> $this->scorer->key($a['concepts'], 0.0, $a['strength']));

        $this->assertSame($legacy, $modern);
    }

    // ---- MOST (SK↔EN, rozhodnutie #30) --------------------------------------

    /** Prahy vstreknuté, aby unit test nepotreboval kontejner ani config. */
    private function bridging(float $min = 0.51, float $penalty = 0.08, int $slots = 2): HybridScorer
    {
        return new HybridScorer($min, $penalty, $slots);
    }

    public function test_bridge_below_the_threshold_stays_under_every_lexical_hit(): void
    {
        $scorer = $this->bridging();

        // 0,50 je pod prahom → most sa nepromuje a zostáva v pásme concepts = 0,
        // teda presne ako pred opravou: neprebije ani najslabší lexikálny zásah
        $this->assertLessThan(
            $scorer->key(1, 0.0, 0.0),
            $scorer->bridgeKey(0.50, 999.0),
        );
    }

    public function test_bridge_above_the_threshold_overtakes_a_weak_lexical_hit(): void
    {
        $scorer = $this->bridging();

        // toto je celá oprava: most s kosínusom 0,52 predbehne lexikálny zásah,
        // ktorý má jeden koncept a slabý kosínus 0,40
        $this->assertGreaterThan(
            $scorer->key(1, 0.40, 1.0),
            $scorer->bridgeKey(0.52, 1.0),
        );
    }

    public function test_bridge_never_beats_two_matching_concepts(): void
    {
        $scorer = $this->bridging();

        $this->assertLessThan(
            $scorer->key(2, 0.0, 0.0),
            $scorer->bridgeKey(1.0, 999.0),
        );
    }

    public function test_penalty_makes_a_real_lexical_hit_win_at_the_same_cosine(): void
    {
        $scorer = $this->bridging();

        $this->assertLessThan(
            $scorer->key(1, 0.60, 1.0),
            $scorer->bridgeKey(0.60, 1.0),
        );
    }

    public function test_penalty_can_be_tuned_without_touching_the_threshold(): void
    {
        // pri penalizácii 0,15 už ten istý most lexikálny zásah 0,40 nepredbehne
        $this->assertLessThan(
            $this->bridging(penalty: 0.15)->key(1, 0.40, 1.0),
            $this->bridging(penalty: 0.15)->bridgeKey(0.52, 1.0),
        );
    }

    public function test_bridge_quota_caps_how_many_bridges_reach_the_result(): void
    {
        $rows = collect([
            $this->row(1, score: 1),
            $this->row(2, score: 0),
            $this->row(3, score: 0),
            $this->row(4, score: 0),
            $this->row(5, score: 1),
        ]);

        $vectors = [1 => 0.30, 2 => 0.90, 3 => 0.88, 4 => 0.86, 5 => 0.20];

        // tri mosty majú lepší kľúč než oba lexikálne zásahy, ale kvóta pustí dva
        $ids = $this->bridging(slots: 2)->rank($rows, $vectors, 4)->pluck('node.id')->all();

        $this->assertSame([2, 3, 1, 5], $ids);
    }

    public function test_quota_is_relaxed_only_to_avoid_returning_fewer_rows(): void
    {
        $rows = collect([
            $this->row(1, score: 1),
            $this->row(2, score: 0),
            $this->row(3, score: 0),
            $this->row(4, score: 0),
        ]);

        $vectors = [1 => 0.30, 2 => 0.90, 3 => 0.88, 4 => 0.86];

        // limit 4, ale lexikálny zásah je len jeden — zamietnutý most sa doplní
        // až na konci, nikdy nie pred lexikálny zásah
        $ids = $this->bridging(slots: 2)->rank($rows, $vectors, 4)->pluck('node.id')->all();

        $this->assertSame([2, 3, 1, 4], $ids);
    }

    public function test_zero_quota_keeps_bridges_out_entirely_when_lexical_hits_fill_the_limit(): void
    {
        $rows = collect([
            $this->row(1, score: 1),
            $this->row(2, score: 0),
        ]);

        $ids = $this->bridging(slots: 0)->rank($rows, [1 => 0.10, 2 => 0.99], 1)->pluck('node.id')->all();

        $this->assertSame([1], $ids);
    }

    public function test_rank_marks_which_rows_are_bridges(): void
    {
        $rows = collect([$this->row(1, score: 1), $this->row(2, score: 0)]);

        $ranked = $this->bridging()->rank($rows, [1 => 0.90, 2 => 0.60], 5);

        $this->assertFalse($ranked->firstWhere('node.id', 1)['bridge']);
        $this->assertTrue($ranked->firstWhere('node.id', 2)['bridge']);
    }

    /**
     * Minimálny riadok kandidáta — `rank()` z uzla potrebuje len `id` a `strength`.
     *
     * @return array{node: object, score: int, snippet: ?string}
     */
    private function row(int $id, int $score, float $strength = 1.0): array
    {
        return [
            'node' => new class($id, $strength)
            {
                public function __construct(public int $id, public float $strength) {}
            },
            'score' => $score,
            'snippet' => null,
        ];
    }
}
