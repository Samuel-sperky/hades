<?php

namespace App\Http\Controllers;

use App\Serializers\Screen\KniznicaScreen;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LibraryController extends Controller
{
    /**
     * Zdroj pre obrazovku Knižnica: skill uzly zoskupené podľa oblasti.
     * Voliteľný ?q= filtruje cez ten istý SK-aware engine (stemované korene),
     * aby slovenské skloňovanie fungovalo aj tu; ?area= zúži na jednu oblasť
     * (slug alebo názov).
     *
     * Tvar drží {@see KniznicaScreen} — tá istá trieda, z ktorej čítá MCP tool
     * `mind_library`, takže obrazovka a AI nemôžu hovoriť iné čísla.
     *
     * `limit => null` je **vedomé rozhodnutie o UI**: obrazovka kreslí všetkých
     * ~1660 kariet bez stránkovania (520 kB odpoveď). Nie je to zabudnutý strop
     * a nie je to chyba dopytu; AI má default {@see KniznicaScreen::AI_LIMIT}.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'q' => 'sometimes|nullable|string|max:200',
            'area' => 'sometimes|nullable|string|max:120',
        ]);

        return response()->json(
            (new KniznicaScreen($validated + ['limit' => null]))->data()
        );
    }
}
