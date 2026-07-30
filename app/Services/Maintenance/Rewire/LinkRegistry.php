<?php

namespace App\Services\Maintenance\Rewire;

use App\Models\Edge;
use App\Models\Node;
use App\Services\MindService;

/**
 * Snapshot existujúcich hrán ako kanonické 'source:target' kľúče + vytváranie
 * chýbajúcich slabých similarity synapsií.
 *
 * Prevzaté 1:1 z MindRewire::linkedPairs() a MindRewire::linkIfNew(). Existuje
 * ako samostatná trieda preto, že ju používajú štyri algoritmy (A5, A6, A7, A8)
 * a každý si ju predtým staval sám — dva z nich navyše s vlastnou kópiou tej istej
 * slučky nad Edge::all().
 *
 * Idempotencia: linkIfNew() nikdy nesiahne na existujúcu hranu (žiadny drift
 * kind/váhy) a novú si okamžite zapíše do snapshotu, aby ju ďalší člen hviezdy
 * nezaložil dvakrát.
 */
class LinkRegistry
{
    /** @var array<string, true> */
    private array $linked = [];

    public function __construct(private readonly MindService $mind) {}

    /** Načíta snapshot existujúcich hrán z DB. */
    public function load(): void
    {
        $this->linked = [];
        foreach (Edge::query()->get(['source_id', 'target_id']) as $edge) {
            $this->linked[$edge->source_id.':'.$edge->target_id] = true;
        }
    }

    public function has(int $a, int $b): bool
    {
        [$s, $t] = $a < $b ? [$a, $b] : [$b, $a];

        return isset($this->linked[$s.':'.$t]);
    }

    public function remember(int $a, int $b): void
    {
        [$s, $t] = $a < $b ? [$a, $b] : [$b, $a];
        $this->linked[$s.':'.$t] = true;
    }

    /**
     * Spojí dvojicu slabou similarity synapsiou len ak ešte hranu nemá.
     * Vracia 1 pri vytvorení, inak 0 — rovnaká sémantika ako MindRewire::linkIfNew().
     */
    public function linkIfNew(Node $a, Node $b, string $kind = 'similarity', float $weight = 0.5): int
    {
        if ($a->id === $b->id) {
            return 0;
        }
        if ($this->has($a->id, $b->id)) {
            return 0;
        }

        $this->mind->connect($a, $b, $kind, true, $weight);
        $this->remember($a->id, $b->id);

        return 1;
    }
}
