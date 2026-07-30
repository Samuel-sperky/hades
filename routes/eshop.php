<?php

/*
 * SPERKY e-shop — čítacie endpointy pre obrazovku „E-shop" a pre chatový nástroj.
 *
 * Súbor je zapojený v bootstrap/app.php pod prefixom `api/eshop` s middleware
 * `api` + `throttle:config('sperky.throttle')`.
 *
 * Rozsah kľúča je `orders:read` — tu NIE JE a nikdy nesmie byť zápisová cesta.
 * Produktové endpointy sú verejné a kľúč nepotrebujú (posiela sa len k objednávkam).
 *
 * Kontrakt odpovede je popísaný v EshopController — {ok, data, meta} / {ok, data, error}.
 */

use App\Http\Controllers\EshopController;
use Illuminate\Support\Facades\Route;

// Zoznamy a detaily idú naživo cez SperkyClient (cache: zoznamy 5 min, detaily 15 min).
Route::get('/orders', [EshopController::class, 'orders'])->name('eshop.orders');
Route::get('/orders/{id}', [EshopController::class, 'order'])
    ->whereNumber('id')
    ->name('eshop.order');

Route::get('/products', [EshopController::class, 'products'])->name('eshop.products');
Route::get('/products/{id}', [EshopController::class, 'product'])
    ->whereNumber('id')
    ->name('eshop.product');

// Hlavné čísla obrazovky: POČTY objednávok (denné/okno/celkovo) + rozpad podľa
// krajín z mesačných súhrnov. Súhrnný obrat sa nevracia — `total_paid` mieša
// HUF, CZK a EUR (nález N1 v 08-SPERKY-API-SPEC.md).
Route::get('/summary', [EshopController::class, 'summary'])->name('eshop.summary');

// Indikátor dostupnosti. Vždy HTTP 200 — je to hlásenie o stave, nie zlyhanie.
Route::get('/health', [EshopController::class, 'health'])->name('eshop.health');
