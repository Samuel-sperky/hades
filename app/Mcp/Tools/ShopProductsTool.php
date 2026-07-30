<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Exceptions\ToolValidationException;
use App\Mcp\Tool;

/**
 * `aura_shop_products` — produkty z e-shopu (zoznam alebo detail).
 *
 * Rovnaká lazy väzba na service vrstvu ako {@see ShopOrdersTool}: registruje sa
 * len keď je `mcp.shop_tools` zapnuté A `SperkyClient` existuje. Varianty sa
 * nevracajú — API ich neposkytuje.
 */
class ShopProductsTool implements Tool
{
    use ValidatesArgs;

    public const CLIENT = ShopOrdersTool::CLIENT;

    public function name(): string
    {
        return 'aura_shop_products';
    }

    public function description(): string
    {
        return 'List e-shop products, or fetch one product by id. Returns id, name, price and '
            .'description. Product variants are not available from the shop API.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'integer', 'description' => 'Product id — returns a single product detail'],
                'page' => ['type' => 'integer', 'description' => 'Page number (default 1)'],
                'per_page' => ['type' => 'integer', 'description' => 'Items per page, 1–100 (default 20)'],
                'lang' => ['type' => 'integer', 'description' => 'Language id for names/descriptions'],
            ],
        ];
    }

    public function handle(array $args): array
    {
        $client = $this->client();
        $lang = isset($args['lang']) ? (int) $args['lang'] : null;

        if (isset($args['id'])) {
            $id = (int) $args['id'];
            if ($id < 1) {
                throw new ToolValidationException('Invalid value for id — must be a positive integer.');
            }

            $product = $client->product($id, $lang);

            return $product === null
                ? ['found' => 0, 'product' => null]
                : ['found' => 1, 'product' => $product];
        }

        $products = $client->products(
            $this->clampInt($args, 'page', 1, 1, 100000),
            $this->clampInt($args, 'per_page', 20, 1, 100),
            $lang,
        );

        return ['products' => $products];
    }

    /** SperkyClient — typ nie je hintovateľný, kým balík so service vrstvou nepribudne. */
    private function client(): object
    {
        if (! class_exists(self::CLIENT)) {
            throw new ToolValidationException('E-shop integration is not installed on this instance.');
        }

        return app(self::CLIENT);
    }
}
