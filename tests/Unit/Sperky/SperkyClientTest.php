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
            'sperky.currencies' => ['SK' => 'EUR', 'SI' => 'EUR', 'CZ' => 'CZK', 'HU' => 'HUF'],
        ]);
    }

    private function client(): SperkyClient
    {
        return new SperkyClient;
    }

    /** Telo úspešnej odpovede zoznamu objednávok. */
    private function ordersBody(int $perPage = 20, int $total = 1763711): array
    {
        $orders = [];
        for ($i = 0; $i < $perPage; $i++) {
            $orders[] = [
                'id' => 1763724 - $i,
                'date_add' => '2026-07-29 1'.($i % 10).':00:00',
                'total_paid' => '14.85',
            ];
        }

        return ['result' => ['orders' => $orders, 'page' => 1, 'per_page' => $perPage, 'total' => $total]];
    }

    public function test_zoznam_objednavok_pouziva_singularnu_cestu_a_hlavicku_s_klucom(): void
    {
        Http::fake([self::BASE.'/api/order*' => Http::response($this->ordersBody(2))]);

        $result = $this->client()->orders(1, 2);

        $this->assertSame(2, $result['count']);
        $this->assertSame(1763724, $result['orders'][0]['id']);
        // N7: total vždy z API
        $this->assertSame(1763711, $result['total']);

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

    public function test_detail_objednavky_dopocita_odhad_meny_z_krajiny(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response([
            'result' => [
                'ok' => true,
                'id' => 1763724,
                'date_add' => '2026-07-29 12:00:00',
                'total_paid' => '11215',
                'country' => 'Maďarsko',
                'country_iso' => 'hu',
                'product_ids' => [22, 23, 22],
            ],
        ])]);

        $order = $this->client()->order(1763724);

        $this->assertNotNull($order);
        $this->assertSame('HU', $order['country_iso']);
        // N1: mena je ODHAD z krajiny, API ju nevracia
        $this->assertSame('HUF', $order['currency_estimate']);
        $this->assertTrue($order['currency_is_estimate']);
        $this->assertSame(11215.0, $order['total_paid']);
        $this->assertSame([22, 23], $order['product_ids']);
    }

    public function test_neznama_krajina_nedostane_menu_namiesto_odhadu_eur(): void
    {
        Http::fake([self::BASE.'/api/order/get*' => Http::response([
            'result' => ['ok' => true, 'id' => 5, 'total_paid' => '10', 'country_iso' => 'XX'],
        ])]);

        $order = $this->client()->order(5);

        $this->assertNull($order['currency_estimate']);
        $this->assertTrue($order['currency_is_estimate']);
    }

    public function test_detail_produktu_nikdy_neposiela_varianty(): void
    {
        // N2: API tieto kľúče nevracia. Keby ich jedného dňa začalo vracať,
        // klient ich stále nepreposiela — UI nemá na čom postaviť sekciu variantov.
        Http::fake([self::BASE.'/api/products/get*' => Http::response([
            'result' => [
                'ok' => true, 'id' => 22, 'name' => 'Prsteň', 'price' => 19.9,
                'description' => 'dlhý popis', 'description_short' => 'krátky',
                'has_attributes' => true, 'attributes' => [['id' => 1]],
            ],
        ])]);

        $product = $this->client()->product(22);

        $this->assertArrayNotHasKey('has_attributes', $product);
        $this->assertArrayNotHasKey('attributes', $product);
        $this->assertSame('krátky', $product['description_short']);
    }

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
        $key = $this->client()->cacheKey('orders', ['page' => 1, 'per_page' => 100]);

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
            self::BASE.'/api/order*' => Http::response(['result' => ['orders' => [], 'total' => 1763711]]),
            self::BASE.'/api/products*' => Http::response(['result' => ['products' => [], 'total' => 41018]]),
        ]);

        $client = $this->client();
        $health = $client->health();

        $this->assertTrue($health['ok']);
        $this->assertTrue($client->available());
        $this->assertSame(1763711, $health['totals']['orders']);

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
