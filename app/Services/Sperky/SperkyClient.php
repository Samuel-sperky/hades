<?php

namespace App\Services\Sperky;

use App\Services\Sperky\Exceptions\SperkyApiException;
use App\Services\Sperky\Exceptions\SperkyDomainException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * JEDINÉ miesto v projekte, ktoré hovorí s e-shopom sperky-eshop.sk.
 *
 * Obrazovka „E-shop", chatový nástroj, MCP tooly aj nočný agregát idú cez tento
 * klient a jeho cache — nikto neobchádza rate limit e-shopu vlastným `Http::get()`.
 *
 * Vychádza z overenia proti ŽIVEJ produkcii (08-SPERKY-API-SPEC.md):
 *
 *   N6  HTTP status NIE JE zdroj pravdy. `forbidden` aj `no id` prichádzajú
 *       s kódom 200 a chybou v tele. Preto sa VŽDY parsuje telo a rozlišuje sa
 *       doménová chyba (`not found` → null) od infrastruktúrnej
 *       (`forbidden` / `rate_limited` / timeout / malformed → výnimka).
 *   N5/N8 `per_page` je clampované na 100 na oboch stranách.
 *   N2  `has_attributes` ani `attributes` API nevracia → varianty sa nikde
 *       nedopĺňajú ani nepredstierajú.
 *   N7  `total` sa vždy prečíta z odpovede, nikdy z konštanty.
 *   N8  Server posiela `Set-Cookie` (PHPSESSID + PrestaShop) — ignorujeme ich.
 *
 * Cesta k objednávkam je SINGULÁR `/api/order`, nie `/api/orders`.
 *
 * BEZPEČNOSŤ: kľúč (`X-Api-Key`, scope `orders:read`) sa posiela výhradne
 * v hlavičke. Nikdy nevstúpi do cache kľúča (hashujú sa len parametre dopytu),
 * do výnimky, do logu ani do návratovej hodnoty. Integrácia je čisto čítacia —
 * klient neposkytuje žiadnu zápisovú metódu.
 */
class SperkyClient
{
    /** Cesty API. Objednávky sú v jednotnom čísle — dokumentácia sa mýli. */
    private const PATH_ORDERS = '/api/order';

    private const PATH_ORDER = '/api/order/get';

    private const PATH_PRODUCTS = '/api/products';

    private const PATH_PRODUCT = '/api/products/get';

    /**
     * Whitelist chybových kódov z tela odpovede. Čokoľvek mimo tohto zoznamu sa
     * mapuje na `unexpected` a surový text sa ZAHODÍ — keby e-shop niekedy
     * vrátil v chybe echo hlavičiek, kľúč by inak skončil v logu.
     */
    private const ERRORS = [
        'not found' => 'not_found',
        'not_found' => 'not_found',
        'no id' => 'no_id',
        'no_id' => 'no_id',
        'forbidden' => 'forbidden',
        'unauthorized' => 'forbidden',
        'invalid_key' => 'forbidden',
        'rate_limited' => 'rate_limited',
        'rate limited' => 'rate_limited',
        'too_many_requests' => 'rate_limited',
        'unknown_controller' => 'bad_route',
        'invalid_action' => 'bad_route',
        'method_not_allowed' => 'bad_route',
    ];

    /** @var array<string, mixed> */
    private readonly array $config;

    private readonly string $baseUrl;

    /** Kľúč žije LEN v tejto property a v hlavičke požiadavky. */
    private readonly string $apiKey;

    private bool $lastCacheHit = false;

    /**
     * @param  array<string, mixed>|null  $config  override `config('sperky')` (testy)
     */
    public function __construct(?array $config = null)
    {
        $this->config = $config ?? (array) config('sperky', []);
        $this->baseUrl = rtrim((string) ($this->config['base_url'] ?? ''), '/');
        $this->apiKey = trim((string) ($this->config['api_key'] ?? ''));
    }

    /**
     * Zoznam objednávok (najnovšie prvé — zoradenie podľa `id` ZOSTUPNE, nález N4).
     *
     * @return array{orders: list<array<string, mixed>>, page: int, per_page: int, total: ?int, count: int}
     */
    public function orders(int $page = 1, ?int $perPage = null): array
    {
        $page = $this->clampPage($page);
        $perPage = $this->clampPerPage($perPage);

        $result = $this->cached('orders', ['page' => $page, 'per_page' => $perPage], 'list', function () use ($page, $perPage) {
            return $this->fetch(self::PATH_ORDERS, ['page' => $page, 'per_page' => $perPage], withKey: true);
        });

        $rows = $this->extractList($result, 'orders');

        return [
            'orders' => array_map(fn (array $row) => $this->normalizeOrderRow($row), $rows),
            'page' => $page,
            'per_page' => $this->readInt($result, 'per_page') ?? $perPage,
            'total' => $this->readInt($result, 'total'),
            'count' => count($rows),
        ];
    }

    /**
     * Detail objednávky. `null` = neexistujúce id (doménový stav, nie porucha).
     *
     * @return array<string, mixed>|null
     */
    public function order(int $id): ?array
    {
        $result = $this->cached('order', ['id' => $id], 'detail', function () use ($id) {
            return $this->fetch(self::PATH_ORDER, ['id' => $id], withKey: true);
        });

        return $result === null ? null : $this->normalizeOrderDetail($result, $id);
    }

    /**
     * Zoznam produktov. Endpoint je verejný — kľúč sa neposiela.
     *
     * @return array{products: list<array<string, mixed>>, page: int, per_page: int, total: ?int, count: int}
     */
    public function products(int $page = 1, ?int $perPage = null, ?int $lang = null): array
    {
        $page = $this->clampPage($page);
        $perPage = $this->clampPerPage($perPage);
        $query = ['page' => $page, 'per_page' => $perPage] + $this->langQuery($lang);

        $result = $this->cached('products', $query, 'list', function () use ($query) {
            return $this->fetch(self::PATH_PRODUCTS, $query, withKey: false);
        });

        $rows = $this->extractList($result, 'products');

        return [
            'products' => array_map(fn (array $row) => $this->normalizeProductRow($row), $rows),
            'page' => $page,
            'per_page' => $this->readInt($result, 'per_page') ?? $perPage,
            'total' => $this->readInt($result, 'total'),
            'count' => count($rows),
        ];
    }

    /**
     * Detail produktu. `null` = neexistujúce id.
     *
     * Varianty sa NEVRACAJÚ — API kľúče `has_attributes` ani `attributes`
     * neposkytuje (nález N2), takže by sme si ich museli vymyslieť.
     *
     * @return array<string, mixed>|null
     */
    public function product(int $id, ?int $lang = null): ?array
    {
        $query = ['id' => $id] + $this->langQuery($lang);

        $result = $this->cached('product', $query, 'detail', function () use ($query) {
            return $this->fetch(self::PATH_PRODUCT, $query, withKey: false);
        });

        return $result === null ? null : $this->normalizeProductDetail($result, $id);
    }

    /**
     * Dostupnosť integrácie pre indikátor v UI. NIKDY nevyhodí výnimku —
     * nedostupný e-shop je normálny stav a appka musí fungovať ďalej.
     *
     * `ok` = obe vetvy odpovedali. Objednávkovú vetvu môže zhodiť chýbajúci
     * kľúč aj pri úplne zdravom e-shope, preto sú vetvy hlásené oddelene.
     *
     * @return array{ok: bool, orders: bool, products: bool, error: ?string, latency_ms: int, checked_at: string, totals: array{orders: ?int, products: ?int}}
     */
    public function health(): array
    {
        $ttl = (int) $this->ttl('health');
        $key = $this->cacheKey('health', []);

        if ($ttl <= 0) {
            return $this->probeHealth();
        }

        try {
            /** @var array<string, mixed> $cached */
            $cached = Cache::remember($key, $ttl, fn () => $this->probeHealth());

            return $this->healthShape($cached);
        } catch (Throwable) {
            // Nedostupná cache nesmie zhodiť health check.
            return $this->probeHealth();
        }
    }

    /** Skratka pre „e-shop odpovedá" (obrazovka aj chatová šablóna). */
    public function available(): bool
    {
        return (bool) $this->health()['ok'];
    }

    /** Bol posledný verejný dopyt obslúžený z cache? (meta pre API odpoveď) */
    public function lastCallWasCached(): bool
    {
        return $this->lastCacheHit;
    }

    /**
     * Cache kľúč. Hashujú sa VÝHRADNE parametre dopytu a base URL — API kľúč
     * sa do kľúča nikdy nedostane (inak by ho vyzradil `redis KEYS *`).
     *
     * @param  array<string, mixed>  $params
     */
    public function cacheKey(string $endpoint, array $params): string
    {
        ksort($params);

        $prefix = (string) (data_get($this->config, 'cache.prefix') ?: 'sperky');
        $fingerprint = sha1($this->baseUrl.'|'.$endpoint.'|'.json_encode($params, JSON_THROW_ON_ERROR));

        return $prefix.':'.$endpoint.':'.$fingerprint;
    }

    /** Najvyššie povolené `per_page` (nález N8 — API viac nedá). */
    public function maxPerPage(): int
    {
        return max(1, (int) (data_get($this->config, 'per_page.max') ?: 100));
    }

    public function clampPerPage(?int $perPage): int
    {
        $default = max(1, (int) (data_get($this->config, 'per_page.default') ?: 20));

        return max(1, min($this->maxPerPage(), $perPage ?? $default));
    }

    public function clampPage(int $page): int
    {
        return max(1, $page);
    }

    /**
     * Cache okolo jedného dopytu. `null` (not found) sa cachuje tiež, aby
     * opakované hľadanie neexistujúceho id nebúchalo na produkciu.
     *
     * @param  array<string, mixed>  $params
     * @param  callable(): ?array<string, mixed>  $fetch
     * @return array<string, mixed>|null
     */
    private function cached(string $endpoint, array $params, string $ttlKey, callable $fetch): ?array
    {
        $ttl = $this->ttl($ttlKey);
        $this->lastCacheHit = false;

        if ($ttl <= 0) {
            return $fetch();
        }

        $key = $this->cacheKey($endpoint, $params);

        try {
            $hit = Cache::get($key);
        } catch (Throwable) {
            $hit = null; // nedostupná cache = ideme naživo
        }

        // Obálka {found, data} je nutná, aby sa dala cachovať aj neexistencia:
        // `Cache::get()` vráti null aj pri prázdnej cache.
        if (is_array($hit) && array_key_exists('found', $hit)) {
            $this->lastCacheHit = true;

            return ($hit['found'] ?? false) === true && is_array($hit['data'] ?? null)
                ? $hit['data']
                : null;
        }

        $result = $fetch();

        try {
            Cache::put($key, ['found' => $result !== null, 'data' => $result], $ttl);
        } catch (Throwable) {
            // zápis do cache je nice-to-have, nikdy nie dôvod zhodiť odpoveď
        }

        return $result;
    }

    /**
     * Jedna požiadavka vrátane opakovania s exponenciálnym backoffom.
     *
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>|null telo `result`; null = `not found`
     *
     * @throws SperkyApiException|SperkyDomainException
     */
    private function fetch(string $path, array $query, bool $withKey, ?int $attempts = null, ?int $timeout = null): ?array
    {
        $attempts = max(1, $attempts ?? (int) ($this->config['attempts'] ?? 2));
        $backoff = max(0, (int) ($this->config['backoff_ms'] ?? 400));
        $last = null;

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            try {
                return $this->attempt($path, $query, $withKey, $timeout);
            } catch (SperkyApiException $e) {
                if (! $e->isRetryable() || $attempt === $attempts) {
                    $this->logFailure($path, $e);

                    throw $e;
                }

                $last = $e;
                // exponenciálny backoff: 400 ms, 800 ms, 1600 ms…
                $this->sleepMs($backoff * (2 ** ($attempt - 1)));
            }
        }

        // nedosiahnuteľné (cyklus vždy vráti alebo vyhodí), ale nechávame fail-closed
        $error = $last ?? SperkyApiException::unavailable();
        $this->logFailure($path, $error);

        throw $error;
    }

    /**
     * @param  array<string, mixed>  $query
     * @return array<string, mixed>|null
     *
     * @throws SperkyApiException|SperkyDomainException
     */
    private function attempt(string $path, array $query, bool $withKey, ?int $timeout): ?array
    {
        try {
            $response = $this->request($withKey, $timeout)->get($this->baseUrl.$path, $query);
        } catch (ConnectionException $e) {
            // Text výnimky sa ZÁMERNE nepreberá do našej výnimky (obsahuje celú
            // požiadavku) — použije sa len na rozlíšenie timeoutu od odmietnutého
            // spojenia, čo je pre indikátor v UI podstatný rozdiel.
            throw str_contains(strtolower($e->getMessage()), 'timed out')
                ? SperkyApiException::timeout()
                : SperkyApiException::unavailable();
        } catch (Throwable) {
            throw SperkyApiException::unavailable();
        }

        return $this->parse($response);
    }

    /**
     * Telo odpovede je zdroj pravdy (nález N6). Status sa berie do úvahy len
     * tam, kde nesie navyše informáciu (429, 5xx).
     *
     * @return array<string, mixed>|null
     *
     * @throws SperkyApiException|SperkyDomainException
     */
    private function parse(Response $response): ?array
    {
        $status = $response->status();

        if ($status === 429) {
            throw SperkyApiException::rateLimited();
        }
        if ($status === 401 || $status === 403) {
            throw SperkyApiException::forbidden();
        }
        if ($status >= 500) {
            throw SperkyApiException::server();
        }

        $body = json_decode($response->body(), true);

        if (! is_array($body)) {
            // 4xx bez JSON = zlá cesta (HTML 404 e-shopu), inak nečitateľná odpoveď
            throw $status >= 400 ? SperkyApiException::badRoute() : SperkyApiException::malformed();
        }

        $result = is_array($body['result'] ?? null) ? $body['result'] : null;
        $error = $this->readError($body, $result);

        if ($error !== null) {
            return $this->throwForError($error);
        }

        if ($result === null) {
            throw SperkyApiException::malformed();
        }

        return $result;
    }

    /**
     * Chybový text z tela: najprv top-level `error` (`{"error":"forbidden"}`),
     * potom `result.error` pri `ok:false` (`{"result":{"ok":false,"error":"not found"}}`).
     *
     * @param  array<string, mixed>  $body
     * @param  array<string, mixed>|null  $result
     */
    private function readError(array $body, ?array $result): ?string
    {
        $top = $body['error'] ?? null;
        if (is_string($top) && trim($top) !== '') {
            return $top;
        }

        if ($result === null) {
            return null;
        }

        $inner = $result['error'] ?? null;
        if (is_string($inner) && trim($inner) !== '') {
            return $inner;
        }

        // `ok:false` bez textu je stále chyba, len bez bližšieho určenia
        if (array_key_exists('ok', $result) && $result['ok'] === false) {
            return 'unknown';
        }

        return null;
    }

    /**
     * @return array<string, mixed>|null null výhradne pre `not found`
     *
     * @throws SperkyApiException|SperkyDomainException
     */
    private function throwForError(string $raw): ?array
    {
        $code = self::ERRORS[strtolower(trim($raw))] ?? 'unexpected';

        return match ($code) {
            'not_found' => null,
            'no_id' => throw SperkyDomainException::noId(),
            'forbidden' => throw SperkyApiException::forbidden(),
            'rate_limited' => throw SperkyApiException::rateLimited(),
            'bad_route' => throw SperkyApiException::badRoute(),
            default => throw SperkyApiException::unexpected(),
        };
    }

    private function request(bool $withKey, ?int $timeout = null): PendingRequest
    {
        $request = Http::acceptJson()
            ->withOptions([
                'connect_timeout' => max(1, (int) ($this->config['connect_timeout'] ?? 4)),
                // N8: e-shop posiela Set-Cookie (PHPSESSID, PrestaShop). Nikdy ich
                // neukladáme ani nepreposielame — sme anonymný čítací klient.
                'cookies' => false,
                'allow_redirects' => false,
            ])
            ->timeout(max(1, $timeout ?? (int) ($this->config['timeout'] ?? 8)));

        // Prázdny kľúč sa neposiela — e-shop vráti `forbidden` a my to
        // ohlásime ako chýbajúcu konfiguráciu, nie ako prázdnu hlavičku.
        if ($withKey && $this->apiKey !== '') {
            $request = $request->withHeaders(['X-Api-Key' => $this->apiKey]);
        }

        return $request;
    }

    /** @return array{ok: bool, orders: bool, products: bool, error: ?string, latency_ms: int, checked_at: string, totals: array{orders: ?int, products: ?int}} */
    private function probeHealth(): array
    {
        $started = microtime(true);
        $errors = [];

        [$ordersOk, $ordersTotal, $ordersError] = $this->probe(self::PATH_ORDERS, withKey: true);
        [$productsOk, $productsTotal, $productsError] = $this->probe(self::PATH_PRODUCTS, withKey: false);

        if ($ordersError !== null) {
            $errors[] = 'orders:'.$ordersError;
        }
        if ($productsError !== null) {
            $errors[] = 'products:'.$productsError;
        }

        return [
            'ok' => $ordersOk && $productsOk,
            'orders' => $ordersOk,
            'products' => $productsOk,
            'error' => $errors === [] ? null : implode(' ', $errors),
            'latency_ms' => (int) round((microtime(true) - $started) * 1000),
            'checked_at' => now()->toIso8601String(),
            'totals' => ['orders' => $ordersTotal, 'products' => $productsTotal],
        ];
    }

    /**
     * Jedna sonda pre health: jeden pokus, krátky timeout, bez cache.
     * Vracia [ok, total z API (nález N7), strojový kód chyby].
     *
     * @return array{0: bool, 1: ?int, 2: ?string}
     */
    private function probe(string $path, bool $withKey): array
    {
        if ($withKey && $this->apiKey === '') {
            return [false, null, 'not_configured'];
        }

        try {
            $result = $this->fetch(
                $path,
                ['page' => 1, 'per_page' => 1],
                withKey: $withKey,
                attempts: 1,
                timeout: max(1, (int) ($this->config['connect_timeout'] ?? 4)),
            );

            return [$result !== null, $this->readInt($result, 'total'), null];
        } catch (SperkyApiException|SperkyDomainException $e) {
            return [false, null, $e->errorCode];
        } catch (Throwable) {
            return [false, null, 'unexpected'];
        }
    }

    /**
     * @param  array<string, mixed>  $cached
     * @return array{ok: bool, orders: bool, products: bool, error: ?string, latency_ms: int, checked_at: string, totals: array{orders: ?int, products: ?int}}
     */
    private function healthShape(array $cached): array
    {
        return [
            'ok' => (bool) ($cached['ok'] ?? false),
            'orders' => (bool) ($cached['orders'] ?? false),
            'products' => (bool) ($cached['products'] ?? false),
            'error' => isset($cached['error']) ? (string) $cached['error'] : null,
            'latency_ms' => (int) ($cached['latency_ms'] ?? 0),
            'checked_at' => (string) ($cached['checked_at'] ?? now()->toIso8601String()),
            'totals' => [
                'orders' => isset($cached['totals']['orders']) ? (int) $cached['totals']['orders'] : null,
                'products' => isset($cached['totals']['products']) ? (int) $cached['totals']['products'] : null,
            ],
        ];
    }

    /**
     * Zoznam z obálky `result`. Názov kľúča sa overoval len na `orders`
     * a `products`, preto sa hľadá aj generický fallback — neznámy tvar sa má
     * prejaviť prázdnym zoznamom, nie výnimkou.
     *
     * @param  array<string, mixed>|null  $result
     * @return list<array<string, mixed>>
     */
    private function extractList(?array $result, string $key): array
    {
        if ($result === null) {
            return [];
        }

        foreach ([$key, 'items', 'data', 'rows'] as $candidate) {
            if (isset($result[$candidate]) && is_array($result[$candidate])) {
                return $this->rowsOf($result[$candidate]);
            }
        }

        return [];
    }

    /**
     * @param  array<mixed>  $list
     * @return list<array<string, mixed>>
     */
    private function rowsOf(array $list): array
    {
        $rows = [];
        foreach ($list as $row) {
            if (is_array($row)) {
                $rows[] = $row;
            }
        }

        return $rows;
    }

    /**
     * Riadok zoznamu objednávok: API tu dáva LEN id, date_add a total_paid.
     * Krajina (a teda odhad meny) je výhradne v detaile — nedopĺňame ju.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function normalizeOrderRow(array $row): array
    {
        return [
            'id' => (int) ($row['id'] ?? 0),
            'date_add' => $this->readString($row, 'date_add'),
            'total_paid' => $this->readFloat($row, 'total_paid'),
            // presná hodnota tak, ako ju drží e-shop (bez float zaokrúhlenia)
            'total_paid_raw' => $this->readString($row, 'total_paid'),
        ];
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function normalizeOrderDetail(array $result, int $fallbackId): array
    {
        $countryIso = strtoupper((string) ($this->readString($result, 'country_iso') ?? ''));

        return [
            'id' => (int) ($result['id'] ?? $fallbackId),
            'date_add' => $this->readString($result, 'date_add'),
            'total_paid' => $this->readFloat($result, 'total_paid'),
            'total_paid_raw' => $this->readString($result, 'total_paid'),
            'country' => $this->readString($result, 'country'),
            'country_iso' => $countryIso !== '' ? $countryIso : null,
            // Mena je ODHAD z krajiny (nález N1) — API ju nevracia.
            'currency_estimate' => SperkyCurrency::fromConfig()->guess($countryIso),
            'currency_is_estimate' => true,
            'product_ids' => $this->readIds($result['product_ids'] ?? null),
        ];
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function normalizeProductRow(array $row): array
    {
        // Zámerne bez `has_attributes` — API kľúč vôbec neposiela (nález N2).
        return [
            'id' => (int) ($row['id'] ?? 0),
            'name' => $this->readString($row, 'name'),
            'price' => $this->readFloat($row, 'price'),
        ];
    }

    /**
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    private function normalizeProductDetail(array $result, int $fallbackId): array
    {
        // Bez variantov: `attributes` API nevracia (nález N2), takže by sme
        // museli vymyslieť prázdne pole a UI by ukázalo sekciu, ktorá nič nevie.
        return [
            'id' => (int) ($result['id'] ?? $fallbackId),
            'name' => $this->readString($result, 'name'),
            'price' => $this->readFloat($result, 'price'),
            'description' => $this->readString($result, 'description'),
            'description_short' => $this->readString($result, 'description_short'),
        ];
    }

    /** @return list<int> */
    private function readIds(mixed $value): array
    {
        if (is_string($value)) {
            $value = preg_split('/[^0-9]+/', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        }

        if (! is_array($value)) {
            return [];
        }

        $ids = [];
        foreach ($value as $item) {
            if (is_array($item)) {
                $item = $item['id'] ?? null;
            }
            if (is_numeric($item) && (int) $item > 0) {
                $ids[] = (int) $item;
            }
        }

        return array_values(array_unique($ids));
    }

    /** @param  array<string, mixed>|null  $data */
    private function readInt(?array $data, string $key): ?int
    {
        $value = $data[$key] ?? null;

        return is_numeric($value) ? (int) $value : null;
    }

    /** @param  array<string, mixed>  $data */
    private function readFloat(array $data, string $key): ?float
    {
        $value = $data[$key] ?? null;

        return is_numeric($value) ? (float) $value : null;
    }

    /** @param  array<string, mixed>  $data */
    private function readString(array $data, string $key): ?string
    {
        $value = $data[$key] ?? null;

        if (is_string($value)) {
            return trim($value) === '' ? null : $value;
        }

        return is_numeric($value) ? (string) $value : null;
    }

    /** @return array<string, int> */
    private function langQuery(?int $lang): array
    {
        return $lang !== null && $lang > 0 ? ['id_lang' => $lang] : [];
    }

    private function ttl(string $key): int
    {
        return (int) (data_get($this->config, 'cache.ttl.'.$key) ?? 0);
    }

    private function sleepMs(int $ms): void
    {
        if ($ms > 0) {
            usleep($ms * 1000);
        }
    }

    /**
     * Log obsahuje VÝHRADNE cestu a strojový kód. Žiadne hlavičky, žiadny
     * query string s parametrami, žiadne telo — kľúč sa do logu nedostane.
     */
    private function logFailure(string $path, SperkyApiException $e): void
    {
        Log::warning('sperky: request failed', $e->context() + ['path' => $path]);
    }
}
