<?php

namespace App\Services\Maintenance\DryRun;

use App\Services\Maintenance\Metric\EmbeddingMetric;
use App\Services\Maintenance\Metric\SimilarityMetric;
use App\Services\Maintenance\Metric\TfidfMetric;
use App\Services\SimilarityService;

/**
 * Orchestrátor dry-runu: pre každý žiadaný job × každú žiadanú metriku spočíta,
 * čo BY sa stalo, a nechá DryRunReporter zapísať report.
 *
 * DVOJITÁ METRIKA je hlavný dôvod existencie tejto triedy: W3 potrebuje na jednom
 * papieri vidieť, že prah 0.92 na TF-IDF a prah 0.92 na embeddingoch sú dve úplne
 * iné rozhodnutia. Nedostupná metrika (chýbajúci stĺpec nodes.embedding) sa
 * v reporte označí a preskočí — beh nikdy nespadne.
 *
 * Nič nemení. Žiadny zápis do DB, žiadne mazanie uzlov, hrán ani aktivácií.
 */
class DryRunRunner
{
    public function __construct(
        private SimilarityService $similarity,
        private DryRunReporter $reporter,
    ) {}

    /** @return array<string, JobDryRun> */
    public function jobs(): array
    {
        return [
            'automerge' => new AutomergeDryRun,
            'prune-coactivation' => new PruneCoactivationDryRun,
            'cleanup-edges' => new CleanupEdgesDryRun,
        ];
    }

    /** @return array<string, SimilarityMetric> */
    public function metrics(): array
    {
        return [
            'tfidf' => new TfidfMetric($this->similarity),
            'embeddings' => new EmbeddingMetric,
        ];
    }

    /**
     * @param  list<string>  $jobKeys  prázdne = všetky
     * @param  list<string>  $metricKeys  prázdne = všetky z configu
     * @return list<DryRunResult>
     */
    public function run(array $jobKeys = [], array $metricKeys = [], ?DryRunOptions $options = null): array
    {
        $options ??= DryRunOptions::fromConfig();

        $allJobs = $this->jobs();
        $allMetrics = $this->metrics();

        $jobKeys = $jobKeys !== [] ? $jobKeys : array_keys($allJobs);
        $metricKeys = $metricKeys !== []
            ? $metricKeys
            : (array) config('maintenance.dry_run.metrics', ['tfidf']);

        $results = [];

        foreach ($jobKeys as $jobKey) {
            $job = $allJobs[$jobKey] ?? null;
            if (! $job) {
                continue;
            }

            // job bez metriky (cleanup-edges) sa počíta raz; metrika ide dovnútra
            // len ako informatívne skóre
            if (! $job->usesMetric()) {
                $info = $allMetrics['tfidf'];
                $results[] = $job->run($info, $options);

                continue;
            }

            foreach ($metricKeys as $metricKey) {
                $metric = $allMetrics[$metricKey] ?? null;
                if (! $metric) {
                    $results[] = DryRunResult::skipped($job->job(), $metricKey, 'neznáma metrika');

                    continue;
                }
                if (! $metric->available()) {
                    $results[] = DryRunResult::skipped($job->job(), $metric->name(), $metric->unavailableReason());

                    continue;
                }

                $results[] = $job->run($metric, $options);
            }
        }

        return $results;
    }

    /**
     * Spustí dry-run a zapíše report.
     *
     * @param  list<string>  $jobKeys
     * @param  list<string>  $metricKeys
     * @return array{results: list<DryRunResult>, files: array{json: string, markdown: string}}
     */
    public function runAndReport(array $jobKeys = [], array $metricKeys = [], ?DryRunOptions $options = null): array
    {
        $results = $this->run($jobKeys, $metricKeys, $options);

        return ['results' => $results, 'files' => $this->reporter->write($results)];
    }
}
