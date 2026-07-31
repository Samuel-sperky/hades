<?php

namespace Tests\Unit\Mcp;

use App\Mcp\Tools\ShopOrdersTool;
use App\Mcp\Tools\ShopProductsTool;
use Tests\TestCase;

/**
 * Tvar payloadu e-shopových MCP toolov.
 *
 * Klient (`SperkyClient`) už vracia obálku `{orders|products, page, per_page,
 * total, count}`. Tool ju preto NESMIE obaliť druhýkrát — dvojité zanorenie
 * `{"orders":{"orders":[…]}}` model zbytočne mätie (nález VLNA1-SPERKY-BE 4.3).
 *
 * Klient je nahradený fake objektom cez kontejner — test nesmie siahať na
 * SPERKY API.
 */
class ShopToolPayloadTest extends TestCase
{
    private function fakeClient(): object
    {
        return new class
        {
            public function orders(int $page = 1, ?int $perPage = null): array
            {
                return [
                    'orders' => [['id' => 7, 'total_paid' => '10.00']],
                    'page' => $page,
                    'per_page' => $perPage ?? 20,
                    'total' => 1,
                    'count' => 1,
                ];
            }

            public function order(int $id): ?array
            {
                return $id === 7 ? ['id' => 7] : null;
            }

            public function products(int $page = 1, ?int $perPage = null, ?int $lang = null): array
            {
                return [
                    'products' => [['id' => 3, 'name' => 'Prsteň']],
                    'page' => $page,
                    'per_page' => $perPage ?? 20,
                    'total' => 1,
                    'count' => 1,
                ];
            }

            public function product(int $id, ?int $lang = null): ?array
            {
                return $id === 3 ? ['id' => 3] : null;
            }
        };
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->app->instance(ShopOrdersTool::CLIENT, $this->fakeClient());
    }

    public function test_orders_list_is_not_nested_twice(): void
    {
        $out = app(ShopOrdersTool::class)->handle([]);

        $this->assertSame(['orders', 'page', 'per_page', 'total', 'count'], array_keys($out));
        $this->assertIsList($out['orders']);
        $this->assertSame(7, $out['orders'][0]['id']);
    }

    public function test_products_list_is_not_nested_twice(): void
    {
        $out = app(ShopProductsTool::class)->handle([]);

        $this->assertSame(['products', 'page', 'per_page', 'total', 'count'], array_keys($out));
        $this->assertIsList($out['products']);
        $this->assertSame(3, $out['products'][0]['id']);
    }

    public function test_detail_keeps_the_found_envelope(): void
    {
        $this->assertSame(
            ['found' => 1, 'order' => ['id' => 7]],
            app(ShopOrdersTool::class)->handle(['id' => 7]),
        );

        $this->assertSame(
            ['found' => 0, 'product' => null],
            app(ShopProductsTool::class)->handle(['id' => 99]),
        );
    }

    public function test_per_page_is_clamped_to_the_api_maximum(): void
    {
        $this->assertSame(100, app(ShopOrdersTool::class)->handle(['per_page' => 5000])['per_page']);
    }
}
