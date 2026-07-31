<?php

/*
|--------------------------------------------------------------------------
| SPERKY e-shop (sperky-eshop.sk) — READ-ONLY integrácia
|--------------------------------------------------------------------------
|
| Konzumenti: `App\Services\Sperky\SperkyClient` (transport) a
| `App\Services\Sperky\OrderWindowReader` (okná, obrat po menách, krajiny).
| Hodnoty vychádzajú z overenia proti ŽIVEJ produkcii 31. 7. 2026
| (refactor-auraai/08b-SPERKY-API-SPEC-V2.md), nie z dokumentácie e-shopu.
|
| MAPOVANIE KRAJINA→MENA TU UŽ NIE JE a nesmie sa vrátiť ani „ako fallback"
| (rozhodnutie 7). API vracia `currency` v zozname aj v detaile, a staré
| mapovanie neobsahovalo RON ani PLN — 27 % vzorky preto dostalo NESPRÁVNU menu,
| prezentovanú ako odhad. Tichý fallback na nesprávnu menu je horší než chyba.
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
    | stáť viac requestov na e-shop a jeho rate limit je NEZNÁMY.
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
    | Kľúč = prefix + endpoint + sha1(parametre vrátane filtrov). NIKDY nie API kľúč.
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
    | Krajiny pre PRESNÝ rozpad (rozhodnutie 3)
    |--------------------------------------------------------------------------
    |
    | Filter `country` funguje, takže rozpad je presný: jeden dopyt na krajinu
    | vráti `total` pre danú krajinu a okno. Žiadna vzorka detailov, žiadny odhad.
    |
    | Zoznam je krátky zámerne — každá položka je jedna požiadavka na e-shop.
    | Zvyšok okna sa dopočíta ako `other` (počty sa sčítavať smú, sumy v rôznych
    | menách nie). Vo vzorke 100 objednávok boli meny EUR/HUF/RON/PLN/CZK, teda
    | dodacie krajiny SK, HU, RO, PL, CZ.
    */
    'countries' => array_values(array_filter(array_map(
        fn (string $iso) => strtoupper(trim($iso)),
        explode(',', (string) env('SPERKY_COUNTRIES', 'SK,HU,CZ,RO,PL')),
    ))),

    /*
    |--------------------------------------------------------------------------
    | Mesačný agregát (`sperky:aggregate`)
    |--------------------------------------------------------------------------
    |
    | Počet objednávok za mesiac = JEDEN dopyt (`date_from`+`date_to`, `total`
    | z odpovede). Rozpad podľa krajín = jeden dopyt na krajinu.
    |
    | Obrat po menách je jediné, čo sa musí sčítať z riadkov — API súčet
    | neposkytuje. Riadky sa preto stránkujú po 100 a `revenue_max_requests` je
    | strop. Pri ~250 objednávkach denne má mesiac ~7 500 objednávok, teda
    | ~75 strán; strop 150 pokryje aj dvojnásobne silný mesiac. Keď sa nevyčerpá,
    | obrat je presný (`revenue_meta.complete: true`).
    */
    'aggregate' => [
        'per_page' => 100,
        'revenue_max_requests' => (int) env('SPERKY_AGGREGATE_MAX_REQUESTS', 150),
        'sleep_ms' => (int) env('SPERKY_AGGREGATE_SLEEP_MS', 250),
        'area' => 'Biznis & projekty',
        'department' => 'E-shop',
    ],

    /*
    | Živý súhrn pre obrazovku (`GET /api/eshop/summary`). Beží na klik
    | používateľa, preto nižší strop a bez páuz. Okno 7 dní má ~1 700 objednávok,
    | teda ~17 strán; strop 25 to pokryje a odpoveď sa cachuje 5 minút.
    */
    'summary' => [
        'days' => (int) env('SPERKY_SUMMARY_DAYS', 7),
        'per_page' => 100,
        'revenue_max_requests' => (int) env('SPERKY_SUMMARY_MAX_REQUESTS', 25),
    ],

    /*
    | Chat (`SperkyDomainAnswerer`). Obrat aj krajiny sa počítajú z rovnakých
    | filtrov ako obrazovka, len s tvrdším stropom — chatová odpoveď musí prísť
    | rýchlo. Keď sa strop vyčerpá, odpoveď to prizná.
    */
    'chat' => [
        'days' => (int) env('SPERKY_CHAT_DAYS', 7),
        'revenue_max_requests' => (int) env('SPERKY_CHAT_MAX_REQUESTS', 12),
    ],

];
