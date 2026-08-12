<?php

namespace App\Console\Commands;

use App\Models\MergeCandidate;
use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Console\Command;

/**
 * D5/E7 — detekcia takmer identických uzlov.
 *
 * NEZLUČUJE. Od 12.8.2026 iba plní frontu merge_candidates a rozhodnutie
 * necháva na človeku (`php artisan mind:duplicates`).
 *
 * Dôvod je meraný, nie opatrnícky. Dry-run z 31.7.2026 zistil, že najvyššie
 * skórujúce páry (0,8994) neboli duplikáty, ale sesterské projekty. Živý beh to
 * potvrdil: 26.7. o 04:45 tento príkaz nevratne pohltil „Súhrn týždňa 30/2026"
 * do „Súhrn týždňa 29/2026" pri skóre 0,9258 — dva rôzne týždne. Kosínusová
 * podobnosť spoľahlivo nájde uzly, ktoré SÚVISIA; nevie rozlíšiť, či sú tá istá
 * vec, alebo dve susedné veci opísané rovnakým slovníkom.
 *
 * Kandidáti ostávajú NON-core a NON-session uzly rovnakého typu. Cross-type
 * duplicity (rovnaký slug, iný type) zachytáva mind_learn cez
 * MindService::findMergeCandidates.
 */
class MindAutomerge extends Command
{
    protected $signature = 'mind:automerge {--threshold= : Prah kosínusovej podobnosti (default 0.92)}';

    protected $description = 'Nájde takmer identické uzly a navrhne ich na zlúčenie (nezlučuje)';

    protected const THRESHOLD = 0.92;

    public function handle(SimilarityService $similarity, MindService $mind): int
    {
        $threshold = (float) ($this->option('threshold') ?: self::THRESHOLD);

        $nodes = Node::query()
            ->where('type', '!=', 'core')
            ->where(function ($q) {
                $q->whereNull('source')->orWhere('source', '!=', 'session');
            })
            ->get();

        $similarity->warmCorpus($nodes);

        $proposed = 0;
        $seen = 0;

        foreach ($nodes->groupBy('type') as $group) {
            $group = $group->values();
            $n = $group->count();

            for ($i = 0; $i < $n - 1; $i++) {
                for ($j = $i + 1; $j < $n; $j++) {
                    $score = $similarity->score($group[$i], $group[$j]);

                    if ($score < $threshold) {
                        continue;
                    }

                    $seen++;

                    if ($mind->recordMergeCandidate(
                        $group[$i],
                        $group[$j],
                        round($score * 100, 2),
                        'cosine',
                    )?->wasRecentlyCreated) {
                        $proposed++;
                    }
                }
            }
        }

        $pending = MergeCandidate::pending()->count();

        $this->info("Automerge: {$seen} párov nad prahom {$threshold}, {$proposed} nových návrhov. "
            ."Vo fronte čaká {$pending}. Zobraz ich cez `php artisan mind:duplicates`.");

        return self::SUCCESS;
    }
}
