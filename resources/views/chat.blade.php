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
    <title>Hades — Chat</title>
    {{-- POZOR: tri hodnoty palety sú tu NATVRDO, pretože data-URI je samostatný
         dokument a CSS premenné z mind.css nečíta:
           %230e1413 = --bg-rgb tmavej témy (papier, pozadie znaku),
           %23c4a2f5 = --accent tmavej témy (amethyst, prstenec),
           %23d8b878 = --brand-gold (jadro vedomia).
         Keď sa paleta zmení, tento favicon sa NEZMENÍ sám — a to isté platí pre
         kópiu v console.blade.php a mind.blade.php. --}}
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='36' fill='none' stroke='%23c4a2f5' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>">
    <link rel="alternate icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
    <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
    <meta property="og:type" content="website">
    <meta property="og:title" content="Hades — Chat">
    <meta property="og:description" content="Hierarchical Associative Data Embedding System">
    <meta property="og:image" content="/brand/hades-og.png">
    {{-- Tie isté self-hosted fonty ako graf a konzola. Google Fonts CDN je
         zámerne preč: pri jeho nedostupnosti sa každá ikona vykreslila ako svoj
         ligatúrový názov a rozhranie sa rozpadlo (kontrakt §2c). --}}
    <link rel="preload" href="/fonts/material-symbols-rounded-subset.woff2" as="font" type="font/woff2" crossorigin>
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
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                        <circle cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                        <circle cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
                    </svg>
                </a>
                <button id="chat-new" type="button" title="Nové vlákno (Ctrl+N)">
                    <span class="ms" aria-hidden="true">add</span><span class="lbl">Nové vlákno</span>
                </button>
            </div>
            {{-- Hľadanie. Či je klientské (nad načítaným zoznamom) alebo serverové
                 (fulltext v `console_messages`, kontrakt §3) rozhoduje vlna 3 —
                 kostra dáva len pole a udalosť `chat:search`. --}}
            <div class="cp-find">
                <span class="ms" aria-hidden="true">search</span>
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
                        <span class="ms" aria-hidden="true">list</span>
                    </button>
                    <h1 id="chat-title">Chat</h1>
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
                        <span class="ms" aria-hidden="true">layers</span>
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
                    <svg class="ce-mark" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
                        <circle cx="12" cy="12" r="8.64" fill="none" stroke="var(--accent)" stroke-width="2.16"/>
                        <circle cx="12" cy="12" r="3.6" fill="var(--brand-gold)"/>
                    </svg>
                    <h2>Napíš úlohu pre vedomie</h2>
                    <p>Chat vidí pamäť Hadesa aj súbory projektu. Každý zápis
                       do pamäte alebo do súboru najprv ukáže náhľad a čaká
                       na tvoje potvrdenie.</p>
                </div>
            </div>

            <form id="chat-composer" autocomplete="off">
                {{-- Späť na spodok — ukáže sa len keď človek odskroluje nahor.
                     Ikona `arrow_downward` v subsete NIE JE (zmerané: 252 px
                     namiesto 18 px, teda by sa vykreslila ako text), preto je to
                     `arrow_upward` prevrátená v CSS. --}}
                <button type="button" id="chat-to-bottom" class="hidden" title="Na spodok" aria-label="Skočiť na spodok">
                    <span class="ms flip" aria-hidden="true">arrow_upward</span>
                </button>
                <div class="cc-row">
                    <textarea id="chat-prompt" rows="1"
                              placeholder="Napíš úlohu pre vedomie… (Enter pošle, Shift+Enter nový riadok)"
                              aria-label="Správa pre vedomie"></textarea>
                    <button type="submit" id="chat-send" title="Poslať (Enter)" aria-label="Poslať">
                        <span class="ms" aria-hidden="true">arrow_upward</span>
                    </button>
                    <button type="button" id="chat-stop" class="hidden" title="Zastaviť beh (Esc)" aria-label="Zastaviť beh">
                        <span class="ms" aria-hidden="true">stop</span>
                    </button>
                </div>
                {{-- Klávesová časť je obalená v `.hint-keys`, aby sa na úzkom okne
                     dala skryť SAMOSTATNE — skryť celú nápovedu znamená skryť aj
                     poslednú stopu po skratkách. --}}
                <p id="chat-hint">
                    <span class="hint-keys"><kbd>Enter</kbd> pošle · <kbd>Shift</kbd>+<kbd>Enter</kbd> nový riadok · </span>
                    <span class="hint-keys"><kbd>Esc</kbd> zastaví beh · <kbd>Ctrl</kbd>+<kbd>N</kbd> nové vlákno · </span>
                    <kbd>Ctrl</kbd>+<kbd>B</kbd> vlákna
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
                    <span class="ms" aria-hidden="true">close</span>
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
