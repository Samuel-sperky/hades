<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- CSRF token pre zápisy na interné /api/* — mind.js ho pripája do každého
         non-GET fetchu (ValidateCsrfToken, §3.5 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Hades — Vedomie</title>
    {{-- Favicon = súosé kruhy značky (tmavý papier / amethystový prstenec / zlaté jadro).
         („tealový" tu stálo do 31. 8. 2026 — teal odišiel 19. 8. 2026 a je to dnes
         farba oblasti *Vývoj & kód*, nie akcentu; nasledujúci odsek toho istého
         komentára pritom hovoril „amethystový" správne.)
         Predtým to bol zlatý disk s tenkým prstencom na 40 % alfy — pri 16 px prstenec
         zmizol a v karte ostala len zlatá škvrna bez identity. Teraz: nepriehľadný
         tmavý podklad (čitateľné na svetlej aj tmavej liste prehliadača), plný
         amethystový prstenec a zlaté jadro — geometria je zhodná s public/brand/hades-sigil-mini.svg.
         Farby sú kánonové (#0e1413 / #c4a2f5 / #d8b878). --}}
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='36' fill='none' stroke='%23c4a2f5' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>">
    {{-- Fallback pre prehliadače, ktoré SVG favicon neberú, a dlaždica pre iOS.
         .ico je vyrobené z MINI verzie znaku — master by sa pri 16 px zlial. --}}
    <link rel="alternate icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    {{-- Náhľad odkazu (appka je tunelovaná cez ngrok, takže sa reálne zdieľa).
         Cesta je relatívna zámerne: ngrok doména sa mení, absolútna by zastarala.

         `og:title` = `<title>`, znak po znaku. Do 31. 8. 2026 tu stálo len
         „Hades", teda náhľad odkazu volal túto plochu inak než karta prehliadača
         a zároveň porušoval formát titulkov z manuálu (§9: `Hades — <obsah>`,
         značka prvá). Značka bez obsahu nie je titulok plochy — appka má tri
         plochy a všetky by sa v náhľade menovali rovnako. --}}
    <meta property="og:type" content="website">
    <meta property="og:title" content="Hades — Vedomie">
    <meta property="og:description" content="Hierarchical Associative Data Embedding System">
    <meta property="og:image" content="/brand/hades-og.png">
    {{-- Fonty sú self-hosted v public/fonts/ (@font-face na začiatku mind.css).
         Google Fonts CDN je zámerne PREČ: pri jeho nedostupnosti sa každá ikona
         vykreslila ako svoj ligatúrový názov a chróm sa rozpadol.

         Preload je ROZPOČET, nie zvyk (docs/BRAND-HADES.md §6). Šesť súborov,
         178 108 → 260 780 B:
           · geist-latin + geist-latin-ext     45 912 — chróm + slovenská diakritika
           · geist-mono-latin                  23 128 — `/` má 86 deklarácií
             var(--mono) (breadcrumb, metriky hlavičky, čísla kariet, časy, cesty)
             a preloadovaný tu nebol, kým na /console a /chat áno
           · playfair-display-latin + -ext     59 544 — serif nesie od vlny 1
             titulok obrazovky (.screen-head h1), nie len .hero-val. OBE
             podmnožiny: `Knižnica` má `ž` (U+017E), teda latin-ext, a preload len
             jednej by nechal titulok skočiť z Georgie do Playfairu po dobehnutí
             druhého súboru — presne ten blik, ktorý sa tu rieši.
         Material Symbols (132 196 B) odišiel 28. 8. 2026 za vlastnou SVG sadou,
         takže preloadov je päť, nie šesť, a hlavička je o ten subset ľahšia. --}}
    <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-latin-ext.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/playfair-display-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/playfair-display-latin-ext.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/css/mind.css">
    {{-- Charón — dok nad plátnom. Vlastný stylesheet (variant A): karty nástrojov
         a brány zápisov žijú raz, s vlastným .charon-* prefixom (mind.css má .tc-*
         už obsadené tabulárnym číslom). --}}
    <link rel="stylesheet" href="/css/charon.css">
</head>
<body>
    {{-- SKIP-LINK (P2): prvý fokusovateľný prvok, aby sa klávesnicou dalo skočiť
         rovno na obsah obrazoviek a preskočiť plátno grafu, hlavičku a rail. --}}
    <a class="skip-link" href="#screens">Preskočiť na obsah</a>
    <canvas id="mind"></canvas>

    <header id="app-header">
        <div class="h-left">
            {{-- VLNA CHRÓM: wordmark sa presunul do railu (#brand-core). Hlavička je
                 odteraz čisto KONTEXT: kde som (breadcrumb), v akom stave je Hades
                 (čip) a čím na to siahnem (nástroje, hľadanie). Značka v raile je
                 trvalá a nesúťaží s cestou; predtým boli na obrazovke naraz DVA znaky
                 značky (lockup v hlavičke + zlaté súosé kruhy v raile) a v 44 px
                 hlavičke sa dvojriadkový lockup navyše tlačil s breadcrumbom.
                 Podtitul „Šperky Aura · živé vedomie" bol pri 9 px na hranici
                 čitateľnosti — žije v tooltipe značky a v <title> dokumentu. --}}
            <button id="btn-up" class="hidden" type="button" title="O úroveň von (Esc)" aria-label="O úroveň von">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 19.6 V 4.6"/><path d="M 5.8 10.8 L 12 4.6 L 18.2 10.8"/></svg>
            </button>
            <nav id="breadcrumb" aria-label="Aktuálny kontext"></nav>
            <span id="status-chip" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="txt">spí</span></span>
        </div>
        <div class="h-center">
            <div id="graph-tools" role="group" aria-label="Nástroje grafu">
                <!-- VLNA GRAF A: prepínač pohľadu — organická Sieť / neurónové Vrstvy (V) -->
                <button id="btn-view-net" title="Sieť (V)" aria-label="Pohľad Sieť" aria-pressed="true"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.6" r="2.1"/><circle cx="5.2" cy="17" r="2.1"/><circle cx="18.8" cy="17" r="2.1"/><path d="M 12 9.4 V 6.7 M 10.1 13.7 L 6.9 15.8 M 13.9 13.7 L 17.1 15.8"/></svg></button>
                <button id="btn-view-layers" title="Vrstvy (V)" aria-label="Pohľad Vrstvy" aria-pressed="false"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 3.4 L 20.6 8 L 12 12.6 L 3.4 8 Z"/><path d="M 3.4 12 L 12 16.6 L 20.6 12"/><path d="M 3.4 16 L 12 20.6 L 20.6 16"/></svg></button>
                <button id="btn-structure" title="Štruktúra (R)" aria-label="Štruktúra"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 9 3.5 h 6 v 4.5 H 9 Z"/><path d="M 3.4 16 h 6 v 4.5 H 3.4 Z"/><path d="M 14.6 16 h 6 v 4.5 H 14.6 Z"/><path d="M 12 8 V 12.2"/><path d="M 6.4 16 V 12.2 H 17.6 V 16"/></svg></button>
                {{-- A10: „Prehľad" bol sekcia doku, ktorá čítala /api/dashboard — teda
                     to isté, čo obrazovka Dnes, len v paneli širokom 248 px a len na
                     Grafe. Tlačidlo preto neotvára druhý panel s tými istými číslami,
                     ale skratkou vedie na obrazovku Dnes. Ikona je `wb_sunny`, tá istá,
                     akou je Dnes v raile — cieľ sa má dať prečítať z ikony (`monitoring`
                     sľuboval panel). Rail zostáva primárnou cestou; toto je len skratka
                     z hlavičky Grafu, ktorá je mimo Grafu skrytá spolu s #graph-tools. --}}
                <button id="btn-today" title="Dnes (S)" aria-label="Otvoriť obrazovku Dnes"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><path d="M 12 3.7 v 2.1 M 12 18.2 v 2.1 M 3.7 12 h 2.1 M 18.2 12 h 2.1 M 6.13 6.13 L 7.97 7.97 M 17.87 6.13 L 16.03 7.97 M 6.13 17.87 L 7.97 16.03 M 17.87 17.87 L 16.03 16.03"/></svg></button>
                <button id="btn-legend" title="Legenda (L)" aria-label="Legenda"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 3.4 L 15.6 9.4 H 8.4 Z"/><circle cx="7" cy="16.4" r="3.4"/><path d="M 14 13.4 h 6.6 v 6.6 H 14 Z"/></svg></button>
            </div>
            <div id="header-metrics" aria-live="polite"></div>
            {{-- Rozsah grafu patrí k POČTU uzlov, nie do zbalených Pokročilých nastavení.
                 Je to jediný prepínač, ktorý rozhoduje, či je na plátne ~1100 alebo ~2700
                 uzlov — pochovaný tri kliky hlboko pod kozmetickými slidrami pôsobil ako
                 jeden z nich. Vedľa metriky je vidieť aj to, čo urobil. --}}
            <div class="h-scope">
                <span id="scope-label">Knižnica</span>
                <button id="scope-toggle" class="switch" type="button" role="switch"
                        aria-checked="false" aria-labelledby="scope-label"></button>
            </div>
        </div>
        <div class="h-right">
            {{-- Charón — dok nad plátnom. Otvára sa týmto tlačidlom a (fáza 2)
                 klávesou C; žiadny prepínač v Nastaveniach (R-2). --}}
            <button id="charon-toggle" type="button" title="Charón nad grafom (C)"
          aria-label="Charón — rozhovor nad grafom" aria-expanded="false" aria-controls="charon"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.6" r="2.1"/><circle cx="5.2" cy="17" r="2.1"/><circle cx="18.8" cy="17" r="2.1"/><path d="M 12 9.4 V 6.7 M 10.1 13.7 L 6.9 15.8 M 13.9 13.7 L 17.1 15.8"/></svg></button>
            <button id="cmdk-trigger" type="button" aria-label="Hľadať (Ctrl+K)">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.4" cy="10.4" r="6.2"/><path d="M 14.9 14.9 L 20.3 20.3"/></svg>
                <span class="cmdk-hint">Hľadať</span>
                <kbd>Ctrl K</kbd>
            </button>
        </div>
    </header>

    <nav id="rail" aria-label="Hlavná navigácia">
        {{-- ZNAČKA — jediný výskyt na obrazovke. Súosé kruhy sú kánonový znak Hadesa
             (ten istý motív nesie favicon) a ich dýchanie je zároveň stav: bdie /
             spí (trieda .asleep). Slovo pod znakom drží identitu bez toho, aby
             súťažilo s hlavičkou. Klik naďalej vycentruje graf — logo, ktoré vracia
             pohľad domov, je zaužívané a nesúperí so žiadnou inou funkciou. --}}
        <button id="brand-core" type="button" title="Hades — Hierarchical Associative Data Embedding System (klik vycentruje graf)" aria-label="Hades — vycentrovať graf">
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                {{-- Geometria je zmenšenina public/brand/hades-sigil-mini.svg (prstenec
                     r .36, hrúbka .09, jadro r .15 z hrany viewBoxu). Prstenec je
                     amethyst, jadro zlaté — presne ako znak. --}}
                <circle class="bc-ring" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                <circle class="bc-core" cx="12" cy="12" r="3.6" fill="currentColor"/>
            </svg>
            <span class="bc-word">Hades</span>
        </button>

        {{-- POMENOVANÉ SKUPINY RAILU (nález A12). Osem destinácií viselo v jednej
             skupine „Obrazovky" bez princípu poradia — nič nepovedalo, prečo sú Runy
             medzi Rozhodnutiami a Kontrolou. Delenie je podľa času a povahy obsahu:
             TERAZ = čo sa deje práve teraz, ZÁZNAMY = čo sa stalo, ZNALOSTI = čo
             vedomie vie a práca s tým.

             ODCHÝLKA OD NÁVRHU A ZDÔVODNENIE: triáž navrhla štvrtú skupinu
             PRÁCA/SPRÁVA len pre Kontrolu. Jednopoložková skupina by dostala label
             ťažší než jej obsah (eyebrow + jedna destinácia, teda dva riadky na jeden
             cieľ) a Kontrola pracuje nad tou istou znalosťou ako Knižnica a Smernica —
             je to „fronta poznatkov čakajúcich na overenie", nie samostatná plocha.
             Preto tri skupiny a v ZNALOSTIACH poradie prehliadaj → over → použi
             (Knižnica → Kontrola → Smernica).

             PRÍSTUPNOSŤ: názov skupiny nesie `aria-label` na `role="group"` (ten istý
             vzor, aký tu mala skupina „Obrazovky" a aký majú Charón a Systém), vizuálny
             eyebrow je `aria-hidden`, inak by ho čítačka prečítala druhý raz.
             Verzálku dáva CSS (`text-transform`), nie text — tak ako `.cmdk-group`
             a ostatné eyebrow labely v projekte. --}}
        <div class="rail-group" role="group" aria-label="Teraz">
            <span class="rail-eyebrow" aria-hidden="true">Teraz</span>
            <button class="dest" data-screen="dnes" type="button" aria-label="Dnes">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2"/><path d="M 12 3.7 v 2.1 M 12 18.2 v 2.1 M 3.7 12 h 2.1 M 18.2 12 h 2.1 M 6.13 6.13 L 7.97 7.97 M 17.87 6.13 L 16.03 7.97 M 6.13 17.87 L 7.97 16.03 M 17.87 17.87 L 16.03 16.03"/></svg><span class="lbl">Dnes</span>
            </button>
            <button class="dest" data-screen="graf" type="button" aria-label="Graf">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.6" r="2.1"/><circle cx="5.2" cy="17" r="2.1"/><circle cx="18.8" cy="17" r="2.1"/><path d="M 12 9.4 V 6.7 M 10.1 13.7 L 6.9 15.8 M 13.9 13.7 L 17.1 15.8"/></svg><span class="lbl">Graf</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-label="Záznamy">
            <span class="rail-eyebrow" aria-hidden="true">Záznamy</span>
            <button class="dest" data-screen="dennik" type="button" aria-label="Denník">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6.4 3.4 h 11.2 v 17.2 l -2.8 -1.8 -2.8 1.8 -2.8 -1.8 -2.8 1.8 Z"/><path d="M 9.4 8 h 5.2 M 9.4 11.6 h 5.2"/></svg><span class="lbl">Denník</span>
            </button>
            <button class="dest" data-screen="rozhodnutia" type="button" aria-label="Rozhodnutia">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12.9 4.8 L 19.2 11.1 L 16.6 13.7 L 10.3 7.4 Z"/><path d="M 12.1 9.2 L 6.4 14.9"/><path d="M 3.4 20.4 h 9.2"/></svg><span class="lbl">Rozhodnutia</span>
            </button>
            <button class="dest" data-screen="runy" type="button" aria-label="Runy">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 13.6 3 L 6.9 13.3 H 11.2 L 10.1 21 L 17.1 10.4 H 12.7 Z"/></svg><span class="lbl">Runy</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-label="Znalosti">
            <span class="rail-eyebrow" aria-hidden="true">Znalosti</span>
            <button class="dest" data-screen="kniznica" type="button" aria-label="Knižnica">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 6.6 v 13"/><path d="M 4 5.4 c 2.7 -0.6 5.4 -0.2 8 1.2 2.6 -1.4 5.3 -1.8 8 -1.2 v 12 c -2.7 -0.6 -5.4 -0.2 -8 1.2 -2.6 -1.4 -5.3 -1.8 -8 -1.2 Z"/></svg><span class="lbl">Knižnica</span>
            </button>
            <button id="dest-kontrola" class="dest" data-screen="kontrola" type="button" aria-label="Kontrola">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 5.5 4.5 h 13 a 1.5 1.5 0 0 1 1.5 1.5 v 13 a 1.5 1.5 0 0 1 -1.5 1.5 h -13 A 1.5 1.5 0 0 1 4 19 V 6 a 1.5 1.5 0 0 1 1.5 -1.5 Z"/><path d="M 7.8 9.6 h 8.4"/><path d="M 7.8 14.6 l 2.2 2.2 4.2 -4.6"/></svg><span class="lbl">Kontrola</span>
            </button>
            <button class="dest" data-screen="smernica" type="button" aria-label="Smernica">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 9.4 4.6 H 7.6 A 1.6 1.6 0 0 0 6 6.2 V 18.9 A 1.6 1.6 0 0 0 7.6 20.5 h 8.8 a 1.6 1.6 0 0 0 1.6 -1.6 V 6.2 a 1.6 1.6 0 0 0 -1.6 -1.6 h -1.8"/><path d="M 9.9 3.1 h 4.2 a 0.9 0.9 0 0 1 0.9 0.9 v 1.8 a 0.9 0.9 0 0 1 -0.9 0.9 H 9.9 a 0.9 0.9 0 0 1 -0.9 -0.9 V 4 a 0.9 0.9 0 0 1 0.9 -0.9 Z"/><path d="M 9 11.2 h 6 M 9 15 h 4"/></svg><span class="lbl">Smernica</span>
            </button>
        </div>

        {{-- Charón — AI chat nad vedomím. Vlastná skupina, pretože to NIE JE obrazovka
             grafu, ale samostatná plocha na vlastnej URL; `<a>` a nie `<button>`,
             aby to bol odkaz aj pre čítačku, prostredné kliknutie a klávesnicu.

             Do 20. 8. 2026 sem neviedol ani jeden odkaz (nález A1 auditu): konzola
             existovala, ale z grafu sa k nej nedalo dostať klikom vôbec — človek
             musel poznať URL. V lokálnej appke (`bin/hades.cmd`) nie je adresný
             riadok, takže bez tohto odkazu by bola nedosiahnuteľná úplne.

             Ikona: `send` je v subsete overená (je v kóde použitá). Vlastný glyf pre
             chat (`forum`, `chat`) by si vyžiadal regeneráciu subsetu — viď
             docs/BRAND-HADES.md §5. Význam nesie label, ikona je druhá. --}}
        {{-- Cieľ je `/chat`, nie `/console`. Rail hovorí „Charón — chat s vedomím",
             a to je od 25. 8. 2026 plnohodnotná appka na `/chat` (vlákna, projekty,
             vetvenie, artefakty). `/console` zostáva TECHNICKÁ konzola a svoju URL
             si drží — len na ňu už neposiela primárna navigácia. --}}
        <div class="rail-group" role="group" aria-label="Charón">
            <a href="/chat" class="dest" aria-label="Charón — chat s vedomím">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 20.6 3.4 L 3.4 10.2 L 10.9 13.1 L 13.8 20.6 Z"/><path d="M 20.6 3.4 L 10.9 13.1"/></svg><span class="lbl">Charón</span>
            </a>
            {{-- „Viac" existuje LEN v spodnej lište pod 768px (CSS ho inde skrýva).
                 Neotvára druhé menu — otvára paletu Ctrl-K, ktorá už pozná všetkých
                 deväť destinácií, akcie aj posledné vlákna. NIE `.dest` v zmysle
                 cieľa? Je: v lište sa chová ako piaty stĺpec, takže triedu má, ale
                 `aria-haspopup` priznáva, že otvára plochu a nenaviguje. --}}
            <button id="rail-more" class="dest" type="button"
                    aria-haspopup="dialog" aria-label="Viac — otvorí paletu">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 5.5 12 h 0.01 M 12 12 h 0.01 M 18.5 12 h 0.01"/></svg><span class="lbl">Viac</span>
            </button>
        </div>

        <div class="rail-group bottom" role="group" aria-label="Systém">
            <button id="btn-settings" class="dest" type="button" aria-label="Nastavenia">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 4 8 h 4.4 M 12.6 8 h 7.4"/><circle cx="10.5" cy="8" r="2.1"/><path d="M 4 16 h 7.4 M 15.6 16 h 4.4"/><circle cx="13.5" cy="16" r="2.1"/></svg><span class="lbl">Nastavenia</span>
            </button>
            <button id="btn-help" class="dest" type="button" aria-label="Pomocník">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.75"/><path d="M 9.7 9.6 a 2.4 2.4 0 0 1 4.7 0.8 c -0.25 1.3 -2.4 1.6 -2.4 3.2"/><path d="M 12 17.3 h 0.01"/></svg><span class="lbl">Pomoc</span>
            </button>
            {{-- Prepínač šírky railu. NIE `.dest` — nevedie nikam, tak nesmie mať váhu cieľa. Mechaniku nesie mind/rail.js. --}}
            <button id="rail-collapse" type="button" aria-controls="rail" aria-expanded="true" title="Zbaliť navigáciu" aria-label="Zbaliť navigáciu"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 19.6 V 4.6"/><path d="M 5.8 10.8 L 12 4.6 L 18.2 10.8"/></svg></button>
        </div>
    </nav>

    <main id="screens" tabindex="-1">
        <section class="screen" id="screen-dnes">
            <header class="screen-head">
                <h1>Dnes</h1>
                <p class="screen-sub">Čo sa práve deje vo vedomí</p>
            </header>
            <div id="dnes-body"></div>
        </section>

        <section class="screen" id="screen-dennik">
            <header class="screen-head">
                <h1>Denník</h1>
                <p class="screen-sub">Záznamy zo sessions po dňoch</p>
            </header>
            <div id="journal-filter"></div>
            <div id="journal-list"></div>
        </section>

        <section class="screen" id="screen-kniznica">
            <header class="screen-head">
                <h1>Knižnica</h1>
                <p class="screen-sub">Skills usporiadané podľa oblastí</p>
                <input id="library-search" placeholder="Filtrovať skills…" autocomplete="off" aria-label="Filtrovať skills">
            </header>
            <div id="library-body"></div>
        </section>

        <section class="screen" id="screen-rozhodnutia">
            <header class="screen-head">
                <h1>Rozhodnutia</h1>
                <p class="screen-sub">Časová os rozhodnutí naprieč projektami</p>
            </header>
            <div id="rozhodnutia-body"></div>
        </section>

        <section class="screen" id="screen-runy">
            <header class="screen-head">
                <h1>Runy</h1>
                <p class="screen-sub">Čo konzola robila — zadanie, kroky, cena</p>
            </header>
            <div id="runy-body"></div>
        </section>

        <section class="screen" id="screen-kontrola">
            <header class="screen-head">
                <h1>Kontrola</h1>
                <p class="screen-sub">Fronta poznatkov čakajúcich na overenie</p>
            </header>
            <div id="kontrola-body"></div>
        </section>

        <section class="screen" id="screen-smernica">
            <header class="screen-head">
                <h1>Smernica</h1>
                <p class="screen-sub">Povedz Hadesovi na čom robíš — poskladá kontext pre Claude Code</p>
            </header>
            <div id="directive-body"></div>
        </section>
    </main>

    <aside id="dock" class="hidden" aria-label="Bočný panel">
        <div class="dock-head">
            <h2 id="dock-title"></h2>
            <button class="close" id="dock-close" aria-label="Zavrieť panel"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
        </div>

        <section id="sec-structure" class="hidden">
            <div id="structure-tree"></div>
            <button id="btn-new-node" class="ghost" type="button">+ Nový uzol</button>
        </section>

        {{-- A10: sekcia #sec-stats („Prehľad") tu bola do 24. 8. 2026. Zmazaná —
             hovorila to isté, čo obrazovka Dnes (oba zdroje čítajú /api/dashboard),
             len v 248 px paneli a len na Grafe. #btn-today v hlavičke Grafu teraz
             vedie na obrazovku. --}}
        <section id="sec-legend" class="hidden">
            <h3>Typy uzlov</h3>
            <div id="legend-types"></div>
            <h3>Oblasti</h3>
            <div id="legend-areas"></div>
            <h3>Sila</h3>
            <div id="legend-strength"></div>
            <h3>Spojenia</h3>
            <div id="legend-connections"></div>
        </section>

        <section id="sec-settings" class="hidden">
            <h3>Predvoľby</h3>
            <div id="presets" role="group" aria-label="Predvoľby zobrazenia">
                <button type="button" class="preset" data-preset="clean" aria-pressed="false">
                    <span class="p-name">Čisté</span><span class="p-sub">ticho, len kostra</span>
                </button>
                <button type="button" class="preset" data-preset="live" aria-pressed="false">
                    <span class="p-name">Živé</span><span class="p-sub">predvolené</span>
                </button>
                <button type="button" class="preset" data-preset="dense" aria-pressed="false">
                    <span class="p-name">Husté</span><span class="p-sub">všetky spojenia</span>
                </button>
                <button type="button" class="preset" data-preset="ambient" aria-pressed="false">
                    <span class="p-name">Ambient</span><span class="p-sub">na pozeranie</span>
                </button>
            </div>
            <p id="preset-state" class="preset-state" aria-live="polite">vlastné nastavenie</p>
            <div class="switch-row">
                <span id="theme-toggle-label">Tmavý režim</span>
                <button id="theme-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="theme-toggle-label"></button>
            </div>
            {{-- Hustota zobrazenia — tri stupne jednej osi, preto segmentovaný
                 ovládač (role="radiogroup"), nie prepínač ani select. Stojí pri
                 téme, lebo je to ten istý druh voľby: ako appka vyzerá, nie čo
                 v nej je. Predvoľby (#presets) zámerne na hustotu nesiahajú —
                 tie riešia sieť na plátne, toto rozloženie obrazoviek. --}}
            <div class="switch-row" id="density-row">
                <span id="density-label">Hustota</span>
            </div>
            <div id="density" role="radiogroup" aria-labelledby="density-label">
                <button type="button" class="dens" data-density="comfortable" role="radio" aria-checked="false">Pohodlné</button>
                <button type="button" class="dens" data-density="cozy" role="radio" aria-checked="true">Cozy</button>
                <button type="button" class="dens" data-density="compact" role="radio" aria-checked="false">Kompaktné</button>
            </div>
            <div class="row" id="ambient-row">
                <button id="btn-ambient" class="ghost" type="button">Spustiť na celú obrazovku</button>
            </div>

            <details id="settings-advanced">
                <summary><span class="adv-title">Pokročilé</span><span class="adv-n">jednotlivé ovládače</span></summary>
                <div class="adv-body">
                    <h3>Vzhľad</h3>
                    {{-- A9: prepínač „Chat s Hadesom" je preč. Mŕtvy chat nad grafom
                         (fungoval len s API kľúčom) nahradil dok Charóna — otvára sa
                         tlačidlom v hlavičke a klávesou C, bez prepínača (R-2/§1b). --}}
                    <div class="switch-row">
                        <span id="sound-toggle-label">Zvuk</span>
                        <button id="btn-sound" class="switch" type="button" role="switch" aria-checked="true" aria-labelledby="sound-toggle-label"></button>
                    </div>
                    <h3>Pohyb</h3>
                    <label class="slider">Život
                        <input type="range" data-opt="life" min="0" max="1" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Animácie
                        <input type="range" data-opt="anim" min="0" max="1" step="0.05">
                        <output></output>
                    </label>
                    <h3>Sieť — filter</h3>
                    <div class="check-cap">Typy</div>
                    <label class="check"><input type="checkbox" data-ftype="memory" checked><span class="box" aria-hidden="true"></span><span>Spomienky</span></label>
                    <label class="check"><input type="checkbox" data-ftype="skill" checked><span class="box" aria-hidden="true"></span><span>Skills</span></label>
                    <label class="check"><input type="checkbox" data-ftype="project" checked><span class="box" aria-hidden="true"></span><span>Projekty</span></label>
                    <div class="check-cap">Zdroje</div>
                    <label class="check"><input type="checkbox" data-fsource="session" checked><span class="box" aria-hidden="true"></span><span>Záznamy</span></label>
                    <label class="check"><input type="checkbox" data-fsource="skill" checked><span class="box" aria-hidden="true"></span><span>Playbooky</span></label>
                    <label class="check"><input type="checkbox" data-fsource="digest" checked><span class="box" aria-hidden="true"></span><span>Súhrny a archívy</span></label>
                    <label class="check"><input type="checkbox" data-fsource="manual" checked><span class="box" aria-hidden="true"></span><span>Ručné</span></label>
                    <div class="check-cap">Vzťahy</div>
                    <label class="check"><input type="checkbox" data-frel="part_of" checked><span class="box" aria-hidden="true"></span><span>Kostra (part_of)</span></label>
                    <label class="check"><input type="checkbox" data-frel="uses" checked><span class="box" aria-hidden="true"></span><span>Použitia (uses)</span></label>
                    <label class="check"><input type="checkbox" data-frel="similarity" checked><span class="box" aria-hidden="true"></span><span>Podobnosti</span></label>
                    <label class="check"><input type="checkbox" data-frel="co_activation" checked><span class="box" aria-hidden="true"></span><span>Co-aktivácie</span></label>
                    <div class="switch-row">
                        <span id="softhover-label">Spojenia len pri hovere</span>
                        <button id="softhover-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="softhover-label"></button>
                    </div>
                    <div class="switch-row">
                        <span id="skeleton-label">Len kostra</span>
                        <button id="skeleton-toggle" class="switch" type="button" role="switch" aria-checked="false" aria-labelledby="skeleton-label"></button>
                    </div>
                    <label class="slider">Min. váha spojení
                        <input type="range" id="minweight-slider" min="0" max="5" step="0.5" value="1">
                        <output></output>
                    </label>
                    <h3>Priehľadnosť</h3>
                    <label class="slider">Panely
                        <input type="range" data-opt="panelAlpha" min="0.3" max="1" step="0.01">
                        <output></output>
                    </label>
                    <label class="slider">Pozadie
                        <input type="range" data-opt="bg" min="0" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Spojenia
                        <input type="range" data-opt="edgeAlpha" min="0.1" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Popisky
                        <input type="range" data-opt="labelAlpha" min="0" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    <h3>Veľkosti</h3>
                    <label class="slider">Uzly
                        <input type="range" data-opt="nodeScale" min="0.6" max="1.6" step="0.05">
                        <output></output>
                    </label>
                    <label class="slider">Písmo popiskov
                        <input type="range" data-opt="labelSize" min="0.7" max="1.5" step="0.05">
                        <output></output>
                    </label>
                    {{-- „Žiara" (data-opt="glow") a „Veľkosť podľa spojení" (#sizedeg-toggle)
                         sú zmazané. Ani jednu hodnotu nečítal žiadny renderovací modul:
                         nodeRadius() škáluje podľa stupňa VŽDY (je to súčasť vizuálneho
                         jazyka, nie voľba) a obrysy uzlov si alfu berú z palety témy.
                         Prepínač navyše platil plný buildSim()+kickSim() (40–190 ms) a
                         nové usadzovanie za nulovú vizuálnu zmenu. Rovnako predtým
                         zmizli slidery síl — ovládač, ktorý nič nerobí, je horší než
                         chýbajúci ovládač. --}}
                    <div class="row">
                        <button id="opts-reset">Obnoviť predvolené</button>
                    </div>
                </div>
            </details>
        </section>
    </aside>

    <aside id="node-panel" class="hidden" aria-label="Detail uzla">
        <div class="dock-head">
            <h2 id="node-label"></h2>
            <button class="close" id="node-close" aria-label="Zavrieť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
        </div>
        <div id="node-view">
            <span id="node-type" class="badge"><span id="node-swatch" class="swatch" aria-hidden="true"></span><span id="node-type-label"></span></span>
            <p id="node-meta"></p>
            <p id="node-desc"></p>
            <div id="node-record"></div>
            <h3>Spojenia</h3>
            <div id="node-neighbors"></div>
            <div id="node-suggestions-sec">
                <h3>Možno súvisí</h3>
                <div id="node-suggestions"></div>
            </div>
            <h3>História</h3>
            <div id="node-history"></div>
            <div class="row node-actions">
                {{-- „Overiť" je vidieť LEN pri uzle, ktorý na overenie čaká, a je
                     PRVÉ v rade: keď uzol čaká na rozhodnutie, je to jediná akcia,
                     ktorú od človeka niekto chce. Panel dovtedy odznak „čaká na
                     overenie" len ZOBRAZIL a odpovedať sa naň dalo iba prechodom
                     na Kontrolu — a to je tá istá porucha, akú na obrazovke Dnes
                     opravila sekcia fokusu. Endpoint je ten istý, ktorý používa
                     Kontrola aj Dnes; tretia cesta k tej fronte nevzniká. --}}
                <button id="node-verify" class="primary hidden">Overiť</button>
                <button id="node-edit" class="primary">Upraviť</button>
                {{-- A8: #node-pack („Do balíka") zaniklo — kontext doku je jediný
                     mechanizmus a #node-charon plní ten istý kontext. --}}
                <button id="node-charon" class="ghost" title="Priložiť do rozhovoru" aria-label="Priložiť do rozhovoru" aria-pressed="false"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="4.6" r="2.1"/><circle cx="5.2" cy="17" r="2.1"/><circle cx="18.8" cy="17" r="2.1"/><path d="M 12 9.4 V 6.7 M 10.1 13.7 L 6.9 15.8 M 13.9 13.7 L 17.1 15.8"/></svg></button>
                <button id="node-md" class="ghost hidden" title="Zobraziť dokument" aria-label="Zobraziť dokument"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 14 3.6 H 7 a 1.5 1.5 0 0 0 -1.5 1.5 v 13.8 A 1.5 1.5 0 0 0 7 20.4 h 10 a 1.5 1.5 0 0 0 1.5 -1.5 V 8.1 Z"/><path d="M 14 3.6 V 8.1 h 4.5"/><path d="M 8.6 12.6 h 6.8 M 8.6 16 h 4.4"/></svg></button>
                <button id="node-connect" class="ghost" title="Prepojiť s uzlom" aria-label="Prepojiť s uzlom"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 13.6 10.4 a 4 4 0 0 1 0 5.7 l -2 2 a 4 4 0 0 1 -5.7 -5.7 l 1.4 -1.4"/><path d="M 10.4 13.6 a 4 4 0 0 1 0 -5.7 l 2 -2 a 4 4 0 0 1 5.7 5.7 l -1.4 1.4"/></svg></button>
                <button id="node-delete" class="danger" aria-label="Zmazať"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 4.6 7 h 14.8"/><path d="M 9.6 7 V 5 c 0 -0.6 0.4 -1 1 -1 h 2.8 c 0.6 0 1 0.4 1 1 v 2"/><path d="M 6.4 7 l 0.9 12.2 c 0.1 0.9 0.8 1.6 1.7 1.6 h 6 c 0.9 0 1.6 -0.7 1.7 -1.6 L 17.6 7"/></svg></button>
            </div>
        </div>
        <div id="node-form" class="hidden">
            <label>Názov<input id="edit-label" maxlength="255"></label>
            <label>Popis<textarea id="edit-desc" rows="5"></textarea></label>
            <label id="edit-type-row" class="hidden">Typ<select id="edit-type">
                <option value="memory">Spomienka</option>
                <option value="skill">Skill</option>
                <option value="project">Projekt</option>
            </select></label>
            <label>Oblasť<select id="edit-area"></select></label>
            <label>Oddelenie<select id="edit-dept"></select></label>
            <div class="row">
                <button id="edit-save" class="primary">Uložiť</button>
                <button id="edit-cancel">Zrušiť</button>
            </div>
        </div>
    </aside>

    {{-- DETAIL ZÁZNAMU (kontrakt 28. 8. 2026, G6) — jeden panel pre Runy aj
         Rozhodnutia. Nie je to druhý `#node-panel`: ten nesie uzol vedomia a má
         vlastné akcie (prepojiť, zmazať, do rozhovoru). Tento nesie ZÁZNAM
         z tabuľky a jeho obsah skladá obrazovka, ktorá ho otvorila.

         Geometriu a animáciu dedí z `#node-panel` (spoločné pravidlo v CSS) — dva panely
         s dvoma rôznymi šírkami by boli dva rôzne pravé okraje na tej istej
         ploche, a `camInsets()` v layout.js číta `--panel-w` raz.

         `aria-label` sa dopisuje z JS podľa toho, čo je otvorené — statické
         „Detail" by čítačke nepovedalo, detail čoho. --}}
    <aside id="rec-panel" class="hidden" aria-label="Detail záznamu">
        <div class="dock-head">
            <h2 id="rec-panel-title"></h2>
            <button class="close" id="rec-panel-close" aria-label="Zavrieť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
        </div>
        <div id="rec-panel-body"></div>
    </aside>

    {{-- A8 (R-6): zásuvka „Balík pre Claude Code" a export do schránky zanikli.
         „Do balíka" teraz plní kontext doku Charóna a poznatok ide von rozhovorom
         s Charónom nad tým istým kontextom — jeden mechanizmus namiesto troch. --}}

    <div id="zoomctl" role="group" aria-label="Ovládanie kamery">
        <button id="zoom-in" title="Priblížiť (+)" aria-label="Priblížiť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 4.6 v 14.8 M 4.6 12 h 14.8"/></svg></button>
        <button id="zoom-out" title="Oddialiť (−)" aria-label="Oddialiť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 4.6 12 h 14.8"/></svg></button>
        <button id="zoom-reset" title="Vycentrovať (0)" aria-label="Vycentrovať"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 4 9 V 6 A 2 2 0 0 1 6 4 H 9"/><path d="M 15 4 H 18 A 2 2 0 0 1 20 6 V 9"/><path d="M 20 15 V 18 A 2 2 0 0 1 18 20 H 15"/><path d="M 9 20 H 6 A 2 2 0 0 1 4 18 V 15"/><circle cx="12" cy="12" r="2.6"/></svg></button>
    </div>

    {{-- A9: mŕtvy chat nad grafom (#prompt / #chat-context / #chat-log / #prompt-form)
         je preč — nahradil ho dok Charóna nižšie, ktorý beží lokálne a nesie
         dvojfázovú bránu zápisov. Kontext chatu (#chat-context) splynul s kontextom
         doku (#charon-ctx), A8. --}}

    {{-- CHARÓN — dok nad plátnom. Vlastné id (#dock je obsadené),
         vlastný .charon-* prefix. Napojený na /api/console/run cez zdieľaný
         runclient — jediná cesta k modelu, dvojfázová brána zápisov platí tu
         rovnako ako v konzole. Skrytý kým sa neotvorí (#charon-toggle / klávesa C). --}}
    <aside id="charon" aria-label="Charón — rozhovor nad grafom">
        <div id="charon-head">
            <span id="charon-title">Charón</span>
            <span id="charon-status" aria-hidden="true"></span>
            <button id="charon-close" type="button" aria-label="Zavrieť dok"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
        </div>
        <div id="charon-stream" role="log" aria-live="polite" aria-label="Priebeh rozhovoru"></div>
        <div id="charon-ctx" class="hidden" aria-label="Kontext z grafu"></div>
        {{-- A8: tlačidlo „Priložiť balík (N)" zaniklo — po zlúčení niet oddeleného
             balíka; „Do balíka" na obrazovkách plní priamo tento kontext. --}}
        <div id="charon-composer">
            <form id="charon-form">
                <textarea id="charon-input" rows="1" autocomplete="off"
                          placeholder="Opýtaj sa Hadesa nad grafom…" aria-label="Správa pre Charóna"></textarea>
                <button id="charon-send" type="submit" aria-label="Odoslať"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 20.6 3.4 L 3.4 10.2 L 10.9 13.1 L 13.8 20.6 Z"/><path d="M 20.6 3.4 L 10.9 13.1"/></svg></button>
                <button id="charon-stop" class="hidden" type="button" aria-label="Zastaviť beh"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6.7 6.7 h 10.6 v 10.6 H 6.7 Z"/></svg></button>
            </form>
        </div>
        <div id="charon-announce" class="sr-only" aria-live="polite"></div>
    </aside>

    <div id="toasts" aria-live="polite"></div>
    <div id="hover-card" class="hidden" role="tooltip"></div>

    <div id="cmdk" class="hidden" role="dialog" aria-modal="true" aria-label="Hľadať">
        <div id="cmdk-card">
            <div class="cmdk-input-row">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.4" cy="10.4" r="6.2"/><path d="M 14.9 14.9 L 20.3 20.3"/></svg>
                <input id="cmdk-input" placeholder="Hľadať uzly, playbooky, obrazovky…" autocomplete="off" aria-label="Hľadať">
                <kbd>esc</kbd>
            </div>
            <div id="cmdk-results"></div>
        </div>
    </div>

    <div id="help-overlay" class="hidden" role="dialog" aria-modal="true" aria-label="Klávesové skratky">
        <div id="help-card">
            <div class="dock-head">
                <h2>Klávesové skratky</h2>
                <button class="close" id="help-close" aria-label="Zavrieť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
            </div>
            <div id="help-body"></div>
        </div>
    </div>

    <div id="md-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="md-title">
        <div id="md-card">
            <div class="dock-head">
                <h2 id="md-title"></h2>
                <button class="close" id="md-close" aria-label="Zavrieť"><svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg></button>
            </div>
            <div id="md-body" class="md-body"></div>
            <div id="md-foot">
                <button type="button" class="ghost hidden" id="md-copypath">Kopírovať cestu</button>
                <button type="button" class="primary" id="md-pack">Do balíka</button>
            </div>
        </div>
    </div>

    <!-- VLNA GRAF A: d3 je späť — layout uzlov počíta d3.forceSimulation (sim.js).
         Keby sa d3 nenačítalo, buildSim() to zvládne aj bez neho (`d3ok()` v
         sim.js): uzly zostanú na deterministických semienkach pri svojich
         kotvách, len bez relaxácie. `ws.js` naopak volá `new Pusher(...)` bez
         stráže, takže bez pusher-js by živé pulzy padli s výnimkou.

         SELF-HOSTOVANÉ (F1, 26. 8. 2026). Do tohto dňa oba skripty prišli
         z `cdn.jsdelivr.net` a ani jeden nemal `integrity`, takže CSP povolila
         HOSTA, nie obsah — na appke tunelovanej cez ngrok reálna plocha.
         Presunuté do public/js/vendor/ z toho istého dôvodu ako fonty do
         public/fonts/. Verzie, sha256 a postup overenia sú
         v public/js/vendor/README.md; oba súbory sú UMD, takže globály `d3`
         a `Pusher` nastavia samé a pre sim.js/ws.js je to drop-in.

         Poradie drž: oba musia stáť PRED /js/mind/main.js.

         Dôsledok pre CSP: `script-src 'self'` platí odteraz na VŠETKÝCH troch
         plochách, výnimka pre `/` v App\Http\Middleware\ContentSecurityPolicy
         zanikla. V celom `resources/views/` už nie je ani jeden script tag
         mieriaci na cudzí host — keď sem niekto CDN skript pridá, politika ho
         nepovolí, a to je zámer. (Zámerne to tu nie je napísané ako doslovný
         `script src` s https adresou: audit, ktorý CDN skripty hľadá grepom, by
         na tejto vete falošne zabral. Naletel som na to pri overovaní.)
         Meranie: docs/sprint-2026-08-25/MERANIE-CSP.md -->
    <script src="/js/vendor/d3.min.js"></script>
    <script src="/js/vendor/pusher.min.js"></script>
    <script src="/js/charts.js"></script>
    <script type="module" src="/js/mind/main.js"></script>
    {{-- A9/fáza 2: setupCharon() volá priamo main.js (po installFetchGuard),
         samostatný bootstrap skript zanikol spolu s mŕtvym chat.js. --}}
</body>
</html>
