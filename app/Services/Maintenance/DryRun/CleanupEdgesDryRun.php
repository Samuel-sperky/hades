<?php

namespace App\Services\Maintenance\DryRun;

use App\Models\Edge;
use App\Models\Node;
use App\Services\Maintenance\Metric\SimilarityMetric;

/**
 * Dry-run pre mind:cleanup-edges — ktoré zabudnuté auto synapsie by sa ZMAZALI.
 *
 * Rozhodovanie je prevzaté 1:1 z App\Console\Commands\MindCleanupEdges: auto = true,
 * kind ∈ {similarity, co_activation}, weight < max_weight, last_activated_at starší
 * ako older_than_days. Metrika podobnosti sa NEPOUŽÍVA — rozhoduje váha a vek,
 * takže tento job je na prechod na embeddingy imúnny. V reporte je aj tak, pretože
 * je jedným z troch deštruktívnych jobov a jeho dopad treba schváliť.
 *
 * Report navyše dopĺňa skóre koncov (keď je metrika dostupná) — nie ako rozhodovacie
 * kritérium, ale ako informáciu, či cleanup nemaže sémanticky hodnotné hrany.
 */
class CleanupEdgesDryRun implements JobDryRun
{
    public function job(): string
    {
        return 'cleanup-edges';
    }

    public function command(): string
    {
        return 'mind:cleanup-edges';
    }

    public function usesMetric(): bool
    {
        return false;
    }

    public function run(?SimilarityMetric $metric, DryRunOptions $options): DryRunResult
    {
        $started = microtime(true);

        $maxWeight = (float) config('maintenance.thresholds.cleanup_edges.max_weight', 1.0);
        $days = (int) config('maintenance.thresholds.cleanup_edges.older_than_days', 90);
        $cutoff = now()->subDays($days);

        $candidates = Edge::query()
            ->where('auto', true)
            ->whereIn('kind', ['similarity', 'co_activation'])
            ->where('weight', '<', $maxWeight);

        $doomed = (clone $candidates)
            ->where('last_activated_at', '<', $cutoff)
            ->orderBy('id')
            ->get();

        $ids = $doomed->flatMap(fn (Edge $e) => [$e->source_id, $e->target_id])->unique()->all();
        $byId = Node::query()->whereIn('id', $ids)->get()->keyBy('id');

        // skóre je len informatívne — načítaj korpus len keď je metrika k dispozícii
        if ($metric !== null && $metric->available() && $doomed->isNotEmpty()) {
            $metric->warm(Node::query()->get());
        }

        $samples = [];
        foreach ($doomed as $edge) {
            if (! $options->wantsSample(count($samples))) {
                break;
            }
            $source = $byId->get($edge->source_id);
            $target = $byId->get($edge->target_id);
            $score = ($metric !== null && $metric->available() && $source && $target)
                ? $metric->score($source, $target)
                : null;

            $samples[] = [
                'edge_id' => $edge->id,
                'kind' => (string) $edge->kind,
                'weight' => (float) $edge->weight,
                'last_activated_at' => $edge->last_activated_at?->toIso8601String(),
                'source_id' => $edge->source_id,
                'source_label' => (string) ($source->label ?? '—'),
                'target_id' => $edge->target_id,
                'target_label' => (string) ($target->label ?? '—'),
                // informatívne, NIE rozhodovacie kritérium
                'score_info' => $score === null ? null : round($score, 4),
            ];
        }

        $total = (int) (clone $candidates)->count();

        return new DryRunResult(
            job: $this->job(),
            metric: $metric !== null && $metric->available() ? $metric->name().' (len informatívne)' : 'n/a',
            threshold: $maxWeight,
            candidates: $total,
            compared: $total,
            affected: $doomed->count(),
            kept: max(0, $total - $doomed->count()),
            undecided: 0,
            samples: $samples,
            notes: [
                'Metrika podobnosti sa NEPOUŽÍVA — rozhoduje váha < '.$maxWeight." a vek > {$days} dní. Prechod na embeddingy tento job nemení.",
                'score_info v ukážkach je len kontrola, či cleanup nemaže sémanticky hodnotné hrany.',
                'Ručné (manual) a skill_mention synapsie sa nikdy nemažú, rovnako ani hrany s váhou >= '.$maxWeight.'.',
                'Cutoff tohto reportu: '.$cutoff->toIso8601String(),
            ],
            seconds: microtime(true) - $started,
        );
    }
}
