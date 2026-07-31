<?php

namespace Tests\Unit\Sperky;

use App\Services\Sperky\Exceptions\SperkyApiException;
use App\Services\Sperky\Exceptions\SperkyDomainException;
use App\Services\Sperky\SperkyClient;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * SperkyClient proti falšovanému HTTP. ŽIADNE volanie na produkciu — celá suita
 * musí prejsť offline (e-shop má 1,76 M objednávok a neznámy rate limit).
 *
 * Kľúč v testoch je FIKTÍVNY a nikdy sa nečíta z .env.
 *
 * Brána nálezu N6: HTTP status nie je zdroj pravdy. Väčšina scenárov nižšie
 * prichádza s kódom 200 a chybou v tele — keby klient veril statusu, „zlý kľúč"
 * by sa javil ako úspešná odpoveď.
 *
 * Oproti v1 sa PREPÍSALI tvrdenia o variantoch a o mene: `attributes` sa vracajú
 * a `currency` sa čita z odpovede namiesto odhadu z krajiny (spec v2).
 */
class SperkyClientTest extends TestCase
{
    /** Fiktívny kľúč. Skutočný žije len v .env a do testu sa nikdy nedostane. */
    private const KEY = 'fake-key-orders-read-DO-NOT-USE';

    private const BASE = 'https://shop.test';

    protected function setUp(): void
    {
        parent::setUp();

        config([
            'cache.default' => 'array',
            'sperky.base_url' => self::BASE,
            'sperky.api_key' => self::KEY,
            'sperky.timeout' => 8,
            'sperky.connect_timeout' => 4,
            'sperky.attempts' => 2,
            'sperky.backoff_ms' => 0,   // testy nespia
            'sperky.per_page.default' => 20,
            'sperky.per_page.max' => 100,
            'sperky.cache.prefix' => 'sperky',
            'sperky.cache.ttl.list' => 300,
            'sperky.cache.ttl.detail' => 900,
            'sperky.cache.ttl.health' => 60,
        ]);
    }

    private function client(): SperkyClient
    {
        return new SperkyClient;
    }

    /** Telo úspešnej odpovede zoznamu objednávok. */
    private function ordersBody(int $perPage = 20, int $total = 1764133): array
    {
        $orders = [];
        for ($i = 0; $i < $perPage; $i++) {
            $orders[] = [
                'id' => 1764146 - $i,
                'date_add' => '2026-07-29 1'.($i % 10).':00:00',
                'total_paid' => '14.85',
                'currency' => 'EUR',
            ];
        }

        return ['result' => ['orders' => $orders, 'page' => 1, 'per_page' => $perPage, 'total' => $total]];
    }

    public function test_zoznam_objednavok_pouziva_singularnu_cestu_a_hlavicku_s_klucom(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(2))]);

        $result = $this->client()->orders(1, 2);

        $this->assertSame(2, $result['count']);
        $this->assertSame(1764146, $result['orders'][0]['id']);
        // N7: total vždy z API
        $this->assertSame(1764133, $result['total']);

        Http::assertSent(function ($request) {
            // Cesta je v JEDNOTNOM čísle — dokumentácia sľubuje `/api/orders`.
            return str_starts_with($request->url(), self::BASE.'/api/order?')
                && $request->hasHeader('X-Api-Key', self::KEY);
        });
    }

    public function test_produktove_endpointy_neposielaju_kluc(): void
    {
        Http::fake([self::BASE.'/api/products*' => Http::response([
            'result' => ['products' => [['id' => 22, 'name' => 'Prsteň', 'price' => 19.9]], 'total' => 41018],
        ])]);

        $result = $this->client()->products(1, 5);

        $this->assertSame(41018, $result['total']);
        $this->assertSame('Prsteň', $result['products'][0]['name']);

        Http::assertSent(fn ($request) => ! $request->hasHeader('X-Api-Key'));
    }

    public function test_per_page_je_clampovane_na_100(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(1))]);

        $client = $this->client();
        $this->assertSame(100, $client->clampPerPage(500));
        $this->assertSame(1, $client->clampPerPage(-5));
        $this->assertSame(20, $client->clampPerPage(null));

        $client->orders(1, 500);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'per_page=100'));
    }

    // ------------------------------------------------------------- filtre (v2)

    public function test_datumove_filtre_idu_do_query_a_total_patri_vyberu(): void
    {
        // Overené na produkcii: date_from=2026-07-30&date_to=2026-07-30 → total 220,
        // bez filtra 1 764 133. Filter sa teda NEZAHADZUJE (v1 nález N3 už neplatí).
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [['id' => 1, 'date_add' => '2026-07-30 10:00:00', 'total_paid' => '10', 'currency' => 'EUR']],
            'page' => 1, 'per_page' => 100, 'total' => 220,
        ]])]);

        $result = $this->client()->orders(1, 100, ['date_from' => '2026-07-30', 'date_to' => '2026-07-30']);

        $this->assertSame(220, $result['total']);
        $this->assertSame(['date_from' => '2026-07-30', 'date_to' => '2026-07-30'], $result['filters']);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'date_from=2026-07-30')
            && str_contains($request->url(), 'date_to=2026-07-30'));
    }

    public function test_orders_total_je_jeden_dopyt_s_jednym_riadkom(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [], 'page' => 1, 'per_page' => 1, 'total' => 429015,
        ]])]);

        $this->assertSame(429015, $this->client()->ordersTotal(['country' => 'hu']));

        Http::assertSentCount(1);
        // krajina sa posiela veľkými písmenami, per_page=1 (stačí `total`)
        Http::assertSent(fn ($request) => str_contains($request->url(), 'country=HU')
            && str_contains($request->url(), 'per_page=1'));
    }

    public function test_total_min_bez_krajiny_je_zamietnute_a_nevola_eshop(): void
    {
        // ROZHODNUTIE 8: „nad 100" znamená pri HUF drobné a pri EUR veľkú objednávku.
        Http::fake();

        try {
            $this->client()->orders(1, 100, ['total_min' => 100]);
            $this->fail('total_min bez country musí byť zamietnuté');
        } catch (SperkyDomainException $e) {
            $this->assertSame('filter_needs_country', $e->errorCode);
            $this->assertSame(400, $e->httpStatus);
        }

        Http::assertNothingSent();
    }

    public function test_total_min_s_krajinou_prejde(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 7]])]);

        $this->client()->orders(1, 100, ['country' => 'SK', 'total_min' => 100, 'total_max' => 250.5]);

        Http::assertSent(fn ($request) => str_contains($request->url(), 'total_min=100')
            && str_contains($request->url(), 'total_max=250.5')
            && str_contains($request->url(), 'country=SK'));
    }

    public function test_neplatny_filter_je_domenova_chyba_a_nevola_eshop(): void
    {
        Http::fake();
        $client = $this->client();

        $cases = [
            ['date_from' => '30.7.2026'],
            ['date_from' => '2026-02-30'],
            ['country' => 'Slovensko'],
            ['date_from' => '2026-07-31', 'date_to' => '2026-07-01'],
            ['country' => 'SK', 'total_min' => -1],
            ['country' => 'SK', 'total_min' => 500, 'total_max' => 100],
            ['currency' => 'EUR'],   // neznámy kľúč — e-shop by ho tichým spôsobom zahodil
        ];

        foreach ($cases as $filters) {
            try {
                $client->orders(1, 10, $filters);
                $this->fail('neplatný filter musí vyhodiť doménovú výnimku: '.json_encode($filters));
            } catch (SperkyDomainException $e) {
                $this->assertContains($e->errorCode, ['bad_filter', 'filter_needs_country']);
            }
        }

        Http::assertNothingSent();
    }

    public function test_filtrovany_dopyt_ma_vlastny_cache_kluc(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(1, 220))]);

        $client = $this->client();
        $client->orders(1, 1);
        $client->orders(1, 1, ['date_from' => '2026-07-30']);

        // Iný filter = iný dopyt. Keby filtre neboli v kľúči, druhé volanie by
        // vrátilo cachovaný nefiltrovaný výsledok.
        Http::assertSentCount(2);
    }

    // ------------------------------------------------------------ mena a detail

    public function test_detail_objednavky_cita_menu_z_odpovede(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response([
            'result' => [
                'ok' => true,
                'id' => 1763724,
                'date_add' => '2026-07-29 12:00:00',
                'total_paid' => '11215',
                'currency' => 'huf',
                'country' => 'Maďarsko',
                'country_iso' => 'hu',
                'products' => [['id' => 22, 'qty' => 2], ['id' => 23, 'qty' => 1]],
            ],
        ])]);

        $order = $this->client()->order(1763724);

        $this->assertNotNull($order);
        $this->assertSame('HU', $order['country_iso']);
        // Mena je z API, nie odhad z krajiny (rozhodnutie 7).
        $this->assertSame('HUF', $order['currency']);
        $this->assertArrayNotHasKey('currency_estimate', $order);
        $this->assertArrayNotHasKey('currency_is_estimate', $order);
        $this->assertSame(11215.0, $order['total_paid']);
        // `products: [{id, qty}]` nahradilo `product_ids`
        $this->assertSame([['id' => 22, 'qty' => 2], ['id' => 23, 'qty' => 1]], $order['products']);
        $this->assertArrayNotHasKey('product_ids', $order);
    }

    public function test_chybajuca_mena_je_null_a_nikdy_sa_nehada_z_krajiny(): void
    {
        // Mapovanie krajina→mena je zmazané. SK by staré mapovanie doplnilo na EUR;
        // dnes zostáva null, čo znamená „API menu nepovedalo".
        Http::fake([self::BASE.'/api/order/get*' => Http::response([
            'result' => ['ok' => true, 'id' => 5, 'total_paid' => '10', 'country_iso' => 'SK'],
        ])]);

        $order = $this->client()->order(5);

        $this->assertNull($order['currency']);
        $this->assertSame('SK', $order['country_iso']);
    }

    public function test_zoznam_objednavok_nesie_menu_pri_kazdom_riadku(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['result' => [
            'orders' => [
                ['id' => 1764146, 'total_paid' => 73.9, 'currency' => 'EUR', 'date_add' => '2026-07-31 09:00:00'],
                ['id' => 1764145, 'total_paid' => 11.6, 'currency' => 'EUR', 'date_add' => '2026-07-31 08:00:00'],
                ['id' => 1764144, 'total_paid' => 20965, 'currency' => 'HUF', 'date_add' => '2026-07-31 07:00:00'],
            ],
            'total' => 3,
        ]])]);

        $rows = $this->client()->orders(1, 100)['orders'];

        $this->assertSame(['EUR', 'EUR', 'HUF'], array_column($rows, 'currency'));
    }

    // ---------------------------------------------------------------- varianty

    public function test_detail_produktu_vracia_varianty_vratane_stavu_zasoby(): void
    {
        // Spec v2 N2: produkt 49 má has_attributes:true a 12 variantov.
        Http::fake([self::BASE.'/api/products/get*' => Http::response([
            'result' => [
                'ok' => true, 'id' => 49, 'name' => 'Náramok', 'price' => 12.3,
                'description' => 'dlhý popis', 'description_short' => 'krátky',
                'has_attributes' => true,
                'attributes' => [
                    [
                        'id_product_attribute' => 501, 'reference' => 'NR-49-S', 'ean13' => '1234567890123',
                        'price_impact' => 0, 'quantity' => 7, 'is_default' => true,
                        'values' => [['group' => 'Veľkosť', 'value' => 'S']],
                    ],
                    [
                        'id_product_attribute' => 502, 'reference' => 'NR-49-M', 'ean13' => null,
                        'price_impact' => '1.50', 'quantity' => 0, 'is_default' => false,
                        'values' => [['group' => 'Veľkosť', 'value' => 'M']],
                    ],
                ],
            ],
        ])]);

        $product = $this->client()->product(49);

        $this->assertTrue($product['has_attributes']);
        $this->assertCount(2, $product['attributes']);

        $first = $product['attributes'][0];
        $this->assertSame(
            ['id_product_attribute', 'reference', 'ean13', 'price_impact', 'quantity', 'is_default', 'values'],
            array_keys($first),
            'variant má sedem polí, ktoré API reálne posiela',
        );
        $this->assertSame(501, $first['id_product_attribute']);
        $this->assertSame(7, $first['quantity'], 'quantity je stav zásoby (rozhodnutie 4)');
        $this->assertTrue($first['is_default']);
        $this->assertSame([['group' => 'Veľkosť', 'value' => 'S']], $first['values']);

        // Nula na sklade musí zostať nulou, nie null — „vypredané" je informácia.
        $this->assertSame(0, $product['attributes'][1]['quantity']);
        $this->assertSame(1.5, $product['attributes'][1]['price_impact']);
        $this->assertFalse($product['attributes'][1]['is_default']);
    }

    public function test_produkt_bez_variantov_ma_prazdne_pole_a_false(): void
    {
        Http::fake([self::BASE.'/api/products/get*' => Http::response([
            'result' => ['ok' => true, 'id' => 22, 'name' => 'Prsteň', 'price' => 19.9],
        ])]);

        $product = $this->client()->product(22);

        $this->assertSame([], $product['attributes']);
        $this->assertFalse($product['has_attributes']);
    }

    // ------------------------------------------------------------------ chyby

    public function test_not_found_je_domenovy_stav_a_vracia_null(): void
    {
        // HTTP 200 + chyba v tele (nález N6)
        Http::fake([self::BASE.'/api/order/get*' => Http::response(
            ['result' => ['ok' => false, 'error' => 'not found']], 200,
        )]);

        $this->assertNull($this->client()->order(999999999));
    }

    public function test_no_id_je_domenova_vynimka(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response(
            ['result' => ['ok' => false, 'error' => 'no id']], 200,
        )]);

        try {
            $this->client()->order(1);
            $this->fail('no id musí vyhodiť doménovú výnimku');
        } catch (SperkyDomainException $e) {
            $this->assertSame('no_id', $e->errorCode);
            $this->assertFalse($e->isInfrastructure());
        }
    }

    public function test_forbidden_je_infrastrukturna_vynimka_a_neopakuje_sa(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'forbidden'], 200)]);

        try {
            $this->client()->orders();
            $this->fail('forbidden musí vyhodiť výnimku');
        } catch (SperkyApiException $e) {
            $this->assertSame('forbidden', $e->errorCode);
            $this->assertTrue($e->isInfrastructure());
            $this->assertFalse($e->isRetryable());
        }

        // Zlý kľúč sa opakovaním nespraví dobrým.
        Http::assertSentCount(1);
    }

    public function test_rate_limited_sa_opakuje_a_potom_vyhodi_vynimku(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['error' => 'rate_limited'], 200)]);

        try {
            $this->client()->orders();
            $this->fail('rate_limited musí po vyčerpaní pokusov vyhodiť výnimku');
        } catch (SperkyApiException $e) {
            $this->assertSame('rate_limited', $e->errorCode);
            $this->assertTrue($e->isRetryable());
            $this->assertSame(429, $e->httpStatus);
        }

        // 2 pokusy z configu, nie nekonečné búchanie na produkciu
        Http::assertSentCount(2);
    }

    public function test_timeout_je_vynimka_po_vycerpani_pokusov(): void
    {
        // Zlyhané spojenie Laravel do `recorded` nezapíše, preto sa pokusy
        // počítajú ručne.
        $attempts = 0;
        Http::fake(function () use (&$attempts) {
            $attempts++;

            throw new ConnectionException('cURL error 28: Operation timed out');
        });

        try {
            $this->client()->orders();
            $this->fail('timeout musí vyhodiť výnimku');
        } catch (SperkyApiException $e) {
            $this->assertSame('timeout', $e->errorCode);
            $this->assertSame(504, $e->httpStatus);
        }

        $this->assertSame(2, $attempts, '2 pokusy z configu, nie viac');
    }

    public function test_odmietnute_spojenie_je_unavailable_nie_timeout(): void
    {
        // Indikátor v UI má rozlíšiť „e-shop neodpovedá" od „neodpovedal v limite".
        Http::fake(function () {
            throw new ConnectionException('cURL error 7: Failed to connect to shop.test port 443: Connection refused');
        });

        try {
            $this->client()->orders();
            $this->fail('odmietnuté spojenie musí vyhodiť výnimku');
        } catch (SperkyApiException $e) {
            $this->assertSame('unavailable', $e->errorCode);
            $this->assertSame(503, $e->httpStatus);
            $this->assertStringNotContainsString('shop.test', $e->getMessage());
        }
    }

    public function test_malformed_json_je_vynimka_nie_prazdna_odpoved(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response('<html>Service unavailable</html>', 200)]);

        $this->expectException(SperkyApiException::class);
        $this->client()->orders();
    }

    public function test_odpoved_bez_obalky_result_je_malformed(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(['orders' => []], 200)]);

        try {
            $this->client()->orders();
            $this->fail('chýbajúca obálka result musí byť chyba');
        } catch (SperkyApiException $e) {
            $this->assertSame('malformed', $e->errorCode);
        }
    }

    public function test_neznamy_chybovy_kod_nepresiakne_do_spravy(): void
    {
        // Keby e-shop niekedy vrátil v chybe echo hlavičiek, kľúč nesmie skončiť
        // v správe výnimky ani v logu — preto sa surový text zahadzuje.
        Http::fake([self::BASE.'/api/order*' => Http::response(
            ['error' => 'weird: X-Api-Key '.self::KEY], 200,
        )]);

        try {
            $this->client()->orders();
            $this->fail('neznámy kód musí vyhodiť výnimku');
        } catch (SperkyApiException $e) {
            $this->assertSame('unexpected', $e->errorCode);
            $this->assertStringNotContainsString(self::KEY, $e->getMessage());
        }
    }

    // ------------------------------------------------------------------- cache

    public function test_zlucena_stranka_sa_obsluzi_z_cache_a_neposle_druhy_request(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(2))]);

        $client = $this->client();

        $client->orders(1, 2);
        $this->assertFalse($client->lastCallWasCached(), 'prvé volanie je cache miss');

        $client->orders(1, 2);
        $this->assertTrue($client->lastCallWasCached(), 'druhé volanie musí prísť z cache');

        Http::assertSentCount(1);
    }

    public function test_iny_dopyt_cache_nezdiela(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(2))]);

        $client = $this->client();
        $client->orders(1, 2);
        $client->orders(2, 2);

        Http::assertSentCount(2);
    }

    public function test_not_found_sa_cachuje_aby_sa_nebuchalo_na_produkciu(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response(
            ['result' => ['ok' => false, 'error' => 'not found']], 200,
        )]);

        $client = $this->client();
        $this->assertNull($client->order(42));
        $this->assertNull($client->order(42));

        Http::assertSentCount(1);
    }

    public function test_cache_kluc_neobsahuje_api_kluc(): void
    {
        $key = $this->client()->cacheKey('orders', ['page' => 1, 'per_page' => 100, 'date_from' => '2026-07-01']);

        $this->assertStringStartsWith('sperky:orders:', $key);
        $this->assertStringNotContainsString(self::KEY, $key);
        // ani žiadny jeho fragment
        $this->assertStringNotContainsString(substr(self::KEY, 0, 8), $key);
    }

    public function test_kluc_nie_je_v_ziadnej_vynimke_ani_v_logu(): void
    {
        $scenarios = [
            'forbidden' => Http::response(['error' => 'forbidden'], 200),
            'rate_limited' => Http::response(['error' => 'rate_limited'], 200),
            'malformed' => Http::response('nope', 200),
            'server' => Http::response('', 500),
            'bad_route' => Http::response(['error' => 'unknown_controller'], 200),
        ];

        foreach ($scenarios as $name => $response) {
            Http::fake([self::BASE.'/api/order*' => $response]);
            Log::spy();

            try {
                $this->client()->orders();
                $this->fail("scenár {$name} mal vyhodiť výnimku");
            } catch (SperkyApiException $e) {
                $serialized = $e->getMessage().'|'.json_encode($e->context()).'|'.$e->getTraceAsString();
                $this->assertStringNotContainsString(self::KEY, $serialized, "kľúč presiakol do výnimky ({$name})");
                $this->assertNull($e->getPrevious(), 'pôvodná výnimka sa nepripája — jej text obsahuje hlavičky');
            }

            Log::shouldHaveReceived('warning')->withArgs(function (string $message, array $context) {
                return ! str_contains($message.'|'.json_encode($context), self::KEY);
            });
        }
    }

    // ------------------------------------------------------------------ health

    public function test_health_hlasi_vetvy_oddelene_a_nikdy_nevyhodi_vynimku(): void
    {
        Http::fake([
            self::BASE.'/api/order*' => Http::response(['error' => 'forbidden'], 200),
            self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 41018]]),
        ]);

        $health = $this->client()->health();

        $this->assertFalse($health['ok']);
        $this->assertFalse($health['orders']);
        $this->assertTrue($health['products']);
        $this->assertStringContainsString('orders:forbidden', (string) $health['error']);
        $this->assertSame(41018, $health['totals']['products']);
        $this->assertStringNotContainsString(self::KEY, json_encode($health));
    }

    public function test_health_je_ok_ked_odpovedaju_obe_vetvy(): void
    {
        Http::fake([
            self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1764133]]),
            self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 41018]]),
        ]);

        $client = $this->client();
        $health = $client->health();

        $this->assertTrue($health['ok']);
        $this->assertTrue($client->available());
        $this->assertSame(1764133, $health['totals']['orders']);

        // health je cachovaný 60 s — druhé volanie nesmie znovu sondovať
        Http::assertSentCount(2);
    }

    public function test_health_bez_nastaveneho_kluca_nehlasi_objednavky_ako_ok(): void
    {
        config(['sperky.api_key' => '']);
        Http::fake([self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 1]])]);

        $health = $this->client()->health();

        $this->assertFalse($health['ok']);
        $this->assertFalse($health['orders']);
        $this->assertStringContainsString('orders:not_configured', (string) $health['error']);
        // bez kľúča sa objednávkový endpoint ani neskúša
        Http::assertSentCount(1);
    }

    public function test_klient_neposiela_ani_neuklada_cookies(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response(
            $this->ordersBody(1), 200, ['Set-Cookie' => 'PHPSESSID=abc; path=/'],
        )]);

        $this->client()->orders(1, 1);

        // N8: e-shop posiela Set-Cookie, my ho ignorujeme — žiadna Cookie hlavička
        Http::assertSent(fn ($request) => ! $request->hasHeader('Cookie'));
    }
}
