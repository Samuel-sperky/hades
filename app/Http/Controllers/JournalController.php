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
 * Vstupy sa **nevalidujú, ale zvierajú** (`limit` a `offset` v serializéri): endpoint
 * dovtedy na `?limit=999` vrátil 50 a odpovedať naň 422 by bola zmena zmluvy, nie
 * oprava. To isté platí pre `offset` — záporný sa zviera na 0 a offset za koncom
 * vráti prázdne `records` s pravdivým `filtered_total`, nie chybu.
 *
 * `offset` a `q` pribudli 1. 9. 2026: predtým bol `total: 153` proti 50 poslaným
 * záznamom, takže odpoveď sama priznávala 103 záznamov, ku ktorým nevedla cesta.
 */
class JournalController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        return response()->json(
            (new DennikScreen($request->only(['project', 'q', 'offset', 'limit'])))->data()
        );
    }
}
