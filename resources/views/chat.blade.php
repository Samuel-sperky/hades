<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    {{-- ==================================================================
         PREČO `/chat` EXISTUJE VEDĽA `/console`

         Nie je to tretí beh a nesmie sa ním stať. Beh je jeden:
         `/api/console/run` + `/api/console/decide`, klient `public/js/shared/*`.
         Tri vstupy do toho jedného behu — technická konzola `/console`, dok nad
         grafom (`public/js/mind/charon.js`) a táto plocha.

         Rozdiel je v ADRESÁTOVI, nie v mechanike:
         · `/console` je technická plocha. Jej názvoslovie (`console_*` tabuľky,
           `Console*` triedy, `hades.console.*` kľúče, `/console/<uuid>` URL) sa
           ZÁMERNE nepremenúva — bola by to migrácia bez jediného čitateľa a
           zlomili by sa odkazy na existujúce vlákna.
         · `/chat` je plocha pre človeka: vlákna a projekty, artefakty vedľa
           konverzácie, prílohy, hlas. To sa do technickej konzoly nedá dostavať
           bez toho, aby prestala byť technickou konzolou.

         Preto vlastná URL, vlastný blade, vlastné `public/js/chat/*` a
         `public/css/chat.css` — a spoločný beh. Keď sa tu objaví druhá cesta
         k modelu, je to chyba, nie funkcia (kontrakt §4).
         ================================================================== --}}
    {{-- CSRF pre zápisy na interné /api/* — beh (vlna 3) ho pripája do každého
         non-GET fetchu vrátane streamu (§3.3 docs/BEZPECNOST.md). --}}
    <meta name="csrf-token" content="{{ csrf_token() }}">
    {{-- Vlákno z URL: /chat/<uuid>. Prázdne = nové vlákno.

         Meno metaznačky je ZÁMERNE to isté ako na konzole (`console-thread`):
         je to ten istý riadok v `console_threads`, teda jeden fakt. Druhé meno
         pre tú istú vec by znamenalo, že každý zdieľaný čítač musí poznať obe. --}}
    <meta name="console-thread" content="{{ request()->route('uuid') ?? '' }}">
    {{-- Charón, nie „Chat": beh je jeden pre všetky tri vstupy, takže meno pre
         človeka musí byť jedno. `/console` už tento titulok má; „Chat" bolo
         pomenovanie plochy, nie tej veci, ktorá na nej hovorí.

         `og:title` nižšie hovorí to isté a je to podmienka, nie kozmetika: do
         31. 8. 2026 tu stálo „Hades — Chat", takže `<title>` a náhľad odkazu
         volali tú istú plochu dvoma menami — a náhľad je práve to, čo človek
         vidí prv, než stránku otvorí.

         Runtime `document.title` prepisuje `setTitle()` v public/js/chat/main.js
         na názov vlákna a to je ZÁMER — vlákno je adresa, ktorú si človek hľadá
         medzi kartami. Jeho FALLBACK bol do 31. 8. 2026 rozchod (`|| 'Chat'`,
         teda „Hades — Chat" pri prázdnom vlákne) a je ZAPLATENÝ: fallback
         v `setTitle()` aj `setTitle('Charón')` v run.js pri prázdnom vlákne dnes
         hovoria to isté meno ako tento riadok. Zmerané po oprave: `document.title`
         = „Hades — Charón". Tri miesta, jedno meno — keď meníš jedno, prejdi
         všetky tri. --}}
    <title>Hades — Charón</title>
    {{-- Ikony značky (favicon, .ico fallback, dlaždica iOS) — jedna pravda pre
         všetky tri plochy. Data-URI v nej prepisuje tools/brand/build-mark.py. --}}
    @include('partials.brand-icons')
    <meta property="og:type" content="website">
    <meta property="og:title" content="Hades — Charón">
    <meta property="og:description" content="Hierarchical Associative Data Embedding System">
    <meta property="og:image" content="/brand/hades-og.png">
    {{-- Tie isté self-hosted fonty ako graf a konzola. Google Fonts CDN je
         zámerne preč: pri jeho nedostupnosti sa každá ikona vykreslila ako svoj
         ligatúrový názov a rozhranie sa rozpadlo (kontrakt §2c). --}}
    <link rel="preload" href="/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/fonts/geist-mono-latin.woff2" as="font" type="font/woff2" crossorigin>
    {{-- mind.css PRVÝ a je to podmienka, nie zvyk: nesie @font-face, farebné
         tokeny, témy, `.skip-link`, `.sr-only`, `.hidden`, bare `button`, `kbd`
         a globálne `:focus-visible`. chat.css nesie LEN layout tejto plochy a
         nesmie si písať vlastný fokusový prsteň ani vlastné farby. --}}
    <link rel="stylesheet" href="/css/mind.css">
    <link rel="stylesheet" href="/css/chat.css">
</head>
{{-- Stav panelov nesie <body>, nie #chat-app: pod 900 px sa panely menia na
     prekryv so scrimom, ktorý musí ležať nad celou plochou. Počiatočné hodnoty
     sú „otvorený zoznam vlákien, zatvorený artefakt"; `public/js/chat/main.js`
     ich pri starte prepíše podľa `localStorage` a šírky okna. --}}
<body class="chat-body" data-threads="on" data-artifact="off">
    {{-- SKIP-LINK: prvý fokusovateľný prvok. Cieľ je composer — jediné miesto,
         kde človek púšťa beh — aby sa k nemu klávesnicou dalo skočiť bez
         prechodu cez celý zoznam vlákien. Kresbu nesie `.skip-link` v mind.css. --}}
    <a class="skip-link" href="#chat-prompt">Preskočiť na pole správy</a>

    <div id="chat-app">
        {{-- ---------------------------------------------------------------
             1/3 — VLÁKNA A PROJEKTY (vľavo)
             Obsah zoznamu kreslí vlna 3; tu je kostra a trvalé prvky.
             --------------------------------------------------------------- --}}
        <aside id="chat-threads" aria-label="Vlákna a projekty">
            <div class="cp-top">
                {{-- Značka, nie ikona: chat je plocha Hadesa, tak sem patrí znak.
                     Klik vracia do grafu — logo, ktoré vedie domov, je zaužívané.
                     Prstenec je amethyst, jadro zlaté, presne ako v znaku. --}}
                <a href="/" id="chat-home" title="Hades — späť do grafu" aria-label="Hades — späť do grafu">
                    {{-- Triedy `bc-ring` / `bc-core` sú kánonický tvar znaku v Blade —
                         presne to vydáva `blade_inline_svg()` v tools/brand/build-mark.py,
                         takže markup má tie triedy niesť aj tam, kde ich CSS ešte nečíta.
                         Intro animácia znaku UŽ TU PLATÍ: selektor v mind.css bol
                         31. 8. 2026 rozšírený z `#brand-core` / `#back-to-graph` aj na
                         `#chat-home` a `.ce-mark`. Zmerané 1. 9. 2026 na bežiacej
                         ploche: `animationName` = `bc-draw` / `bc-core-in`,
                         `strokeDasharray` = 54.29px — to isté, čo `/console`.
                         Dovtedy tu stálo, že animácia je inertná, a ten zastaraný
                         komentár stihol spôsobiť nesprávny zápis do kontraktu šprintu
                         (agent uveril komentáru namiesto computed style). --}}
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                        <circle class="bc-ring" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                        <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
                    </svg>
                </a>
                <button id="chat-new" type="button" title="Nové vlákno (Ctrl+N)">
                    <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 4.6 v 14.8 M 4.6 12 h 14.8"/></svg><span class="lbl">Nové vlákno</span>
                </button>
            </div>
            {{-- Hľadanie. Či je klientské (nad načítaným zoznamom) alebo serverové
                 (fulltext v `console_messages`, kontrakt §3) rozhoduje vlna 3 —
                 kostra dáva len pole a udalosť `chat:search`. --}}
            <div class="cp-find">
                <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="10.4" cy="10.4" r="6.2"/><path d="M 14.9 14.9 L 20.3 20.3"/></svg>
                <input type="search" id="chat-search" autocomplete="off"
                       placeholder="Hľadať vo vláknach…" aria-label="Hľadať vo vláknach">
            </div>
            <nav id="chat-thread-list" aria-label="História vlákien" aria-busy="false"></nav>
        </aside>

        {{-- Ťahadlá šírky. `role="separator"` s `tabindex` je tu preto, aby sa
             šírka dala meniť aj klávesnicou (šípky) — myš nie je jediný vstup.

             Sú SÚRODENCI panelov, nie ich deti: panely majú `overflow: hidden`
             (bez neho by pri nulovej šírke stĺpca obsah vytiekol do konverzácie)
             a ťahadlo vnútri by sa o tú hranu zrezalo a sadlo na scrollbar
             zoznamu. Odtiaľto sedí na hranici a nezasahuje ani do jedného.
             Zatvorenému panelu ťahadlo zháša CSS podľa `body[data-…="off"]`. --}}
        <div class="cp-grip" id="chat-threads-grip" role="separator" tabindex="0"
             aria-orientation="vertical" aria-controls="chat-threads"
             aria-label="Šírka zoznamu vlákien"></div>

        {{-- ---------------------------------------------------------------
             2/3 — KONVERZÁCIA (stred)
             --------------------------------------------------------------- --}}
        <main id="chat-main">
            <header id="chat-header">
                <div class="ch-left">
                    {{-- Prepínač zoznamu vlákien. Pod 900 px je panel prekryv a bez
                         tohto tlačidla by k histórii nebolo ako sa dostať; nad 900 px
                         ním človek získa celú šírku pre konverzáciu. --}}
                    <button id="chat-threads-toggle" type="button" title="Vlákna (Ctrl+B)"
                            aria-label="Vlákna" aria-expanded="true" aria-controls="chat-threads">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 8 7 h 12 M 8 12 h 12 M 8 17 h 12"/><path d="M 4.2 7 h 0.01 M 4.2 12 h 0.01 M 4.2 17 h 0.01"/></svg>
                    </button>
                    {{-- „Charón", nie „Chat" — to isté meno ako `<title>` a `og:title`
                         (manuál §9). Toto je hodnota pred prvým vláknom a jediná, ktorú
                         vidí prvé vykreslenie aj crawler.

                         Tu stála poznámka, že `setTitle()` v public/js/chat/main.js má
                         fallback `|| 'Chat'` a tento nadpis po dobehnutí JS prepíše na
                         staré meno. Je ZAPLATENÁ (31. 8. 2026): fallback aj vetva
                         prázdneho vlákna v run.js hovoria „Charón". Statický text
                         a runtime text sa teda už nerozchádzajú. --}}
                    <h1 id="chat-title">Charón</h1>
                </div>
                <div class="ch-right">
                    {{-- Profil nástrojov pre ĎALŠÍ beh. Bez tohto ovládača bol
                         `spawn_agent` nedosiahnuteľný z akejkoľvek plochy: je len
                         v profile `orchestrator`, dok beží natvrdo na `graph` a
                         `/chat` neposielal `profile` vôbec, takže sa vždy použil
                         default `full` — v ktorom ten tool zámerne NIE JE.

                         Prečo výber a nie zmena defaultu: `orchestrator` má dva
                         tooly (recall + spawn_agent), takže ako default by z chatu
                         zmizli súbory aj kurátorstvo pamäte. Profil je vlastnosť
                         ŤAHU, nie plochy.

                         Server je posledné slovo: neznámy profil `RunController`
                         odmietne (422), takže tento `<select>` je pohodlie, nie
                         hranica. --}}
                    <label id="chat-profile-label" class="sr-only" for="chat-profile">Profil nástrojov</label>
                    <select id="chat-profile" aria-labelledby="chat-profile-label">
                        <option value="full" selected>Všetko</option>
                        <option value="memory">Pamäť</option>
                        <option value="files">Súbory</option>
                        <option value="graph">Graf</option>
                        <option value="orchestrator">Orchestrátor</option>
                    </select>
                    {{-- MODEL (kontrakt 28. 8. 2026, H5). Ide tou istou cestou ako
                         profil: `RunController` prijíma `model` na KAŽDÝ ťah, takže
                         je to vlastnosť ťahu a nie nastavenie plochy — jeden krok
                         sa dá pustiť na malom modeli a ďalší na veľkom.

                         Zoznam plní server (`GET /api/console/models`), nie tento
                         markup: modely sa v Ollame pridávajú a odoberajú a zoznam
                         zadrôtovaný v Blade by o týždeň ponúkal model, ktorý na
                         stroji nie je. Prázdna hodnota znamená „default z configu",
                         rovnako ako u profilu.

                         Voľba sa ZÁMERNE nepamätá medzi načítaniami: profil sa tiež
                         nepamätá a model uložený z minulej session by sa ticho
                         nasadil na vlákno iného poskytovateľa. Server je posledné
                         slovo — neznámy model odmietne. --}}
                    <label id="chat-model-label" class="sr-only" for="chat-model">Model</label>
                    <select id="chat-model" aria-labelledby="chat-model-label">
                        <option value="">Predvolený model</option>
                    </select>
                    {{-- Stav behu (sekundy, krok, tokeny) — plní vlna 3.
                         `aria-live` tu ZÁMERNE nie je: hodnota sa mení každú
                         sekundu a čítačka by tikala do rečí. Hotový ťah ohlási
                         jedna veta v #chat-announce. --}}
                    <span id="chat-run-stats"></span>
                    {{-- Prepínač panela artefaktu. `aria-expanded` je natvrdo
                         `false`, pretože panel štartuje zatvorený a
                         `public/js/chat/main.js` ho prepína — nesmie ho pri
                         prvom otvorení zakladať. --}}
                    <button id="chat-artifact-toggle" type="button" title="Panel artefaktu (Ctrl+J)"
                            aria-label="Panel artefaktu" aria-expanded="false" aria-controls="chat-artifact">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 3.4 L 20.6 8 L 12 12.6 L 3.4 8 Z"/><path d="M 3.4 12 L 12 16.6 L 20.6 12"/><path d="M 3.4 16 L 12 20.6 L 20.6 16"/></svg>
                    </button>
                </div>
            </header>

            {{-- Tok správ. Kreslí ho vlna 3 (bubliny, karty nástrojov, diffy,
                 potvrdzovacie prompty) nad zdieľaným `renderMarkdown` — žiadna
                 druhá kópia markdownu.

                 `aria-busy` má počas streamu držať vlna 3: inak čítačka hlási
                 každý prílet tokenu, teda pri ~8 tok/s osemkrát za sekundu. --}}
            <div id="chat-stream" role="log" aria-live="polite" aria-relevant="additions" aria-busy="false">
                {{-- Prázdny stav. Statický, aby plocha nebola biela ešte pred prvým
                     fetchom; vlna 3 ho odstráni, keď má čo kresliť (`#chat-empty`). --}}
                <div id="chat-empty">
                    {{-- Tie isté triedy ako v hlavičke a z toho istého dôvodu: znak má
                         v Blade jeden kánonický tvar. Animácia je aj tu zatiaľ inertná. --}}
                    <svg class="ce-mark" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                        <circle class="bc-ring" cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                        <circle class="bc-core" cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
                    </svg>
                    <h2>Napíš úlohu pre vedomie</h2>
                    <p>Chat vidí pamäť Hadesa aj súbory projektu. Každý zápis
                       do pamäte alebo do súboru najprv ukáže náhľad a čaká
                       na tvoje potvrdenie.</p>
                </div>
            </div>

            <form id="chat-composer" autocomplete="off">
                {{-- Späť na spodok — ukáže sa len keď človek odskroluje nahor.
                     Kresba je `arrow-down` z public/js/shared/icons.js, teda šípka
                     nakreslená dolu. Tu stálo, že `arrow_downward` v ikonovom subsete
                     nie je a preto je to prevrátená `arrow_upward` — to platilo pre
                     ikonový FONT, ktorý je od 28. 8. 2026 preč, a `.ms.flip` s ním.
                     Nevracaj CSS prevrátenie: v sade je vlastný tvar. --}}
                <button type="button" id="chat-to-bottom" class="hidden" title="Na spodok" aria-label="Skočiť na spodok">
                    <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 12 4.4 v 15"/><path d="M 18.2 13.2 L 12 19.4 L 5.8 13.2"/></svg>
                </button>
                <div class="cc-row">
                    <textarea id="chat-prompt" rows="1"
                              placeholder="Napíš úlohu pre vedomie… (Enter pošle, Shift+Enter nový riadok)"
                              aria-label="Správa pre vedomie"></textarea>
                    <button type="submit" id="chat-send" title="Poslať (Enter)" aria-label="Poslať">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 20.6 3.4 L 3.4 10.2 L 10.9 13.1 L 13.8 20.6 Z"/><path d="M 20.6 3.4 L 10.9 13.1"/></svg>
                    </button>
                    <button type="button" id="chat-stop" class="hidden" title="Zastaviť beh (Esc)" aria-label="Zastaviť beh">
                        <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6.7 6.7 h 10.6 v 10.6 H 6.7 Z"/></svg>
                    </button>
                </div>
                {{-- Klávesová časť je obalená v `.hint-keys`, aby sa na úzkom okne
                     dala skryť SAMOSTATNE — skryť celú nápovedu znamená skryť aj
                     poslednú stopu po skratkách.

                     PORADIE JE PODĽA ROZSAHU, nie podľa dôležitosti: najprv čo robí
                     pole pod nápovedou (Enter, Shift+Enter), potom beh (Esc), potom
                     plocha (Ctrl+N, Ctrl+B) a nakoniec paleta, ktorá dosiahne na
                     všetko. To isté poradie má `#composer-hint` na `/console`.

                     Ctrl+K tu do 31. 8. 2026 chýbalo, hoci paleta je odteraz hlavný
                     vstup na navigáciu a akcie (public/js/chat/palette.js, `keydown`
                     na dokumente). Nápoveda je JEDINÝ statický zdroj tejto vety —
                     dopisovať ju z JS by znamenalo druhý zdroj, ktorý sa rozíde.
                     Pod 900 px sa `.hint-keys` skrývajú, a to je zámer politiky
                     v chat.css: kombinácie na dotyku nemajú význam a `#cmdk-trigger`
                     si tam mind.css schová aj vlastnú `kbd`. --}}
                <p id="chat-hint">
                    <span class="hint-keys"><kbd>Enter</kbd> pošle · <kbd>Shift</kbd>+<kbd>Enter</kbd> nový riadok · </span>
                    <span class="hint-keys"><kbd>Esc</kbd> zastaví beh · <kbd>Ctrl</kbd>+<kbd>N</kbd> nové vlákno · </span>
                    <kbd>Ctrl</kbd>+<kbd>B</kbd> vlákna<span class="hint-keys"> · <kbd>Ctrl</kbd>+<kbd>K</kbd> paleta</span>
                </p>
            </form>

            {{-- Jedna veta pre čítačku, keď ťah dobehne alebo si žiada rozhodnutie. --}}
            <p id="chat-announce" class="sr-only" aria-live="polite"></p>
            {{-- Stavové oznamy z JS (otvorenie panela, šírka po ťahaní). Jeden
                 zámerne — dva `polite` regióny sa prekričia. --}}
            <div id="chat-live" class="sr-only" aria-live="polite"></div>
        </main>

        <div class="cp-grip" id="chat-artifact-grip" role="separator" tabindex="0"
             aria-orientation="vertical" aria-controls="chat-artifact"
             aria-label="Šírka panela artefaktu"></div>

        {{-- ---------------------------------------------------------------
             3/3 — ARTEFAKT (vpravo)
             Zatiaľ LEN kostra: `hidden` a prázdny kontejner. Obsah (zvýraznená
             syntax, náhľad HTML/SVG, tabuľky, diagramy, kopírovanie a stiahnutie)
             rieši vlna 3 — a technológiu diagramov rozhoduje meranie, nie
             preferencia (kontrakt §2c: žiadne CDN, žiadny bundler).
             --------------------------------------------------------------- --}}
        <aside id="chat-artifact" aria-labelledby="chat-artifact-title" hidden>
            <header class="ca-head">
                <h2 id="chat-artifact-title">Artefakt</h2>
                <button type="button" id="chat-artifact-close" title="Zavrieť panel" aria-label="Zavrieť panel artefaktu">
                    <svg class="ic" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M 6 6 L 18 18 M 18 6 L 6 18"/></svg>
                </button>
            </header>
            {{-- Jediný kontejner pre obsah artefaktu. Vlna 3 doňho kreslí a nič
                 iné v tomto panele nemá meniť — držať vstup na jednom mieste je
                 to, čo umožní panel neskôr vymeniť bez šitia po celej ploche. --}}
            <div id="chat-artifact-body"></div>
        </aside>
    </div>

    {{-- Nástroje, ktoré beh naozaj má. Zoznam skládá ToolRegistry v
         routes/web.php, nie klient — je to statický fakt o behu, ktorý sa medzi
         dvoma requestami nemení, takže endpoint by bol okruh za nič. Id je to
         isté ako na konzole zámerne: jeden fakt, jedno meno, jeden čítač.

         CSP: `type="application/json"` NIE JE spustiteľný typ, takže HTML tento
         blok nepripraví ako skript a `script-src` naň nedosiahne — politika
         v App\Http\Middleware\ContentSecurityPolicy preto NEMÁ `'unsafe-inline'`
         a tento riadok nemá nonce. Keby report-only režim na tomto riadku
         violáciu hlásil, je to nález a rieši ho MERANIE-CSP.md §5, nie dopísanie
         `'unsafe-inline'`. --}}
    <script type="application/json" id="console-tools">@json($consoleTools ?? [])</script>

    <script type="module" src="/js/chat/main.js"></script>
</body>
</html>
