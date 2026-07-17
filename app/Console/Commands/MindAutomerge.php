<?php

namespace App\Console\Commands;

use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * D5/E7 — automatické zlúčenie takmer identických uzlov. Kandidáti sú NON-core,
 * NON-session uzly (source != 'session') rovnakého typu; pri kosínusovej
 * podobnosti >= 0.92 sa slabší uzol zlúči do silnejšieho. Session záznamy sa
 * NIKDY nezlučujú automaticky (majú vlastný archív cez mind:archive-old).
 */
class MindAutomerge extends Command
{
    protected $signature = 'mind:automerge';

    protected $description = 'Automaticky zlúči takmer identické uzly (skilly/fakty), nikdy nie session záznamy';

    /** Prah podobnosti pre automatické zlúčenie. */
    protected const THRESHOLD = 0.92;

    public function handle(SimilarityService $similarity, MindService $mind): int
    {
        // kandidáti: ne-core, ne-session (source null alebo != 'session')
        $nodes = Node::query()
            ->where('type', '!=', 'core')
            ->where(function ($q) {
                $q->whereNull('source')->orWhere('source', '!=', 'session');
            })
            ->get();

        $similarity->warmCorpus($nodes);

        $merged = 0;
        $gone = []; // id => true pre už pohltené uzly

        // zlučujeme len uzly rovnakého typu
        foreach ($nodes->groupBy('type') as $group) {
            $group = $group->values();
            $n = $group->count();

            for ($i = 0; $i < $n - 1; $i++) {
                $a = $group[$i];
                if (isset($gone[$a->id])) {
                    continue;
                }

                for ($j = $i + 1; $j < $n; $j++) {
                    $b = $group[$j];
                    if (isset($gone[$b->id])) {
                        continue;
                    }

                    $score = $similarity->score($a, $b);
                    if ($score < self::THRESHOLD) {
                        continue;
                    }

                    // slabší uzol sa zlúči do silnejšieho
                    [$winner, $loser] = (float) $a->strength >= (float) $b->strength ? [$a, $b] : [$b, $a];

                    $fresh = $mind->mergeNodes($loser->fresh(), $winner->fresh());
                    $gone[$loser->id] = true;

                    Log::info('automerge', [
                        'loser' => $loser->id,
                        'loser_label' => $loser->label,
                        'winner' => $winner->id,
                        'winner_label' => $winner->label,
                        'score' => round($score, 4),
                    ]);
                    $merged++;

                    if ($loser->id === $a->id) {
                        break; // pohltený bol $a → von z vnútornej slučky
                    }
                    // pohltený bol $b → pokračuj s aktualizovaným winnerom ($a)
                    $a = $fresh;
                }
            }
        }

        $this->info("Automerge: zlúčených {$merged} párov.");

        return self::SUCCESS;
    }
}
