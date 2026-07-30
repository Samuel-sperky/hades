<?php

namespace Tests\Unit\Sperky;

use App\Services\Sperky\OrderScanner;
use App\Services\Sperky\SperkyClient;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Prechod zoznamom objednávok. Testuje presne to, čo robí integráciu
 * realizovateľnou: zastavenie pri prvej objednávke staršej než okno (nález N4).
 *
 * Bez toho by mesačný agregát znamenal 17 640 requestov na archív s 1,76 M
 * objednávkami — filtrovanie podľa dátumu v API neexistuje (nález N3).
 */
class OrderScannerTest extends TestCase
{
    private const BASE = 'https://shop.test';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'cache.default' => 'array',
            'sperky.base_url' => self::BASE,
            'sperky.api_key' => 'fake-key-orders-read-DO-NOT-USE',
            'sperky.attempts' => 1,
            'sperky.backoff_ms' => 0,
            'sperky.per_page.max' => 100,
            'sperky.per_page.default' => 20,
            'sperky.cache.ttl.list' => 300,
            'sperky.cache.ttl.detail' => 900,
            'sperky.currencies' => ['SK' => 'EUR', 'CZ' => 'CZK', 'HU' => 'HUF'],
        ]);
    }

    private function scanner(): OrderScanner
    {
        return new OrderScanner(new SperkyClient);
    }

    /** @param  list<array{int, string}>  $rows  [id, date_add] */
    private function page(array $rows, int $perPage, int $total = 1763711): array
    {
        return [
            'result' => [
                'orders' => array_map(
                    fn (array $row) => ['id' => $row[0], 'date_add' => $row[1], 'total_paid' => '14.85'],
                    $rows,
                ),
                'page' => 1,
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    private function pageParam(string $url): int
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        return (int) ($query['page'] ?? 1);
    }

    public function test_scan_sa_zastavi_pri_prvej_objednavke_starsej_nez_okno(): void
    {
        // Zoradenie je podľa id ZOSTUPNE a date_add klesá spolu s ním (nález N4).
        Http::fake([
            self::BASE.'/api/order*' => Http::sequence()
                ->push($this->page([[100, '2026-08-02 10:00:00'], [99, '2026-08-01 09:00:00'], [98, '2026-07-31 23:00:00']], 3))
                ->push($this->page([[97, '2026-07-30 10:00:00'], [96, '2026-07-15 10:00:00'], [95, '2026-06-30 10:00:00']], 3))
                ->push($this->page([[94, '2026-06-29 10:00:00']], 3)),
        ]);

        $scan = $this->scanner()->scan(
            Carbon::parse('2026-07-01 00:00:00'),
            Carbon::parse('2026-08-01 00:00:00'),
            ['per_page' => 3, 'max_requests' => 50, 'sleep_ms' => 0],
        );

        $this->assertSame([98, 97, 96], $scan->ids(), 'augustové objednávky sa preskočia, júnová okno ukončí');
        $this->assertSame('boundary', $scan->stoppedBy);
        $this->assertTrue($scan->isComplete());
        // Tretia strana sa už nesmie stiahnuť — to je celá pointa nálezu N4.
        $this->assertSame(2, $scan->requests);
        Http::assertSentCount(2);
        $this->assertSame(1763711, $scan->totalOrders);
    }

    public function test_strop_requestov_scan_ukonci_a_oznaci_ako_neuplny(): void
    {
        // Každá strana je plná a celá v okne → scan by inak išiel do nekonečna.
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            $page = $this->pageParam($request->url());
            $base = 1000 - ($page - 1) * 3;

            return Http::response($this->page([
                [$base, '2026-07-20 10:00:00'],
                [$base - 1, '2026-07-20 09:00:00'],
                [$base - 2, '2026-07-20 08:00:00'],
            ], 3));
        }]);

        $scan = $this->scanner()->scan(
            Carbon::parse('2026-07-01 00:00:00'),
            Carbon::parse('2026-08-01 00:00:00'),
            ['per_page' => 3, 'max_requests' => 3, 'sleep_ms' => 0],
        );

        $this->assertSame('max_requests', $scan->stoppedBy);
        $this->assertFalse($scan->isComplete(), 'čiastočný scan sa nesmie hlásiť ako hotový mesiac');
        $this->assertSame(9, $scan->count());
        Http::assertSentCount(3);
    }

    public function test_rate_limited_scan_ukonci_elegantne_a_zapise_co_stihol(): void
    {
        // N5: žiadna výnimka nahor, žiadne opakované búchanie na produkciu.
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            return $this->pageParam($request->url()) === 1
                ? Http::response($this->page([[100, '2026-07-30 10:00:00'], [99, '2026-07-29 10:00:00']], 2))
                : Http::response(['error' => 'rate_limited'], 200);
        }]);

        $scan = $this->scanner()->scan(
            Carbon::parse('2026-07-01 00:00:00'),
            Carbon::parse('2026-08-01 00:00:00'),
            ['per_page' => 2, 'max_requests' => 10, 'sleep_ms' => 0],
        );

        $this->assertSame('rate_limited', $scan->stoppedBy);
        $this->assertFalse($scan->isComplete());
        $this->assertSame([100, 99], $scan->ids(), 'to, čo sa stihlo, zostáva použiteľné');
    }

    public function test_posledna_strana_archivu_scan_ukonci(): void
    {
        Http::fake([
            self::BASE.'/api/order*' => Http::sequence()
                ->push($this->page([[3, '2026-07-05 10:00:00'], [2, '2026-07-04 10:00:00']], 2))
                ->push($this->page([[1, '2026-07-03 10:00:00']], 2)),
        ]);

        $scan = $this->scanner()->scan(
            Carbon::parse('2026-07-01 00:00:00'),
            Carbon::parse('2026-08-01 00:00:00'),
            ['per_page' => 2, 'max_requests' => 10, 'sleep_ms' => 0],
        );

        $this->assertSame('exhausted', $scan->stoppedBy);
        $this->assertTrue($scan->isComplete());
        $this->assertSame([3, 2, 1], $scan->ids());
    }

    public function test_objednavka_s_necitatelnym_datumom_scan_nezastavi(): void
    {
        Http::fake([
            self::BASE.'/api/order*' => Http::sequence()
                ->push($this->page([[9, ''], [8, '2026-07-10 10:00:00'], [7, '2026-06-01 10:00:00']], 3)),
        ]);

        $scan = $this->scanner()->scan(
            Carbon::parse('2026-07-01 00:00:00'),
            Carbon::parse('2026-08-01 00:00:00'),
            ['per_page' => 3, 'max_requests' => 10, 'sleep_ms' => 0],
        );

        $this->assertSame([8], $scan->ids());
        $this->assertSame(1, $scan->undated);
        $this->assertSame('boundary', $scan->stoppedBy);
    }

    public function test_detaily_vzorky_sa_pri_rate_limite_zastavia(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => function ($request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            return (int) ($query['id'] ?? 0) === 1
                ? Http::response(['result' => ['ok' => true, 'id' => 1, 'total_paid' => '10', 'country_iso' => 'SK']])
                : Http::response(['error' => 'rate_limited'], 200);
        }]);

        $sample = $this->scanner()->details([1, 2, 3], 3, 0);

        $this->assertCount(1, $sample['details']);
        $this->assertSame('rate_limited', $sample['stopped_by']);
        $this->assertSame('SK', $sample['details'][0]['country_iso']);
    }
}
