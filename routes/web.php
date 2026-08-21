<?php

use App\Services\Console\ToolRegistry;
use Illuminate\Support\Facades\Route;

// Dashboard je od 13. 8. 2026 pod tým istým UI guardom ako interné /api/*.
// Bez toho by celá ochrana nefungovala: lokálny proces si spraví GET / a token
// (aj CSRF) si z HTML vyparsuje. Odomknutie raz cez `/?token=<HADES_UI_TOKEN>`,
// ďalej drží session cookie; na verejnej ceste hlavičku vkladá Caddy.
Route::get('/', fn () => view('mind'))->middleware('auth.ui');

// Charón — samostatné rozhranie, nie obrazovka v raile grafu. Vlákno má
// vlastnú URL (/console/<uuid>), aby sa dalo poslať odkazom a otvoriť po reštarte.
// Pod tým istým guardom ako dashboard: konzola vie zapisovať do pamäte aj do
// súborov, takže bez guardu by bola najsilnejší vstup do appky.
// Zoznam nástrojov ide do HTML, nie na nový endpoint: prázdny stav konzoly
// sľuboval „vidí pamäť aj súbory", ale KTORÉ nástroje to sú, sa z UI nedalo
// zistiť nikdy (nález A19). Register je jediný zdroj členstva v zozname —
// keď tool pribudne, `/tools` ho vypíše bez toho, aby to niekto pamätal.
// Posiela sa len meno a či zapisuje; popisy toolov sú anglický text pre model
// a do rozhrania nepatria.
$console = function (ToolRegistry $tools) {
    return view('console', [
        'consoleTools' => array_map(
            fn (string $name) => ['name' => $name, 'write' => $tools->isWrite($name)],
            $tools->names(),
        ),
    ]);
};

Route::get('/console', $console)->middleware('auth.ui');
Route::get('/console/{uuid}', $console)
    ->where('uuid', '[0-9a-fA-F-]{36}')
    ->middleware('auth.ui');

if (app()->environment('local')) {
    Route::post('/debug/snapshot', function (Illuminate\Http\Request $request) {
        $data = explode(',', (string) $request->input('image'), 2)[1] ?? '';
        $name = preg_replace('/[^a-z0-9_-]/', '', (string) $request->input('name', 'snapshot')) ?: 'snapshot';
        file_put_contents(storage_path("app/{$name}.png"), base64_decode($data));

        return response()->json(['saved' => true]);
    })->withoutMiddleware([Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class]);
}
