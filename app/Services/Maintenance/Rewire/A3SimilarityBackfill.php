<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * A3 — backfill similarity synapsií naprieč celou sieťou (TF-IDF kosínus).
 * Idempotentné: prepája len páry, ktoré ešte hranu nemajú. Prah 0.20
 * (config('maintenance.thresholds.rewire_similarity')).
 *
 * Prevzaté 1:1 z MindRewire — vrátane filtra, ktorý zabraňuje, aby sa dva session
 * záznamy rôznych projektov spojili priamo (mostom medzi projektmi je zdieľaný
 * skill, nie záznam ↔ záznam).
 *
 * Beží per-uzol vo spoločnej slučke s A4, pretože poradie zápisov v tejto slučke
 * je súčasťou výsledku: hrana vytvorená pri uzle N je už v linkedIds uzla N+1.
 */
class A3SimilarityBackfill
{
    /** @return int  počet vytvorených similarity synapsií */
    public function perNode(Node $node, RewireContext $ctx): int
    {
        $threshold = (float) config('maintenance.thresholds.rewire_similarity', 0.20);

        // aktuálne prepojené uzly — čerstvo z DB, v tomto behu už mohli pribudnúť
        $linkedIds = $this->linkedIds($node);

        $isSession = $node->type === 'memory' && $node->source === 'session';
        $ownProject = (string) ($node->meta['project'] ?? '');

        $filter = function (Node $cand) use ($node, $linkedIds, $isSession, $ownProject) {
            if ($cand->id === $node->id || $cand->type === 'core') {
                return false;
            }
            if ($linkedIds->has($cand->id)) {
                return false;
            }
            // A4: dva session záznamy rôznych projektov sa priamo nespájajú
            if ($isSession && $cand->type === 'memory' && $cand->source === 'session') {
                if ((string) ($cand->meta['project'] ?? '') !== $ownProject) {
                    return false;
                }
            }

            return true;
        };

        $created = 0;
        foreach ($ctx->similarity->topSimilar($node, 3, $threshold, $filter) as $hit) {
            $other = Node::find($hit['node_id']);
            if (! $other) {
                continue;
            }
            $ctx->mind->connect($node, $other, 'similarity', true, 0.5);
            $created++;
        }

        return $created;
    }

    /** Množina id uzlov, s ktorými má $node hranu (bez seba). */
    private function linkedIds(Node $node): Collection
    {
        return Edge::query()
            ->where('source_id', $node->id)
            ->orWhere('target_id', $node->id)
            ->get(['source_id', 'target_id'])
            ->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])
            ->reject(fn ($id) => $id === $node->id)
            ->unique()
            ->flip();
    }
}
