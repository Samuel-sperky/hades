<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Services\Console\HeadlessRunner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Jeden ťah konzoly bez človeka — `POST /api/console/headless`.
 *
 * Toto je vstup pre STROJ: skript, plánovaný beh, alebo iná AI cez MCP. Preto
 * jedna JSON odpoveď a nie NDJSON prúd — volajúci nemá kam kresliť tokeny, a
 * kým odpoveď nedorazí celá, aj tak s ňou nič nespraví.
 *
 * Register je v {@see HeadlessRunner} obmedzený na ČÍTANIE a je to podmienka,
 * nie opatrnosť: zápisový tool ťah zaparkuje a čaká na povolenie od človeka.
 * V programovom behu tam nikto nie je, takže vlákno by zostalo trvalo
 * zablokované (ďalšia správa doň už nesmie vojsť). Kto chce zápis, ide cez
 * `/console/cli/*` alebo cez prehliadač, kde je komu sa spýtať.
 *
 * Validácia je tu a nie v runneri, pretože runner volá aj scheduler a MCP —
 * a tam žiadny HTTP request neexistuje.
 */
class HeadlessController extends Controller
{
    public function run(Request $request, HeadlessRunner $runner): JsonResponse
    {
        $data = $request->validate([
            'message' => 'required|string|max:8000',
            'thread' => 'sometimes|nullable|uuid',
            'model' => 'sometimes|nullable|string|max:120',
            'provider' => 'sometimes|nullable|string|max:40',
        ]);

        $result = $runner->run(
            $data['message'],
            $data['thread'] ?? null,
            [
                'provider' => $data['provider'] ?? null,
                'model' => $data['model'] ?? null,
            ],
        );

        // Chyba behu je 422, nie 200 s poľom `error`: volajúci je stroj a ten sa
        // rozhoduje podľa stavového kódu skôr, než sa pozrie do tela. Ťah, ktorý
        // neprebehol, nesmie vyzerať ako úspešný.
        return response()->json($result, isset($result['error']) ? 422 : 200);
    }
}
