<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- CSRF token pre zápisy na interné /api/* — mind.js ho pripája do každého
         non-GET fetchu (ValidateCsrfToken, §3.5 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Hades — Vedomie</title>
    {{-- Favicon = súosé kruhy značky (tmavý papier / tealový prstenec / zlaté jadro).
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
         Cesta je relatívna zámerne: ngrok doména sa mení, absolútna by zastarala. --}}
    <meta property="og:type" content="website">
    <meta property="og:title" content="Hades">
    <meta property="og:description" content="Hierarchical Associative Data Embedding System">
    <meta property="og:image" content="/brand/hades-og.png">
    {{-- Fonty sú self-hosted v public/fonts/ (@font-face na začiatku mind.css).
         Google Fonts CDN je zámerne PREČ: pri jeho nedostupnosti sa každá ikona
         vykreslila ako svoj ligatúrový názov a chróm sa rozpadol.

         Preload je ROZPOČET, nie zvyk (docs/BRAND-HADES.md §6). Šesť súborov,
         178 108 → 260 780 B:
           · material-symbols-rounded-subset  132 196 — ikony railu v prvom rámci
           · geist-latin + geist-latin-ext     45 912 — chróm + slovenská diakritika
           · geist-mono-latin                  23 128 — `/` má 86 deklarácií
             var(--mono) (breadcrumb, metriky hlavičky, čísla kariet, časy, cesty)
             a preloadovaný tu nebol, kým na /console a /chat áno
           · playfair-display-latin + -ext     59 544 — serif nesie od vlny 1
             titulok obrazovky (.screen-head h1), nie len .hero-val. OBE
             podmnožiny: `Knižnica` má `ž` (U+017E), teda latin-ext, a preload len
             jednej by nechal titulok skočiť z Georgie do Playfairu po dobehnutí
             druhého súboru — presne ten blik, ktorý sa tu rieši.
         Účet je VEDOME dočasný: keď Material Symbols odíde za vlastnou SVG sadou
         (vlna 3), hlavička padne na 128 584 B, teda 50 kB POD dnešný stav. --}}
    <link rel="preload" href="/fonts/material-symbols-rounded-subset.woff2" as="font" type="font/woff2" crossorigin>
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
                <span class="ms" aria-hidden="true">arrow_upward</span>
            </button>
            <nav id="breadcrumb" aria-label="Aktuálny kontext"></nav>
            <span id="status-chip" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="txt">spí</span></span>
        </div>
        <div class="h-center">
            <div id="graph-tools" role="group" aria-label="Nástroje grafu">
                <!-- VLNA GRAF A: prepínač pohľadu — organická Sieť / neurónové Vrstvy (V) -->
                <button id="btn-view-net" class="ms" title="Sieť (V)" aria-label="Pohľad Sieť" aria-pressed="true">hub</button>
                <button id="btn-view-layers" class="ms" title="Vrstvy (V)" aria-label="Pohľad Vrstvy" aria-pressed="false">layers</button>
                <button id="btn-structure" class="ms" title="Štruktúra (R)" aria-label="Štruktúra">account_tree</button>
                {{-- A10: „Prehľad" bol sekcia doku, ktorá čítala /api/dashboard — teda
                     to isté, čo obrazovka Dnes, len v paneli širokom 248 px a len na
                     Grafe. Tlačidlo preto neotvára druhý panel s tými istými číslami,
                     ale skratkou vedie na obrazovku Dnes. Ikona je `wb_sunny`, tá istá,
                     akou je Dnes v raile — cieľ sa má dať prečítať z ikony (`monitoring`
                     sľuboval panel). Rail zostáva primárnou cestou; toto je len skratka
                     z hlavičky Grafu, ktorá je mimo Grafu skrytá spolu s #graph-tools. --}}
                <button id="btn-today" class="ms" title="Dnes (S)" aria-label="Otvoriť obrazovku Dnes">wb_sunny</button>
                <button id="btn-legend" class="ms" title="Legenda (L)" aria-label="Legenda">category</button>
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
            <button id="charon-toggle" type="button" class="ms" title="Charón nad grafom (C)"
                    aria-label="Charón — rozhovor nad grafom" aria-expanded="false" aria-controls="charon">hub</button>
            <button id="cmdk-trigger" type="button" aria-label="Hľadať (Ctrl+K)">
                <span class="ms" aria-hidden="true">search</span>
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
                <span class="ms" aria-hidden="true">wb_sunny</span><span class="lbl">Dnes</span>
            </button>
            <button class="dest" data-screen="graf" type="button" aria-label="Graf">
                <span class="ms" aria-hidden="true">hub</span><span class="lbl">Graf</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-label="Záznamy">
            <span class="rail-eyebrow" aria-hidden="true">Záznamy</span>
            <button class="dest" data-screen="dennik" type="button" aria-label="Denník">
                <span class="ms" aria-hidden="true">receipt_long</span><span class="lbl">Denník</span>
            </button>
            <button class="dest" data-screen="rozhodnutia" type="button" aria-label="Rozhodnutia">
                <span class="ms" aria-hidden="true">gavel</span><span class="lbl">Rozhodnutia</span>
            </button>
            <button class="dest" data-screen="runy" type="button" aria-label="Runy">
                <span class="ms" aria-hidden="true">bolt</span><span class="lbl">Runy</span>
            </button>
        </div>

        <div class="rail-group" role="group" aria-label="Znalosti">
            <span class="rail-eyebrow" aria-hidden="true">Znalosti</span>
            <button class="dest" data-screen="kniznica" type="button" aria-label="Knižnica">
                <span class="ms" aria-hidden="true">menu_book</span><span class="lbl">Knižnica</span>
            </button>
            <button id="dest-kontrola" class="dest" data-screen="kontrola" type="button" aria-label="Kontrola">
                <span class="ms" aria-hidden="true">fact_check</span><span class="lbl">Kontrola</span>
            </button>
            <button class="dest" data-screen="smernica" type="button" aria-label="Smernica">
                <span class="ms" aria-hidden="true">assignment</span><span class="lbl">Smernica</span>
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
        <div class="rail-group" role="group" aria-label="Charón">
            <a href="/console" class="dest" aria-label="Charón — chat s vedomím">
                <span class="ms" aria-hidden="true">send</span><span class="lbl">Charón</span>
            </a>
        </div>

        <div class="rail-group bottom" role="group" aria-label="Systém">
            <button id="btn-settings" class="dest" type="button" aria-label="Nastavenia">
                <span class="ms" aria-hidden="true">tune</span><span class="lbl">Nastavenia</span>
            </button>
            <button id="btn-help" class="dest" type="button" aria-label="Pomocník">
                <span class="ms" aria-hidden="true">help</span><span class="lbl">Pomoc</span>
            </button>
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
            <button class="close ms" id="dock-close" aria-label="Zavrieť panel">close</button>
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
            <button class="close ms" id="node-close" aria-label="Zavrieť">close</button>
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
                <button id="node-edit" class="primary">Upraviť</button>
                {{-- A8: #node-pack („Do balíka") zaniklo — kontext doku je jediný
                     mechanizmus a #node-charon plní ten istý kontext. --}}
                <button id="node-charon" class="ghost ms" title="Priložiť do rozhovoru" aria-label="Priložiť do rozhovoru" aria-pressed="false">hub</button>
                <button id="node-md" class="ghost ms hidden" title="Zobraziť dokument" aria-label="Zobraziť dokument">description</button>
                <button id="node-connect" class="ghost ms" title="Prepojiť s uzlom" aria-label="Prepojiť s uzlom">link</button>
                <button id="node-delete" class="danger ms" aria-label="Zmazať">delete</button>
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

    {{-- A8 (R-6): zásuvka „Balík pre Claude Code" a export do schránky zanikli.
         „Do balíka" teraz plní kontext doku Charóna a poznatok ide von rozhovorom
         s Charónom nad tým istým kontextom — jeden mechanizmus namiesto troch. --}}

    <div id="zoomctl" role="group" aria-label="Ovládanie kamery">
        <button id="zoom-in" class="ms" title="Priblížiť (+)" aria-label="Priblížiť">add</button>
        <button id="zoom-out" class="ms" title="Oddialiť (−)" aria-label="Oddialiť">remove</button>
        <button id="zoom-reset" class="ms" title="Vycentrovať (0)" aria-label="Vycentrovať">center_focus_strong</button>
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
            <button id="charon-close" class="ms" type="button" aria-label="Zavrieť dok">close</button>
        </div>
        <div id="charon-stream" role="log" aria-live="polite" aria-label="Priebeh rozhovoru"></div>
        <div id="charon-ctx" class="hidden" aria-label="Kontext z grafu"></div>
        {{-- A8: tlačidlo „Priložiť balík (N)" zaniklo — po zlúčení niet oddeleného
             balíka; „Do balíka" na obrazovkách plní priamo tento kontext. --}}
        <div id="charon-composer">
            <form id="charon-form">
                <textarea id="charon-input" rows="1" autocomplete="off"
                          placeholder="Opýtaj sa Hadesa nad grafom…" aria-label="Správa pre Charóna"></textarea>
                <button id="charon-send" class="ms" type="submit" aria-label="Odoslať">send</button>
                <button id="charon-stop" class="ms hidden" type="button" aria-label="Zastaviť beh">stop</button>
            </form>
        </div>
        <div id="charon-announce" class="sr-only" aria-live="polite"></div>
    </aside>

    <div id="toasts" aria-live="polite"></div>
    <div id="hover-card" class="hidden" role="tooltip"></div>

    <div id="cmdk" class="hidden" role="dialog" aria-modal="true" aria-label="Hľadať">
        <div id="cmdk-card">
            <div class="cmdk-input-row">
                <span class="ms" aria-hidden="true">search</span>
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
                <button class="close ms" id="help-close" aria-label="Zavrieť">close</button>
            </div>
            <div id="help-body"></div>
        </div>
    </div>

    <div id="md-overlay" class="hidden" role="dialog" aria-modal="true" aria-labelledby="md-title">
        <div id="md-card">
            <div class="dock-head">
                <h2 id="md-title"></h2>
                <button class="close ms" id="md-close" aria-label="Zavrieť">close</button>
            </div>
            <div id="md-body" class="md-body"></div>
            <div id="md-foot">
                <button type="button" class="ghost hidden" id="md-copypath">Kopírovať cestu</button>
                <button type="button" class="primary" id="md-pack">Do balíka</button>
            </div>
        </div>
    </div>

    <div id="hint" class="hidden" role="dialog" aria-label="Nápoveda">
        <p id="hint-text"></p>
        <div class="hint-foot">
            <button id="hint-skip" class="ghost" type="button">Preskočiť</button>
            <span id="hint-step" class="step"></span>
            <button id="hint-next" class="primary" type="button">Ďalej</button>
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
