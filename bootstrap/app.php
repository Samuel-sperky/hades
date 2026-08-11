<?php

use App\Http\Controllers\McpController;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        then: function (): void {
            Route::middleware('api')
                ->match(['get', 'post', 'delete'], '/mcp', McpController::class);
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Za Caddy proxy (docker/Caddyfile) + ngrok tunelom appka dostáva požiadavky
        // z proxy siete — bez dôvery X-Forwarded-* by Laravel generoval http://localhost
        // URL (mixed content cez https tunel). Bezpečné: porty 8080/8095 sú bindnuté
        // len na 127.0.0.1, takže k appke sa aj tak dostane iba lokálny proxy reťazec.
        $middleware->trustProxies(at: '*');
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp'),
        );
    })->create();
