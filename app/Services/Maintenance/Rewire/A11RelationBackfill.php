<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Edge;
use App\Models\Node;
use Illuminate\Support\Facades\Schema;

/**
 * A11 — sémantika hrán do stĺpca 'relation' (aditívne, popri kind/weight):
 *   - session záznam (memory, source = session) ↔ skill → 'uses'
 *   - člen (skill/project) ↔ jeho agregačný hub („mapa / ekosystém / systém"
 *     podľa HubPicker::DEPT_HUB_HINTS) → 'part_of'
 *
 * Mení VÝHRADNE stĺpec relation cez forceFill (kind, weight ani auto sa nikdy
 * nedotknú) a len na hranách s relation = null, takže opakovaný beh nič neprepisuje
 * a nezvyšuje váhy.
 *
 * Celý krok je strážený Schema::hasColumn('edges', 'relation') — kým stĺpec
 * v schéme nie je, backfill sa ticho preskočí a rewire ostáva spätne kompatibilný.
 *
 * Prevzaté 1:1 z MindRewire::backfillRelations().
 */
class A11RelationBackfill
{
    /** @return array{uses: int, part_of: int, skipped: bool} */
    public function run(RewireContext $ctx): array
    {
        if (! Schema::hasColumn('edges', 'relation')) {
            return ['uses' => 0, 'part_of' => 0, 'skipped' => true];
        }

        $nodes = Node::query()->get(['id', 'type', 'source', 'label']);

        $type = [];       // id => type
        $isSession = [];  // id => bool (memory záznam zo session)
        $isHub = [];      // id => bool (agregačný „mapa/ekosystém/systém" uzol)
        foreach ($nodes as $n) {
            $type[$n->id] = $n->type;
            $isSession[$n->id] = $n->type === 'memory' && $n->source === 'session';
            $tokens = $ctx->labelTokens((string) $n->label);
            $isHub[$n->id] = (bool) array_intersect(HubPicker::DEPT_HUB_HINTS, $tokens);
        }

        $uses = 0;
        $partOf = 0;

        // len hrany bez relácie — existujúce relácie sa nikdy neprepisujú
        foreach (Edge::query()->whereNull('relation')->get() as $edge) {
            $s = $edge->source_id;
            $t = $edge->target_id;
            if (! isset($type[$s], $type[$t])) {
                continue;
            }

            // session záznam ↔ skill = 'uses'
            $sessionSkill = ($isSession[$s] && $type[$t] === 'skill')
                || ($isSession[$t] && $type[$s] === 'skill');
            if ($sessionSkill) {
                $edge->forceFill(['relation' => 'uses'])->save();
                $uses++;

                continue;
            }

            // člen (skill/project) ↔ agregačný hub = 'part_of'
            // práve jeden koniec je hub, druhý je (ne-hub) skill/project
            if ($isHub[$s] !== $isHub[$t]) {
                $memberId = $isHub[$s] ? $t : $s;
                if (in_array($type[$memberId], ['skill', 'project'], true)) {
                    $edge->forceFill(['relation' => 'part_of'])->save();
                    $partOf++;
                }
            }
        }

        $ctx->budget->addPairs($nodes->count());

        return ['uses' => $uses, 'part_of' => $partOf, 'skipped' => false];
    }
}
