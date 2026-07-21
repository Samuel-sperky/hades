<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/v1/health — liveness + verzia kontraktu. Jediný v1 endpoint BEZ
 * Bearer tokenu (monitoring/health-check nemá držať tajomstvá).
 */
class HealthController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json([
            'status' => 'ok',
            'name' => config('hades.name'),
            'version' => config('hades.version'),
            'time' => now()->toIso8601String(),
            'brain_write_enabled' => (bool) config('hades.allow_brain_write'),
        ]);
    }
}
