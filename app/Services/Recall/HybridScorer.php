<?php

namespace App\Services\Recall;

use Illuminate\Support\Collection;

/**
 * Zlúčenie dvoch skóre do jedného poradia. Lexikálne skóre je PRVOTRIEDNE
 * a dominantné, vektorový kosínus je druhé skóre, strength je až tretie.
 *
 * Kľúč radenia (celé čísla, deterministicky):
 *
 *     concepts × 10 000 000  +  round(cos × 1000) × 1 000  +  min(strength, 999)
 *
 * Keď vektorová vetva nie je dostupná, je `cos` pre všetkých 0 a kľúč sa
 * redukuje na `concepts × 10 000 000 + strength`, čo dáva IDENTICKÉ poradie
 * ako pôvodné `score × 1000 + min(strength, 999)` v MindService. Preto sa
 * chovanie recallu bez Ollamy nemení ani o jeden riadok.
 */
class HybridScorer
{
    private const CONCEPT_WEIGHT = 10_000_000;

    private const VECTOR_WEIGHT = 1_000;

    /**
     * @param  Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string}>  $candidates
     * @param  array<int, float>  $vectorScores  node_id => kosínus (prázdne = vetva vynechaná)
     * @return Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string, vector: float}>
     */
    public function rank(Collection $candidates, array $vectorScores, int $limit): Collection
    {
        return $candidates
            ->map(function (array $row) use ($vectorScores) {
                $row['vector'] = (float) ($vectorScores[$row['node']->id] ?? 0.0);

                return $row;
            })
            ->sortByDesc(fn (array $row) => $this->key($row['score'], $row['vector'], (float) $row['node']->strength))
            ->take($limit)
            ->values();
    }

    /**
     * Kľúč radenia — verejný, aby ho vedel overiť test aj dry-run report.
     *
     * Strength zostáva FLOAT (uzly majú po decay hodnoty ako 2.91) a je vždy
     * < 1000, takže sa nikdy nepretečie do vektorovej zložky.
     */
    public function key(int $concepts, float $vector, float $strength): float
    {
        $vectorPart = (int) round(max(0.0, min(1.0, $vector)) * 1000);

        return $concepts * self::CONCEPT_WEIGHT
            + $vectorPart * self::VECTOR_WEIGHT
            + min($strength, 999.0);
    }
}
