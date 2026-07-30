<?php

namespace App\Services\Maintenance\DryRun;

/**
 * Výsledok jedného dry-run behu (job × metrika). Iba dáta — zápis robí
 * DryRunReporter, aby sa report dal rovnako dobre vypísať do konzoly aj do súboru.
 */
class DryRunResult
{
    /**
     * @param  string  $job  'automerge' | 'prune-coactivation' | 'cleanup-edges'
     * @param  string  $metric  kľúč metriky, alebo 'n/a' keď job metriku nepoužíva
     * @param  float  $threshold  prah, proti ktorému sa rozhodovalo
     * @param  int  $candidates  koľko kandidátov job vôbec zvažoval
     * @param  int  $compared  koľko párov/hrán sa reálne vyhodnotilo
     * @param  int  $affected  koľko by sa ich zlúčilo/zmazalo
     * @param  int  $kept  koľko by ostalo
     * @param  int  $undecided  koľko párov metrika nedokázala ohodnotiť (score = null)
     * @param  list<array<string, mixed>>  $samples  konkrétne položky s labelmi
     * @param  list<string>  $notes  varovania a obmedzenia interpretácie
     */
    public function __construct(
        public readonly string $job,
        public readonly string $metric,
        public readonly float $threshold,
        public readonly int $candidates,
        public readonly int $compared,
        public readonly int $affected,
        public readonly int $kept,
        public readonly int $undecided,
        public readonly array $samples,
        public readonly array $notes = [],
        public readonly bool $truncated = false,
        public readonly bool $skipped = false,
        public readonly string $skippedReason = '',
        public readonly float $seconds = 0.0,
    ) {}

    public static function skipped(string $job, string $metric, string $reason): self
    {
        return new self(
            job: $job,
            metric: $metric,
            threshold: 0.0,
            candidates: 0,
            compared: 0,
            affected: 0,
            kept: 0,
            undecided: 0,
            samples: [],
            notes: [],
            truncated: false,
            skipped: true,
            skippedReason: $reason,
        );
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'job' => $this->job,
            'metric' => $this->metric,
            'threshold' => $this->threshold,
            'skipped' => $this->skipped,
            'skipped_reason' => $this->skippedReason,
            'candidates' => $this->candidates,
            'compared' => $this->compared,
            'affected' => $this->affected,
            'kept' => $this->kept,
            'undecided' => $this->undecided,
            'truncated' => $this->truncated,
            'seconds' => round($this->seconds, 3),
            'notes' => $this->notes,
            'samples' => $this->samples,
        ];
    }
}
