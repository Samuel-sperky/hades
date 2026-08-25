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
        ]);

        // UI guard musí bežať PRED route model bindingom. Inak SubstituteBindings
        // (je v priority zozname, takže si predbehne route middleware) stihne
        // vrátiť 404 na neexistujúce id ešte pred 401 — a nezamknutý klient by
        // tým zistil, ktoré uzly v pamäti existujú.
        $middleware->prependToPriorityList(
            before: Illuminate\Routing\Middleware\SubstituteBindings::class,
            prepend: App\Http\Middleware\AuthenticateUi::class,
        );

        // CSP na HTML plochy (`/`, `/console`, `/chat`). Zavádza sa v REPORT-ONLY
        // režime — prepnutie na vynucovanú je jedna konštanta v tej triede.
        // Meranie, z ktorého politika vyšla: docs/sprint-2026-08-25/MERANIE-CSP.md
        //
        // `web`, nie globálne: `routes/api.php` vracia JSON, NDJSON a stiahnuté
        // prílohy (tie si nesú vlastnú, tvrdšiu politiku), takže tam hlavička
        // nemá čo robiť. Middleware si to aj tak overuje — pošle ju len odpovedi
        // s `Content-Type: text/html` a nikdy neprepíše existujúcu.
        //
        $middleware->web(append: [
            App\Http\Middleware\ContentSecurityPolicy::class,
        ]);

        // …a hlavičku musí dostať AJ odpoveď 401 z `auth.ui`. Samo to nenastane:
        // `AuthenticateUi` je vyššie vložený do PRIORITNÉHO zoznamu, ktorý Laravel
        // radí pred nezaradené middleware skupiny — takže bez tohto riadku vráti
        // guard 401 skôr, než sa CSP vôbec spustí. A práve `errors/401.blade.php`
        // je stránka, na ktorej stojí odôvodnenie najslabšej direktívy politiky
        // (`style-src 'unsafe-inline'` kvôli inline `<style>` bloku), takže by sa
        // meralo všade okrem miesta, kde to najviac záleží.
        //
        // Zaradenie do prioritného zoznamu mení PORADIE, nie členstvo — CSP zostáva
        // len v skupine `web`, teda `routes/api.php` sa jej ďalej netýka.
        $middleware->prependToPriorityList(
            before: App\Http\Middleware\AuthenticateUi::class,
            prepend: App\Http\Middleware\ContentSecurityPolicy::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp'),
        );
    })->create();
