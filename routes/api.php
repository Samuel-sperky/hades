<?php

use App\Http\Controllers\ActivationController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\EdgeController;
use App\Http\Controllers\MaintenanceController;
use App\Http\Controllers\MindController;
use App\Http\Controllers\NodeController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\StructureController;
use Illuminate\Support\Facades\Route;

Route::get('/mind', [MindController::class, 'graph']);
Route::get('/mind/stats', [MindController::class, 'stats']);
Route::get('/journal', [\App\Http\Controllers\JournalController::class, 'index']);

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
