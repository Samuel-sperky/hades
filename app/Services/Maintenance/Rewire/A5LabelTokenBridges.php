<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;

/**
 * A5 — cross-domain mosty z tokenov labelu. Dvojice skill/project/claude-memory
 * uzlov, ktoré NIE sú v rovnakom oddelení (to už spája seed/klaster A8) a zdieľajú
 * aspoň 2 distinktívne tokeny labelu (>= 4 znaky), sa prepoja slabou similarity
 * synapsiou. Match je label-only (bez description) → vysoká presnosť bez šumu
 * z dlhých popisov.
 *
 * Idempotentné: preskakuje už prepojené páry (žiadna zmena kind/váhy na existujúcich
 * hranách). Per-uzol strop MAX_BRIDGES_PER_NODE bráni hairballu okolo hubov.
 * Poradie je deterministické (podľa id).
 *
 * Prevzaté 1:1 z MindRewire::bridgeByLabelTokens(). Jediný rozdiel: snapshot hrán
 * a vytváranie vedie LinkRegistry (predtým lokálne pole $linked), a rozpočet
 * dostane informáciu o počte porovnaných párov — to je najdrahší algoritmus behu.
 */
class A5LabelTokenBridges
{
    /** Strop nových cross-domain mostov na jeden uzol (bráni hairballu okolo hubov). */
    public const MAX_BRIDGES_PER_NODE = 6;

    public function run(RewireContext $ctx): int
    {
        $nodes = Node::query()
            ->where(function ($q) {
                $q->whereIn('type', ['skill', 'project'])
                    ->orWhere(function ($q2) {
                        $q2->where('type', 'memory')->where('source', 'claude-memory');
                    });
            })
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'department_id']);

        // distinktívne tokeny labelu (>= 4 znaky) pre každý uzol
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = $ctx->labelTokens((string) $n->label, 4);
        }

        $ctx->links->load();

        $newDegree = [];
        $created = 0;
        $list = $nodes->values();
        $count = $list->count();

        for ($i = 0; $i < $count; $i++) {
            $a = $list[$i];
            for ($j = $i + 1; $j < $count; $j++) {
                $b = $list[$j];

                // most je cross-domain — rovnaké oddelenie už spája seed/klaster
                if ($a->department_id && $b->department_id && $a->department_id === $b->department_id) {
                    continue;
                }
                if (count(array_intersect($tokens[$a->id], $tokens[$b->id])) < 2) {
                    continue;
                }
                if ($ctx->links->has($a->id, $b->id)) {
                    continue;
                }
                if (($newDegree[$a->id] ?? 0) >= self::MAX_BRIDGES_PER_NODE
                    || ($newDegree[$b->id] ?? 0) >= self::MAX_BRIDGES_PER_NODE) {
                    continue;
                }

                $ctx->mind->connect($a, $b, 'similarity', true, 0.5);
                $ctx->links->remember($a->id, $b->id);
                $newDegree[$a->id] = ($newDegree[$a->id] ?? 0) + 1;
                $newDegree[$b->id] = ($newDegree[$b->id] ?? 0) + 1;
                $created++;
            }
        }

        // najdrahší algoritmus behu — n*(n-1)/2 porovnaní ide do rozpočtu
        $ctx->budget->addPairs((int) ($count * max(0, $count - 1) / 2));

        return $created;
    }
}
