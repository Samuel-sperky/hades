<?php

namespace App\Console\Commands;

use App\Events\MindPulse;
use App\Models\Edge;
use Illuminate\Console\Command;

/**
 * A9 — prerušenie zabudnutých synapsií. Zmaže len slabé, automatické similarity
 * hrany (auto, kind = similarity, váha < 1) staršie ako 90 dní. Ručné, skill a
 * co-aktivačné synapsie sa nikdy nemažú, rovnako ani hrany s váhou >= 1.
 */
class MindCleanupEdges extends Command
{
    protected $signature = 'mind:cleanup-edges';

    protected $description = 'Zmaže zabudnuté similarity synapsie (auto, váha < 1, staršie ako 90 dní)';

    public function handle(): int
    {
        $cutoff = now()->subDays(90);

        $edges = Edge::query()
            ->where('auto', true)
            ->where('kind', 'similarity')
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
