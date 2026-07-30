<?php

namespace App\Services\Maintenance\Rewire;

/**
 * Počítadlá a časy jedného rewire behu. Formát súhrnnej vety je zámerne
 * bit-identický s pôvodným MindRewire, aby sa nočný log nezmenil.
 */
class RewireResult
{
    public int $checked = 0;

    public int $simCreated = 0;

    public int $skillCreated = 0;

    public int $skillPromoted = 0;

    public int $bridged = 0;

    public int $clustered = 0;

    public int $sessioned = 0;

    public int $depted = 0;

    public int $relUses = 0;

    public int $relPartOf = 0;

    public bool $relSkipped = false;

    /** @var array<string, float> algoritmus => sekundy */
    public array $timings = [];

    /** Ktorý strop beh zastavil, alebo null. */
    public ?string $cappedBy = null;

    /** Ktoré algoritmy sa kvôli stropu vôbec nespustili. */
    public array $skippedSteps = [];

    /** Súhrnná veta — rovnaký text ako pôvodný monolit. */
    public function summary(): string
    {
        $relInfo = $this->relSkipped
            ? 'relácie preskočené (stĺpec chýba)'
            : "{$this->relUses} uses + {$this->relPartOf} part_of relácií";

        $line = "Rewire: {$this->checked} uzlov · {$this->simCreated} similarity · "
            ."{$this->skillCreated} nových + {$this->skillPromoted} povýšených skill_mention · "
            ."{$this->bridged} cross-domain · {$this->clustered} klastrových · "
            ."{$this->sessioned} projekt · {$this->depted} oddelenských mostov · {$relInfo}.";

        if ($this->cappedBy !== null) {
            $line .= ' ⚠ Zastavené stropom '.$this->cappedBy
                .($this->skippedSteps ? ' — nespustené: '.implode(', ', $this->skippedSteps) : '').'.';
        }

        return $line;
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'checked' => $this->checked,
            'similarity' => $this->simCreated,
            'skill_mention_new' => $this->skillCreated,
            'skill_mention_promoted' => $this->skillPromoted,
            'cross_domain' => $this->bridged,
            'clusters' => $this->clustered,
            'sessions_to_projects' => $this->sessioned,
            'department_stars' => $this->depted,
            'relations' => ['uses' => $this->relUses, 'part_of' => $this->relPartOf, 'skipped' => $this->relSkipped],
            'timings_ms' => array_map(fn (float $s) => (int) round($s * 1000), $this->timings),
            'capped_by' => $this->cappedBy,
            'skipped_steps' => $this->skippedSteps,
        ];
    }
}
