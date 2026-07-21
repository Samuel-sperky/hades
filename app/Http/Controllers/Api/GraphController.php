<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\GraphService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/graph — externý mirror grafu vedomia (Bearer token). Tenký wrapper
 * nad GraphService (tá istá služba obsluhuje interné /api/mind), aby sa logika
 * NEDUPLIKOVALA. ?scope=live|all.
 */
class GraphController extends Controller
{
    public function index(Request $request, GraphService $graph): JsonResponse
    {
        return response()->json($graph->payload((string) $request->query('scope', 'live')));
    }
}
