<?php

namespace App\Services\Sperky;

/**
 * Výsledok čítania jedného časového okna objednávok.
 *
 * Nahradilo `OrderScan` z v1. Rozdiel nie je kozmetický:
 *
 *   - `orders` je PRESNÝ počet z `total` filtrovanej odpovede (jeden dopyt).
 *     Starý `OrderScan` vedel len to, koľko riadkov sa stihlo prejsť, a musel to
 *     priznávať príznakom `stoppedBy` / `isComplete()` — „dolná hranica" zmizla.
 *   - `revenue` je obrat PO MENÁCH, nikdy jedno číslo naprieč menami
 *     (rozhodnutie 1). Prepočet na EUR je zakázaný.
 *   - `complete` sa vzťahuje výhradne na riadky prečítané pre obrat a denný
 *     rozpad. Počet objednávok je presný vždy, aj keď je `complete` false.
 */
final readonly class OrderWindow
{
    /**
     * @param  string  $from  `YYYY-MM-DD` vrátane
     * @param  string  $to  `YYYY-MM-DD` vrátane
     * @param  ?int  $orders  presný počet z API; `null` = e-shop neodpovedal
     * @param  list<array{date: string, orders: int}>  $byDay
     * @param  list<array{currency: string, total: float, orders: int}>  $revenue
     * @param  int  $ordersRead  koľko riadkov sa reálne prečítalo (základ obratu)
     * @param  int  $withoutCurrency  riadky bez meny — spočítané, NIKDY nesčítané
     * @param  bool  $complete  prečítali sa všetky riadky okna?
     * @param  ?string  $error  strojový kód chyby e-shopu, alebo `null`
     */
    public function __construct(
        public string $from,
        public string $to,
        public ?int $orders,
        public array $byDay = [],
        public array $revenue = [],
        public int $ordersRead = 0,
        public int $withoutCurrency = 0,
        public bool $complete = false,
        public int $requests = 0,
        public ?string $error = null,
    ) {}

    /** Máme aspoň počet objednávok? Obrazovka podľa toho rozhodne, čo ukáže. */
    public function available(): bool
    {
        return $this->orders !== null;
    }

    /**
     * Meta k obratu. `complete: false` znamená, že sumy pokrývajú len časť okna —
     * sú to stále súčty skutočných objednávok v jednej mene, len nie celého okna.
     *
     * @return array{complete: bool, orders_covered: int, orders_in_window: ?int, without_currency: int, requests: int}
     */
    public function revenueMeta(): array
    {
        return [
            'complete' => $this->complete,
            'orders_covered' => $this->ordersRead,
            'orders_in_window' => $this->orders,
            'without_currency' => $this->withoutCurrency,
            'requests' => $this->requests,
        ];
    }

    /** @return array{from: string, to: string, available: bool, error: ?string, requests: int} */
    public function meta(): array
    {
        return [
            'from' => $this->from,
            'to' => $this->to,
            'available' => $this->available(),
            'error' => $this->error,
            'requests' => $this->requests,
        ];
    }
}
