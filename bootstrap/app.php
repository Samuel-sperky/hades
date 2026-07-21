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
        // Bearer-token guard pre externé /api/v1/* (fail-closed).
        $middleware->alias([
            'auth.token' => App\Http\Middleware\AuthenticateApiToken::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->is('mcp'),
        );
    })->create();
