<?php

namespace App\Http\Controllers\Api;

use App\Exceptions\BrainFileNotFoundException;
use App\Exceptions\BrainWriteDisabledException;
use App\Exceptions\SecretsDetectedException;
use App\Http\Controllers\Api\Concerns\HandlesBrainErrors;
use App\Http\Controllers\Controller;
use App\Models\Decision;
use App\Serializers\Screen\RozhodnutiaScreen;
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
     *
     * Tvar odpovede drží {@see RozhodnutiaScreen} — tá istá trieda, z ktorej čerpá
     * MCP tool `mind_decisions`. Kontrolér sám neserializuje nič: keby si odpoveď
     * skládal, plocha človeka a plocha AI by sa rozišli pri prvej zmene obrazovky
     * (a raz už sa tak rozišli — názov oblasti brala obrazovka z grafu).
     *
     * `q` a `limit` sa **nevalidujú**, ale sanitizujú v serializéri. Doteraz ich
     * endpoint nepoznal a mlčky zahadzoval; zaviesť na nich 422 by bola zmena
     * chovania externého mirroru `/api/v1/decisions`.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'year' => 'nullable|integer',
            'area' => 'nullable|string',
            'origin' => 'nullable|in:session,brain',
        ]);

        return response()->json((new RozhodnutiaScreen($validated + [
            'q' => $request->query('q'),
            'limit' => $request->query('limit'),
        ]))->data());
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
                    if ($e instanceof SecretsDetectedException
                        || $e instanceof BrainWriteDisabledException
                        || $e instanceof BrainFileNotFoundException) {
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

    /**
     * DELETE — zmaže jedno rozhodnutie.
     *
     * Prečo to existuje: obrazovka Rozhodnutia mala dovtedy len `index` a `store`,
     * takže zle zapísané rozhodnutie sa dalo napraviť jedine tým, že sa vedľa neho
     * zapíše ďalšie. Plocha, ktorej účel je držať pamäť v poriadku, tak sama
     * neporiadok vyrábala.
     *
     * **Markdown zrkadlo sa nemaže.** Pri `origin=brain` žije text rozhodnutia aj
     * v súbore (`source_file`) a vyrezať z neho riadok je zásah do mozgu, nie do
     * indexu — a nevratný. Cestu preto vraciame v odpovedi, nech UI vie povedať
     * pravdu: záznam je preč, zápis v `.md` zostáva. Nič ho späť do DB nenaimportuje
     * (rozhodnutia sa zo súborov nesynchronizujú), takže obrazovka ostane čistá.
     *
     * Neexistujúce id rieši route model binding (404) — vlastnú vetvu nemá,
     * lebo by bola druhá kópia toho istého pravidla.
     */
    public function destroy(Decision $decision): JsonResponse
    {
        $id = $decision->id;
        $sourceFile = $decision->source_file;

        $decision->delete();

        return response()->json(['deleted' => $id, 'source_file' => $sourceFile]);
    }

    /**
     * Oblasť podľa id (numerické) alebo slug/mena. Vráti area_id alebo null.
     *
     * Jediná implementácia žije v serializéri — zápis a filter musia rozumieť
     * tomu istému menu, inak by rozhodnutie uložené pod „Vývoj / kód" nebolo
     * nájditeľné filtrom `area=vyvoj-kod` a nikto by to nezbadal.
     */
    private function resolveAreaId(string $area): ?int
    {
        return RozhodnutiaScreen::resolveAreaId($area);
    }
}
