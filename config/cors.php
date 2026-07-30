<?php

/*
|--------------------------------------------------------------------------
| CORS — koniec `Access-Control-Allow-Origin: *`
|--------------------------------------------------------------------------
|
| Do W2 tento súbor NEEXISTOVAL, takže platil framework default
| `allowed_origins => ['*']` na všetkých `/api/*` — vrátane zápisových
| (`POST /api/nodes`, `DELETE /api/nodes/{id}`, `POST /api/chat`). Ktorákoľvek
| stránka na internete tak mohla z prehliadača používateľa čítať aj mazať jeho
| dlhodobú pamäť. Rozhodnutie #23.
|
| SPA je servírovaná z TEJ ISTEJ origin ako API, takže same-origin požiadavky
| CORS hlavičky vôbec nepotrebujú — whitelist je tu len pre legitímne prípady
| (Caddy tunel, ngrok domain) a je zámerne úzky.
|
| `supports_credentials` zostáva false: interné `/api/*` sú stateless a session
| cookie nepoužívajú. Pri true + úzkom whiteliste by ostalo CSRF riziko.
*/

$port = (string) config('auraai.public_app_port', '8082');

/** Loopback varianty appky a Caddy proxy (8095 v kontajneri → 8084 na hostiteľovi). */
$loopback = [];
foreach (['localhost', '127.0.0.1'] as $host) {
    foreach ([$port, '8084'] as $p) {
        $loopback[] = "http://{$host}:{$p}";
    }
}

/** Ďalšie povolené originy (napr. ngrok domain), ';' oddelené. Bez '*'. */
$extra = array_values(array_filter(
    array_map('trim', explode(';', (string) env('AURAAI_ALLOWED_ORIGINS', ''))),
    fn (string $origin): bool => $origin !== '' && $origin !== '*',
));

$appUrl = rtrim((string) config('app.url', ''), '/');

return [

    // /mcp je tu tiež — má vlastný token guard, ale wildcard origin by z neho
    // urobil cross-origin zápisový endpoint do pamäte.
    'paths' => ['api/*', 'mcp'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_unique(array_filter(
        array_merge([$appUrl], $loopback, $extra),
        fn (string $origin): bool => $origin !== '',
    ))),

    // Žiadne regex vzory — wildcard subdomény sú presne to, čo tu nechceme.
    'allowed_origins_patterns' => [],

    'allowed_headers' => [
        'Accept',
        'Authorization',
        'Content-Type',
        'X-Requested-With',
    ],

    // Klient potrebuje vidieť limity, aby rozlíšil 429 od chyby servera
    // (core/api.js mapuje 429 na code 'rate_limited').
    'exposed_headers' => [
        'Retry-After',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
    ],

    'max_age' => 0,

    'supports_credentials' => false,

];
