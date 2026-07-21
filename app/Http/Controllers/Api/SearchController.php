<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\SearchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/v1/search — externý mirror fulltextu (Bearer token). Tenký wrapper
 * nad SearchService (tá istá služba obsluhuje interné /api/search), aby sa
 * SK-aware engine NEDUPLIKOVAL.
 */
class SearchController extends Controller
{
    public function index(Request $request, SearchService $search): JsonResponse
    {
        $validated = $request->validate([
            'q' => 'required|string|min:2',
        ]);

        return response()->json($search->search($validated['q']));
    }
}
