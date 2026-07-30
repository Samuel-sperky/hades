<?php

namespace App\Services\Sperky;

/**
 * Výsledok prechodu zoznamom objednávok pre jedno časové okno.
 *
 * `stoppedBy` je dôležitejšie než samotné počty: hovorí, či je okno prejdené
 * DO KONCA (`boundary` / `exhausted`), alebo či sa scan zastavil na strope
 * requestov, resp. na rate limite e-shopu. V druhom prípade sú počty ČIASTOČNÉ
 * a nesmú sa prezentovať ako mesačný súhrn (nález N5).
 */
final readonly class OrderScan
{
    /**
     * @param  list<array<string, mixed>>  $orders  objednávky v okne (najnovšie prvé)
     * @param  string  $stoppedBy  boundary|exhausted|max_requests|rate_limited|<kód chyby>
     * @param  ?int  $totalOrders  `total` z API — celý archív, nie okno (nález N7)
     * @param  int  $undated  objednávky s nečitateľným `date_add` (nedali sa zaradiť)
     */
    public function __construct(
        public array $orders,
        public string $stoppedBy,
        public int $requests,
        public int $pages,
        public ?int $totalOrders = null,
        public int $undated = 0,
    ) {}

    /** Je okno prejdené celé, alebo sme skončili na strope/limite? */
    public function isComplete(): bool
    {
        return in_array($this->stoppedBy, ['boundary', 'exhausted'], true);
    }

    public function count(): int
    {
        return count($this->orders);
    }

    /** @return list<int> */
    public function ids(): array
    {
        return array_values(array_map(fn (array $o) => (int) ($o['id'] ?? 0), $this->orders));
    }

    /** @return array<string, mixed> */
    public function meta(): array
    {
        return [
            'stopped_by' => $this->stoppedBy,
            'complete' => $this->isComplete(),
            'requests' => $this->requests,
            'pages' => $this->pages,
            'undated' => $this->undated,
            'total_orders_in_shop' => $this->totalOrders,
        ];
    }
}
