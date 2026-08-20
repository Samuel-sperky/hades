<?php

namespace App\Http\Controllers;

use App\Serializers\Screen\DennikScreen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Denník automatických záznamov zo sessions (+ týždenné súhrny) — `GET /api/journal`.
 *
 * Kontrolér sám nič neserializuje: tvar odpovede drží {@see DennikScreen}, tá istá
 * trieda, z ktorej čítá MCP tool `mind_journal`.
 *
 * `project` je **kľúč skupiny**, nie surová hodnota z `meta`: `#bez-projektu`
 * zachytí prázdny projekt aj každý strojový názov adresára. Dovtedy tú skupinu
 * skládal prehliadač, takže sa dala vidieť, ale nedala filtrovať.
 *
 * Vstupy sa **nevalidujú, ale zvierajú** (`limit` v serializéri): endpoint dovtedy
 * na `?limit=999` vrátil 50 a odpovedať naň 422 by bola zmena zmluvy, nie oprava.
 */
class JournalController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(
            (new DennikScreen($request->only(['project', 'limit'])))->data()
        );
    }
}
