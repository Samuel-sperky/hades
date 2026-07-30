<?php

namespace App\Services\Maintenance\DryRun;

use App\Services\Maintenance\Metric\SimilarityMetric;

/**
 * Dry-run jedného deštruktívneho jobu: spočíta a vymenuje, čo BY sa stalo.
 *
 * ŽELEZNÉ PRAVIDLO: implementácia nesmie zapísať ani zmazať jediný riadok.
 * Používa výhradne čítacie dotazy — žiadne delete(), save(), mergeNodes().
 */
interface JobDryRun
{
    /** Kľúč jobu do reportu, napr. 'automerge'. */
    public function job(): string;

    /** Artisan príkaz, ktorý by tento dry-run simuloval. */
    public function command(): string;

    /** Používa job metriku podobnosti? cleanup-edges nie (rozhoduje váha + vek). */
    public function usesMetric(): bool;

    public function run(?SimilarityMetric $metric, DryRunOptions $options): DryRunResult;
}
