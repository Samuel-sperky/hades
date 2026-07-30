<?php

/*
|--------------------------------------------------------------------------
| SPERKY e-shop (sperky-eshop.sk) — READ-ONLY integrácia
|--------------------------------------------------------------------------
|
| Jediný konzument tejto konfigurácie je `App\Services\Sperky\SperkyClient`.
| Všetky hodnoty vychádzajú z overenia proti ŽIVEJ produkcii
| (refactor-auraai/08-SPERKY-API-SPEC.md, nálezy N1–N8) — nie z dokumentácie,
| ktorá sa na viacerých miestach mýli.
|
| BEZPEČNOSŤ: `api_key` má scope `orders:read`. Nikdy sa nesmie dostať do
| kódu, testu, logu, cache kľúča, výnimky ani API odpovede. V testoch sa
| nastavuje fiktívna hodnota cez `config([...])` + `Http::fake()`.
*/

return [

    /*
    | Base URL e-shopu. Bez koncového lomítka; klient si cestu doskladá sám.
    */
    'base_url' => rtrim((string) env('SPERKY_API_URL', 'https://sperky-eshop.sk'), '/'),

    /*
    | Kľúč pre `X-Api-Key`. Objednávkové endpointy ho vyžadujú, produktové sú
    | verejné. Prázdna hodnota = objednávky vrátia doménovú chybu `forbidden`
    | (fail-closed), produkty fungujú ďalej.
    */
    'api_key' => (string) env('SPERKY_API_KEY', ''),

    /*
    | Throttle pre `/api/eshop/*` v tvare "<pokusov>,<minút>" (čítané v
    | bootstrap/app.php). Nižšie než MCP, lebo za každým našim requestom môže
    | stáť viac requestov na e-shop a jeho rate limit je NEZNÁMY (nález: presný
    | limit sa nezisťoval, aby sa produkcia netestovala do zablokovania).
    */
    'throttle' => (string) env('SPERKY_THROTTLE', '60,1'),

    /*
    | Timeouty a opakovanie. 8 s total / 2 pokusy s exponenciálnym backoffom.
    | Opakuje sa LEN infrastruktúrne zlyhanie (timeout, 5xx, rate_limited) —
    | `forbidden` ani `not found` opakovať nemá zmysel.
    */
    'timeout' => (int) env('SPERKY_TIMEOUT', 8),
    'connect_timeout' => (int) env('SPERKY_CONNECT_TIMEOUT', 4),
    'attempts' => (int) env('SPERKY_ATTEMPTS', 2),
    'backoff_ms' => (int) env('SPERKY_BACKOFF_MS', 400),

    /*
    | Stránkovanie. `per_page` server clampuje na 100 sám (nález N5/N8), klient
    | ho aj tak nikdy neprekročí — clamp je súčasťou kontraktu, nie nádeje.
    */
    'per_page' => [
        'default' => 20,
        'max' => 100,
    ],

    /*
    | Cache v Redise (v testoch `array`). Žiadna lokálna kópia dát — len krátke
    | okno, aby preklikávanie obrazovky nezavalilo e-shop.
    | Kľúč = prefix + endpoint + sha1(parametre). NIKDY nie API kľúč.
    */
    'cache' => [
        'prefix' => 'sperky',
        'ttl' => [
            'list' => (int) env('SPERKY_CACHE_LIST', 300),      // 5 min
            'detail' => (int) env('SPERKY_CACHE_DETAIL', 900),   // 15 min
            'health' => (int) env('SPERKY_CACHE_HEALTH', 60),    // 1 min
            'summary' => (int) env('SPERKY_CACHE_SUMMARY', 300), // 5 min
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Mena — ODHAD z krajiny (nález N1)
    |--------------------------------------------------------------------------
    |
    | `total_paid` je v mene objednávky, ale API menu NEVRACIA. Zmerané:
    | id 1763724 = 11215 HU (HUF), 1763723 = 4253 CZ (CZK), 1763720 = 14.85 SK (EUR).
    |
    | Toto mapovanie je HEURISTIKA — zákazník z HU mohol zaplatiť v EUR. Každá
    | suma odvodená týmto mapovaním musí byť označená `currency_is_estimate`.
    | Prepočet na jednu menu je ZAKÁZANÝ (appka nemá kurzy) a súčet `total_paid`
    | naprieč krajinami je nezmyselné číslo.
    |
    | Neznáma krajina → `null`, čo znamená „menu nevieme" (nie EUR).
    */
    'currencies' => [
        'SK' => 'EUR', 'SI' => 'EUR', 'AT' => 'EUR', 'DE' => 'EUR', 'IT' => 'EUR',
        'FR' => 'EUR', 'ES' => 'EUR', 'PT' => 'EUR', 'NL' => 'EUR', 'BE' => 'EUR',
        'IE' => 'EUR', 'FI' => 'EUR', 'GR' => 'EUR', 'HR' => 'EUR', 'EE' => 'EUR',
        'LV' => 'EUR', 'LT' => 'EUR', 'LU' => 'EUR', 'CY' => 'EUR', 'MT' => 'EUR',
        'CZ' => 'CZK',
        'HU' => 'HUF',
        'PL' => 'PLN',
        'RO' => 'RON',
        'BG' => 'BGN',
        'DK' => 'DKK',
        'SE' => 'SEK',
        'GB' => 'GBP',
        'CH' => 'CHF',
        'UA' => 'UAH',
    ],

    /*
    |--------------------------------------------------------------------------
    | Mesačný agregát (`sperky:aggregate`)
    |--------------------------------------------------------------------------
    |
    | Objednávky sú zoradené podľa `id` ZOSTUPNE (nález N4) a filtrovanie podľa
    | dátumu neexistuje (nález N3), takže sa číta od `page=1` a scan sa zastaví
    | pri prvej objednávke staršej než okno. Archív má 1,76 M objednávok —
    | `max_requests` je tvrdý strop, ktorý bráni prechodu celého archívu.
    |
    | `sample_details` je počet objednávok, pre ktoré sa dotiahne DETAIL. Krajina
    | (`country_iso`) je len v detaile, takže rozpad podľa krajín je ZO VZORKY,
    | nikdy nie z celého mesiaca — inak by mesiac s 5 000 objednávkami znamenal
    | 5 000 requestov na produkciu.
    */
    'aggregate' => [
        'per_page' => 100,
        'max_requests' => (int) env('SPERKY_AGGREGATE_MAX_REQUESTS', 80),
        'sleep_ms' => (int) env('SPERKY_AGGREGATE_SLEEP_MS', 250),
        'sample_details' => (int) env('SPERKY_AGGREGATE_SAMPLE', 60),
        'area' => 'Biznis & projekty',
        'department' => 'E-shop',
    ],

    /*
    | Živý súhrn pre obrazovku (`GET /api/eshop/summary`). Vlastný, nižší strop
    | requestov — beží na klik používateľa, nie v noci.
    */
    'summary' => [
        'days' => (int) env('SPERKY_SUMMARY_DAYS', 7),
        'per_page' => 100,
        'max_requests' => (int) env('SPERKY_SUMMARY_MAX_REQUESTS', 8),
        'sample_details' => (int) env('SPERKY_SUMMARY_SAMPLE', 0),
    ],

];
