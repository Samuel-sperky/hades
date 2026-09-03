<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- CSRF token pre zápisy na interné /api/* — console.js ho pripája do každého
         non-GET fetchu vrátane streamovaného behu (§3.3 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    {{-- Vlákno z URL: /console/<uuid>. Prázdne = nové vlákno. Číta ho main.js pri
         starte, aby sa odkaz na konkrétnu konverzáciu dal poslať a otvoriť. --}}
    <meta name="console-thread" content="{{ request()->route('uuid') ?? '' }}">
    <title>Hades — Charón</title>
    {{-- Ikony značky (favicon, .ico fallback, dlaždica iOS) — jedna pravda pre
         všetky tri plochy. Data-URI v nej prepisuje tools/brand/build-mark.py. --}}
    @include('partials.brand-icons')
    {{-- Náhľad odkazu (appka je tunelovaná cez ngrok, takže sa reálne zdieľa).
         Cesta je relatívna zámerne: ngrok doména sa mení, absolútna by zastarala. --}}
    <meta property="og:type" content="website">
    <meta property="og:title" content="Hades — Charón">
    <meta property="og:description" content="Hierarchical Associative Data Embedding System">
    <meta property="og:image" content="/brand/hades-og.png">
    {{-- Tie isté self-hosted fonty ako graf (Google Fonts CDN je zámerne preč,
         inak sa ikony vykreslia ako ligatúrové názvy). --}}
    <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
    {{-- mind.css nesie @font-face, farebné tokeny a tému; console.css len layout
         konzoly. Dva súbory zámerne: tokeny majú byť jedno miesto pravdy pre celú
         appku, inak by konzola hovorila inou farbou než plátno. --}}
    <link rel="stylesheet" href="/css/mind.css">
    <link rel="stylesheet" href="/css/console.css">
</head>
<body class="console-body">
    {{-- SKIP-LINK (P2): prvý fokusovateľný prvok, aby sa klávesnicou dalo skočiť
         rovno ku composeru — jediné miesto, kde človek púšťa zápis do pamäte —
         bez prechodu cez celý rail a hlavičku. --}}
    <a class="skip-link" href="#prompt">Preskočiť na pole správy</a>
    <div id="console-app">
        {{-- Bočný panel vlákien --}}
        <aside id="thread-rail" aria-label="Vlákna konzoly">
            <div class="rail-top">
                {{-- Značka, nie ikona: Charón je obrazovka Hadesa, tak sem patrí znak. Klik
                     vracia do grafu — logo, ktoré vedie domov, je zaužívané. --}}
                <a href="/" id="back-to-graph" title="Hades — späť do grafu" aria-label="Hades — späť do grafu">
                    {{-- ZNAK v REDUKOVANOM stupni `core` — jeden uzol (prstenec 8,64/2,16
                         + zlatý stred 3,6), teda bez troch satelitov a štyroch hrán.
                         Nosič je 24 px a pri tej veľkosti má viditeľná stopa hrany 3,9 px,
                         takže sieť by prestala hovoriť „sieť". Celé odôvodnenie, pravidlo
                         redukcie aj to, kde sieť vidno v plnej kresbe, je pri `#brand-core`
                         v mind.blade.php — tu sa to nekopíruje druhýkrát.
                         Kresba je bajt na bajt výstup `sigilNetMarkup(cls, {step:'core'})`
                         z public/js/shared/sigil.js (tabuľka `SIGIL_NET`). Jediný rozdiel proti
                         railu: jadro je tu `var(--brand-gold)`, nie `currentColor` —
                         `#back-to-graph` nemá vlastný `color` a `.asleep` sem nedosiahne.
                         `class="bc-mark"` je SPÍNAČ zrodu, nie ozdoba. --}}
                    <svg class="bc-mark" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                        <g class="bc-nodes">
                            <circle class="bc-node" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                        </g>
                        <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
                    </svg>
                </a>
                <button id="new-thread" type="button" title="Nové vlákno (Ctrl+N)">
                    <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 4.6 v 14.8 M 4.6 12 h 14.8"/></svg><span class="lbl">Nové vlákno</span>
                </button>
            </div>
            {{-- Filter nad zoznamom je čisto klientský: `/api/console/threads` vracia
                 najviac 100 riadkov, takže hľadať sa má v tom, čo už je načítané —
                 druhý okruh na server by pri tejto veľkosti nič nepridal. --}}
            <div class="rail-find">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.4" cy="10.4" r="6.2"/><path d="M 14.9 14.9 L 20.3 20.3"/></svg>
                <input type="search" id="thread-find" autocomplete="off"
                       placeholder="Hľadať vo vláknach…" aria-label="Hľadať vo vláknach">
            </div>
            <nav id="thread-list" aria-label="História vlákien"></nav>
        </aside>

        <main id="console-main">
            <header id="console-header">
                <div class="ch-left">
                    {{-- Pod 860 px je panel skrytý; bez tohto prepínača by sa na úzkom
                         okne k histórii vlákien nedalo dostať vôbec. --}}
                    <button id="rail-toggle" type="button" title="Vlákna" aria-label="Vlákna">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 8 7 h 12 M 8 12 h 12 M 8 17 h 12"/><path d="M 4.2 7 h 0.01 M 4.2 12 h 0.01 M 4.2 17 h 0.01"/></svg>
                    </button>
                    <h1 id="thread-title">Charón</h1>
                </div>
                <div class="ch-right">
                    {{-- Prepínač modelu: lokálny Qwen vs Claude. Napĺňa ho models.js
                         z /api/console/models — zoznam závisí od toho, čo je
                         reálne stiahnuté v Ollame. Keď endpoint nie je, zhasne a
                         ukáže model vlákna. --}}
                    <label class="model-pick">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 5.4 5.4 h 13.2 v 13.2 H 5.4 Z"/><path d="M 9.2 9.2 h 5.6 v 5.6 H 9.2 Z"/><path d="M 9.4 2.8 v 2.6 M 14.6 2.8 v 2.6 M 9.4 18.6 v 2.6 M 14.6 18.6 v 2.6 M 2.8 9.4 h 2.6 M 2.8 14.6 h 2.6 M 18.6 9.4 h 2.6 M 18.6 14.6 h 2.6"/></svg>
                        <select id="model-select" aria-label="Model"></select>
                    </label>
                    {{-- Auto-accept: povolí zápisové tooly bez pýtania sa. Default
                         vypnuté — slabší lokálny model dokáže do pamäte napísať odpad. --}}
                    {{-- aria-label je tu POVINNÝ, nie zdvojenie: pod 860 px sa `.lbl`
                         skrýva cez `display: none`, čím zmizne aj z prístupného mena,
                         a políčko by na úzkom okne bolo bezmenné. --}}
                    <label class="auto-accept" title="Auto-povoliť zápisy">
                        <input type="checkbox" id="auto-accept" aria-label="Auto-povoliť zápisy">
                        <span class="lbl">Auto-povoliť zápisy</span>
                    </label>
                    {{-- Stav behu (sekundy, krok, tokeny) sa mení každú sekundu, takže
                         aria-live tu NIE JE: čítačka by tikala do rečí. Hotový ťah
                         ohlási jedna veta v #run-announce. --}}
                    <span id="run-stats"></span>
                </div>
            </header>

            {{-- Tok správ: používateľ, odpovede modelu, karty tool callov, diffy,
                 potvrdzovacie prompty. Všetko kreslí console/render.js.
                 aria-busy drží render.js počas streamu — inak by čítačka hlásila
                 každý prílet tokenu, teda pri 9 tok/s deväťkrát za sekundu. --}}
            <div id="stream" role="log" aria-live="polite" aria-relevant="additions" aria-busy="false"></div>

            <form id="composer" autocomplete="off">
                {{-- Späť na spodok — ukáže sa len keď človek odskroluje nahor a tok
                     ho prestane sledovať. Ikona `arrow_downward` v subsete NIE JE,
                     preto je to `arrow_upward` prevrátená v CSS. --}}
                <button type="button" id="to-bottom" class="hidden" title="Na spodok" aria-label="Skočiť na spodok">
                    <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 4.4 v 15"/><path d="M 18.2 13.2 L 12 19.4 L 5.8 13.2"/></svg>
                </button>
                <div class="composer-row">
                    {{-- Paletu príkazov MUSÍ vlastniť toto pole. Do 20. 8. 2026 bola
                         `#slash-palette` `role="listbox"`, ktorý nikto nevlastnil:
                         textarea nemala `role`, `aria-expanded` ani
                         `aria-activedescendant`, takže otvorenie palety, počet
                         možností ani pohyb kurzora sa k čítačke nedostali vôbec.
                         `aria-expanded` je tu preto natvrdo `false` — slash.js ho
                         prepína a nesmie ho pri prvom otvorení zakladať. --}}
                    <textarea id="prompt" rows="1" placeholder="Napíš úlohu pre vedomie… (/ pre príkazy, Enter pošle)"
                              aria-label="Správa pre Charóna"
                              role="combobox" aria-expanded="false" aria-controls="slash-palette"
                              aria-autocomplete="list" aria-haspopup="listbox"></textarea>
                    <button type="submit" id="send" title="Poslať (Enter)" aria-label="Poslať">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 20.6 3.4 L 3.4 10.2 L 10.9 13.1 L 13.8 20.6 Z"/><path d="M 20.6 3.4 L 10.9 13.1"/></svg>
                    </button>
                    <button type="button" id="stop" class="hidden" title="Zastaviť beh (Esc)" aria-label="Zastaviť beh">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6.7 6.7 h 10.6 v 10.6 H 6.7 Z"/></svg>
                    </button>
                </div>
                {{-- Klávesová časť je obalená v .hint-keys, aby sa na úzkom okne dala
                     skryť SAMOSTATNE. Predtým sa pod 860 px skrývala celá nápoveda
                     a s ňou jediná stopa po slash príkazoch; skryť len <kbd> sa nedá,
                     zo zvyšku by ostalo „pošle · nový riadok · príkazy". --}}
                <p id="composer-hint">
                    <span class="hint-keys"><kbd>Enter</kbd> pošle · <kbd>Shift</kbd>+<kbd>Enter</kbd> nový riadok · </span>
                    {{-- Ctrl+N žil len v `title` tlačidla „Nové vlákno", teda v tooltipe,
                         ktorý sa na klávesnici ani na dotyku nezobrazí. Handler je
                         v public/js/console/main.js (`keydown`, `n` + Ctrl/Cmd). --}}
                    {{-- Ctrl+K (paleta príkazov) tu ZÁMERNE NIE JE, hoci `/chat` ho
                         v `#chat-hint` má: na tejto ploche vetu „· Ctrl+K paleta"
                         dopisuje `mountHint()` v public/js/console/palette.js do
                         POSLEDNÉHO `.hint-keys` za behu. Zmerané 31. 8. 2026 pri
                         1400 px: keď je aj tu, nápoveda hlási „… Ctrl+K paleta ·
                         Ctrl+K paleta". Dva zdroje jednej vety — a ten druhý nevlastní
                         tento sprint, takže statický zostáva prázdny.
                         Správne konečné miesto je TENTO riadok (nápoveda je statický
                         text plochy, ako na `/chat`) a `mountHint()` má zmiznúť; kým
                         sa tak nestane, NEPRIDÁVAJ to sem. --}}
                    <kbd>/</kbd> príkazy<span class="hint-keys"> · <kbd>Esc</kbd> zastaví beh · <kbd>Ctrl</kbd>+<kbd>N</kbd> nové vlákno</span>
                </p>
                {{-- Paleta slash príkazov. Zoznam žije v public/js/console/slash.js;
                     vlastníkom palety je #prompt (role="combobox" vyššie). --}}
                <div id="slash-palette" class="hidden" role="listbox" aria-label="Príkazy"></div>
            </form>

            {{-- Jedna veta pre čítačku, keď ťah dobehne alebo si žiada rozhodnutie. --}}
            <p id="run-announce" class="sr-only" aria-live="polite"></p>
            {{-- P4: prázdny live región pre stavové oznamy z JS (obsah doňho píše
                 iný modul). Jeden zámerne — dva polite regióny by sa prekričali. --}}
            <div aria-live="polite" class="sr-only" id="console-live"></div>
        </main>
    </div>

    {{-- Nástroje, ktoré beh naozaj má — vypisuje ich príkaz /tools. Zoznam
         skládá ToolRegistry (routes/web.php), nie klient: prázdny stav sľubuje
         „vidí pamäť aj súbory" a ktorých dvanásť toolov to je, sa z UI dovtedy
         nedalo zistiť. Nie je to endpoint zámerne — je to statický fakt o behu,
         ktorý sa medzi dvoma requestami nemení.

         CSP: `type="application/json"` nie je spustiteľný typ, takže HTML tento
         blok nepripraví ako skript a `script-src` naň nedosiahne — politika
         v App\Http\Middleware\ContentSecurityPolicy preto nemá `'unsafe-inline'`
         a tento riadok nemá nonce. Detail v MERANIE-CSP.md §5. --}}
    <script type="application/json" id="console-tools">@json($consoleTools ?? [])</script>

    <script type="module" src="/js/console/main.js"></script>
</body>
</html>
