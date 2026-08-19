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
            // /mcp je od 12.8.2026 za tokenom (AuthenticateMcp, fail-closed).
            // Predtým ho chránil len binding na 127.0.0.1, čo nechránilo pred
            // žiadnym procesom na tom istom stroji.
            Route::middleware(['api', App\Http\Middleware\AuthenticateMcp::class])
                ->match(['get', 'post', 'delete'], '/mcp', McpController::class);
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Bearer-token guard pre externé /api/v1/* (fail-closed) a session guard
        // pre UI okruh — dashboard `/` aj interné /api/* (tiež fail-closed).
        $middleware->alias([
            'auth.token' => App\Http\Middleware\AuthenticateApiToken::class,
            'auth.ui' => App\Http\Middleware\AuthenticateUi::class,
            // Programový okruh konzoly (CLI, desktop, skript): ten istý UI token
            // v hlavičke, ale LOOPBACK-ONLY a bez session aj bez CSRF. Viď
            // AuthenticateConsoleToken — a routes/api.php, kde je popísané, prečo
            // tento okruh vôbec existuje.
            'auth.console' => App\Http\Middleware\AuthenticateConsoleToken::class,
        ]);

        // UI guard musí bežať PRED route model bindingom. Inak SubstituteBindings
        // (je v priority zozname, takže si predbehne route middleware) stihne
        // vrátiť 404 na neexistujúce id ešte pred 401 — a nezamknutý klient by
        // tým zistil, ktoré uzly v pamäti existujú.
        $middleware->prependToPriorityList(
            before: Illuminate\Routing\Middleware\SubstituteBindings::class,
            prepend: App\Http\Middleware\AuthenticateUi::class,
        );

        // Ten istý dôvod pre programový okruh: `/console/cli/threads/{thread:uuid}`
        // by inak vrátilo 404 na neexistujúce vlákno ešte pred 401, a nezamknutý
        // klient by tým zistil, ktoré vlákna existujú.
        $middleware->prependToPriorityList(
            before: Illuminate\Routing\Middleware\SubstituteBindings::class,
            prepend: App\Http\Middleware\AuthenticateConsoleToken::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp'),
        );
    })->create();
