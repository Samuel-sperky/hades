<?php

namespace Tests\Unit\Sperky;

use App\Services\Sperky\OrderWindowReader;
use App\Services\Sperky\SperkyClient;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * Čítanie okna objednávok. PREPÍSANÝ `OrderScannerTest` — trieda `OrderScanner`
 * bola zrušená spolu s `OrderScan`.
 *
 * Čo tvrdil starý test a už neplatí: „scan sa zastaví pri prvej objednávke
 * staršej než okno" a „strop requestov scan označí ako neúplný". Okno sa dnes
 * vyžiada dátumovým filtrom, takže počet je PRESNÝ po jednom dopyte a pojmy
 * `stoppedBy` / `isComplete` pre počty zmizli.
 *
 * Čo z pôvodných tvrdení zostalo (len presunuté na nové rozhranie): rate limit
 * beh ukončí elegantne bez výnimky, nečitateľný dátum nič nezhodí a nič
 * nevolá produkciu.
 */
class OrderWindowReaderTest extends TestCase
{
    private const BASE = 'https://shop.test';

    /** 100 EUR + 11 215 HUF = 11 315 — číslo, ktoré nesmie nikde vzniknúť. */
    private const FORBIDDEN_SUM = '11315';

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
        ]);
    }

    private function reader(): OrderWindowReader
    {
        return new OrderWindowReader(new SperkyClient);
    }

    /**
     * @param  list<array{int, string, float|int, ?string}>  $rows  [id, date_add, total_paid, currency]
     */
    private function page(array $rows, int $perPage, int $total): array
    {
        return [
            'result' => [
                'orders' => array_map(fn (array $r) => [
                    'id' => $r[0],
                    'date_add' => $r[1],
                    'total_paid' => $r[2],
                    'currency' => $r[3] ?? null,
                ], $rows),
                'page' => 1,
                'per_page' => $perPage,
                'total' => $total,
            ],
        ];
    }

    private function queryParam(string $url, string $key): ?string
    {
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

        return isset($query[$key]) ? (string) $query[$key] : null;
    }

    public function test_pocet_objednavok_v_okne_je_presny_po_jednom_dopyte(): void
    {
        // Toto je celý zmysel rozhodnutia 2: `total` filtrovanej odpovede
        // nahradilo prechod stránkami a príznak „dolná hranica".
        Http::fake([self::BASE.'/api/order*' => Http::response(
            $this->page([], 1, 220),
        )]);

        $this->assertSame(220, $this->reader()->count('2026-07-30', '2026-07-30'));

        Http::assertSentCount(1);
        Http::assertSent(fn ($request) => $this->queryParam($request->url(), 'date_from') === '2026-07-30'
            && $this->queryParam($request->url(), 'date_to') === '2026-07-30');
    }

    public function test_obrat_je_po_menach_a_nikdy_nescita_dve_meny(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->page([
            [30, '2026-07-30 10:00:00', '100.00', 'EUR'],
            [29, '2026-07-29 10:00:00', '11215', 'HUF'],
            [28, '2026-07-29 09:00:00', '20.50', 'EUR'],
        ], 100, 3))]);

        $window = $this->reader()->read('2026-07-24', '2026-07-30');

        $this->assertSame(3, $window->orders);
        $this->assertTrue($window->complete);

        // Dva samostatné riadky, žiadny tretí so súčtom.
        $this->assertSame([
            ['currency' => 'EUR', 'total' => 120.5, 'orders' => 2],
            ['currency' => 'HUF', 'total' => 11215.0, 'orders' => 1],
        ], $window->revenue);

        $serialized = json_encode($window->revenue);
        $this->assertStringNotContainsString(self::FORBIDDEN_SUM, (string) $serialized);
        $this->assertStringNotContainsString('11335', (string) $serialized, '100+20.5+11215 tiež nesmie vzniknúť');
    }

    public function test_objednavka_bez_meny_sa_nepripocita_nikam(): void
    {
        // Tichý fallback na nesprávnu menu je horší než chýbajúca hodnota
        // (rozhodnutie 7) — riadok sa spočíta, ale nesčíta.
        Http::fake([self::BASE.'/api/order*' => Http::response($this->page([
            [30, '2026-07-30 10:00:00', '100.00', 'EUR'],
            [29, '2026-07-30 09:00:00', '50.00', null],
        ], 100, 2))]);

        $window = $this->reader()->read('2026-07-30', '2026-07-30');

        $this->assertSame([['currency' => 'EUR', 'total' => 100.0, 'orders' => 1]], $window->revenue);
        $this->assertSame(1, $window->withoutCurrency);
        $this->assertStringNotContainsString('150', (string) json_encode($window->revenue));
    }

    public function test_denny_rozpad_pokryva_cele_okno_vratane_prazdnych_dni(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->page([
            [30, '2026-07-30 10:00:00', '10', 'EUR'],
            [29, '2026-07-28 10:00:00', '10', 'EUR'],
        ], 100, 2))]);

        $window = $this->reader()->read('2026-07-28', '2026-07-30');

        $this->assertSame([
            ['date' => '2026-07-28', 'orders' => 1],
            ['date' => '2026-07-29', 'orders' => 0],
            ['date' => '2026-07-30', 'orders' => 1],
        ], $window->byDay);
    }

    public function test_stranky_sa_docitaju_do_konca_okna(): void
    {
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            $page = (int) ($this->queryParam($request->url(), 'page') ?? 1);

            return Http::response($page === 1
                ? $this->page([[4, '2026-07-30 10:00:00', '10', 'EUR'], [3, '2026-07-30 09:00:00', '10', 'EUR']], 2, 3)
                : $this->page([[2, '2026-07-30 08:00:00', '5', 'HUF']], 2, 3));
        }]);

        $window = $this->reader()->read('2026-07-30', '2026-07-30', ['per_page' => 2, 'max_requests' => 5]);

        $this->assertSame(3, $window->orders);
        $this->assertSame(3, $window->ordersRead);
        $this->assertTrue($window->complete);
        $this->assertSame(20.0, $window->revenue[0]['total']);
    }

    public function test_strop_pozdiadaviek_obrat_oznaci_ako_neuplny_ale_pocet_zostava_presny(): void
    {
        // Počet objednávok je z `total`, takže je presný aj keď sa riadky
        // nedočítali — na rozdiel od starého scanneru, ktorý nevedel ani počet.
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            $page = (int) ($this->queryParam($request->url(), 'page') ?? 1);
            $base = 1000 - ($page - 1) * 2;

            return Http::response($this->page([
                [$base, '2026-07-30 10:00:00', '10', 'EUR'],
                [$base - 1, '2026-07-30 09:00:00', '10', 'EUR'],
            ], 2, 500));
        }]);

        $window = $this->reader()->read('2026-07-30', '2026-07-30', ['per_page' => 2, 'max_requests' => 3]);

        $this->assertSame(500, $window->orders, 'počet je presný z API');
        $this->assertFalse($window->complete);
        $this->assertSame(6, $window->ordersRead);
        $this->assertSame([], $window->byDay, 'čiastočný denný rozpad sa nevydáva za úplný');
        $this->assertSame(500, $window->revenueMeta()['orders_in_window']);
        $this->assertSame(6, $window->revenueMeta()['orders_covered']);
        Http::assertSentCount(3);
    }

    public function test_rate_limit_okno_ukonci_elegantne_bez_vynimky(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $window = $this->reader()->read('2026-07-01', '2026-07-31');

        $this->assertSame('rate_limited', $window->error);
        $this->assertNull($window->orders);
        $this->assertFalse($window->available());
        $this->assertFalse($window->complete);
        $this->assertSame([], $window->revenue);
    }

    public function test_opakovana_stranka_obrat_nezdvoji(): void
    {
        // Poistka: keby `page` pri filtroch nefungoval, e-shop by vracal stále
        // tú istú stranu a obrat by sa násobil počtom požiadaviek.
        Http::fake([self::BASE.'/api/order*' => function () {
            return Http::response($this->page([
                [30, '2026-07-30 10:00:00', '100.00', 'EUR'],
                [29, '2026-07-30 09:00:00', '100.00', 'EUR'],
            ], 2, 500));
        }]);

        $window = $this->reader()->read('2026-07-30', '2026-07-30', ['per_page' => 2, 'max_requests' => 5]);

        $this->assertSame(2, $window->ordersRead);
        $this->assertSame(200.0, $window->revenue[0]['total']);
        $this->assertLessThanOrEqual(2, $window->requests, 'nulový prírastok cyklus ukončí');
    }

    public function test_necitatelny_datum_nezhodi_denny_rozpad(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->page([
            [9, '', '10', 'EUR'],
            [8, '2026-07-30 10:00:00', '10', 'EUR'],
        ], 100, 2))]);

        $window = $this->reader()->read('2026-07-30', '2026-07-30');

        $this->assertSame([['date' => '2026-07-30', 'orders' => 1]], $window->byDay);
        $this->assertSame(20.0, $window->revenue[0]['total'], 'suma sa počíta aj bez dátumu');
    }

    public function test_krajiny_su_presne_jeden_dopyt_na_krajinu(): void
    {
        $counts = ['SK' => 345523, 'HU' => 429015, 'CZ' => 423427];

        Http::fake([self::BASE.'/api/order*' => function ($request) use ($counts) {
            $iso = (string) $this->queryParam($request->url(), 'country');

            return Http::response($this->page([], 1, $counts[$iso] ?? 0));
        }]);

        $result = $this->reader()->countries('2020-01-01', '2026-07-31', ['sk', 'hu', 'cz'], 1764133);

        $this->assertSame([
            ['country_iso' => 'HU', 'orders' => 429015],
            ['country_iso' => 'CZ', 'orders' => 423427],
            ['country_iso' => 'SK', 'orders' => 345523],
        ], $result['countries']);
        // počty sa sčítavať SMÚ (na rozdiel od súm v rôznych menách)
        $this->assertSame(1764133 - 345523 - 429015 - 423427, $result['other']);
        $this->assertNull($result['error']);
        Http::assertSentCount(3);
    }

    public function test_krajiny_pri_zlyhani_nehlasia_nulu(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $result = $this->reader()->countries('2026-07-01', '2026-07-31', ['SK'], 100);

        $this->assertSame([], $result['countries']);
        $this->assertNull($result['other'], 'bez dát sa zvyšok nedopočítava');
        $this->assertSame('rate_limited', $result['error']);
    }

    public function test_neplatny_kod_krajiny_sa_neposle(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->page([], 1, 5))]);

        $result = $this->reader()->countries('2026-07-01', '2026-07-31', ['Slovensko', '', 'SK'], null);

        $this->assertSame([['country_iso' => 'SK', 'orders' => 5]], $result['countries']);
        Http::assertSentCount(1);
    }
}
