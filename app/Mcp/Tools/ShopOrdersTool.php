<?php

namespace App\Mcp\Tools;

use App\Mcp\Concerns\ValidatesArgs;
use App\Mcp\Exceptions\ToolValidationException;
use App\Mcp\Tool;

/**
 * `aura_shop_orders` — objednávky z e-shopu (zoznam alebo detail).
 *
 * Service vrstvu (`App\Services\Sperky\SperkyClient`) dodáva samostatný balík.
 * Tento tool ju rieši z kontajnera LEN pri volaní, takže sa dá zaregistrovať
 * skôr, než trieda existuje — {@see \App\Mcp\ToolRegistry} ho pridá len keď je
 * `mcp.shop_tools` zapnuté A trieda je na svete.
 *
 * Volá TEN ISTÝ klient a cache ako obrazovka a chat — MCP nesmie obchádzať
 * rate limit e-shopu.
 */
class ShopOrdersTool implements Tool
{
    use ValidatesArgs;

    /** FQCN service vrstvy — rieši sa lazy, aby balíky boli nezávislé. */
    public const CLIENT = 'App\Services\Sperky\SperkyClient';

    public function name(): string
    {
        return 'aura_shop_orders';
    }

    public function description(): string
    {
        return 'List recent e-shop orders, or fetch one order by id. Returns order counts, '
            .'country codes and product ids. Amounts are per-currency as stored by the shop — '
            .'never sum them across countries.';
    }

    public function schema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'id' => ['type' => 'integer', 'description' => 'Order id — returns a single order detail'],
                'page' => ['type' => 'integer', 'description' => 'Page number (default 1)'],
                'per_page' => ['type' => 'integer', 'description' => 'Items per page, 1–100 (default 20)'],
            ],
        ];
    }

    public function handle(array $args): array
    {
        $client = $this->client();

        if (isset($args['id'])) {
            $id = (int) $args['id'];
            if ($id < 1) {
                throw new ToolValidationException('Invalid value for id — must be a positive integer.');
            }

            $order = $client->order($id);

            return $order === null
                ? ['found' => 0, 'order' => null]
                : ['found' => 1, 'order' => $order];
        }

        // klient už vracia {orders, page, per_page, total, count} — ďalší obal by
        // dal dvojité zanorenie {"orders":{"orders":[…]}} (nález VLNA1-SPERKY-BE 4.3)
        return $client->orders(
            $this->clampInt($args, 'page', 1, 1, 100000),
            $this->clampInt($args, 'per_page', 20, 1, 100),
        );
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
