<?php

namespace App\Services\Maintenance\DryRun;

use App\Models\Node;
use App\Services\Maintenance\Metric\SimilarityMetric;

/**
 * Dry-run pre mind:automerge — ktoré páry uzlov by sa ZLÚČILI a ktorý by prehral.
 *
 * Kandidáti a poradie sú prevzaté 1:1 z App\Console\Commands\MindAutomerge:
 * ne-core uzly, ktorých source nie je 'session', zoskupené podľa type, dvojitá
 * slučka i < j, prah z config('maintenance.thresholds.automerge').
 *
 * Simulácia je vedome KONZERVATÍVNA a report to priznáva: reálny beh po zlúčení
 * pripojí popis pohltencu k víťazovi, čím sa jeho text zmení a v tom istom behu
 * môžu vzniknúť ďalšie páry, ktoré tu nie sú. Dry-run skóruje pôvodné uzly, takže
 * je to DOLNÁ hranica dopadu — nikdy nie nadhodnotenie.
 */
class AutomergeDryRun implements JobDryRun
{
    public function job(): string
    {
        return 'automerge';
    }

    public function command(): string
    {
        return 'mind:automerge';
    }

    public function usesMetric(): bool
    {
        return true;
    }

    public function run(?SimilarityMetric $metric, DryRunOptions $options): DryRunResult
    {
        if ($metric === null) {
            return DryRunResult::skipped($this->job(), 'n/a', 'job vyžaduje metriku podobnosti');
        }

        $started = microtime(true);
        $threshold = (float) config('maintenance.thresholds.automerge', 0.92);

        $nodes = Node::query()
            ->where('type', '!=', 'core')
            ->where(function ($q) {
                $q->whereNull('source')->orWhere('source', '!=', 'session');
            })
            ->get();

        $metric->warm($nodes);

        $compared = 0;
        $undecided = 0;
        $affected = 0;
        $samples = [];
        $truncated = false;
        $gone = [];

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

                    if ($options->pairLimitReached($compared)) {
                        $truncated = true;

                        break 3;
                    }

                    $compared++;
                    $score = $metric->score($a, $b);
                    if ($score === null) {
                        $undecided++;

                        continue;
                    }
                    if ($score < $threshold) {
                        continue;
                    }

                    // slabší uzol prehráva — presne ako v príkaze
                    [$winner, $loser] = (float) $a->strength >= (float) $b->strength ? [$a, $b] : [$b, $a];
                    $gone[$loser->id] = true;
                    $affected++;

                    if ($options->wantsSample(count($samples))) {
                        $samples[] = [
                            'score' => round($score, 4),
                            'winner_id' => $winner->id,
                            'winner_label' => (string) $winner->label,
                            'winner_strength' => (float) $winner->strength,
                            'loser_id' => $loser->id,
                            'loser_label' => (string) $loser->label,
                            'loser_strength' => (float) $loser->strength,
                            'type' => (string) $a->type,
                        ];
                    }

                    if ($loser->id === $a->id) {
                        break;
                    }
                }
            }
        }

        $notes = [
            'Dolná hranica: reálny beh po zlúčení pripojí popis pohltenca k víťazovi, čím môže v tom istom behu odomknúť ďalšie páry. Dry-run skóruje pôvodné uzly.',
            'Session záznamy (source = session) a core uzol sú z kandidátov vylúčené — rovnako ako v príkaze.',
            'Zlúčenie je NEVRATNÉ: pohltený uzol zanikne, jeho hrany prejdú na víťaza, v meta.absorbed zostane audit stopa.',
        ];
        if ($truncated) {
            $notes[] = 'Beh zastavil strop max_pairs — čísla sú neúplné.';
        }

        return new DryRunResult(
            job: $this->job(),
            metric: $metric->name(),
            threshold: $threshold,
            candidates: $nodes->count(),
            compared: $compared,
            affected: $affected,
            kept: max(0, $nodes->count() - $affected),
            undecided: $undecided,
            samples: $samples,
            notes: $notes,
            truncated: $truncated,
            seconds: microtime(true) - $started,
        );
    }
}
