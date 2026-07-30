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
            'sperky.currencies' => ['SK' => 'EUR', 'CZ' => 'CZK', 'HU' => 'HUF'],
            'sperky.summary.days' => 7,
            'sperky.summary.per_page' => 3,
            'sperky.summary.max_requests' => 3,
            'sperky.summary.sample_details' => 0,
        ]);
    }

    public function test_zoznam_objednavok_ma_stabilny_tvar(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [['id' => 30, 'date_add' => '2026-07-20 10:00:00', 'total_paid' => '14.85']],
            'page' => 1, 'per_page' => 20, 'total' => 1763711,
        ]])]);

        $response = $this->getJson('/api/eshop/orders')->assertOk();

        $response->assertJson([
            'ok' => true,
            'data' => [
                'page' => 1,
                'total' => 1763711,
                'count' => 1,
                'sorted_by' => 'id_desc',
                'orders' => [['id' => 30, 'total_paid' => 14.85]],
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

    public function test_detail_produktu_neobsahuje_varianty(): void
    {
        Http::fake([self::BASE.'/api/products/get*' => Http::response(['result' => [
            'ok' => true, 'id' => 22, 'name' => 'Prsteň', 'price' => 19.9,
            'description' => 'popis', 'description_short' => 'krátky',
        ]])]);

        $response = $this->getJson('/api/eshop/products/22')->assertOk();

        $product = $response->json('data.product');
        $this->assertSame(['id', 'name', 'price', 'description', 'description_short'], array_keys($product));
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
            self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1763711]]),
            self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 41018]]),
        ]);

        $response = $this->getJson('/api/eshop/health')->assertOk();

        $this->assertTrue($response->json('data.ok'));
        $this->assertSame(1763711, $response->json('data.totals.orders'));
        $this->assertStringNotContainsString(self::KEY, $response->getContent());
    }

    public function test_summary_vracia_pocty_a_denny_rozpad(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));

        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [
                ['id' => 30, 'date_add' => '2026-07-30 10:00:00', 'total_paid' => '14.85'],
                ['id' => 29, 'date_add' => '2026-07-29 10:00:00', 'total_paid' => '11215'],
                ['id' => 28, 'date_add' => '2026-07-20 10:00:00', 'total_paid' => '50.00'],
            ],
            'page' => 1, 'per_page' => 3, 'total' => 1763711,
        ]])]);

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $this->assertSame(2, $response->json('data.orders.in_window'));
        $this->assertSame(1, $response->json('data.orders.today'));
        $this->assertTrue($response->json('data.orders.complete'));
        // N7: celkový počet je z API, nie z konštanty
        $this->assertSame(1763711, $response->json('data.orders.total_in_shop'));

        $byDay = $response->json('data.by_day');
        $this->assertCount(7, $byDay);
        $this->assertSame('2026-07-30', $byDay[6]['date']);
        $this->assertSame(1, $byDay[6]['orders']);
    }

    public function test_summary_neobsahuje_jeden_suhrnny_obrat(): void
    {
        $this->travelTo(Carbon::parse('2026-07-30 12:00:00'));

        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [
                ['id' => 30, 'date_add' => '2026-07-30 10:00:00', 'total_paid' => '100.00'],
                ['id' => 29, 'date_add' => '2026-07-29 10:00:00', 'total_paid' => '11215'],
                ['id' => 28, 'date_add' => '2026-07-01 10:00:00', 'total_paid' => '50.00'],
            ],
            'page' => 1, 'per_page' => 3, 'total' => 1763711,
        ]])]);

        $response = $this->getJson('/api/eshop/summary')->assertOk();
        $data = (array) $response->json('data');

        // `total_paid` V RÁMCI JEDNEJ KRAJINY je legitímne (jedna mena) — zakázaný
        // je akýkoľvek kľúč, ktorý by tváril obrat naprieč krajinami.
        foreach ($this->keysOf($data) as $key) {
            $this->assertDoesNotMatchRegularExpression(
                '/^(revenue|turnover|obrat|total_revenue|total_paid_sum|sum_total|grand_total)$/i',
                $key,
                "summary nesmie obsahovať súhrnnú sumu: {$key}",
            );
        }

        // 100 EUR + 11215 HUF = 11315 — číslo, ktoré nesmie nikde vzniknúť
        $this->assertStringNotContainsString('11315', $response->getContent());
        $this->assertTrue($response->json('data.countries_meta.currency_is_estimate'));
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
                'orders_complete' => true,
                'countries' => [['country_iso' => 'SK', 'orders' => 30, 'total_paid' => 512.4, 'currency_estimate' => 'EUR']],
                'countries_meta' => ['basis' => 'sample', 'sample_size' => 60, 'currency_is_estimate' => true],
                'top_products' => [['id' => 22, 'orders' => 9]],
            ],
        ]);

        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1763711]])]);

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $months = $response->json('data.months');
        $this->assertCount(1, $months);
        $this->assertSame('2026-06', $months[0]['month']);
        $this->assertSame(4812, $months[0]['orders']);
        $this->assertSame('SK', $months[0]['countries'][0]['country_iso']);
    }

    public function test_summary_prezije_rate_limit_a_povie_to(): void
    {
        // Rule 8: obrazovka to musí povedať a nespadnúť.
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        $response = $this->getJson('/api/eshop/summary')->assertOk();

        $this->assertTrue($response->json('ok'));
        $this->assertNull($response->json('data.orders.in_window'));
        $this->assertFalse($response->json('data.live.available'));
        $this->assertSame('rate_limited', $response->json('data.live.stopped_by'));
    }

    public function test_summary_sa_obsluzi_z_cache_pri_druhom_volani(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1763711]])]);

        $this->getJson('/api/eshop/summary')->assertOk()->assertJson(['meta' => ['cached' => false]]);
        $this->getJson('/api/eshop/summary')->assertOk()->assertJson(['meta' => ['cached' => true]]);

        Http::assertSentCount(1);
    }

    /**
     * @param  array<mixed>  $data
     * @return list<string>
     */
    private function keysOf(array $data): array
    {
        $keys = [];
        foreach ($data as $key => $value) {
            if (is_string($key)) {
                $keys[] = $key;
            }
            if (is_array($value)) {
                $keys = array_merge($keys, $this->keysOf($value));
            }
        }

        return $keys;
    }
}
