<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\Sperky\Exceptions\SperkyApiException;
use App\Services\Sperky\Exceptions\SperkyDomainException;
use App\Services\Sperky\OrderScanner;
use App\Services\Sperky\SperkyAggregator;
use App\Services\Sperky\SperkyClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Čítacie endpointy e-shopu pre obrazovku „E-shop" a pre chatový nástroj.
 *
 * Kontrakt odpovede je STABILNÝ (SPERKY-FE na ňom stavia paralelne):
 *
 *   úspech:  {"ok": true,  "data": <payload>, "meta": {"cached": bool, "source": "sperky"}}
 *   chyba:   {"ok": false, "data": null, "error": {"code": "<stroj>", "message": "<SK text>"}}
 *
 * `error.code` je z uzavretého zoznamu: not_found · no_id · bad_request ·
 * forbidden · rate_limited · timeout · unavailable · server · malformed ·
 * bad_route · unexpected. Frontend sa rozhoduje podľa `code`, nie podľa textu.
 *
 * Rozsah kľúča je `orders:read` — tento controller nemá ani jednu zápisovú
 * cestu a nikdy mať nebude.
 *
 * `GET health` vracia 200 aj keď je e-shop mimo — je to hlásenie o stave, nie
 * zlyhanie. Obrazovka podľa neho ukáže indikátor a nespadne.
 */
class EshopController extends Controller
{
    public function __construct(
        private readonly SperkyClient $client,
        private readonly OrderScanner $scanner,
        private readonly SperkyAggregator $aggregator,
    ) {}

    /** GET /api/eshop/orders?page=&per_page= — najnovšie prvé (zoradenie DESC podľa id). */
    public function orders(Request $request): JsonResponse
    {
        return $this->guard(function () use ($request) {
            $data = $this->client->orders(
                $this->intParam($request, 'page', 1),
                $this->intParam($request, 'per_page', null),
            );

            return $this->ok($data + ['sorted_by' => 'id_desc']);
        });
    }

    /** GET /api/eshop/orders/{id} */
    public function order(int $id): JsonResponse
    {
        if ($id < 1) {
            return $this->fail('bad_request', 'Neplatné id objednávky.', 400);
        }

        return $this->guard(function () use ($id) {
            $order = $this->client->order($id);

            return $order === null
                ? $this->fail('not_found', 'Objednávka sa nenašla.', 404)
                : $this->ok(['order' => $order]);
        });
    }

    /** GET /api/eshop/products?page=&per_page=&lang= — verejný endpoint, bez kľúča. */
    public function products(Request $request): JsonResponse
    {
        return $this->guard(function () use ($request) {
            $data = $this->client->products(
                $this->intParam($request, 'page', 1),
                $this->intParam($request, 'per_page', null),
                $this->intParam($request, 'lang', null),
            );

            return $this->ok($data);
        });
    }

    /**
     * GET /api/eshop/products/{id}
     *
     * Varianty sa NEVRACAJÚ — `has_attributes` ani `attributes` API neposkytuje
     * (nález N2), takže by ich UI muselo vymyslieť.
     */
    public function product(Request $request, int $id): JsonResponse
    {
        if ($id < 1) {
            return $this->fail('bad_request', 'Neplatné id produktu.', 400);
        }

        return $this->guard(function () use ($request, $id) {
            $product = $this->client->product($id, $this->intParam($request, 'lang', null));

            return $product === null
                ? $this->fail('not_found', 'Produkt sa nenašiel.', 404)
                : $this->ok(['product' => $product]);
        });
    }

    /**
     * GET /api/eshop/summary?days= — hlavné čísla obrazovky.
     *
     * NÁLEZ N1: vracia POČTY (denné, v okne, celkovo v e-shope) a obrat výhradne
     * rozpadnutý podľa krajín zo vzorky. Jedno súhrnné číslo obratu tu
     * NEEXISTUJE a existovať nesmie — `total_paid` mieša HUF, CZK a EUR.
     *
     * Filtrovanie podľa dátumu v API neexistuje (nález N3), takže sa okno
     * počíta u nás: číta sa od `page=1` a scan sa zastaví pri prvej objednávke
     * staršej než okno (nález N4), so stropom requestov z configu.
     */
    public function summary(Request $request): JsonResponse
    {
        $days = max(1, min(31, (int) ($this->intParam($request, 'days', null) ?? (int) config('sperky.summary.days', 7))));
        $ttl = (int) config('sperky.cache.ttl.summary', 300);
        $key = 'sperky:summary:'.$days;

        try {
            $cached = $ttl > 0 ? Cache::get($key) : null;
        } catch (Throwable) {
            $cached = null;
        }

        if (is_array($cached)) {
            return $this->ok($cached, cached: true);
        }

        $payload = $this->buildSummary($days);

        if ($ttl > 0) {
            try {
                Cache::put($key, $payload, $ttl);
            } catch (Throwable) {
                // cache je nice-to-have
            }
        }

        return $this->ok($payload);
    }

    /**
     * GET /api/eshop/health — indikátor dostupnosti pre UI. Vždy HTTP 200.
     *
     * `orders` a `products` sú hlásené oddelene: chýbajúci kľúč zhodí objednávky
     * aj pri úplne zdravom e-shope a obrazovka to má povedať presne.
     */
    public function health(): JsonResponse
    {
        try {
            $health = $this->client->health();
        } catch (Throwable) {
            // health() sám výnimku nevyhadzuje; toto je posledná poistka, aby
            // indikátor v UI nikdy nepadol na 500.
            $health = [
                'ok' => false, 'orders' => false, 'products' => false,
                'error' => 'unexpected', 'latency_ms' => 0,
                'checked_at' => now()->toIso8601String(),
                'totals' => ['orders' => null, 'products' => null],
            ];
        }

        return $this->ok($health + ['key_configured' => trim((string) config('sperky.api_key', '')) !== '']);
    }

    /**
     * Živý súhrn. Scanner nikdy nevyhodí výnimku — pri rate limite skončí
     * elegantne s tým, čo stihol (nález N5), takže obrazovka vždy niečo dostane.
     *
     * @return array<string, mixed>
     */
    private function buildSummary(int $days): array
    {
        $until = Carbon::now()->startOfDay()->addDay();   // vrátane dneška
        $from = $until->copy()->subDays($days);

        $config = (array) config('sperky.summary', []);

        try {
            $scan = $this->scanner->scan($from, $until, [
                'per_page' => (int) ($config['per_page'] ?? 100),
                'max_requests' => (int) ($config['max_requests'] ?? 8),
                'sleep_ms' => 0,   // beží na klik používateľa, nie v noci
            ]);
        } catch (Throwable) {
            $scan = null;
        }

        $sampleLimit = (int) ($config['sample_details'] ?? 0);
        $sample = ['details' => [], 'requests' => 0, 'stopped_by' => null];
        if ($scan !== null && $sampleLimit > 0) {
            $sample = $this->scanner->details($scan->ids(), $sampleLimit, 0);
        }

        $live = $scan === null
            ? ['available' => false, 'stopped_by' => 'unexpected']
            : ['available' => $scan->count() > 0 || $scan->isComplete(), 'stopped_by' => $scan->stoppedBy];

        return [
            'generated_at' => now()->toIso8601String(),
            'window' => [
                'days' => $days,
                'from' => $from->toDateString(),
                'until' => $until->toDateString(),
            ],
            // POČTY sú jediné bezpečné súhrnné čísla (nález N1)
            'orders' => [
                'in_window' => $scan === null ? null : ($scan->count() === 0 && ! $scan->isComplete() ? null : $scan->count()),
                'today' => $scan === null ? null : $this->countForDay($scan->orders, Carbon::now()->toDateString()),
                'complete' => $scan?->isComplete() ?? false,
                // N7: celkový počet vždy z API, nikdy z konštanty
                'total_in_shop' => $scan?->totalOrders,
            ],
            'by_day' => $scan === null ? [] : $this->byDay($scan->orders, $from, $until),
            'countries' => $sample['details'] === [] ? [] : $this->aggregator->countries($sample['details']),
            'countries_meta' => [
                'basis' => 'sample',
                'sample_size' => count($sample['details']),
                'currency_is_estimate' => true,
                'note' => $sampleLimit > 0
                    ? 'Rozpad je zo vzorky detailov — krajina je len v detaile objednávky. '
                        .'Mena je odhad z krajiny, sumy sa nesčítavajú naprieč krajinami.'
                    : 'Rozpad podľa krajín je v mesačných súhrnoch — pri každom otvorení '
                        .'obrazovky by stál jeden request na objednávku.',
            ],
            'months' => $this->months(),
            'live' => $live,
            'scan' => $scan?->meta() ?? ['stopped_by' => 'unexpected', 'complete' => false, 'requests' => 0],
        ];
    }

    /**
     * Denné POČTY objednávok v okne. Bez sumy — počet je jediné číslo, ktoré sa
     * dá naprieč objednávkami bezpečne sčítať.
     *
     * @param  list<array<string, mixed>>  $orders
     * @return list<array{date: string, orders: int}>
     */
    private function byDay(array $orders, Carbon $from, Carbon $until): array
    {
        $buckets = [];
        for ($day = $from->copy(); $day->lessThan($until); $day->addDay()) {
            $buckets[$day->toDateString()] = 0;
        }

        foreach ($orders as $order) {
            $date = $this->dateOf($order);
            if ($date !== null && array_key_exists($date, $buckets)) {
                $buckets[$date]++;
            }
        }

        $rows = [];
        foreach ($buckets as $date => $count) {
            $rows[] = ['date' => (string) $date, 'orders' => (int) $count];
        }

        return $rows;
    }

    /** @param  list<array<string, mixed>>  $orders */
    private function countForDay(array $orders, string $date): int
    {
        $count = 0;
        foreach ($orders as $order) {
            if ($this->dateOf($order) === $date) {
                $count++;
            }
        }

        return $count;
    }

    /** @param  array<string, mixed>  $order */
    private function dateOf(array $order): ?string
    {
        $raw = $order['date_add'] ?? null;
        if (! is_string($raw) || trim($raw) === '') {
            return null;
        }

        try {
            return Carbon::parse($raw)->toDateString();
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * Mesačné súhrny z pamäte (uzly `sperky:month:YYYY-MM`). Obrazovka tak má
     * históriu aj vtedy, keď je API práve mimo.
     *
     * @return list<array<string, mixed>>
     */
    private function months(int $limit = 12): array
    {
        try {
            $nodes = Node::query()
                ->where('external_key', 'like', 'sperky:month:%')
                ->orderByDesc('external_key')
                ->limit($limit)
                ->get(['id', 'external_key', 'label', 'description', 'meta']);
        } catch (Throwable) {
            return [];
        }

        return $nodes->map(function (Node $node) {
            $meta = is_array($node->meta) ? $node->meta : [];

            return [
                'node_id' => (int) $node->id,
                'month' => (string) ($meta['month'] ?? str_replace('sperky:month:', '', (string) $node->external_key)),
                'label' => (string) $node->label,
                'orders' => isset($meta['orders']) ? (int) $meta['orders'] : null,
                'orders_complete' => (bool) ($meta['orders_complete'] ?? false),
                'countries' => array_values((array) ($meta['countries'] ?? [])),
                'countries_meta' => (array) ($meta['countries_meta'] ?? []),
                'top_products' => array_values((array) ($meta['top_products'] ?? [])),
                'generated_at' => $meta['generated_at'] ?? null,
            ];
        })->values()->all();
    }

    /**
     * Preloží výnimky klienta na stabilnú chybovú odpoveď. Text výnimky je
     * bezpečný — je to konštanta z {@see SperkyApiException}, nikdy nie hlavička
     * ani telo odpovede, takže API kľúč sa do odpovede nemá ako dostať.
     *
     * @param  callable(): JsonResponse  $call
     */
    private function guard(callable $call): JsonResponse
    {
        try {
            return $call();
        } catch (SperkyDomainException $e) {
            return $this->fail($e->errorCode, $e->getMessage(), $e->httpStatus ?? 400);
        } catch (SperkyApiException $e) {
            return $this->fail($e->errorCode, $e->getMessage(), $e->httpStatus ?? 503);
        }
    }

    /** @param  array<string, mixed>  $data */
    private function ok(array $data, ?bool $cached = null): JsonResponse
    {
        return response()->json([
            'ok' => true,
            'data' => $data,
            'meta' => [
                'cached' => $cached ?? $this->client->lastCallWasCached(),
                'source' => 'sperky',
            ],
        ]);
    }

    private function fail(string $code, string $message, int $status): JsonResponse
    {
        return response()->json([
            'ok' => false,
            'data' => null,
            'error' => ['code' => $code, 'message' => $message],
        ], $status);
    }

    /** Voliteľný celočíselný parameter; `null` znamená „nezadané" (klient si clampne default). */
    private function intParam(Request $request, string $key, ?int $default): ?int
    {
        $value = $request->query($key);

        return is_numeric($value) ? (int) $value : $default;
    }
}
