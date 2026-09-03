{{--
    SPOLOČNÝ PLÁŠŤ CHYBOVÝCH STRÁNOK — jeden domov kresby pre 401, 404, 419, 500 a 503.

    Prečo plášť a nie päť samostatných dokumentov: `mind.css` sa na chybové stránky
    NENAČÍTAVA (401 sa vydáva aj vtedy, keď je appka zamknutá, a 500 sa vydáva aj
    vtedy, keď je appka rozbitá), takže každá stránka musí niesť kresbu znaku sama.
    Päť kópií toho istého 90-riadkového bloku by sa rozišlo — presne to appka už raz
    zaplatila na znaku samom (`mind/charon.js` a `console/render.js` mali každý svoju
    kópiu starého prstenca a po prekreslení na sieť jedna z nich kreslila ďalej starý
    tvar). Preto je výkres, tichá verzia aj typografia TU RAZ a stránka dopisuje len
    predmet, vetu a jednu akciu.

    `@extends` je framework vlastný vzor pre chybové stránky (`errors::minimal` robí
    to isté), takže to nie je druhý spôsob — je to ten istý spôsob s jedným zdrojom.

    Čo plášť ZÁMERNE nerobí:
      · nenačítava `mind.css`, žiadny externý CSS ani JS — dokument musí vyjsť aj
        vtedy, keď appka nevie obslúžiť request (500) alebo je odstavená (503);
      · nepoužíva serif. Manuál §8: v chybe je Playfair zakázaný — je to text, ktorý
        má človek použiť na opravu, nie na obdiv. Znak áno, serif nie;
      · neprezrádza cesty na serveri ani stav vedomia. Appka je verejne tunelovaná
        cez ngrok, takže tieto stránky vidí aj cudzí človek.

    `layout` nie je HTTP kód, takže Laravel ho nikdy neresolvuje ako chybovú stránku
    (`errors.{status}`) — kolízia s 401/404/419/500/503 nevzniká.
--}}
<!DOCTYPE html>
<html lang="sk">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>@yield('title')</title>
    {{-- Favicon je JEDEN UZOL, nie sieť — pri 16 px sa hrany zlejú (pravidlo redukcie
         znaku, viď `#brand-core` v mind.blade.php). Zhoduje sa s data-URI v
         `partials/brand-icons.blade.php` vrátane tmavej vetvy palety: karta prehliadača
         je tmavá. Do 1. 9. 2026 stál na 401 INÝ výkres (zlatý disk r 30 + prstenec r 45
         na 40 % alfy) — pri 16 px z neho ostala len zlatá škvrna bez identity, a bola to
         jediná plocha, ktorá znak kreslila po svojom. Generátor `build-mark.py` chybové
         stránky nevlastní (jeho stráž kontroluje len tri page blade), takže tento riadok
         sa musí prepisovať ručne, keď sa zmení partial — ale odteraz LEN TU, nie v každej
         chybovej stránke zvlášť. --}}
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='50' fill='%230e1413'/><circle cx='50' cy='50' r='36' fill='none' stroke='%23c4a2f5' stroke-width='9'/><circle cx='50' cy='50' r='15' fill='%23d8b878'/></svg>">
    <style>
        :root {
            color-scheme: light dark;
            /* Znak nesmie mať farbu napísanú na prvku — tu je to jediný :root, ktorý
               chybové stránky majú, a mind.css sem nedosiahne. `--gold` je hodnota
               `--gold-text`, nie `--gold`: jadro je tu 9 px plný disk, nie plocha
               v legende. */
            --accent: #6d3fb5;
            --gold: #8a6417;
        }
        body {
            margin: 0; min-height: 100vh; display: grid; place-items: center;
            background: #f8f4f7; color: #101d1b;
            font: 400 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        main { max-width: 30rem; padding: 2.5rem; text-align: center; }
        h1 { margin: 0 0 .5rem; font-size: 1.35rem; font-weight: 600; letter-spacing: -.01em; }
        p { margin: 0 0 1rem; color: #566964; }
        code {
            display: inline-block; padding: .35rem .6rem; border-radius: .4rem;
            background: rgba(109, 63, 181, .08); color: #6d3fb5;
            font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: .85em;
        }
        /* JEDNA AKCIA NA STRÁNKU (manuál §8) — preto `.act` a nie skupina tlačidiel.
           Zásahová plocha je 40 px na výšku, teda nad podlahou `--target-min` (24 px);
           chybová stránka je jediná plocha, kde človek klikne raz a naslepo, tak si tú
           rezervu zaslúži. Kontrast textu: 6,34:1 na svetlej, 8,74:1 na tmavej. */
        .act {
            display: inline-block; padding: .55rem 1.1rem; min-height: 40px;
            box-sizing: border-box; border-radius: .5rem;
            border: 1px solid rgba(109, 63, 181, .35);
            color: #6d3fb5; text-decoration: none; font-weight: 500;
        }
        .act:hover { background: rgba(109, 63, 181, .08); }
        .act:focus-visible { outline: 2px solid #6d3fb5; outline-offset: 2px; }

        /* ZNAK = SIEŤ (1. 9. 2026). Nosič je inline SVG a nie CSS `border`, a nebolo to
           voliteľné: kruh sa dá nakresliť rámom, zhluk uzlov spojených hranami nie.
           `display: block` zabíja spodný baseline odstup inline SVG. */
        .sigil { display: block; width: 44px; height: 44px; margin: 0 auto 1.25rem; }
        .sigil .edge { fill: none; stroke: var(--accent); stroke-width: 1.1; stroke-linecap: round; }
        /* Uzol je PRSTENEC, nie disk — ten istý jazyk ako uzly na plátne. Jadro je
           jediný sýty plný prvok, a preto jediné zlaté. */
        .sigil .node { fill: none; stroke: var(--accent); stroke-width: 1.2; }
        .sigil .core { fill: var(--gold); }

        /* Základný stav je HOTOVÝ ZNAK (mierka 1, hrany nakreslené), takže tichá
           verzia nie je „vypnuté", ale dosadnutý znak. Plošná podlaha z mind.css
           tento dokument nekryje — mind.css sa na chybové stránky nenačítava vôbec —
           preto je gate `no-preference` jediný nositeľ tichej verzie a musí zostať.
           Dýchanie jadra tu ZÁMERNE NIE JE: `core-pulse` je jediný nosič stavu
           bdie/spí a ten prepína `#brand-core` v appke. Na chybovej stránke nie je
           čo prepnúť, takže slučka by nenesla informáciu — bola by dekorácia. */
        .sigil .node, .sigil .core { transform: scale(1); opacity: 1; }
        .sigil .edge { stroke-dashoffset: 0; }

        @media (prefers-reduced-motion: no-preference) {
            /* `transform-box: fill-box` MUSÍ byť: v SVG je počiatočná hodnota
               `view-box` a `transform-origin` `0 0`, takže `scale()` na kruhu bez
               tejto dvojice škáluje okolo rohu viewBoxu a uzol prilieta z ľava-hora
               namiesto toho, aby vyrástol na mieste. */
            .sigil .node, .sigil .core { transform-box: fill-box; transform-origin: center; }
            /* `pathLength="100"` je v markupe: hrany majú 6,50 / 6,20 / 6,10 / 8,13 (zmerané `getTotalLength()`)
               jednotky, takže jedna konštanta `stroke-dasharray` by dokreslila jednu
               a ostatné zastavila v polovici. */
            .sigil .edge {
                stroke-dasharray: 100; stroke-dashoffset: 100;
                animation: sig-draw 760ms cubic-bezier(.22, 1, .36, 1) 200ms 1 both;
            }
            .sigil .node { animation: sig-node-in 220ms cubic-bezier(.22, 1, .36, 1) 1 both; }
            .sigil .nodes .node:nth-child(2) { animation-delay: 80ms; }
            .sigil .nodes .node:nth-child(3) { animation-delay: 160ms; }
            /* Jedna dlhá dráha s plató v strede, nie dve zložené animácie: jadro sa
               zjaví ako BLEDÝ uzol spolu s ostatnými, počká, kým sa dokreslia hrany,
               a až potom sa presýti. Dve animácie by sa bili o `transform`.
               `filter: saturate()` a nie výmena farby — zlatá je v CSS raz. */
            .sigil .core { animation: sig-core-in 1040ms cubic-bezier(.22, 1, .36, 1) 160ms 1 both; }
        }

        @keyframes sig-draw {
            from { stroke-dashoffset: 100; }
            to   { stroke-dashoffset: 0; }
        }
        @keyframes sig-node-in {
            from { opacity: 0; transform: scale(.4); }
            70%  { opacity: 1; transform: scale(1.12); }
            to   { opacity: 1; transform: scale(1); }
        }
        @keyframes sig-core-in {
            0%   { opacity: 0; transform: scale(.4);   filter: saturate(.08); }
            21%  { opacity: 1; transform: scale(1);    filter: saturate(.08); }
            62%  { opacity: 1; transform: scale(1);    filter: saturate(.08); }
            84%  { opacity: 1; transform: scale(1.16); filter: saturate(1); }
            to   { opacity: 1; transform: scale(1);    filter: saturate(1); }
        }

        @media (prefers-color-scheme: dark) {
            :root { --accent: #c4a2f5; --gold: #d8b878; }
            body { background: #0e1413; color: #eaf3f1; }
            p { color: #8a9b98; }
            code { background: rgba(196, 162, 245, .12); color: #c4a2f5; }
            .act { border-color: rgba(196, 162, 245, .35); color: #c4a2f5; }
            .act:hover { background: rgba(196, 162, 245, .12); }
            .act:focus-visible { outline-color: #c4a2f5; }
        }
    </style>
</head>
<body>
    <main>
        {{-- SIEŤ V PLNEJ KRESBE. Nosič je 44 px, teda nad prahom redukcie: viditeľná
             stopa hrany od jadra má 7,2 px. (Pri 24 px by mala 3,9 px, a tam appka kreslí
             jeden uzol — pravidlo redukcie je pri `#brand-core` v mind.blade.php.)
             Súradnice sú tabuľka `SIGIL_NET` z public/js/shared/sigil.js, jediný zdroj výkresu
             rodiny `bc-*`. Uzly sú PRSTENCE ako uzly na plátne, jadro je jediný sýty plný
             prvok, chorda 2↔3 je z troch možných spojení satelitov jediná, ktorá minie
             jadro (5,63 od stredu proti polomeru 2,60).
             Triedy sú lokálne (`edge`/`node`/`core`), nie `bc-*`: kontrakt `.bc-mark` žije
             v mind.css a ten sa na chybové stránky nenačítava, takže `bc-*` by tu bolo
             meno, ktoré nikto nečíta. --}}
        <svg class="sigil" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
            <path class="edge" pathLength="100" d="M12 12L6.27 8.94"/>
            <path class="edge" pathLength="100" d="M12 12L17.74 9.65"/>
            <path class="edge" pathLength="100" d="M12 12L13.43 17.93"/>
            <path class="edge" pathLength="100" d="M18.9 10.92L15.17 18.14"/>
            <g class="nodes">
                <circle class="node" cx="4.06" cy="7.76" r="1.9"/>
                <circle class="node" cx="20.05" cy="8.7" r="1.9"/>
                <circle class="node" cx="14.02" cy="20.36" r="1.9"/>
            </g>
            <circle class="core" cx="12" cy="12" r="2.6"/>
        </svg>
        <h1>@yield('subject')</h1>
        @yield('body')
    </main>
</body>
</html>
