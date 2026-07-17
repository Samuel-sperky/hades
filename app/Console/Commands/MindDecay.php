<?php

namespace App\Console\Commands;

use App\Models\Edge;
use App\Models\Node;
use Illuminate\Console\Command;

/**
 * D2 — zabúdanie. Neaktívne uzly a staré automatické synapsie postupne slabnú,
 * nikdy ale nespadnú pod podlahu (uzol 1.0, hrana 0.5). Pripnuté uzly (pinned),
 * jadro a manuálne fakty (source = null) sa nikdy neoslabujú.
 */
class MindDecay extends Command
{
    protected $signature = 'mind:decay';

    protected $description = 'Oslabí neaktívne uzly (>14 dní) a staré automatické synapsie (>30 dní)';

    public function handle(): int
    {
        $nodeCutoff = now()->subDays(14);
        $edgeCutoff = now()->subDays(30);

        // Uzly: nie pripnuté, nie jadro, so zdrojom (manuálne fakty majú source
        // null → nikdy nedecayujú), neaktívne viac než 14 dní.
        $nodesDecayed = 0;
        $nodes = Node::query()
            ->where('pinned', false)
            ->where('type', '!=', 'core')
            ->whereNotNull('source')
            ->where('last_activated_at', '<', $nodeCutoff)
            ->get();

        foreach ($nodes as $node) {
            $new = max(1.0, (float) $node->strength * 0.97);
            if ($new !== (float) $node->strength) {
                $node->forceFill(['strength' => $new])->save();
                $nodesDecayed++;
            }
        }

        // Hrany: len automatické, neaktívne viac než 30 dní.
        $edgesDecayed = 0;
        $edges = Edge::query()
            ->where('auto', true)
            ->where('last_activated_at', '<', $edgeCutoff)
            ->get();

        foreach ($edges as $edge) {
            $new = max(0.5, (float) $edge->weight * 0.95);
            if ($new !== (float) $edge->weight) {
                $edge->forceFill(['weight' => $new])->save();
                $edgesDecayed++;
            }
        }

        $this->info("Decay: oslabených {$nodesDecayed} uzlov · {$edgesDecayed} synapsií.");

        return self::SUCCESS;
    }
}
