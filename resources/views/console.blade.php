<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- CSRF token pre zápisy na interné /api/* — console.js ho pripája do každého
         non-GET fetchu vrátane streamovaného behu (§3.5 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    {{-- Vlákno z URL: /console/<uuid>. Prázdne = nové vlákno. Číta ho main.js pri
         starte, aby sa odkaz na konkrétnu konverzáciu dal poslať a otvoriť. --}}
    <meta name="console-thread" content="{{ request()->route('uuid') ?? '' }}">
    <title>Konzola — Hades</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='33' fill='none' stroke='%2305bcc4' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>">
    {{-- Tie isté self-hosted fonty ako graf (Google Fonts CDN je zámerne preč,
         inak sa ikony vykreslia ako ligatúrové názvy). --}}
    <link rel="preload" href="/fonts/material-symbols-rounded-subset.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
    {{-- mind.css nesie @font-face, farebné tokeny a tému; console.css len layout
         konzoly. Dva súbory zámerne: tokeny majú byť jedno miesto pravdy pre celú
         appku, inak by konzola hovorila inou farbou než plátno. --}}
    <link rel="stylesheet" href="/css/mind.css">
    <link rel="stylesheet" href="/css/console.css">
</head>
<body class="console-body">
    <div id="console-app">
        {{-- Bočný panel vlákien --}}
        <aside id="thread-rail" aria-label="Vlákna konzoly">
            <div class="rail-top">
                <a href="/" id="back-to-graph" title="Späť do grafu" aria-label="Späť do grafu">
                    <span class="ms" aria-hidden="true">hub</span>
                </a>
                <button id="new-thread" type="button" title="Nové vlákno (Ctrl+N)">
                    <span class="ms" aria-hidden="true">add</span><span class="lbl">Nové vlákno</span>
                </button>
            </div>
            <nav id="thread-list" aria-label="História vlákien"></nav>
        </aside>

        <main id="console-main">
            <header id="console-header">
                <div class="ch-left">
                    <h1 id="thread-title">Konzola vedomia</h1>
                </div>
                <div class="ch-right">
                    {{-- Prepínač modelu: lokálny Qwen vs Claude. Napĺňa ho main.js
                         z /api/console/models — zoznam závisí od toho, čo je
                         reálne stiahnuté v Ollame. --}}
                    <label class="model-pick">
                        <span class="ms" aria-hidden="true">memory</span>
                        <select id="model-select" aria-label="Model"></select>
                    </label>
                    {{-- Auto-accept: povolí zápisové tooly bez pýtania sa. Default
                         vypnuté — slabší lokálny model dokáže do pamäte napísať odpad. --}}
                    <label class="auto-accept">
                        <input type="checkbox" id="auto-accept">
                        <span>Auto-povoliť zápisy</span>
                    </label>
                    <span id="run-stats" aria-live="polite"></span>
                </div>
            </header>

            {{-- Tok správ: používateľ, odpovede modelu, karty tool callov, diffy,
                 potvrdzovacie prompty. Všetko kreslí console/render.js. --}}
            <div id="stream" role="log" aria-live="polite" aria-relevant="additions"></div>

            <form id="composer" autocomplete="off">
                <div class="composer-row">
                    <textarea id="prompt" rows="1" placeholder="Napíš úlohu pre vedomie… (/ pre príkazy, Enter pošle)"
                              aria-label="Správa pre konzolu"></textarea>
                    <button type="submit" id="send" title="Poslať (Enter)" aria-label="Poslať">
                        <span class="ms" aria-hidden="true">arrow_upward</span>
                    </button>
                    <button type="button" id="stop" class="hidden" title="Zastaviť beh (Esc)" aria-label="Zastaviť beh">
                        <span class="ms" aria-hidden="true">stop</span>
                    </button>
                </div>
                {{-- Paleta slash príkazov — /recall, /learn, /model, /clear, /help --}}
                <div id="slash-palette" class="hidden" role="listbox" aria-label="Príkazy"></div>
            </form>
        </main>
    </div>

    <script type="module" src="/js/console/main.js"></script>
</body>
</html>
