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
}
