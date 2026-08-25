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
// Zoznam nástrojov je JEDNA funkcia pre obe plochy. Keby si ho `/chat` skládal
// vlastným `array_map`, existovali by dve pravdy o tom, čo beh naozaj má —
// a rozišli by sa presne v okamihu, keď sa zmení tvar riadku.
$toolList = fn (ToolRegistry $tools) => array_map(
    fn (string $name) => ['name' => $name, 'write' => $tools->isWrite($name)],
    $tools->names(),
);

$console = fn (ToolRegistry $tools) => view('console', ['consoleTools' => $toolList($tools)]);

Route::get('/console', $console)->middleware('auth.ui');
Route::get('/console/{uuid}', $console)
    ->where('uuid', '[0-9a-fA-F-]{36}')
    ->middleware('auth.ui');

// Chat — plocha pre človeka. `/console` je technická konzola a jej názvoslovie
// (`console_*`, `Console*`, `hades.console.*`) sa nepremenúva, pretože migrácia
// bez čitateľa nič nezlepší; `/chat` je iná PLOCHA nad tým istým behom, nie iný
// beh. Tri vstupy (konzola, dok nad grafom, chat), jeden beh — všetky idú cez
// `public/js/shared/runclient.js` na `/api/console/run` a `/api/console/decide`,
// takže dvojfázová brána zápisov platí na všetkých troch.
//
// Vlákno má vlastnú URL a `where` je bajt za bajt to isté ako pri konzole:
// uuid je ten istý riadok v `console_threads`, takže odkaz sa dá preniesť
// medzi plochami len prepísaním prefixu cesty.
//
// Pod `auth.ui` z tej istej príčiny ako konzola: chat vie zapisovať do pamäte
// aj do súborov, teda je to najsilnejší vstup do appky (a appka je verejne
// tunelovaná cez ngrok).
$chat = fn (ToolRegistry $tools) => view('chat', ['consoleTools' => $toolList($tools)]);

Route::get('/chat', $chat)->middleware('auth.ui');
Route::get('/chat/{uuid}', $chat)
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
