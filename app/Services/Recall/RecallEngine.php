<?php

namespace App\Services\Recall;

use App\Events\MindPulse;
use App\Models\Activation;
use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * ZAMKNUTÉ ROZHRANIE (#13). Vyčlenené z 737-riadkového `MindService`
 * (rozhodnutie #40) — jediný engine vyhľadávania vo vedomí.
 *
 *   recall(query, limit, sessionKey): RecallResult   — hľadanie + graph-walk + pulz
 *   search(query, limit): Collection                 — len kandidáti, bez vedľajších efektov
 *
 * Dve vetvy:
 *   A) lexikálna (LexicalSearch) — POVINNÁ, prvotriedna, funguje bez modelu
 *   B) vektorová (VectorSearch)  — nepovinná, druhé skóre navrch
 *
 * Keď je B nedostupná (Ollama nebeží, LLM vypnutý, žiadny vektor v DB), výsledok
 * je BIT-IDENTICKÝ s pôvodným `MindService::searchNodes()`. To je zámer, nie
 * náhoda: `HybridScorer::key()` sa pri nulovom kosínuse redukuje na pôvodný kľúč.
 */
class RecallEngine
{
    public function __construct(
        private readonly LexicalSearch $lexical = new LexicalSearch,
        private readonly VectorSearch $vector = new VectorSearch,
        private readonly HybridScorer $scorer = new HybridScorer,
    ) {}

    /**
     * Najde poznatky relevantne k dopytu. Nezvysuje silu, ale vysle
     * "spomienkovy" pulz do vizualizacie.
     *
     * Graph-walk hĺbky 1: k primárnym zásahom pridá ich priamych susedov
     * (jeden skok po hranách). Primáre si držia poradie, susedia sa pripoja
     * za ne. Celkový strop = limit + 50 %.
     */
    public function recall(string $query, int $limit = 12, ?string $sessionKey = null): RecallResult
    {
        $matches = $this->search($query, $limit);

        if ($matches->isEmpty()) {
            return RecallResult::empty();
        }

        /** @var Collection<int, Node> $primaries */
        $primaries = $matches->pluck('node')->values();

        $primaryIds = $primaries->pluck('id')->all();
        $overallCap = (int) ceil($limit * 1.5);
        $neighborSlots = max(0, $overallCap - $primaries->count());

        $neighbours = $this->neighbours($primaryIds, $neighborSlots);

        // session_key sa uloží k aktiváciám — neskoršie learn/activate v tej istej
        // session sa cez coActivate prepoja aj s vybavenými uzlami
        foreach ($primaries as $node) {
            Activation::record($node, 'recall', $sessionKey);
        }
        foreach ($neighbours as $node) {
            // ľahšia aktivácia — sused vybavený cez hranu, nie priamou zhodou
            Activation::record($node, 'recall-neighbor', $sessionKey);
        }

        $result = new RecallResult(
            primaries: $primaries,
            neighbours: $neighbours,
            total: $primaries->count() + $neighbours->count(),
        );

        MindPulse::dispatch('recall', ['node_ids' => $result->ids()]);

        return $result;
    }

    /**
     * Kandidáti na dopyt — bez aktivácií a bez pulzu. Zdroj pravdy pre webové
     * /api/search, knižnicu, smernicu aj MCP recall.
     *
     * @return Collection<int, array{node: Node, score: int, snippet: ?string, vector: float}>
     */
    public function search(string $query, int $limit = 12): Collection
    {
        $candidates = $this->lexical->candidates($query, $limit);
        $expand = $this->vector->mode() === 'expand';

        // Bez lexikálnych kandidátov nemá režim 'rerank' čo preraďovať — vetva sa
        // vynechá úplne (žiadne čítanie korpusu, žiadny request do Ollamy).
        // 'expand' pokračuje, tam vektor SMIE priniesť vlastných kandidátov.
        if (! $expand && $candidates->isEmpty()) {
            return collect();
        }

        // V 'rerank' stačí kosínus pre kandidátov; skóre ostatných uzlov sa
        // v `HybridScorer::rank()` aj tak zahodí. 'expand' potrebuje celý korpus.
        $vectorScores = $this->vector->scores(
            $query,
            $expand ? null : $candidates->pluck('node.id')->all(),
        );

        // 'expand' — vektor smie pridať uzly, ktoré lexikálna vetva nenašla.
        // Default je 'rerank': tvrdý prah zostáva a množina výsledkov sa nemení.
        if ($vectorScores !== [] && $expand) {
            $candidates = $this->expand($candidates, $vectorScores, $query);
        }

        if ($candidates->isEmpty()) {
            return collect();
        }

        return $this->scorer->rank($candidates, $vectorScores, $limit);
    }

    /** Rozbor dopytu (fold / stem / korene) — `MindService` naň deleguje. */
    public function analyzer(): QueryAnalyzer
    {
        return $this->lexical->analyzer();
    }

    /**
     * Priami susedia primárov, najsilnejšie ako prvé, bez samotných primárov.
     *
     * @param  list<int>  $primaryIds
     * @return Collection<int, Node>
     */
    private function neighbours(array $primaryIds, int $slots): Collection
    {
        if ($slots <= 0 || $primaryIds === []) {
            return collect();
        }

        $neighborIds = Edge::query()
            ->where(function ($q) use ($primaryIds) {
                $q->whereIn('source_id', $primaryIds)
                    ->orWhereIn('target_id', $primaryIds);
            })
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => in_array($id, $primaryIds, true))
            ->unique()
            ->values();

        if ($neighborIds->isEmpty()) {
            return collect();
        }

        return Node::query()
            ->with(['area', 'department'])
            ->whereIn('id', $neighborIds->all())
            ->orderByDesc('strength')
            ->limit($slots)
            ->get();
    }

    /**
     * Doplní kandidátov, ktorých našla len vektorová vetva (skóre = 0 zhodných
     * konceptov, takže v poradí skončia VŽDY za lexikálnymi zásahmi).
     *
     * Toto je jediné miesto, kde sa množina výsledkov oproti dnešnému stavu
     * rozširuje, a je za vypínačom `recall.vector.mode` — zapína ho vlna W3
     * po kalibrácii prahov (docs/BENCHMARK-LLM.md §3).
     *
     * @param  Collection<int, array{node: Node, score: int, snippet: ?string}>  $candidates
     * @param  array<int, float>  $vectorScores
     * @return Collection<int, array{node: Node, score: int, snippet: ?string}>
     */
    private function expand(Collection $candidates, array $vectorScores, string $query): Collection
    {
        // `min_score` rozhoduje o vstupe do POOLU, `bridge_min_score` (HybridScorer)
        // o promócii pred lexikálny zásah. Musí platiť min_score <= bridge_min_score,
        // inak vyšší pool-prah ticho zruší nižšiu promóciu — obe defaulty sú 0.51.
        $min = (float) config('recall.vector.min_score', 0.55);
        $max = max(0, (int) config('recall.vector.candidates', 12));

        if ($max === 0) {
            return $candidates;
        }

        $known = $candidates->pluck('node.id')->all();

        $extraIds = collect($vectorScores)
            ->reject(fn (float $score, int $nodeId) => in_array($nodeId, $known, true))
            ->filter(fn (float $score) => $score >= $min)
            ->sortDesc()
            ->take($max)
            ->keys()
            ->all();

        if ($extraIds === []) {
            return $candidates;
        }

        $roots = $this->lexical->analyzer()->roots($query);

        $extra = Node::query()
            ->with(['area', 'department'])
            ->whereIn('id', $extraIds)
            ->get()
            ->map(fn (Node $node) => [
                'node' => $node,
                'score' => 0,   // žiadny lexikálny zásah → za všetkými primárnymi
                'snippet' => $this->lexical->analyzer()->snippet((string) $node->description, $roots),
            ]);

        return $candidates->concat($extra)->values();
    }
}
