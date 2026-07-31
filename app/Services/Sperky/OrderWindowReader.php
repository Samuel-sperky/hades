<?php

namespace App\Services\Sperky;

use App\Services\Sperky\Exceptions\SperkyApiException;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Čítanie objednávok za časové okno cez FILTRE (rozhodnutie 2).
 *
 * Toto nahradilo `OrderScanner`. Ten prechádzal zoznam od `page=1` a zastavil sa
 * pri prvej objednávke staršej než okno, pretože v1 tvrdila, že dátumový filter
 * neexistuje (nález N3). Filter existuje, takže:
 *
 *   - POČET je presný po JEDNOM dopyte (`date_from`+`date_to`, `total` z odpovede).
 *     Zmizol strop požiadaviek, príznak „dolná hranica" aj riziko rate limitu.
 *   - ROZPAD PODĽA KRAJÍN je presný, jeden dopyt na krajinu (rozhodnutie 3) —
 *     už žiadna vzorka detailov a žiadne vety o odhade.
 *   - OBRAT sa musí sčítať z riadkov, lebo API súčet neposkytuje. Riadky sa preto
 *     stránkujú, ale hustou stránkou (každý riadok je v okne) a so stropom.
 *     Sumy sa držia ODDELENE PO MENÁCH — súčet naprieč menami nevznikne nikdy
 *     a prepočet na EUR je zakázaný (rozhodnutie 1).
 *
 * Nedostupný e-shop NIE JE výnimka: vráti sa okno s `error` a bez čísel, aby
 * obrazovka vedela povedať „e-shop neodpovedá" a nespadla. Doménová chyba
 * (napr. suma bez krajiny, rozhodnutie 8) naopak prebubláva — je to chyba
 * požiadavky, nie stav e-shopu.
 */
class OrderWindowReader
{
    public function __construct(private readonly SperkyClient $client) {}

    /**
     * PRESNÝ počet objednávok v okne. Jeden dopyt.
     *
     * @return ?int `null` = e-shop neodpovedal (nie nula!)
     */
    public function count(string $from, string $to, ?string $country = null): ?int
    {
        try {
            return $this->client->ordersTotal(OrderFilters::window($from, $to, $country));
        } catch (SperkyApiException) {
            return null;
        }
    }

    /**
     * Celé okno: presný počet + denný rozpad + obrat po menách.
     *
     * @param  array{per_page?: int, max_requests?: int, sleep_ms?: int, revenue?: bool}  $options
     */
    public function read(string $from, string $to, array $options = []): OrderWindow
    {
        $filters = OrderFilters::window($from, $to);
        $perPage = max(1, min(100, (int) ($options['per_page'] ?? 100)));
        $maxRequests = max(1, (int) ($options['max_requests'] ?? 25));
        $sleepMs = max(0, (int) ($options['sleep_ms'] ?? 0));

        // Len počet: jeden dopyt, presné `total`, žiadne riadky.
        if (($options['revenue'] ?? true) === false) {
            $only = $this->count($from, $to);

            return new OrderWindow(
                from: $filters->dateFrom ?? $from,
                to: $filters->dateTo ?? $to,
                orders: $only,
                complete: $only !== null,
                requests: 1,
                error: $only === null ? 'unavailable' : null,
            );
        }

        $total = null;
        $requests = 0;
        $error = null;
        $complete = false;

        /** @var array<int, array<string, mixed>> $rows objednávky podľa id (deduplikované) */
        $rows = [];

        for ($page = 1; $page <= $maxRequests; $page++) {
            try {
                $response = $this->client->orders($page, $perPage, $filters);
            } catch (SperkyApiException $e) {
                $error = $e->errorCode;
                break;
            } catch (Throwable) {
                $error = 'unexpected';
                break;
            }

            $requests++;
            $total ??= $response['total'];
            $batch = $response['orders'];

            if ($batch === []) {
                $complete = true;
                break;
            }

            $before = count($rows);
            foreach ($batch as $row) {
                $id = (int) ($row['id'] ?? 0);
                if ($id > 0) {
                    // Poistka: keby `page` pri filtroch nefungoval, opakovaná
                    // strana by inak obrat ZDVOJILA. Deduplikácia podľa id to
                    // vylúči a nulový prírastok cyklus ukončí.
                    $rows[$id] = $row;
                }
            }

            if (count($rows) === $before) {
                $complete = $total !== null && count($rows) >= $total;
                break;
            }

            if (count($batch) < $perPage || ($total !== null && count($rows) >= $total)) {
                $complete = true;
                break;
            }

            $this->sleep($sleepMs);
        }

        $orders = array_values($rows);
        $complete = $complete && $error === null;

        return new OrderWindow(
            from: $filters->dateFrom ?? $from,
            to: $filters->dateTo ?? $to,
            orders: $total,
            byDay: $complete ? $this->byDay($orders, $from, $to) : [],
            revenue: $this->revenueByCurrency($orders),
            ordersRead: count($orders),
            withoutCurrency: $this->withoutCurrency($orders),
            complete: $complete,
            requests: $requests,
            error: $error,
        );
    }

    /**
     * PRESNÝ rozpad podľa krajín — jeden dopyt na krajinu (rozhodnutie 3).
     * Overené počty bez dátumového okna: SK 345 523 · HU 429 015 · CZ 423 427.
     *
     * `other` je zvyšok okna (počet okna mínus vypísané krajiny). POČTY sa
     * sčítavať smú — na rozdiel od súm v rôznych menách.
     *
     * @param  list<string>  $isoCodes
     * @return array{countries: list<array{country_iso: string, orders: ?int}>, other: ?int, error: ?string}
     */
    public function countries(string $from, string $to, array $isoCodes, ?int $windowTotal = null): array
    {
        $countries = [];
        $known = 0;
        $error = null;

        foreach ($isoCodes as $iso) {
            $iso = strtoupper(trim((string) $iso));
            if (preg_match('/^[A-Z]{2}$/', $iso) !== 1) {
                continue;
            }

            try {
                $count = $this->client->ordersTotal(OrderFilters::window($from, $to, $iso));
            } catch (SperkyApiException $e) {
                $error = $e->errorCode;
                break;
            }

            $countries[] = ['country_iso' => $iso, 'orders' => $count];
            $known += (int) $count;
        }

        usort($countries, fn (array $a, array $b) => ($b['orders'] ?? 0) <=> ($a['orders'] ?? 0));

        return [
            'countries' => $countries,
            'other' => $windowTotal === null || $error !== null ? null : max(0, $windowTotal - $known),
            'error' => $error,
        ];
    }

    /**
     * Obrat PO MENÁCH. Každá mena má vlastný riadok a vlastný počet objednávok —
     * jedno číslo naprieč menami tu nevznikne ani omylom, pretože sa nikde
     * nesčítavajú dva rôzne kľúče (rozhodnutie 1).
     *
     * Objednávka bez meny sa do žiadnej sumy NEZARADÍ. Pripočítať ju „niekam"
     * by znamenalo tichý fallback na nesprávnu menu, a ten používateľ zamietol.
     *
     * @param  list<array<string, mixed>>  $orders
     * @return list<array{currency: string, total: float, orders: int}>
     */
    public function revenueByCurrency(array $orders): array
    {
        $buckets = [];

        foreach ($orders as $order) {
            $currency = $order['currency'] ?? null;
            $paid = $order['total_paid'] ?? null;

            if (! is_string($currency) || $currency === '' || ! is_numeric($paid)) {
                continue;
            }

            $buckets[$currency] ??= ['currency' => $currency, 'total' => 0.0, 'orders' => 0];
            $buckets[$currency]['total'] += (float) $paid;
            $buckets[$currency]['orders']++;
        }

        $rows = array_map(
            fn (array $row) => [
                'currency' => $row['currency'],
                'total' => round((float) $row['total'], 2),
                'orders' => (int) $row['orders'],
            ],
            array_values($buckets),
        );

        usort(
            $rows,
            fn (array $a, array $b) => [$b['orders'], $a['currency']] <=> [$a['orders'], $b['currency']],
        );

        return $rows;
    }

    /**
     * Denné POČTY. Počet je jediné číslo, ktoré sa dá naprieč objednávkami
     * bezpečne sčítať — suma nie.
     *
     * @param  list<array<string, mixed>>  $orders
     * @return list<array{date: string, orders: int}>
     */
    public function byDay(array $orders, string $from, string $to): array
    {
        $buckets = [];

        try {
            $day = Carbon::parse($from)->startOfDay();
            $end = Carbon::parse($to)->startOfDay();
        } catch (Throwable) {
            return [];
        }

        // Strop 400 dní, aby zlý vstup nevyrobil nekonečný cyklus.
        for ($guard = 0; $day->lessThanOrEqualTo($end) && $guard < 400; $guard++) {
            $buckets[$day->toDateString()] = 0;
            $day = $day->copy()->addDay();
        }

        foreach ($orders as $order) {
            $date = $this->dateOf($order);
            if ($date !== null && array_key_exists($date, $buckets)) {
                $buckets[$date]++;
            }
        }

        $rows = [];
        foreach ($buckets as $date => $count) {
            $rows[] = ['date' => (string) $date, 'orders' => (int) $count];
        }

        return $rows;
    }

    /** @param  list<array<string, mixed>>  $orders */
    public function countForDay(array $orders, string $date): int
    {
        $count = 0;
        foreach ($orders as $order) {
            if ($this->dateOf($order) === $date) {
                $count++;
            }
        }

        return $count;
    }

    /** @param  list<array<string, mixed>>  $orders */
    private function withoutCurrency(array $orders): int
    {
        $n = 0;
        foreach ($orders as $order) {
            $currency = $order['currency'] ?? null;
            if (! is_string($currency) || $currency === '') {
                $n++;
            }
        }

        return $n;
    }

    /** @param  array<string, mixed>  $order */
    private function dateOf(array $order): ?string
    {
        $raw = $order['date_add'] ?? null;
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->toDateString();
        } catch (Throwable) {
            return null;
        }
    }

    private function sleep(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }
}
