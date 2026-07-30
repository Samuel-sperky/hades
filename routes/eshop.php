<?php

/*
 * SPERKY e-shop — čítacie endpointy pre obrazovku „E-shop" a pre chatový nástroj.
 *
 * SKELETON. Napĺňa agent SPERKY-BE; súbor je už zapojený v bootstrap/app.php
 * pod prefixom `api/eshop` s middleware `api`, takže netreba siahať do
 * zdieľaných súborov.
 *
 * Rozsah kľúča je `orders:read` — tieto routy teda NIKDY nesmú zapisovať do
 * e-shopu. Produktové endpointy sú verejné a kľúč nepotrebujú.
 *
 * Povinne throttle: appka je verejne tunelovaná cez ngrok a SPERKY API má
 * vlastný rate limit, ktorého vyčerpanie by odstrelilo aj legitímne volania
 * (nález N5 v 08-SPERKY-API-SPEC.md).
 *
 * Očakávané routy (návrh, uprav podľa potreby):
 *   GET  orders            zoznam, page/per_page (per_page clamp na 100, nález N8)
 *   GET  orders/{id}       detail jednej objednávky
 *   GET  products          zoznam produktov
 *   GET  products/{id}     detail produktu (bez variantov — nález N2)
 *   GET  summary           počty + rozpad podľa country_iso (NIE súhrnný obrat, nález N1)
 *   GET  health            dostupnosť API pre indikátor v UI
 */

use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => response()->json(['ok' => false, 'error' => 'not_implemented'], 501))
    ->name('eshop.health');
