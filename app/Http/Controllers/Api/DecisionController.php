<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\HandlesBrainErrors;
use App\Http\Controllers\Controller;
use App\Models\Area;
use App\Models\Decision;
use App\Services\Brain\BrainText;
use App\Services\Brain\BrainWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Rozhodnutia ako časová os. GET /api/decisions (interné) = GET /api/v1/decisions
 * (Bearer) s filtrami year/area/origin. POST zakladá rozhodnutie:
 *   - guard OFF → len DB záznam origin=session (§4.7 POVOLENÉ),
 *   - guard ON + writable zdroj → aj markdown zrkadlo, origin=brain.
 */
class DecisionController extends Controller
{
    use HandlesBrainErrors;

    /**
     * GET — filtre: year (rok decided_on), area (slug|id), origin (session|brain).
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'year' => 'nullable|integer',
            'area' => 'nullable|string',
            'origin' => 'nullable|in:session,brain',
        ]);

        $query = Decision::query()->orderByDesc('decided_on')->orderByDesc('id');

        if (! empty($validated['year'])) {
            $query->whereYear('decided_on', (int) $validated['year']);
        }

        if (! empty($validated['area'])) {
            $areaId = $this->resolveAreaId($validated['area']);
            // neexistujúca oblasť → prázdny výsledok (nie všetky)
            $query->where('area_id', $areaId ?? -1);
        }

        if (! empty($validated['origin'])) {
            $query->where('origin', $validated['origin']);
        }

        return response()->json([
            'decisions' => $query->limit(500)->get()->map->toApi()->all(),
        ]);
    }

    /**
     * POST — nové rozhodnutie. DB záznam vzniká VŽDY (aj pri guard OFF). Pri
     * guard ON sa navyše zapíše markdown zrkadlo cez BrainWriter (secret-scan →
     * 422, lock → 423). SecretsDetectedException musí zabrániť aj DB zápisu, tak
     * markdown ide PRED vytvorením záznamu.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'text' => 'required|string|max:5000',
            'reason' => 'nullable|string|max:5000',
            'area' => 'nullable|string',
            'decided_on' => 'nullable|date',
            'node_id' => 'nullable|integer|exists:nodes,id',
            'force' => 'nullable|boolean',
        ]);

        return $this->guardBrain(function () use ($validated) {
            $areaId = ! empty($validated['area']) ? $this->resolveAreaId($validated['area']) : null;
            $decidedOn = $validated['decided_on'] ?? now()->toDateString();
            $text = trim($validated['text']);
            $reason = isset($validated['reason']) ? trim((string) $validated['reason']) : null;

            $origin = 'session';
            $sourceFile = null;

            // guard ON → skús markdown zrkadlo; Secrets/lock výnimky prebublú
            // (guardBrain ich zmapuje). Ak nie je writable zdroj, ostane session.
            if (config('hades.allow_brain_write')) {
                try {
                    $res = app(BrainWriter::class)->writeDecision(
                        $text,
                        $reason,
                        $validated['area'] ?? null,
                        $decidedOn,
                        (bool) ($validated['force'] ?? false),
                    );
                    $origin = 'brain';
                    $sourceFile = $res['source_file'];
                } catch (\RuntimeException $e) {
                    // len „žiadny writable zdroj" a pod. → fallback na DB session.
                    // Secrets/BrainWriteDisabled/Lock sú tiež RuntimeException, ale
                    // tie chceme mapovať — preto ich prehodíme ďalej.
                    if ($e instanceof \App\Exceptions\SecretsDetectedException
                        || $e instanceof \App\Exceptions\BrainWriteDisabledException
                        || $e instanceof \App\Exceptions\BrainFileNotFoundException) {
                        throw $e;
                    }
                }
            }

            $decision = Decision::create([
                'node_id' => $validated['node_id'] ?? null,
                'area_id' => $areaId,
                'decided_on' => $decidedOn,
                'text' => $text,
                'reason' => $reason,
                'origin' => $origin,
                'source_file' => $sourceFile,
                'content_hash' => $origin === 'brain' ? BrainText::hash($text.'|'.$decidedOn.'|'.(string) $reason) : null,
            ]);

            return response()->json(['decision' => $decision->toApi()], 201);
        });
    }

    /** Oblasť podľa id (numerické) alebo slug/mena. Vráti area_id alebo null. */
    private function resolveAreaId(string $area): ?int
    {
        if (ctype_digit($area)) {
            return Area::whereKey((int) $area)->value('id');
        }

        $slug = \Illuminate\Support\Str::slug($area);

        return Area::where('slug', $slug)
            ->orWhereRaw('LOWER(name) = ?', [mb_strtolower(trim($area))])
            ->value('id');
    }
}
