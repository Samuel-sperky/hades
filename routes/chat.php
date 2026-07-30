<?php

/*
 * Chatové API. Vlastník P5, klient P6.
 *
 * ZAPOJENIE (patch pre integrátora — `bootstrap/app.php` patrí P4/integrátorovi,
 * preto ho tento balík needituje). Do `withRouting(then: …)` pridať:
 *
 *     Route::middleware('api')->prefix('api')->group(__DIR__.'/../routes/chat.php');
 *
 * a z `routes/api.php` odstrániť starý riadok
 *     Route::post('/chat', [ChatController::class, 'send'])->middleware('throttle:20,1');
 * spolu s `use App\Http\Controllers\ChatController;`.
 *
 * Kým patch nie je aplikovaný, endpointy nie sú v produkcii dostupné; testy si
 * tento súbor registrujú samé (trait Tests\Support\LoadsChatRoutes), takže
 * pokrytie je reálne a nie simulované.
 */

use App\Http\Controllers\Chat\ChatSendController;
use App\Http\Controllers\Chat\ChatStreamController;
use App\Http\Controllers\Chat\ConversationController;
use App\Http\Controllers\Chat\LlmHealthController;
use Illuminate\Support\Facades\Route;

// Rate limit 60/min je lokálny strop z rozhodnutia #125 (cloudová vetva neexistuje).
Route::middleware('throttle:60,1')->group(function (): void {
    Route::post('/chat', ChatSendController::class);
    Route::post('/chat/stream', ChatStreamController::class);
});

Route::get('/chat/health', LlmHealthController::class);

Route::get('/chat/conversations', [ConversationController::class, 'index']);
Route::post('/chat/conversations', [ConversationController::class, 'store']);
Route::get('/chat/conversations/{conversation}', [ConversationController::class, 'show']);
Route::put('/chat/conversations/{conversation}', [ConversationController::class, 'update']);
Route::get('/chat/conversations/{conversation}/export', [ConversationController::class, 'export']);
