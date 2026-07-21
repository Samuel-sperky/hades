<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Brain\BrainSyncService;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * POST /api/sync (interné, bez tokenu) = POST /api/v1/sync (Bearer token) —
 * spustí brain-sync. Zdieľaný controller: SPA volá interný variant, programatický
 * klient v1. Súbežný sync drží Cache::lock('brain-sync') → 423.
 */
class SyncController extends Controller
{
    public function store(Request $request, BrainSyncService $sync): JsonResponse
    {
        $validated = $request->validate([
            'source' => 'nullable|string|max:120',
            'dry_run' => 'nullable|boolean',
        ]);

        $source = $validated['source'] ?? null;
        $dryRun = (bool) ($validated['dry_run'] ?? false);

        try {
            $result = $sync->sync($source, $dryRun);
        } catch (LockTimeoutException $e) {
            return response()->json([
                'message' => 'Brain-sync práve beží (zámok obsadený) — skús o chvíľu znova.',
                'error' => 'sync_locked',
            ], 423);
        }

        return response()->json($result);
    }
}
