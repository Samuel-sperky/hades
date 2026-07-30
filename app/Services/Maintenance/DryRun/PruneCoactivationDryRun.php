<?php

namespace App\Services\Maintenance\DryRun;

use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Metric\SimilarityMetric;

/**
 * Dry-run pre mind:prune-coactivation — ktoré jednorazové co-aktivačné synapsie
 * by sa PREREZALI ako koincidencia.
 *
 * Výber hrán a rozhodovanie sú prevzaté 1:1 z App\Console\Commands\MindPruneCoactivation:
 * kind = co_activation, weight <= 1, skóre koncov < prah
 * (config('maintenance.thresholds.prune_coactivation')). Osirelý koniec sa ponecháva.
 *
 * Rozdiel oproti automerge: tu nie je O(n²) — vyhodnocuje sa presne toľko párov,
 * koľko je takých hrán, takže report je EXAKTNÝ, nie dolná hranica.
 */
class PruneCoactivationDryRun implements JobDryRun
{
    public function job(): string
    {
        return 'prune-coactivation';
    }

    public function command(): string
    {
        return 'mind:prune-coactivation';
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
        $threshold = (float) config('maintenance.thresholds.prune_coactivation', 0.08);

        // warm nad CELÝM korpusom — presne ako príkaz (bez warmu by boli IDF neutrálne)
        $metric->warm(Node::query()->get());

        $edges = Edge::query()
            ->where('kind', 'co_activation')
            ->where('weight', '<=', 1)
            ->orderBy('id')
            ->get();

        // koncové uzly načítaj naraz — príkaz robí Node::find() v slučke (N+1),
        // dry-run musí byť lacný, výsledok rozhodovania je identický
        $ids = $edges->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])->unique()->all();
        $byId = Node::query()->whereIn('id', $ids)->get()->keyBy('id');

        $compared = 0;
        $undecided = 0;
        $pruned = 0;
        $kept = 0;
        $orphans = 0;
        $samples = [];
        $truncated = false;

        foreach ($edges as $edge) {
            if ($options->pairLimitReached($compared)) {
                $truncated = true;

                break;
            }

            $source = $byId->get($edge->source_id);
            $target = $byId->get($edge->target_id);

            if (! $source || ! $target) {
                $orphans++;
                $kept++;

                continue;
            }

            $compared++;
            $score = $metric->score($source, $target);
            if ($score === null) {
                $undecided++;
                $kept++;

                continue;
            }

            if ($score >= $threshold) {
                $kept++;

                continue;
            }

            $pruned++;
            if ($options->wantsSample(count($samples))) {
                $samples[] = [
                    'score' => round($score, 4),
                    'edge_id' => $edge->id,
                    'weight' => (float) $edge->weight,
                    'source_id' => $source->id,
                    'source_label' => (string) $source->label,
                    'target_id' => $target->id,
                    'target_label' => (string) $target->label,
                    'last_activated_at' => $edge->last_activated_at?->toIso8601String(),
                ];
            }
        }

        $notes = [
            'Exaktné: vyhodnocuje sa presne toľko párov, koľko je jednorazových co-aktivácií — žiadna extrapolácia.',
            'Posilnené co-aktivácie (weight > 1), manual, skill_mention a similarity hrany sa nedotknú.',
            "Osirelé hrany (chýbajúci koniec): {$orphans} — ponechané, rovnako ako v príkaze.",
        ];
        if ($truncated) {
            $notes[] = 'Beh zastavil strop max_pairs — čísla sú neúplné.';
        }

        return new DryRunResult(
            job: $this->job(),
            metric: $metric->name(),
            threshold: $threshold,
            candidates: $edges->count(),
            compared: $compared,
            affected: $pruned,
            kept: $kept,
            undecided: $undecided,
            samples: $samples,
            notes: $notes,
            truncated: $truncated,
            seconds: microtime(true) - $started,
        );
    }
}
