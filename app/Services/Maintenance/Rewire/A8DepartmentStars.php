<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;

/**
 * A8 — vnútro-oddelenské soft-linky hviezdou. Oddelenie s DEPT_STAR_MIN..
 * DEPT_STAR_MAX skill/project uzlami dostane hub (agregačný „mapa / systém" uzol,
 * inak najsilnejší) a každý ostatný člen sa naň naviaže. Rieši riedke oddelenia
 * (napr. dept s 0/6 vnútornými hranami) čitateľnou hviezdou namiesto náhodných
 * nití. A5 zámerne preskakuje rovnaké oddelenie — túto medzeru dopĺňa práve A8.
 *
 * Príliš veľké oddelenia (> DEPT_STAR_MAX) sa vynechajú — tam by hviezda z jedného
 * huba bola neúnosne hustá a významovo slabá.
 *
 * Prevzaté 1:1 z MindRewire::bridgeDepartmentStars(). Lineárny počet hrán
 * (n-1 na oddelenie), idempotentné, kind 'similarity', váha 0.5.
 */
class A8DepartmentStars
{
    /** Rozsah veľkosti oddelenia (skill+project) vhodného na hviezdu. */
    public const DEPT_STAR_MIN = 3;

    public const DEPT_STAR_MAX = 12;

    public function run(RewireContext $ctx): int
    {
        $nodes = Node::query()
            ->whereIn('type', ['skill', 'project'])
            ->whereNotNull('department_id')
            ->orderBy('id')
            ->get(['id', 'label', 'type', 'department_id', 'strength']);

        // kanonizované tokeny labelu (bez dĺžkového filtra — hint je kanonický term)
        $tokens = [];
        foreach ($nodes as $n) {
            $tokens[$n->id] = $ctx->labelTokens((string) $n->label);
        }

        $ctx->links->load();
        $created = 0;

        foreach ($nodes->groupBy('department_id') as $group) {
            $members = $group->values();
            $count = $members->count();
            if ($count < self::DEPT_STAR_MIN || $count > self::DEPT_STAR_MAX) {
                continue;
            }

            $hub = $ctx->hubs->pick($members, $tokens, HubPicker::DEPT_HUB_HINTS);

            foreach ($members as $member) {
                if ($member->id === $hub->id) {
                    continue;
                }
                $created += $ctx->links->linkIfNew($hub, $member);
            }
        }

        $ctx->budget->addPairs($nodes->count());

        return $created;
    }
}
