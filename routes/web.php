<?php

use Illuminate\Support\Facades\Route;

// Dashboard je od 13. 8. 2026 pod tým istým UI guardom ako interné /api/*.
// Bez toho by celá ochrana nefungovala: lokálny proces si spraví GET / a token
// (aj CSRF) si z HTML vyparsuje. Odomknutie raz cez `/?token=<HADES_UI_TOKEN>`,
// ďalej drží session cookie; na verejnej ceste hlavičku vkladá Caddy.
Route::get('/', fn () => view('mind'))->middleware('auth.ui');

// Konzola vedomia — samostatné rozhranie, nie obrazovka v raile grafu. Vlákno má
// vlastnú URL (/console/<uuid>), aby sa dalo poslať odkazom a otvoriť po reštarte.
// Pod tým istým guardom ako dashboard: konzola vie zapisovať do pamäte aj do
// súborov, takže bez guardu by bola najsilnejší vstup do appky.
Route::get('/console', fn () => view('console'))->middleware('auth.ui');
Route::get('/console/{uuid}', fn () => view('console'))
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
