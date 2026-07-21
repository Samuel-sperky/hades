<?php

namespace App\Http\Controllers\Api\Concerns;

use App\Exceptions\BrainFileNotFoundException;
use App\Exceptions\BrainWriteDisabledException;
use App\Exceptions\SecretsDetectedException;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\JsonResponse;

/**
 * Jednotné mapovanie výnimiek brain-write vrstvy na HTTP kódy (zdieľané medzi
 * Knowledge/Sync/Decision controllermi). Presné kontrakty (handoff od B3):
 *   - BrainWriteDisabledException  → 403  (guard OFF, fail-safe)
 *   - SecretsDetectedException     → 422  (+ patterns[], NIKDY hodnota; retry force=true)
 *   - BrainFileNotFoundException   → 409  (zdrojový .md zmizol)
 *   - LockTimeoutException         → 423  (súbežný brain-sync drží zámok)
 */
trait HandlesBrainErrors
{
    /**
     * Spustí $callback a zmapuje známe brain-write výnimky na JSON chyby.
     * Ak výnimka nie je z tejto rodiny, prebubláva ďalej (globálny handler).
     *
     * @param  callable():JsonResponse  $callback
     */
    protected function guardBrain(callable $callback): JsonResponse
    {
        try {
            return $callback();
        } catch (BrainWriteDisabledException $e) {
            return response()->json(['message' => $e->getMessage(), 'error' => 'brain_write_disabled'], 403);
        } catch (SecretsDetectedException $e) {
            // len NÁZVY vzorov — matched hodnota sa nikdy nevracia ani neloguje
            return response()->json([
                'message' => $e->getMessage(),
                'error' => 'secrets_detected',
                'patterns' => $e->patterns,
                'hint' => 'Ak ide o falošný poplach, zopakuj s force=true.',
            ], 422);
        } catch (BrainFileNotFoundException $e) {
            return response()->json(['message' => $e->getMessage(), 'error' => 'brain_file_not_found'], 409);
        } catch (LockTimeoutException $e) {
            return response()->json([
                'message' => 'Brain-sync práve beží (zámok obsadený) — skús o chvíľu znova.',
                'error' => 'sync_locked',
            ], 423);
        }
    }
}
