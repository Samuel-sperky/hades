<?php

use Illuminate\Support\Facades\Route;

// Koreňová šablóna je resources/views/app.blade.php — len zoznam @include
// partialov s jednoznačnými vlastníkmi (CLAUDE.md §4). Pôvodný monolit
// mind.blade.php (417 riadkov) tým zanikol.
Route::get('/', fn () => view('app'));

if (app()->environment('local')) {
    Route::post('/debug/snapshot', function (Illuminate\Http\Request $request) {
        $data = explode(',', (string) $request->input('image'), 2)[1] ?? '';
        $name = preg_replace('/[^a-z0-9_-]/', '', (string) $request->input('name', 'snapshot')) ?: 'snapshot';
        file_put_contents(storage_path("app/{$name}.png"), base64_decode($data));

        return response()->json(['saved' => true]);
    })->withoutMiddleware([Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class]);
}
