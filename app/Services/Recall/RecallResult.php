<?php

namespace App\Services\Recall;

use App\Models\Node;
use Illuminate\Support\Collection;

/**
 * ZAMKNUTÉ ROZHRANIE (#13) — `RecallResult{primaries, neighbours, total}`.
 *
 * `primaries`  = uzly, ktoré dopyt trafil priamo (lexikálne, prípadne s vektorovým
 *                druhým skóre).
 * `neighbours` = graph-walk hĺbky 1 — priami susedia primárov, pripojení ZA ne
 *                s polovičnou relevanciou.
 * `total`      = primaries + neighbours (počet, nie súčet skóre).
 *
 * @phpstan-type NodeCollection Collection<int, Node>
 */
final readonly class RecallResult
{
    /**
     * @param  Collection<int, Node>  $primaries
     * @param  Collection<int, Node>  $neighbours
     */
    public function __construct(
        public Collection $primaries,
        public Collection $neighbours,
        public int $total,
    ) {}

    /** @return Collection<int, Node> primaries + neighbours v poradí vybavovania */
    public function all(): Collection
    {
        return $this->primaries->concat($this->neighbours)->values();
    }

    /** @return list<int> */
    public function ids(): array
    {
        return $this->all()->pluck('id')->all();
    }

    public static function empty(): self
    {
        return new self(collect(), collect(), 0);
    }
}
