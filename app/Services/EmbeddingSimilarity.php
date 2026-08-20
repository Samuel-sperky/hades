<?php

namespace App\Services;

use App\Models\Node;

/**
 * Vektorová polovica prewiringu: pre uzol, ktorý už má vektor v `node_embeddings`,
 * vráti kandidátov na synapsiu podľa kosínusovej podobnosti.
 *
 * Prečo vlastná služba a nie ďalšia metóda v {@see EmbeddingService}: tam sedí
 * HĽADANIE (dopyt → korpus) a stojí na ňom živý `mind_recall`. Toto je
 * PREPÁJANIE (uzol → korpus) a má iné pravidlá: kandidát nesmie byť sám sebou,
 * prah je vyšší (kandidát recallu sa v RRF môže prepadnúť, hrana v grafe ostáva
 * napísaná) a rozhoduje strop na uzol, nie strop odpovede.
 *
 * Kosínus tu nepočítame druhýkrát — robí ho `EmbeddingService::searchByVector()`
 * a s ním aj tri veci, na ktorých sa dá naletieť: vylúčenie soft-deleted uzlov
 * (vektor zmazaného uzla v tabuľke ostáva), filter na model AJ dimenziu
 * (skalárny súčin dvoch rôznych dĺžok je nezmysel) a deterministické poradie.
 * Vlastná implementácia kosínu by tieto tri veci musela zopakovať a pri prvej
 * zmene v službe by sa rozišli.
 */
class EmbeddingSimilarity
{
    /**
     * Koľkonásobok požadovaného počtu kandidátov vytiahnuť z vektorovej vetvy.
     * `searchByVector()` reže limit PO zoradení, takže bez rezervy by uzol, ktorý
     * má svojich najbližších susedov už prepojených (a rewire beží nad sieťou,
     * kde väčšina blízkych párov hranu má), nedostal ani jedného kandidáta —
     * filter by celý limit prežral a vetva by hlásila tichú nulu.
     */
    protected const POOL = 8;

    public function __construct(protected EmbeddingService $embeddings) {}

    /**
     * Má vetva nad čím pracovať? Volajúci sa má spýtať PRED prvým `topSimilar()`.
     * Prázdna tabuľka nie je chyba, je to sieť, ktorá ešte nebola vektorizovaná —
     * a prejsť ju celú by bola cena za istú nulu (ten istý dôvod je zapísaný
     * v `EmbeddingService::search()`).
     */
    public function available(): bool
    {
        return $this->embeddings->enabled() && $this->embeddings->count() > 0;
    }

    /**
     * Prah podobnosti pre prewiring. Zámerne VYŠŠÍ než `min_similarity` recallu:
     * recall kandidáta len ponúkne do fúzie a slabý sa prepadne, kým hrana zostane
     * v grafe a ťahá k sebe layout aj `mind_recall` cez `via`. Falošná synapsia
     * je preto drahšia než falošný kandidát.
     */
    public function threshold(): float
    {
        return (float) config('hades.embeddings.prewire_min_similarity', 0.72);
    }

    /**
     * Najbližší vektoroví susedia uzla. Tvar výsledku je zámerne ten istý ako pri
     * {@see SimilarityService::topSimilar()} (`node_id` + skóre), aby sa obe vetvy
     * prewiringu dali porovnať bez prekladu.
     *
     * Uzol bez vektora vráti prázdno a NEDOPOČÍTAVA sa: dopĺňanie chýbajúcich
     * vektorov je práca `mind:embed` (CPU inferencia v desiatkach minút), nie
     * nočného prepájania.
     *
     * @param  int  $k  Maximálny počet kandidátov (strop volajúceho, nie odpovede).
     * @param  float|null  $min  Prah; `null` = {@see threshold()}.
     * @param  (callable(Node): bool)|null  $filter  Vráť false pre kandidáta, ktorý sa má zahodiť.
     * @return array<int, array{node_id: int, similarity: float}>
     */
    public function topSimilar(Node $node, int $k = 3, ?float $min = null, ?callable $filter = null): array
    {
        if ($k < 1) {
            return [];
        }

        $vector = $this->embeddings->vectorFor($node);

        if ($vector === null) {
            return [];
        }

        $hits = $this->embeddings->searchByVector($vector, $k * self::POOL, $min ?? $this->threshold());

        $out = [];

        foreach ($hits as $hit) {
            // vektor uzla trafí sám seba s podobnosťou 1,0 — je to prvý riadok
            // každej odpovede a bez tohto riadku by prewiring spájal uzol so sebou
            if ($hit['node_id'] === $node->id) {
                continue;
            }

            $other = Node::find($hit['node_id']);

            if (! $other) {
                continue;
            }

            if ($filter && ! $filter($other)) {
                continue;
            }

            $out[] = $hit;

            if (count($out) >= $k) {
                break;
            }
        }

        return $out;
    }
}
