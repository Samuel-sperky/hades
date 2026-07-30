<?php

use Illuminate\Support\Facades\Route;

// Koreňová šablóna je resources/views/app.blade.php — len zoznam @include
// partialov s jednoznačnými vlastníkmi (CLAUDE.md §4.9). Pôvodný monolit
// mind.blade.php (417 riadkov) tým zanikol.
Route::get('/', fn () => view('app'));

// POZOR: `POST /debug/snapshot` tu bol zmazaný (rozhodnutie #24).
// Bral base64 obrázok, zapisoval ho pod používateľom zvoleným menom do
// storage/app/ a mal VYPNUTÝ CSRF, žiadny throttle a žiadny strop veľkosti.
// Aj keď bol len v `local`, appka sa v lokálnom režime verejne tuneluje, takže
// to bol otvorený zápis na disk. Screenshoty do reportov robí Playwright
// (tests/e2e/**), ktorý si ich ukladá sám — endpoint nemal iného volajúceho.
