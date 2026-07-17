<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Edge;
use Illuminate\Console\Command;

/**
 * A9 — prerušenie zabudnutých synapsií. Zmaže slabé, automatické similarity a
 * co-aktivačné hrany (auto, váha < 1 — teda už zoslabnuté decayom) staršie ako
 * 90 dní. Ručné (manual) a skill_mention synapsie sa nikdy nemažú, rovnako ani
 * hrany s váhou >= 1. Spolu s decayom (ktorý tlačí neaktívne hrany k podlahe 0.5)
 * to tvorí prirodzený cyklus zabúdania a bráni nekonečnému hustnutiu grafu.
 */
class MindCleanupEdges extends Command
{
    protected $signature = 'mind:cleanup-edges';

    protected $description = 'Zmaže zabudnuté auto synapsie (similarity/co-aktivácia, váha < 1, staršie ako 90 dní)';

    public function handle(): int
    {
        $cutoff = now()->subDays(90);

        $edges = Edge::query()
            ->where('auto', true)
            ->whereIn('kind', ['similarity', 'co_activation'])
            ->where('weight', '<', 1)
            ->where('last_activated_at', '<', $cutoff)
            ->get();

        $deleted = 0;
        foreach ($edges as $edge) {
            $id = $edge->id;
            $edge->delete();
            MindPulse::dispatch('edge.deleted', ['id' => $id]);
            $deleted++;
        }

        $this->info("Cleanup: prerušených {$deleted} synapsií.");

        return self::SUCCESS;
    }
}
