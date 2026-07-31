{{-- ZDIEĽANÝ — vlastník: koordinátor. Meta, fonty, favicon, @vite.
     Fonty sú vendorované lokálne (resources/css/base/fonts.css + resources/fonts/),
     appka musí zostať offline-ready — NEPRIDÁVAJ sem <link> na CDN. --}}
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AuraAI — živé vedomie</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='30' fill='%23b88a3a'/><circle cx='50' cy='50' r='45' fill='none' stroke='%2303797e' stroke-opacity='.4' stroke-width='4'/></svg>">
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
