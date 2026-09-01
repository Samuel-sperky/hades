<?php

namespace App\Http\Controllers;

use App\Models\Run;
use App\Serializers\Screen\RunDetailScreen;
use App\Serializers\Screen\RunsScreen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * Log behov pre obrazovku Runy — `GET /api/runs` a `GET /api/runs/{uuid}`.
 *
 * Kontrolér sám nič neserializuje: tvar odpovede drží {@see RunsScreen} a
 * {@see RunDetailScreen}, tie isté triedy, z ktorých čítajú MCP tooly `mind_runs`
 * a `mind_run`. To je celý zmysel dvojitej plochy — keby si kontrolér skladal
 * odpoveď sám, plochy by sa rozišli pri prvej zmene obrazovky.
 *
 * Endpointy sú **len na čítanie**. „Spustiť znovu" vedome nie je akcia servera:
 * vracia sa zadanie behu a nový ťah spustí klient bežnou cestou
 * `POST /api/console/run`. Inak by vznikla druhá cesta k spusteniu modelu, ktorá
 * obchádza dvojfázovú bránu — a tá brána je to jediné, čo stojí medzi lokálnym
 * modelom a zápisom do pamäte.
 */
class RunsController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $validator = Validator::make($request->query(), [
            'status' => 'sometimes|nullable|string|in:running,waiting,done,aborted,failed',
            'model' => 'sometimes|nullable|string|max:120',
            'source' => 'sometimes|nullable|string|max:32',
            'thread' => 'sometimes|nullable|uuid',
            'since' => 'sometimes|nullable|date',
            'q' => 'sometimes|nullable|string|max:200',
            // `sort` sa validuje proti TEJ ISTEJ whitelist konštante, z ktorej sa
            // berie stĺpec do `ORDER BY`. Druhý zoznam povolených hodnôt tu by bol
            // presne to miesto, kde sa dve kópie jedného pravidla rozídu — a rozišli
            // by sa vo prospech útočníka: `in:` by povolilo, čo serializér nemá.
            'sort' => 'sometimes|nullable|string|in:'.implode(',', array_keys(RunsScreen::SORTS)),
            'dir' => 'sometimes|nullable|string|in:asc,desc',
            'limit' => 'sometimes|nullable|integer|min:1|max:'.RunsScreen::MAX_LIMIT,
        ]);

        if ($validator->fails()) {
            return response()->json(['message' => $validator->errors()->first()], 422);
        }

        return response()->json((new RunsScreen($validator->validated()))->data());
    }

    public function show(string $uuid): JsonResponse
    {
        $run = Run::query()->with('thread:id,uuid,title')->where('uuid', $uuid)->first();

        if ($run === null) {
            return response()->json(['message' => 'Taký beh neexistuje.'], 404);
        }

        return response()->json((new RunDetailScreen($run))->data());
    }

    /**
     * Zadanie behu na znovu spustenie. Vracia text a vlákno, nie nový beh —
     * dôvod je v komentári triedy.
     */
    public function rerun(string $uuid): JsonResponse
    {
        $run = Run::query()->with('thread:id,uuid,title')->where('uuid', $uuid)->first();

        if ($run === null) {
            return response()->json(['message' => 'Taký beh neexistuje.'], 404);
        }

        $detail = new RunDetailScreen($run);
        $prompt = $detail->userPrompt();

        if ($prompt === '') {
            return response()->json(['message' => 'Tento beh nemá zadanie, ktoré by sa dalo zopakovať.'], 422);
        }

        return response()->json([
            'prompt' => $prompt,
            'thread' => $run->thread?->uuid,
            'provider' => $run->provider,
            'model' => $run->model,
        ]);
    }
}
