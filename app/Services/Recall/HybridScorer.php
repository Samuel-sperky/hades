<?php

namespace App\Services\Recall;

use Illuminate\Support\Collection;

/**
 * Zlúčenie dvoch skóre do jedného poradia. Lexikálne skóre je PRVOTRIEDNE
 * a dominantné, vektorový kosínus je druhé skóre, strength je až tretie.
 *
 * Kľúč radenia (deterministicky):
 *
 *     concepts × 10 000 000  +  round(cos × 1000) × 1 000  +  min(strength, 999)
 *
 * Keď vektorová vetva nie je dostupná, je `cos` pre všetkých 0 a kľúč sa
 * redukuje na `concepts × 10 000 000 + strength`, čo dáva IDENTICKÉ poradie
 * ako pôvodné `score × 1000 + min(strength, 999)` v MindService. Preto sa
 * chovanie recallu bez Ollamy nemení ani o jeden riadok.
 *
 * MOST (SK↔EN, rozhodnutie #30)
 * ----------------------------
 * Kandidát, ktorého našla len vektorová vetva (`score === 0`, dodáva ho
 * `RecallEngine::expand()`), by pri kľúči vyššie neprešiel NIKDY: najlepší
 * možný most (cos 1,00) dá 1 000 999, najslabší lexikálny zásah 10 000 000.
 * Preto sa most PROMUJE do najnižšieho lexikálneho pásma (efektívne
 * `concepts = 1`), ale s dvoma bezpečnostnými poistkami:
 *
 *   1. `bridge_min_score` — pod týmto kosínusom sa most nepromuje vôbec
 *      (na bge-m3 sedia nezhodné SK↔EN páry okolo 0,35, zhodné okolo 0,77).
 *   2. `bridge_penalty` — od kosínusu mostu sa ODČÍTA konštanta, takže most
 *      vstupuje do pásma tak, ako keby mal o tolik slabší kosínus. Odčítanie
 *      (nie násobenie) je zvolené zámerne: použiteľné okno bge-m3 je úzke
 *      (0,35–0,77), násobenie by pri nízkych kosínusoch takmer nič nerobilo
 *      a pri vysokých trestalo priveľmi.
 *
 * Kvótu na počet mostov vo výsledku drží `rank()` (`bridge_slots`), takže
 * most nikdy nevytlačí viac než N lexikálnych zásahov.
 */
class HybridScorer
{
    private const CONCEPT_WEIGHT = 10_000_000;

    private const VECTOR_WEIGHT = 1_000;

    /** Pásmo, do ktorého sa promuje vektorový most — najnižšie lexikálne. */
    private const BRIDGE_CONCEPTS = 1;

    /**
     * Prahy mostu sa dajú vstreknúť (unit test beží bez kontejnera). `null`
     * znamená „vezmi z `config/recall.php`", čo je produkčná cesta.
     */
    public function __construct(
        private readonly ?float $bridgeMinScore = null,
        private readonly ?float $bridgePenalty = null,
        private readonly ?int $bridgeSlots = null,
    ) {}

    /**
     * @param  Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string}>  $candidates
     * @param  array<int, float>  $vectorScores  node_id => kosínus (prázdne = vetva vynechaná)
     * @return Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string, vector: float, bridge: bool}>
     */
    public function rank(Collection $candidates, array $vectorScores, int $limit): Collection
    {
        $ranked = $candidates
            ->map(function (array $row) use ($vectorScores) {
                $row['vector'] = (float) ($vectorScores[$row['node']->id] ?? 0.0);
                // most = kandidát bez jediného lexikálneho zásahu (viď expand())
                $row['bridge'] = ((int) $row['score']) === 0;

                return $row;
            })
            ->sortByDesc(fn (array $row) => $row['bridge']
                ? $this->bridgeKey($row['vector'], (float) $row['node']->strength)
                : $this->key((int) $row['score'], $row['vector'], (float) $row['node']->strength))
            ->values();

        return $this->takeWithBridgeQuota($ranked, $limit);
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

    /**
     * Kľúč vektorového mostu (`concepts === 0`). Pod prahom vracia kľúč
     * nepromovaného uzla, takže most zostane pod všetkými lexikálnymi zásahmi
     * presne ako doteraz.
     */
    public function bridgeKey(float $vector, float $strength): float
    {
        $cos = max(0.0, min(1.0, $vector));

        if ($cos < $this->bridgeMinScore()) {
            return $this->key(0, $cos, $strength);
        }

        return $this->key(self::BRIDGE_CONCEPTS, $cos - $this->bridgePenalty(), $strength);
    }

    /** Minimálny kosínus, nad ktorým most vstúpi do lexikálneho pásma. */
    public function bridgeMinScore(): float
    {
        $value = $this->bridgeMinScore ?? (float) config('recall.vector.bridge_min_score', 0.51);

        return max(0.0, min(1.0, $value));
    }

    /** Penalizácia kosínusu mostu — koľko „stratí" oproti skutočnému zásahu. */
    public function bridgePenalty(): float
    {
        $value = $this->bridgePenalty ?? (float) config('recall.vector.bridge_penalty', 0.08);

        return max(0.0, min(1.0, $value));
    }

    /** Koľko miest vo výsledku smú najviac obsadiť mosty. */
    public function bridgeSlots(): int
    {
        return max(0, $this->bridgeSlots ?? (int) config('recall.vector.bridge_slots', 2));
    }

    /**
     * Vyberie prvých `$limit` kandidátov, ale mostom nechá najviac
     * `bridge_slots` miest. Zvyšné miesta doplní lexikálnymi zásahmi
     * v ich pôvodnom poradí, takže most nikdy neodstrelí celý výsledok.
     *
     * @param  Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string, vector: float, bridge: bool}>  $ranked
     * @return Collection<int, array{node: \App\Models\Node, score: int, snippet: ?string, vector: float, bridge: bool}>
     */
    private function takeWithBridgeQuota(Collection $ranked, int $limit): Collection
    {
        $slots = $this->bridgeSlots();
        $taken = collect();
        $overflow = collect();
        $bridges = 0;

        foreach ($ranked as $row) {
            if ($taken->count() >= $limit) {
                break;
            }

            if ($row['bridge']) {
                if ($bridges >= $slots) {
                    continue;
                }
                $bridges++;
            }

            $taken->push($row);
        }

        // Menej než `limit`? Kvóta mohla zamietnuť mosty, ktoré by inak prešli
        // — doplníme ich až na konci, nikdy nad lexikálny zásah.
        if ($taken->count() < $limit && $slots > 0) {
            $takenIds = $taken->pluck('node.id')->all();
            $overflow = $ranked
                ->filter(fn (array $row) => $row['bridge'] && ! in_array($row['node']->id, $takenIds, true))
                ->take($limit - $taken->count());
        }

        return $taken->concat($overflow)->take($limit)->values();
    }
}
