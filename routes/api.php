<?php

use App\Http\Controllers\ActivationController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\MindController;
use App\Http\Controllers\NodeController;
use Illuminate\Support\Facades\Route;

Route::get('/mind', [MindController::class, 'graph']);
Route::get('/mind/stats', [MindController::class, 'stats']);

Route::get('/nodes/{node}', [NodeController::class, 'show']);
Route::put('/nodes/{node}', [NodeController::class, 'update']);
Route::delete('/nodes/{node}', [NodeController::class, 'destroy']);

Route::get('/activations', [ActivationController::class, 'index']);

Route::post('/chat', [ChatController::class, 'send']);
