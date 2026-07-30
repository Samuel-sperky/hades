<?php

namespace Tests\Support;

use Illuminate\Support\Facades\Route;

/**
 * Registrácia `routes/chat.php` v teste.
 *
 * `bootstrap/app.php` je súbor integrátora (P4), takže balík P5 doň nesmie
 * pridať `->group(routes/chat.php)`. Aby testy overovali REÁLNE endpointy
 * a nie ich napodobeninu, načítajú si ten istý route súbor rovnakým spôsobom,
 * ako to spraví integrátorov patch:
 *
 *     Route::middleware('api')->prefix('api')->group(__DIR__.'/../routes/chat.php');
 *
 * Keď patch dobehne, tento trait sa stane redundantným (routy sa len prepíšu
 * tou istou definíciou) a testy zostanú zelené bez zmeny.
 */
trait LoadsChatRoutes
{
    protected function loadChatRoutes(): void
    {
        Route::middleware('api')->prefix('api')->group(base_path('routes/chat.php'));
    }
}
