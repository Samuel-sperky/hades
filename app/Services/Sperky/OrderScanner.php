<?php

namespace App\Services\Sperky;

use App\Services\Sperky\Exceptions\SperkyApiException;
use Carbon\CarbonInterface;
use Illuminate\Support\Carbon;
use Throwable;

/**
 * Prechod zoznamom objednávok pre jedno časové okno.
 *
 * Prečo to nie je jednoduchý dopyt: filtrovanie podľa dátumu v API NEEXISTUJE
 * (nález N3) — neznámy parameter (`date_from`, `from`, `since`) sa tichým
 * spôsobom zahodí, takže „objednávky za júl" sa vyžiadať nedá a filtrovať sa
 * musí na našej strane.
 *
 * Zachraňuje nás nález N4: objednávky sú zoradené podľa `id` ZOSTUPNE a
 * `date_add` klesá spolu s `id`. Preto sa číta od `page=1` a scan sa ZASTAVÍ
 * pri prvej objednávke staršej než okno. Mesiac tak stojí desiatky requestov,
 * nie 17 640 — archív má 1,76 M objednávok a celý sa neťahá nikdy.
 *
 * Rate limit e-shopu je NEZNÁMY, preto: pauza medzi stránkami, tvrdý strop
 * requestov a pri `rate_limited` elegantné ukončenie s tým, čo sa stihlo
 * (nález N5) — žiadne opakované búchanie na produkciu.
 */
class OrderScanner
{
    public function __construct(private readonly SperkyClient $client) {}

    /**
     * Objednávky s `date_add` v intervale [$from, $until).
     *
     * @param  array{per_page?: int, max_requests?: int, sleep_ms?: int}  $options
     */
    public function scan(CarbonInterface $from, CarbonInterface $until, array $options = []): OrderScan
    {
        $perPage = max(1, (int) ($options['per_page'] ?? 100));
        $maxRequests = max(1, (int) ($options['max_requests'] ?? 80));
        $sleepMs = max(0, (int) ($options['sleep_ms'] ?? 250));

        $collected = [];
        $requests = 0;
        $pages = 0;
        $undated = 0;
        $total = null;
        $stoppedBy = 'exhausted';

        for ($page = 1; $page <= $maxRequests; $page++) {
            try {
                $response = $this->client->orders($page, $perPage);
            } catch (SperkyApiException $e) {
                // N5: pri rate limite (aj pri inom infrastruktúrnom zlyhaní) sa
                // beh ukončí a zapíše sa, čo sa stihlo. Bez výnimky nahor.
                $stoppedBy = $e->errorCode;
                break;
            }

            $requests++;
            $pages++;
            $total ??= $response['total'];
            $rows = $response['orders'];

            if ($rows === []) {
                $stoppedBy = 'exhausted';
                break;
            }

            $reachedBoundary = false;

            foreach ($rows as $row) {
                $date = $this->parseDate($row['date_add'] ?? null);

                if ($date === null) {
                    $undated++;

                    continue;
                }

                // novšie než okno → ešte sme doň nedošli (zoradenie je DESC)
                if ($date->greaterThanOrEqualTo($until)) {
                    continue;
                }

                // prvá objednávka staršia než okno = koniec scanu (nález N4)
                if ($date->lessThan($from)) {
                    $reachedBoundary = true;
                    break;
                }

                $collected[] = $row;
            }

            if ($reachedBoundary) {
                $stoppedBy = 'boundary';
                break;
            }

            // posledná strana archívu
            if (count($rows) < $perPage) {
                $stoppedBy = 'exhausted';
                break;
            }

            if ($page === $maxRequests) {
                $stoppedBy = 'max_requests';
                break;
            }

            $this->sleep($sleepMs);
        }

        return new OrderScan(
            orders: $collected,
            stoppedBy: $stoppedBy,
            requests: $requests,
            pages: $pages,
            totalOrders: $total,
            undated: $undated,
        );
    }

    /**
     * Detaily pre VZORKU objednávok. Krajina (`country_iso`) je len v detaile,
     * takže rozpad podľa krajín stojí jeden request na objednávku — pre mesiac
     * s tisíckami objednávok je preto vzorka jediná prípustná cesta.
     *
     * @param  list<int>  $ids
     * @return array{details: list<array<string, mixed>>, requests: int, stopped_by: ?string}
     */
    public function details(array $ids, int $limit, int $sleepMs = 250): array
    {
        $details = [];
        $requests = 0;
        $stoppedBy = null;

        foreach (array_slice($ids, 0, max(0, $limit)) as $id) {
            try {
                $detail = $this->client->order((int) $id);
            } catch (SperkyApiException $e) {
                $stoppedBy = $e->errorCode;
                break;
            } catch (Throwable) {
                $stoppedBy = 'unexpected';
                break;
            }

            $requests++;

            if ($detail !== null) {
                $details[] = $detail;
            }

            $this->sleep($sleepMs);
        }

        return ['details' => $details, 'requests' => $requests, 'stopped_by' => $stoppedBy];
    }

    /** `date_add` je naivný čas e-shopu — porovnáva sa v časovej zóne appky. */
    private function parseDate(mixed $raw): ?CarbonInterface
    {
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        try {
            return Carbon::parse($raw);
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
