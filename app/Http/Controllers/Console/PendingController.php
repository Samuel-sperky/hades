<?php

namespace App\Http\Controllers\Console;

use App\Http\Controllers\Controller;
use App\Services\Console\WriteProposals;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Front odložených zápisov — čo navrhol beh, pri ktorom nikto nesedel.
 *
 * Programový beh ({@see \App\Services\Console\HeadlessRunner}) zápis nevykoná, ale
 * uloží ho ako návrh s náhľadom. Toto je miesto, kde ho človek uvidí a rozhodne —
 * z terminálu: `hades pending`, `hades pending approve <id>`.
 *
 * Prečo je to v programovom okruhu (`auth.console`, loopback-only) a nie za
 * `auth.ui`: rozhoduje o tom ten istý človek pri tom istom stroji a z toho istého
 * klienta, ktorý beh spustil. Druhá cesta so session by bola druhý okruh k jednej
 * akcii bez dôvodu — a každý okruh navyše je ďalšie miesto, kde sa dá zabudnúť
 * na guard.
 *
 * Vykonanie a rozhodnutie sú tu ZÁMERNE spolu: `approve` zápis vykoná až v tejto
 * chvíli. Dovtedy návrh nič nezmenil, takže front sa dá nechať ležať aj týždeň.
 * Súbeh dvoch rozhodnutí rieši {@see WriteProposals} podmieneným UPDATE-om, nie
 * tento kontrolér — a preto sa druhé `approve` nevykoná druhýkrát.
 */
class PendingController extends Controller
{
    public function index(Request $request, WriteProposals $proposals): JsonResponse
    {
        $data = $request->validate([
            'thread' => 'sometimes|nullable|uuid',
            'limit' => 'sometimes|integer|min:1|max:50',
        ]);

        return response()->json($proposals->listOpen(
            $data['thread'] ?? null,
            (int) ($data['limit'] ?? 50),
        ));
    }

    /**
     * Povolí alebo zamietne jeden návrh.
     *
     * Neexistujúce `uuid` skončí ako 404 z `firstOrFail()` — a to je správne:
     * volajúci sa pýta na návrh, ktorý nie je, a nemá sa dozvedieť „hotovo".
     * Návrh, o ktorom sa už rozhodlo, sa vráti taký, aký je (jeho `status` to
     * povie), a tool sa druhýkrát nevykoná.
     */
    public function decide(WriteProposals $proposals, string $uuid, string $decision): JsonResponse
    {
        if (! in_array($decision, ['approve', 'deny'], true)) {
            return response()->json(['error' => 'Rozhodnutie je `approve` alebo `deny`.'], 422);
        }

        $proposal = $decision === 'approve'
            ? $proposals->approve($uuid)
            : $proposals->deny($uuid);

        return response()->json(['proposal' => $proposals->payload($proposal)]);
    }
}
