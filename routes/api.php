<?php

use App\Http\Controllers\ActivationController;
use App\Http\Controllers\Api\DecisionController;
use App\Http\Controllers\Api\GraphController as ApiGraphController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\KnowledgeController;
use App\Http\Controllers\Api\ReviewController;
use App\Http\Controllers\Api\SearchController as ApiSearchController;
use App\Http\Controllers\Api\StatsController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ContextController;
use App\Http\Controllers\DirectiveController;
use App\Http\Controllers\EdgeController;
use App\Http\Controllers\LibraryController;
use App\Http\Controllers\MaintenanceController;
use App\Http\Controllers\MindController;
use App\Http\Controllers\NodeController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StructureController;
use App\Http\Controllers\TodayController;
use Illuminate\Support\Facades\Route;

Route::get('/mind', [MindController::class, 'graph']);
Route::get('/mind/stats', [MindController::class, 'stats']);
Route::get('/journal', [\App\Http\Controllers\JournalController::class, 'index']);

// Obrazovky redizajnu: Dnes / Knižnica + export balíka do schránky
Route::get('/today', [TodayController::class, 'index']);
Route::get('/library', [LibraryController::class, 'index']);
Route::post('/context/pack', [ContextController::class, 'pack']);

// Smernica pre Claude — prompt builder (KDE ČO NÁJDE: skilly, projekty, fakty, pravidlá)
Route::post('/directive/build', [DirectiveController::class, 'build']);
Route::post('/directive/save', [DirectiveController::class, 'save']);
Route::get('/directive/templates', [DirectiveController::class, 'templates']);
Route::get('/directive/{name}', [DirectiveController::class, 'show']);
Route::get('/directives', [DirectiveController::class, 'index']);

Route::post('/nodes', [NodeController::class, 'store']);
Route::get('/nodes/{node}/suggestions', [NodeController::class, 'suggestions']);
Route::get('/nodes/{node}/markdown', [NodeController::class, 'markdown']);
Route::get('/nodes/{node}', [NodeController::class, 'show']);
Route::put('/nodes/{node}', [NodeController::class, 'update']);
Route::delete('/nodes/{node}', [NodeController::class, 'destroy']);

Route::post('/edges', [EdgeController::class, 'store']);
Route::delete('/edges/{edge}', [EdgeController::class, 'destroy']);

Route::get('/activations', [ActivationController::class, 'index']);

Route::post('/chat', [ChatController::class, 'send'])->middleware('throttle:20,1');

// Foldering / štruktúra vedomia
Route::get('/structure', [StructureController::class, 'index']);
Route::put('/departments/{department}', [StructureController::class, 'updateDepartment']);
Route::delete('/departments/{department}', [StructureController::class, 'destroyDepartment']);

// Vyhľadávanie naprieč uzlami a playbookmi
Route::get('/search', [SearchController::class, 'index']);

// Údržba — duplicity a zlučovanie uzlov
Route::get('/duplicates', [MaintenanceController::class, 'duplicates']);
Route::post('/nodes/{node}/merge/{target}', [MaintenanceController::class, 'merge']);

// ---------------------------------------------------------------------------
// Interné /api/* pre SPA (same-origin, BEZ Bearer tokenu) — §4.3.
// Zdieľané controllery s v1: SPA nikdy nedrží token.
// ---------------------------------------------------------------------------
Route::get('/dashboard', [StatsController::class, 'index']);       // = /api/v1/stats
Route::post('/sync', [SyncController::class, 'store']);            // lock → 423
Route::get('/decisions', [DecisionController::class, 'index']);
Route::post('/decisions', [DecisionController::class, 'store']);   // §4.7 aj pri guard OFF
Route::get('/tags', [KnowledgeController::class, 'tags']);

// Kontrola — verify/review fronta (B5). Interné /api/* bez tokenu (SPA).
Route::get('/review/queue', [ReviewController::class, 'queue']);
Route::post('/nodes/{node}/verify', [ReviewController::class, 'verify']);
Route::post('/nodes/{node}/resolve-review', [ReviewController::class, 'resolveReview']);

// ---------------------------------------------------------------------------
// Externé /api/v1/* — programatický mirror. Health bez tokenu, zvyšok
// auth.token (Bearer, fail-closed). Rovnaké controllery ako interné.
// ---------------------------------------------------------------------------
Route::prefix('v1')->group(function (): void {
    Route::get('/health', [HealthController::class, 'index']);

    Route::middleware('auth.token')->group(function (): void {
        Route::get('/knowledge', [KnowledgeController::class, 'index']);
        Route::post('/knowledge', [KnowledgeController::class, 'store']);
        Route::get('/knowledge/{node}', [KnowledgeController::class, 'show']);
        Route::put('/knowledge/{node}', [KnowledgeController::class, 'update']);
        Route::delete('/knowledge/{node}', [KnowledgeController::class, 'destroy']);

        Route::get('/graph', [ApiGraphController::class, 'index']);
        Route::get('/search', [ApiSearchController::class, 'index']);
        Route::get('/stats', [StatsController::class, 'index']);
        Route::post('/sync', [SyncController::class, 'store']);

        Route::get('/decisions', [DecisionController::class, 'index']);
        Route::post('/decisions', [DecisionController::class, 'store']);
        Route::get('/tags', [KnowledgeController::class, 'tags']);

        // Kontrola — verify/review fronta (B5), externý mirror.
        Route::get('/review/queue', [ReviewController::class, 'queue']);
        Route::post('/nodes/{node}/verify', [ReviewController::class, 'verify']);
        Route::post('/nodes/{node}/resolve-review', [ReviewController::class, 'resolveReview']);
    });
});
