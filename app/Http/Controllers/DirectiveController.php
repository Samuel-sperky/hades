<?php

namespace App\Http\Controllers;

use App\Serializers\Screen\SmernicaScreen;
use App\Serializers\ScreenSerializer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * "Prompt builder / smernica pre Claude" — Hades poskladá pre danú úlohu
 * smernicu, ktorá Claudovi povie, KDE ČO NÁJDE: overené skilly (.md cesty),
 * súvisiace projekty (adresáre), kľúčové fakty a pravidlá/preferencie.
 *
 * Len čítanie mozgu + zápis hotovej smernice do directives/*.md. Nič v mozgu
 * nemení, nezvyšuje silu, neposiela pulz.
 *
 * **Kontrolér sám nič neskladá.** Tvar obrazovky aj markdown drží
 * {@see SmernicaScreen} — tá istá trieda, z ktorej čítá MCP tool `mind_directive`.
 * Dovtedy si markdown skladal aj prehliadač a texty sa reálne rozišli (namerané:
 * 15–23 z ~45 riadkov na troch úlohách), takže smernica pre človeka nebola tá,
 * ktorú by dostala AI.
 */
class DirectiveController extends Controller
{
    /**
     * POST /api/directive/build {task?: string, node_ids?: int[], include_ids?: int[]}
     * Poskladá NÁVRH smernice: nájde relevantné uzly, roztriedi ich na skilly /
     * projekty / fakty / pravidlá, overí cesty skillov na disku a vygeneruje
     * markdown. Vráti {task, suggested, markdown, counts, selected_ids}.
     *
     * `include_ids` je výber človeka na obrazovke (odškrtané položky). Náhľad si
     * ho preto **nepočíta sám** — pošle ho sem a dostane markdown, ktorý je znak
     * za znak ten, čo dostane AI.
     */
    public function build(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'task' => 'nullable|string|max:2000',
            'node_ids' => 'nullable|array|max:50',
            'node_ids.*' => 'integer',
            'include_ids' => 'nullable|array|max:200',
            'include_ids.*' => 'integer',
        ]);

        $screen = new SmernicaScreen($validated);

        return response()->json(ScreenSerializer::project($screen->data(), [
            'task', 'suggested', 'markdown', 'counts', 'selected_ids',
        ]));
    }

    /**
     * POST /api/directive/save {name, markdown} → zapíše directives/<slug>.md.
     * Vráti { path } (relatívnu cestu v repo).
     */
    public function save(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:200',
            'markdown' => 'required|string|max:100000',
        ]);

        $dir = $this->directivesPath();
        if (! is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }

        $slug = Str::slug($validated['name']);
        if ($slug === '') {
            $slug = 'smernica-'.now()->format('Ymd-His');
        }

        $full = rtrim($dir, '/\\').DIRECTORY_SEPARATOR.$slug.'.md';
        file_put_contents($full, $validated['markdown']);

        return response()->json(['path' => 'directives/'.$slug.'.md']);
    }

    /**
     * GET /api/directives → zoznam uložených smerníc { name, path, title }.
     * title = prvý riadok súboru (nadpis bez '#'). Najnovšie prvé.
     */
    public function index(): JsonResponse
    {
        return response()->json(ScreenSerializer::project(
            (new SmernicaScreen)->data(),
            ['directives'],
        ));
    }

    /**
     * GET /api/directive/{name} → obsah uloženej smernice pre znovuotvorenie v UI.
     * name je slug (bez prípony); cesta je chránená proti path traversal.
     */
    public function show(string $name): JsonResponse
    {
        $slug = Str::slug($name);
        if ($slug === '') {
            return response()->json(['message' => 'Neplatný názov.'], 404);
        }

        $full = rtrim($this->directivesPath(), '/\\').DIRECTORY_SEPARATOR.$slug.'.md';
        if (! is_file($full)) {
            return response()->json(['message' => 'Smernica sa nenašla.'], 404);
        }

        return response()->json([
            'name' => $slug,
            'path' => 'directives/'.$slug.'.md',
            'markdown' => (string) @file_get_contents($full),
        ]);
    }

    /**
     * DELETE /api/directive/{name} → zmaže directives/<slug>.md.
     *
     * Sekcia „Uložené smernice" dovtedy vedela len rásť: `save` prepisuje súbor
     * podľa slugu úlohy, takže každá preformulovaná úloha nechala vedľa seba ďalší
     * .md a zoznam sa nedal upratať inak než ručne v repozitári.
     *
     * Cesta sa **odmieta, nesanitizuje** — presne ako v `show`: `Str::slug()`
     * zahodí lomky aj bodky, takže `..%2Fetc%2Fpasswd` skončí ako neexistujúci
     * slug a nie ako súbor mimo priečinka. Mažeme len `.md` v `directivesPath()`.
     */
    public function destroy(string $name): JsonResponse
    {
        $slug = Str::slug($name);
        if ($slug === '') {
            return response()->json(['message' => 'Neplatný názov.'], 404);
        }

        $full = rtrim($this->directivesPath(), '/\\').DIRECTORY_SEPARATOR.$slug.'.md';
        if (! is_file($full)) {
            return response()->json(['message' => 'Smernica sa nenašla.'], 404);
        }

        if (! @unlink($full)) {
            return response()->json(['message' => 'Smernicu sa nepodarilo zmazať.'], 500);
        }

        return response()->json(['deleted' => $slug, 'path' => 'directives/'.$slug.'.md']);
    }

    /**
     * GET /api/directive/templates → rýchle štarty. Každá šablóna predvyplní
     * task a UI ju hneď spustí cez /api/directive/build.
     */
    public function templates(): JsonResponse
    {
        return response()->json(ScreenSerializer::project(
            (new SmernicaScreen)->data(),
            ['templates'],
        ));
    }

    /** Absolútna cesta k priečinku smerníc (config alebo base_path/directives). */
    protected function directivesPath(): string
    {
        return (string) config('hades.directives_path', base_path('directives'));
    }
}
