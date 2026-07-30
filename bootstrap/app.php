<?php

use App\Http\Controllers\McpController;
use App\Mcp\Exceptions\ToolValidationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Psr\Log\LogLevel;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        channels: __DIR__.'/../routes/channels.php',
        health: '/up',
        then: function (): void {
            // /mcp = zápisový vstup do dlhodobej pamäte na verejne tunelovanej
            // appke. Poradie middleware je zámerné: throttle je PRED auth, aby
            // sa počítal aj neautentizovaný flood a nedal sa endpoint zavaliť
            // pokusmi o token. Rozhodnutie #21.
            Route::middleware([
                'api',
                'throttle:'.(string) config('mcp.throttle', '120,1'),
                'auth.mcp',
            ])->match(['get', 'post', 'delete'], '/mcp', McpController::class);
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->alias([
            // Bearer-token guard pre externé /api/v1/* (fail-closed).
            'auth.token' => App\Http\Middleware\AuthenticateApiToken::class,
            // Token guard pre /mcp (Bearer alebo ?token=, fail-closed).
            'auth.mcp' => App\Http\Middleware\AuthenticateMcp::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp'),
        );

        // Log hygiena (rozhodnutie #38). 87 zo 102 „chýb" v laravel.log boli
        // validačné výnimky z MCP toolov — chýbajúci argument nie je porucha
        // servera a v error logu nemá čo robiť. Chybu klient stále dostane
        // (JSON-RPC -32602 / isError), len sa nezapíše ako error.
        $exceptions->dontReport([
            ToolValidationException::class,
        ]);

        // HTTP validácia (422) patrí do debug úrovne z toho istého dôvodu.
        // Laravel ju dnes nereportuje sám (internalDontReport), toto je explicitná
        // poistka, aby ju budúca zmena handleru nevrátila do error logu.
        $exceptions->level(ValidationException::class, LogLevel::DEBUG);
    })->create();
