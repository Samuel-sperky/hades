<?php

namespace App\Services\Maintenance\DryRun;

/**
 * Nastavenia jedného dry-run behu. Defaulty prichádzajú z config/maintenance.php,
 * príkaz ich smie prebiť (--sample, --max-pairs).
 */
class DryRunOptions
{
    public function __construct(
        /** Koľko konkrétnych položiek s labelmi sa dostane do reportu. 0 = všetky. */
        public readonly int $sampleSize = 200,
        /** Strop porovnaných párov (poistka proti O(n²) výbuchu). 0 = bez stropu. */
        public readonly int $maxPairs = 2_000_000,
    ) {}

    public static function fromConfig(): self
    {
        return new self(
            sampleSize: (int) config('maintenance.dry_run.sample_size', 200),
            maxPairs: (int) config('maintenance.dry_run.max_pairs', 2_000_000),
        );
    }

    public function withSampleSize(int $size): self
    {
        return new self($size, $this->maxPairs);
    }

    public function withMaxPairs(int $pairs): self
    {
        return new self($this->sampleSize, $pairs);
    }

    public function wantsSample(int $collected): bool
    {
        return $this->sampleSize <= 0 || $collected < $this->sampleSize;
    }

    public function pairLimitReached(int $compared): bool
    {
        return $this->maxPairs > 0 && $compared >= $this->maxPairs;
    }
}
