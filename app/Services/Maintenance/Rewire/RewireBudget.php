<?php

namespace App\Services\Maintenance\Rewire;

/**
 * Strop času a veľkosti pre rewire.
 *
 * Rewire je O(n²) a beží v 15-minútovom okne pred mind:decay (04:05 → 04:20).
 * Pri 666 uzloch je to ~221 000 porovnaných párov. Bez stropu by rast siete
 * jedného dňa spôsobil, že rewire pretečie do decay-u a oba joby budú súťažiť
 * o rovnaké hrany.
 *
 * Stropy sú POISTKA, nie zmena chovania: defaulty v config/maintenance.php sú
 * nastavené s niekoľkonásobnou rezervou nad dnešnou veľkosťou siete, takže sa
 * dnes nedosiahnu a výsledok rewire je identický s pôvodným monolitom.
 *
 * Keď strop padne, orchestrátor prestane spúšťať ďalšie jednotky práce a nahlási
 * to. Už zapísané hrany zostávajú — rewire je idempotentný, takže ďalší beh
 * pokračuje tam, kde tento skončil.
 */
class RewireBudget
{
    private float $startedAt;

    private int $pairs = 0;

    private int $nodes = 0;

    private ?string $exhaustedBy = null;

    public function __construct(
        private readonly int $maxSeconds = 780,
        private readonly int $maxPairs = 1_000_000,
        private readonly int $maxNodes = 5_000,
    ) {
        $this->startedAt = microtime(true);
    }

    public static function fromConfig(): self
    {
        return new self(
            maxSeconds: (int) config('maintenance.rewire.max_seconds', 780),
            maxPairs: (int) config('maintenance.rewire.max_pairs', 1_000_000),
            maxNodes: (int) config('maintenance.rewire.max_nodes', 5_000),
        );
    }

    /** Strop bez limitov — používajú testy ekvivalencie. */
    public static function unlimited(): self
    {
        return new self(0, 0, 0);
    }

    public function addPairs(int $count): void
    {
        $this->pairs += max(0, $count);
    }

    public function addNode(): void
    {
        $this->nodes++;
    }

    public function elapsed(): float
    {
        return microtime(true) - $this->startedAt;
    }

    public function pairs(): int
    {
        return $this->pairs;
    }

    public function nodes(): int
    {
        return $this->nodes;
    }

    /** Zostáva rozpočet na ďalšiu jednotku práce? */
    public function ok(): bool
    {
        if ($this->maxSeconds > 0 && $this->elapsed() >= $this->maxSeconds) {
            $this->exhaustedBy ??= 'max_seconds';

            return false;
        }
        if ($this->maxPairs > 0 && $this->pairs >= $this->maxPairs) {
            $this->exhaustedBy ??= 'max_pairs';

            return false;
        }
        if ($this->maxNodes > 0 && $this->nodes >= $this->maxNodes) {
            $this->exhaustedBy ??= 'max_nodes';

            return false;
        }

        return true;
    }

    public function exhausted(): bool
    {
        return ! $this->ok();
    }

    /** Ktorý strop padol, alebo null keď žiadny. */
    public function exhaustedBy(): ?string
    {
        $this->ok();

        return $this->exhaustedBy;
    }
}
