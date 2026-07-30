<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Node;
use App\Services\MindService;
use App\Services\SimilarityService;
use Illuminate\Support\Facades\Log;

/**
 * Orchestrátor rewire — rozpad pôvodného 672-riadkového MindRewire na triedy podľa
 * algoritmu (rozhodnutie #41), BEZ ZMENY VÝSLEDKU.
 *
 * Poradie krokov je súčasťou výsledku, nie implementačný detail:
 *
 *   1. jedna slučka nad Node::all() v poradí z DB, core preskočený:
 *        A3 (similarity backfill) potom A4 (skill_mention) pre TEN ISTÝ uzol,
 *      pretože hrana vytvorená pri uzle N je už v linkedIds/edgeKinds uzla N+1.
 *      Rozdelenie tejto slučky na dva prechody by zmenilo výsledok.
 *   2. A5 cross-domain mosty
 *   3. A6 sémantické klastre
 *   4. A7 memory → projekt
 *   5. A8 vnútro-oddelenské hviezdy
 *   6. A11 backfill stĺpca relation
 *
 * Pridané oproti monolitu (a nič iné):
 *   - meranie času každého algoritmu zvlášť (rozhodnutie #41),
 *   - strop času/veľkosti cez RewireBudget. Strop je poistka: pri dnešnej veľkosti
 *     siete sa nedosiahne, takže výsledok je identický. Keď padne, dobehne
 *     rozbehnutý algoritmus, ďalšie sa nespustia a nahlási sa to.
 */
class RewireOrchestrator
{
    public function __construct(
        private SimilarityService $similarity,
        private MindService $mind,
    ) {}

    public function run(?RewireBudget $budget = null): RewireResult
    {
        $budget ??= RewireBudget::fromConfig();
        $result = new RewireResult;

        $ctx = new RewireContext(
            mind: $this->mind,
            similarity: $this->similarity,
            links: new LinkRegistry($this->mind),
            hubs: new HubPicker,
            budget: $budget,
        );

        $nodes = Node::query()->get();
        $this->similarity->warmCorpus($nodes);

        $skills = Node::where('type', 'skill')->get(['id', 'label']);

        $a3 = new A3SimilarityBackfill;
        $a4 = new A4SkillMentions;

        // ---- krok 1: spoločná slučka A3 + A4 (poradie zápisov je výsledok) ----
        $started = microtime(true);
        $corpusSize = $nodes->count();

        foreach ($nodes as $node) {
            if ($node->type === 'core') {
                continue;
            }

            if ($budget->exhausted()) {
                $result->cappedBy = $budget->exhaustedBy();
                break;
            }

            $result->checked++;
            $budget->addNode();
            // topSimilar porovná uzol s celým korpusom — to je O(n) na uzol
            $budget->addPairs($corpusSize);

            $result->simCreated += $a3->perNode($node, $ctx);

            if ($node->type === 'memory' && $node->source === 'session') {
                ['new' => $new, 'promoted' => $promoted] = $a4->perNode($node, $skills, $ctx);
                $result->skillCreated += $new;
                $result->skillPromoted += $promoted;
            }
        }
        $result->timings['A3+A4'] = microtime(true) - $started;

        // ---- kroky 2–6: každý algoritmus samostatne, s kontrolou stropu ----
        $steps = [
            'A5' => fn () => $result->bridged = (new A5LabelTokenBridges)->run($ctx),
            'A6' => fn () => $result->clustered = (new A6SemanticClusters)->run($ctx),
            'A7' => fn () => $result->sessioned = (new A7SessionProjects)->run($ctx),
            'A8' => fn () => $result->depted = (new A8DepartmentStars)->run($ctx),
            'A11' => function () use ($ctx, $result) {
                $rel = (new A11RelationBackfill)->run($ctx);
                $result->relUses = $rel['uses'];
                $result->relPartOf = $rel['part_of'];
                $result->relSkipped = $rel['skipped'];
            },
        ];

        foreach ($steps as $name => $step) {
            if ($budget->exhausted()) {
                $result->cappedBy ??= $budget->exhaustedBy();
                $result->skippedSteps[] = $name;

                continue;
            }
            $at = microtime(true);
            $step();
            $result->timings[$name] = microtime(true) - $at;
        }

        if ((bool) config('maintenance.rewire.log_timings', true)) {
            Log::info('rewire', $result->toArray() + [
                'pairs' => $budget->pairs(),
                'seconds' => round($budget->elapsed(), 2),
            ]);
        }

        return $result;
    }
}
