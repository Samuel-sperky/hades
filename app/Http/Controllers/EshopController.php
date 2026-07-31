<?php

namespace App\Http\Controllers;

use App\Models\Node;
use App\Services\Sperky\Exceptions\SperkyApiException;
use App\Services\Sperky\Exceptions\SperkyDomainException;
use App\Services\Sperky\OrderWindowReader;
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
 * bad_filter · filter_needs_country · forbidden · rate_limited · timeout ·
 * unavailable · server · malformed · bad_route · unexpected.
 * Frontend sa rozhoduje podľa `code`, nie podľa textu.
 *
 * OBRAT (rozhodnutie 1): `summary` vracia `revenue: [{currency, total, orders}]` —
 * samostatný riadok pre každú menu. Jedno číslo, ktoré by sčítalo sumy v rôznych
 * menách, tu NEEXISTUJE a existovať nesmie. Prepočet na EUR je zakázaný.
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
        private readonly OrderWindowReader $reader,
    ) {}

    /**
     * GET /api/eshop/orders?page=&per_page=&date_from=&date_to=&country=&total_min=&total_max=
     *
     * Filtre sú overené proti živej produkcii (spec v2 §1) a `total` v odpovedi
     * patrí filtrovanému výberu. `total_min`/`total_max` bez `country` sa zamietnu
     * chybou `filter_needs_country` — inak by filter miešal meny (rozhodnutie 8).
     */
    public function orders(Request $request): JsonResponse
    {
        return $this->guard(function () use ($request) {
            $data = $this->client->orders(
                $this->intParam($request, 'page', 1),
                $this->intParam($request, 'per_page', null),
                $this->filterParams($request),
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
     * Vracia aj varianty: `has_attributes` + `attributes` so `quantity`,
     * `ean13`, `reference`, `price_impact`, `is_default`, `values`
     * (spec v2 N2, rozhodnutie 4).
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
     * Počty sú PRESNÉ (jeden dopyt s dátumovým filtrom), rozpad podľa krajín je
     * PRESNÝ (jeden dopyt na krajinu), obrat je PO MENÁCH. Jedno súhrnné číslo
     * obratu naprieč menami tu nevznikne — `total_paid` v EUR a v HUF sú dve
     * rôzne veci a kurz appka nemá (rozhodnutie 1).
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
     * Živý súhrn. Čítanie okna nikdy nevyhodí infrastruktúrnu výnimku — pri
     * nedostupnom e-shope sa vráti okno s `error` a obrazovka to povie.
     *
     * @return array<string, mixed>
     */
    private function buildSummary(int $days): array
    {
        $to = Carbon::now()->startOfDay();
        $from = $to->copy()->subDays($days - 1);
        $fromDate = $from->toDateString();
        $toDate = $to->toDateString();

        $config = (array) config('sperky.summary', []);

        $window = $this->reader->read($fromDate, $toDate, [
            'per_page' => (int) ($config['per_page'] ?? 100),
            'max_requests' => (int) ($config['revenue_max_requests'] ?? 25),
            'sleep_ms' => 0,   // beží na klik používateľa, nie v noci
        ]);

        $breakdown = $this->reader->countries(
            $fromDate,
            $toDate,
            (array) config('sperky.countries', []),
            $window->orders,
        );

        return [
            'generated_at' => now()->toIso8601String(),
            'window' => [
                'days' => $days,
                'from' => $fromDate,
                'to' => $toDate,
            ],
            'orders' => [
                // presný počet z filtrovanej odpovede, nie z prejdených strán
                'in_window' => $window->orders,
                'today' => $this->todayFrom($window->byDay),
                'total_in_shop' => $this->totalInShop(),
            ],
            'by_day' => $window->byDay,
            // OBRAT PO MENÁCH — nikdy jedno číslo naprieč menami (rozhodnutie 1)
            'revenue' => $window->revenue,
            'revenue_meta' => $window->revenueMeta(),
            // PRESNÉ počty na krajinu (rozhodnutie 3) — bez vzorky a bez odhadov
            'countries' => $breakdown['countries'],
            'countries_other' => $breakdown['other'],
            'months' => $this->months(),
            'live' => [
                'available' => $window->available(),
                'error' => $window->error ?? $breakdown['error'],
            ],
        ];
    }

    /**
     * Dnešný počet z denného rozpadu. `null`, keď sa okno neprečítalo celé —
     * dolná hranica sa neprezentuje ako fakt.
     *
     * @param  list<array{date: string, orders: int}>  $byDay
     */
    private function todayFrom(array $byDay): ?int
    {
        $today = Carbon::now()->toDateString();

        foreach ($byDay as $row) {
            if (($row['date'] ?? null) === $today) {
                return (int) $row['orders'];
            }
        }

        return null;
    }

    /** Celkový počet objednávok v e-shope — vždy z API (nález N7). */
    private function totalInShop(): ?int
    {
        try {
            return $this->client->ordersTotal();
        } catch (SperkyApiException|SperkyDomainException) {
            return null;
        }
    }

    /**
     * Filtre z query stringu. Odovzdávajú sa surové — validáciu (vrátane
     * rozhodnutia 8) robí `OrderFilters` a chyba prejde cez `guard()` na 400.
     *
     * @return array<string, mixed>
     */
    private function filterParams(Request $request): array
    {
        $filters = [];

        foreach (['date_from', 'date_to', 'country', 'total_min', 'total_max'] as $key) {
            $value = $request->query($key);
            if (is_string($value) && trim($value) !== '') {
                $filters[$key] = trim($value);
            }
        }

        return $filters;
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
                'revenue' => array_values((array) ($meta['revenue'] ?? [])),
                'revenue_meta' => (array) ($meta['revenue_meta'] ?? []),
                'countries' => array_values((array) ($meta['countries'] ?? [])),
                'countries_other' => $meta['countries_other'] ?? null,
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
