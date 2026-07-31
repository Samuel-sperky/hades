<?php

namespace Tests\Feature\Sperky;

use App\Models\Node;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * `/api/eshop/*` — kontrakt, na ktorom stavia obrazovka „E-shop".
 *
 * Tvar odpovede je zamknutý testom, aby sa SPERKY-FE nemusel pýtať:
 *   úspech {ok:true, data, meta{cached, source}} · chyba {ok:false, data:null, error{code,message}}
 *
 * Oproti v1 sa prepísalo tvrdenie „summary neobsahuje jeden súhrnný obrat":
 * `summary.revenue` JE, ale je to ZOZNAM riadkov po menách. Zakázané zostáva
 * jedno číslo, ktoré by sčítalo sumy v rôznych menách.
 *
 * Nič nevolá produkciu (Http::fake), kľúč je fiktívny.
 */
class EshopApiTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'https://shop.test';

    private const KEY = 'fake-key-orders-read-DO-NOT-USE';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'cache.default' => 'array',
            'sperky.base_url' => self::BASE,
            'sperky.api_key' => self::KEY,
            'sperky.attempts' => 1,
            'sperky.backoff_ms' => 0,
            'sperky.per_page.default' => 20,
            'sperky.per_page.max' => 100,
            'sperky.cache.ttl.list' => 300,
            'sperky.cache.ttl.detail' => 900,
            'sperky.cache.ttl.health' => 60,
            'sperky.cache.ttl.summary' => 300,
            'sperky.countries' => ['SK', 'HU'],
            'sperky.summary.days' => 7,
            'sperky.summary.per_page' => 100,
            'sperky.summary.revenue_max_requests' => 5,
        ]);
    }

    public function test_zoznam_objednavok_ma_stabilny_tvar(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [['id' => 30, 'date_add' => '2026-07-20 10:00:00', 'total_paid' => '14.85', 'currency' => 'EUR']],
            'page' => 1, 'per_page' => 20, 'total' => 1764133,
        ]])]);

        $response = $this->getJson('/api/eshop/orders')->assertOk();

        $response->assertJson([
            'ok' => true,
            'data' => [
                'page' => 1,
                'total' => 1764133,
                'count' => 1,
                'sorted_by' => 'id_desc',
                'filters' => [],
                'orders' => [['id' => 30, 'total_paid' => 14.85, 'currency' => 'EUR']],
            ],
            'meta' => ['cached' => false, 'source' => 'sperky'],
        ]);
    }

    public function test_per_page_nad_100_je_clampnute_pred_odoslanim(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 0]])]);

        $this->getJson('/api/eshop/orders?per_page=500')->assertOk();

        Http::assertSent(fn ($request) => str_contains($request->url(), 'per_page=100'));
    }

    public function test_filtre_z_query_idu_do_eshopu_a_total_patri_vyberu(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [], 'page' => 1, 'per_page' => 20, 'total' => 220,
        ]])]);

        $response = $this->getJson('/api/eshop/orders?date_from=2026-07-30&date_to=2026-07-30&country=sk')
            ->assertOk();

        $this->assertSame(220, $response->json('data.total'));
        $this->assertSame(
            ['date_from' => '2026-07-30', 'date_to' => '2026-07-30', 'country' => 'SK'],
            $response->json('data.filters'),
        );

        Http::assertSent(fn ($request) => str_contains($request->url(), 'date_from=2026-07-30')
            && str_contains($request->url(), 'country=SK'));
    }

    public function test_total_min_bez_krajiny_je_400_a_nevola_eshop(): void
    {
        // ROZHODNUTIE 8 — „nad 100" mieša HUF drobné s EUR veľkými objednávkami.
        Http::fake();

        $this->getJson('/api/eshop/orders?total_min=100')
            ->assertStatus(400)
            ->assertJson(['ok' => false, 'data' => null, 'error' => ['code' => 'filter_needs_country']]);

        Http::assertNothingSent();
    }

    public function test_neplatny_datum_je_400_s_kodom_bad_filter(): void
    {
        Http::fake();

        $this->getJson('/api/eshop/orders?date_from=30.7.2026')
            ->assertStatus(400)
            ->assertJson(['ok' => false, 'error' => ['code' => 'bad_filter']]);

        Http::assertNothingSent();
    }

    public function test_neexistujuca_objednavka_vracia_404_s_kodom_not_found(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response(
            ['result' => ['ok' => false, 'error' => 'not found']], 200,
        )]);

        $this->getJson('/api/eshop/orders/999999999')
            ->assertNotFound()
            ->assertJson(['ok' => false, 'data' => null, 'error' => ['code' => 'not_found']]);
    }

    public function test_nulove_id_je_bad_request_a_nevola_eshop(): void
    {
        Http::fake();

        $this->getJson('/api/eshop/orders/0')
            ->assertStatus(400)
            ->assertJson(['ok' => false, 'error' => ['code' => 'bad_request']]);

        Http::assertNothingSent();
    }

    public function test_detail_objednavky_vracia_menu_a_polozky_s_mnozstvom(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response(['result' => [
            'ok' => true, 'id' => 30, 'total_paid' => '11215', 'currency' => 'HUF',
            'country' => 'Maďarsko', 'country_iso' => 'HU',
            'products' => [['id' => 30582, 'qty' => 3]],
        ]])]);

        $order = $this->getJson('/api/eshop/orders/30')->assertOk()->json('data.order');

        $this->assertSame('HUF', $order['currency']);
        $this->assertSame([['id' => 30582, 'qty' => 3]], $order['products']);
        $this->assertArrayNotHasKey('currency_is_estimate', $order);
        $this->assertArrayNotHasKey('product_ids', $order);
    }

    public function test_forbidden_z_tela_s_kodom_200_je_chybova_odpoved_bez_kluca(): void
    {
        // Nález N6: e-shop vráti HTTP 200 a `{"error":"forbidden"}`.
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'forbidden'], 200)]);

        $response = $this->getJson('/api/eshop/orders')
            ->assertStatus(502)
            ->assertJson(['ok' => false, 'data' => null, 'error' => ['code' => 'forbidden']]);

        $this->assertStringNotContainsString(self::KEY, $response->getContent());
    }

    public function test_rate_limited_je_429(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $this->getJson('/api/eshop/orders')
            ->assertStatus(429)
            ->assertJson(['ok' => false, 'error' => ['code' => 'rate_limited']]);
    }

    public function test_detail_produktu_obsahuje_varianty_so_stavom_zasoby(): void
    {
        Http::fake([self::BASE.'/api/products/get*' => Http::response(['result' => [
            'ok' => true, 'id' => 49, 'name' => 'Náramok', 'price' => 12.3,
            'description' => 'popis', 'description_short' => 'krátky',
            'has_attributes' => true,
            'attributes' => [[
                'id_product_attribute' => 501, 'reference' => 'NR-S', 'ean13' => '1234567890123',
                'price_impact' => 0, 'quantity' => 7, 'is_default' => true,
                'values' => [['group' => 'Veľkosť', 'value' => 'S']],
            ]],
        ]])]);

        $product = $this->getJson('/api/eshop/products/49')->assertOk()->json('data.product');

        $this->assertSame(
            ['id', 'name', 'price', 'description', 'description_short', 'has_attributes', 'attributes'],
            array_keys($product),
        );
        $this->assertTrue($product['has_attributes']);
        $this->assertSame(7, $product['attributes'][0]['quantity']);
    }

    public function test_health_vracia_200_aj_ked_je_eshop_mimo(): void
    {
        Http::fake(fn () => Http::response('', 500));

        $this->getJson('/api/eshop/health')
            ->assertOk()
            ->assertJson([
                'ok' => true,
                'data' => ['ok' => false, 'orders' => false, 'products' => false, 'key_configured' => true],
            ]);
    }

    public function test_health_nikdy_nevydava_kluc(): void
    {
        Http::fake([
            self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1764133]]),
            self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 41018]]),
        ]);

        $response = $this->getJson('/api/eshop/health')->assertOk();

        $this->assertTrue($response->json('data.ok'));
        $this->assertSame(1764133, $response->json('data.totals.orders'));
        $this->assertStringNotContainsString(self::KEY, $response->getContent());
    }

    // ----------------------------------------------------------------- summary

    /**
     * Okno 2026-07-24..2026-07-30. Dopyt bez `country` vracia riadky okna,
     * dopyt s `country` len počet, dopyt bez dátumov je celkový počet v e-shope.
     */
    private function fakeSummary(): void
    {
        Http::fake([self::BASE.'/api/order*' => function ($request) {
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);

            if (isset($query['country'])) {
                $totals = ['SK' => 2, 'HU' => 1];

                return Http::response(['result' => [
                    'orders' => [], 'page' => 1, 'per_page' => 1, 'total' => $totals[$query['country']] ?? 0,
                ]]);
            }

            if (! isset($query['date_from'])) {
                // celkový počet v e-shope (bez filtra)
                return Http::response(['result' => ['orders' => [], 'page' => 1, 'per_page' => 1, 'total' => 1764133]]);
            }

            return Http::response(['result' => [
                'orders' => [
                    ['id' => 30, 'date_add' => '2026-07-30 10:00:00', 'total_paid' => '100.00', 'currency' => 'EUR'],
                    ['id' => 29, 'date_add' => '2026-07-29 10:00:00', 'total_paid' => '11215', 'currency' => 'HUF'],
                    ['id' => 28, 'date_add' => '2026-07-24 10:00:00', 'total_paid' => '50.00', 'currency' => 'EUR'],
                ],
                'page' => 1, 'per_page' => 100, 'total' => 3,
            ]]);
        }]);
    }

    public function test_summary_vracia_presne_pocty_a_denny_rozpad(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $this->assertSame(3, $response->json('data.orders.in_window'));
        $this->assertSame(1, $response->json('data.orders.today'));
        // N7: celkový počet je z API, nie z konštanty
        $this->assertSame(1764133, $response->json('data.orders.total_in_shop'));
        $this->assertSame(
            ['days' => 7, 'from' => '2026-07-24', 'to' => '2026-07-30'],
            $response->json('data.window'),
        );

        $byDay = $response->json('data.by_day');
        $this->assertCount(7, $byDay);
        $this->assertSame('2026-07-24', $byDay[0]['date']);
        $this->assertSame('2026-07-30', $byDay[6]['date']);
        $this->assertSame(1, $byDay[6]['orders']);
    }

    public function test_summary_vracia_obrat_po_menach(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        // ROZHODNUTIE 1: samostatný riadok pre každú menu, žiadny prepočet.
        $this->assertEquals([
            ['currency' => 'EUR', 'total' => 150.0, 'orders' => 2],
            ['currency' => 'HUF', 'total' => 11215.0, 'orders' => 1],
        ], $response->json('data.revenue'));

        $this->assertTrue($response->json('data.revenue_meta.complete'));
        $this->assertSame(3, $response->json('data.revenue_meta.orders_covered'));
        $this->assertSame(0, $response->json('data.revenue_meta.without_currency'));
    }

    public function test_summary_neobsahuje_ziadne_cislo_napriec_menami(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $response = $this->getJson('/api/eshop/summary')->assertOk();
        $content = $response->getContent();

        // 100 EUR + 11 215 HUF = 11 315 · a so všetkými tromi 11 365
        $this->assertStringNotContainsString('11315', $content);
        $this->assertStringNotContainsString('11365', $content);
        $this->assertNoValueEquals((array) $response->json('data'), [11315.0, 11365.0]);

        // `revenue` smie byť len ZOZNAM riadkov, každý s vlastnou menou.
        $revenue = $response->json('data.revenue');
        $this->assertIsList($revenue);
        foreach ($revenue as $row) {
            $this->assertMatchesRegularExpression('/^[A-Z]{3}$/', $row['currency']);
        }

        // Rozhodnutie 7: nikde už žiadny odhad meny.
        $this->assertStringNotContainsString('currency_is_estimate', $content);
        $this->assertStringNotContainsString('currency_estimate', $content);
        // Rozhodnutie 3: ani slovo o vzorke.
        $this->assertStringNotContainsString('sample', $content);
    }

    public function test_summary_ma_presne_pocty_na_krajinu_bez_vzorky(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $this->assertSame(
            [['country_iso' => 'SK', 'orders' => 2], ['country_iso' => 'HU', 'orders' => 1]],
            $response->json('data.countries'),
        );
        // 3 v okne − 2 SK − 1 HU. POČTY sa sčítavať smú.
        $this->assertSame(0, $response->json('data.countries_other'));
        $this->assertNull($response->json('data.countries_meta'));
    }

    public function test_summary_prilozi_mesacne_suhrny_z_pamete(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));

        Node::create([
            'type' => 'memory',
            'source' => 'sperky',
            'external_key' => 'sperky:month:2026-06',
            'label' => 'E-shop Jún 2026',
            'description' => 'Jún 2026 — 4 812 objednávok.',
            'meta' => [
                'month' => '2026-06',
                'orders' => 4812,
                'revenue' => [['currency' => 'EUR', 'total' => 512.4, 'orders' => 30]],
                'revenue_meta' => ['complete' => true, 'orders_covered' => 4812],
                'countries' => [['country_iso' => 'SK', 'orders' => 3000]],
                'countries_other' => 1812,
            ],
        ]);

        $this->fakeSummary();

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $months = $response->json('data.months');
        $this->assertCount(1, $months);
        $this->assertSame('2026-06', $months[0]['month']);
        $this->assertSame(4812, $months[0]['orders']);
        $this->assertSame('EUR', $months[0]['revenue'][0]['currency']);
        $this->assertSame('SK', $months[0]['countries'][0]['country_iso']);
    }

    public function test_summary_prezije_rate_limit_a_povie_to(): void
    {
        // Pravidlo 9: obrazovka to musí povedať a nespadnúť.
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $this->assertTrue($response->json('ok'));
        $this->assertNull($response->json('data.orders.in_window'));
        $this->assertNull($response->json('data.orders.total_in_shop'));
        $this->assertFalse($response->json('data.live.available'));
        $this->assertSame('rate_limited', $response->json('data.live.error'));
        $this->assertSame([], $response->json('data.revenue'));
    }

    public function test_summary_sa_obsluzi_z_cache_pri_druhom_volani(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $this->getJson('/api/eshop/summary')->assertOk()->assertJson(['meta' => ['cached' => false]]);
        $sentAfterFirst = count(Http::recorded());

        $this->getJson('/api/eshop/summary')->assertOk()->assertJson(['meta' => ['cached' => true]]);

        // Druhé volanie nesmie poslať ani jednu novú požiadavku.
        $this->assertSame($sentAfterFirst, count(Http::recorded()));
    }

    public function test_summary_okna_stoji_jednu_poziadavku_na_okno_plus_krajiny(): void
    {
        // Rozhodnutie 2: žiadny prechod stránkami. 1× okno + 2× krajina + 1× celkový počet.
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));
        $this->fakeSummary();

        $this->getJson('/api/eshop/summary')->assertOk();

        Http::assertSentCount(4);
    }

    /**
     * Žiadna číselná hodnota (rekurzívne) sa nerovná zakázanému súčtu.
     *
     * @param  array<mixed>  $data
     * @param  list<float>  $forbidden
     */
    private function assertNoValueEquals(array $data, array $forbidden): void
    {
        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $this->assertNoValueEquals($value, $forbidden);

                continue;
            }

            if (! is_numeric($value)) {
                continue;
            }

            foreach ($forbidden as $sum) {
                $this->assertNotEquals(
                    $sum,
                    (float) $value,
                    "kľúč '{$key}' obsahuje súčet naprieč menami ({$sum}) — to je zakázané číslo",
                );
            }
        }
    }
}
