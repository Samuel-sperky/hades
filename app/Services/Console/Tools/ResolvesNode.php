<?php

namespace App\Services\Console\Tools;

use App\Models\Node;
use App\Services\MindService;

/**
 * Nájdenie JEDNÉHO uzla podľa `id` alebo presného `label`.
 *
 * Prísnosť je zámerná a je tu preto, že ju platí zápis: pri premenovaní, presune
 * a mazaní je „skoro ten správny uzol" horší výsledok než odmietnutie. Preto
 * {@see MindService::findExact()} (vracia uzol len keď je jednoznačný), nie
 * `findByLabel()` (ktorý zámerne trafí aj podobný — to je správne pri učení,
 * kde sa uzly zlučujú, a zlé všade inde).
 *
 * `id` má prednosť: prišlo z recallu, takže je to jediný identifikátor, ktorý
 * model neuhádol.
 */
trait ResolvesNode
{
    /**
     * @param  array<string, mixed>  $args
     * @param  array<int, string>  $relations
     *
     * @throws ToolRefusal
     */
    protected function resolveNode(array $args, MindService $mind, array $relations = []): Node
    {
        $id = $this->optionalInt($args, 'id');

        if ($id !== null) {
            $node = Node::query()->with($relations)->find($id);

            if ($node) {
                return $node;
            }

            throw new ToolRefusal("No node with id {$id}. Use mind_recall to find it again.");
        }

        $label = $this->optionalString($args, 'label');

        if ($label === null) {
            throw new ToolRefusal('Give either `id` (from mind_recall) or the exact `label` of the node.');
        }

        $node = $mind->findExact($label, $this->optionalString($args, 'type'));

        if (! $node) {
            throw new ToolRefusal(
                "No single node matches label: {$label}. Use mind_recall to get its exact label or id first."
            );
        }

        if ($relations !== []) {
            $node->load($relations);
        }

        return $node;
    }
}
