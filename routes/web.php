<?php

use Illuminate\Support\Facades\Route;

Route::get('/', fn () => view('mind'));

if (app()->environment('local')) {
    Route::post('/debug/snapshot', function (Illuminate\Http\Request $request) {
        $data = explode(',', (string) $request->input('image'), 2)[1] ?? '';
        file_put_contents(storage_path('app/snapshot.png'), base64_decode($data));

        return response()->json(['saved' => true]);
    })->withoutMiddleware([Illuminate\Foundation\Http\Middleware\ValidateCsrfToken::class]);
}
