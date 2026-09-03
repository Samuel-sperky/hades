/* ===========================================================================
   ZNAK HADESA — jediný domov geometrie pre VŠETKY tri plochy.

   `/`, `/console` aj `/chat` kreslia ten istý znak, takže jeho výkres nesmie
   žiť v `mind/*` (tam naň import nemá nikto okrem obrazovky Graf). Súbor je
   preto bez závislostí: nič neimportuje a `esc()` má vlastný.

   Exporty: `sigilNetMarkup(cls, opts)` (reťazec do `innerHTML`) a
   `sigilNetSvg(cls, opts)` (prvok na `append`). Oba HOISTOVANÉ `export function`
   — ten istý dôvod ako všade v tomto repe (cyklické importy).
   =========================================================================== */

/* Privátny escape — shared modul nesmie ťahať `mind/util.js` len pre jednu
   funkciu (bol by to import z obrazovky Graf do plochy, ktorá ju nemá). */
function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------------------------
   ZNAK HADESA — SIEŤ PAMÄTI (rozhodnutie používateľa 1. 9. 2026)

   Znak prestal byť prstenec s jadrom a je to sieť: štyri uzly spojené hranami,
   jeden z nich sýty. Hovorí to, čo Hades je — živá sieť pamäti — a je to ten istý
   jazyk, akým hovorí plátno grafu: uzol je PRIEHĽADNÝ prstenec (priehľadnosť
   nesie diera, nie nízka alfa) a jadro je jediný sýty PLNÝ prvok, zlatý.

   TU JE JEDINÝ VÝKRES a je to zámer: `.load-mark` (32 px, načítavanie),
   `.charon-sigil` (32 px, prázdny dok nad grafom) aj `.empty-sigil` (44 px,
   prázdny stav `/console`) čítajú tú istú tabuľku `SIGIL_NET`. Dva výkresy sa
   vždy rozídu a appka to už raz zaplatila: `mind/charon.js` a `console/render.js`
   mali každý svoju kópiu STARÉHO prstenca, a keď sa znak prekreslil na sieť,
   `console/render.js` kreslil prstenec ďalej — s triedou `bc-ring`, ku ktorej
   v `mind.css` už neexistovalo žiadne pravidlo, takže zrod tam bol MŔTVY.

   PRESUN DO `shared/` JE PRÁVE PRETO (2. 9. 2026, predtým `mind/util.js`):
   na `mind/*` dosiahnu LEN moduly obrazovky Graf, takže `/console` a `/chat`
   na geometriu import nemali a ich nosiče si ju museli opisovať ručne. Tento
   súbor preto nesmie importovať z `mind/*` ani z `console/*` — má vlastný,
   privátny `esc()` a nulové závislosti. `mind/util.js` z neho re-exportuje,
   aby volajúci na obrazovke Graf nemuseli meniť import.

   ViewBox je 24 na všetkých nosičoch, tak ako doteraz: `transform-origin`
   aj dash matematika sa v SVG merajú v UŽÍVATEĽSKÝCH jednotkách viewBoxu, takže
   jeden výkres platí na 24, 26, 32 aj 44 px bez druhej sady čísel.

   KONTRAKT S KRESBOU (mind.css, blok ZROD ZNAKU) — markup ho musí naozaj niesť,
   inak zrod ticho nebeží:
     `class="bc-mark"` na `<svg>` je SPÍNAČ zrodu. Nesie ho `.charon-sigil`;
        `.load-mark` ho ZÁMERNE nemá (dôvod je pri jeho pravidle v mind.css:
        spinner sa montuje pri každom načítaní zoznamu a kreslenie hrán nanovo
        by z jednorazovej dramaturgie urobilo druhý, konkurenčný pohyb).
     `.bc-nodes` musí byť skupina s TROMI satelitmi ako svojimi jedinými deťmi —
        dobehy 80/160 ms visia na `:nth-child(2)` a `(3)`. Jadro do tej skupiny
        NEPATRÍ: má vlastnú, dlhšiu dráhu a `:nth-child` by mu ju rozhodil.
     `.bc-edge` je JEDEN PRVOK NA HRANU s `pathLength="100"`, nie jedna cesta so
        štyrmi podcestami. Hrany sú rôzne dlhé (6,10–8,13 jednotky), takže jedna
        podcestová dash hodnota by jednu dokreslila a ostatné zastavila v polovici;
        `pathLength` prevedie dash na percentá dĺžky a CSS tak nemusí poznať
        geometriu (kalibrácia oboch smerov je v mind.css nad `bc-draw`).
     `.bc-core` nesie LEN zlaté jadro a je to jeden prvok bez `.bc-node` — dve
        animácie nad tým istým `transform` by sa bili.

   PRAVIDLO REDUKCIE — tvrdšie než u kruhu a PRIZNANÉ po stupňoch. Hrany vedú zo
   STREDU jadra (tam sú skryté pod jeho plným kotúčom, r 2,6) na okraj prstenca
   satelitu, takže z nich VIDNO 3,90 / 3,60 / 3,50 jednotky, a chordu medzi 2. a 3.
   satelitom celú (8,13). Zmerané dĺžky ciest: 6,496 / 6,202 / 6,100 / 8,127.
   Prepočet na obrazovkové px:

     32 px (dok aj spinner): vidno 5,20 / 4,80 / 4,67 / 10,84 px · obrysy 1,60 / 1,47
     24 px (hlavičky):       vidno 3,90 / 3,60 / 3,50 /  8,13 px · obrysy 1,20 / 1,10
     16 px (favicon):        vidno 2,60 / 2,40 / 2,33 /  5,42 px · obrysy 0,80 / 0,73

   HRANICA JE 32 px — taká, akú dáva zadanie („pod ~32 px sa hrany zlejú") a akú
   nezávisle zapísala kresba (`.load-mark` v mind.css preto vyrástol z 26 na 32 px).
   Nad ňou sa kreslí sieť, pod ňou stupeň `'core'`, teda JEDEN uzol. Aritmetické
   dno je nižšie než tá hranica a je dobré to vedieť: pri 24 px sú obrysy ešte
   1,20 a 1,10 px, teda nad plným pixelom, až pri 16 px padajú na 0,80 a 0,73, kde
   antialiasing zoberie viac než polovicu kontrastu. Sieť teda pri 24 px nezmizne —
   len sa jej hrany scvrknú na 3,5 px stuble a znak prestane hovoriť „sieť". Prah sa
   preto neurčuje z obrysov, ale zo stubli, a 24 px nosiče (`#brand-core`,
   `#back-to-graph`, `#chat-home`) patria pod stupeň `'core'`.

   Stupeň `'core'` nekreslí ten uzol zo siete zväčšený, ale bajt na bajt dnešnú
   značku (prstenec `r 8,64` / obrys `2,16`, zlato `r 3,6`, teda `36 / 9 / 15`
   z `public/brand/hades-sigil-mini.svg` prepočítané do viewBoxu 24). Identita sa
   pri 16 px nerozpadne práve preto, že redukovaný tvar JE tá značka, ktorú appka
   nosila doteraz, a v jazyku plátna je to poctivý uzol: prstenec s plným stredom.
   Čo presne zmizne: tri satelitné uzly a všetky štyri hrany. Zlatý kotúč sám by
   značka nebol — amethyst musí prežiť do najmenšieho stupňa.

   FAREBNÝ KÁNON sa nemení: hrany a nesýte uzly amethyst (`--accent`, nosná
   a interaktívna rola), jadro zlaté (rola vyhradená značke a jadru vedomia).
   Tokeny, nikdy hex. Ktorá zlatá, rozhoduje NOSIČ, nie výkres: značkové nosiče
   `--brand-gold`, spinner `--gold-text` (téme prispôsobená zlatá pre malé plné
   prvky — dôvod je pri pravidle `.load-mark`), rail `currentColor`.

   POHYB je celý v CSS. SMIL sa nepoužije: nectí `prefers-reduced-motion`
   (§3 manuálu) a vo faviconách ani v `<img>` ho prehliadače neanimujú.

   Kreslí sa `createElementNS`, resp. reťazcom — nie cez `iconMarkup()` zo
   shared/icons.js: tá sada je ikonografia (60 symbolov) a znak značky do nej
   nepatrí. A pozor: `textContent` na `<svg>` nezobrazí NIČ a výnimku nevydá,
   takže znak sa nikdy neskládá priradením textu. */
const SIGIL_NET = {
    /* Jadro je PLNÝ kotúč bez prstenca. Prstenec okolo neho bol starý znak;
       v novom by z jadra urobil štvrtý prstencový uzol a „jediný sýty prvok"
       by prestal byť jediný. */
    core: { x: 12, y: 12, r: 2.6 },
    /* Vzdialenosti od jadra sú zámerne rôzne (9,00 / 8,70 / 8,60) a uhly
       nepravidelné: pravidelný trojuholník je ornament, sieť pamäti nie je
       symetrická. Ďalej to nejde — pri prstenci s vonkajším polomerom 2,50 je
       strop vzdialenosti 9,50 a satelit by sa dotkol okraja viewBoxu. */
    nodes: [
        { x: 4.06, y: 7.76, r: 1.9, sw: 1.2 },
        { x: 20.05, y: 8.70, r: 1.9, sw: 1.2 },
        { x: 14.02, y: 20.36, r: 1.9, sw: 1.2 },
    ],
    /* Tri hrany zo stredu jadra + chorda 2↔3. Chorda je z troch možných spojení
       satelitov jediná, ktorá minie jadro (zmerané: 5,63 od stredu proti polomeru
       2,60; ostatné dve by ho preťali). Sieť tým prestane byť hviezda — uzol vie
       viesť k uzlu, nie len do stredu, čo je presne to, čo graf pamäti robí. */
    edges: [
        [12, 12, 6.27, 8.94],
        [12, 12, 17.74, 9.65],
        [12, 12, 13.43, 17.93],
        [18.90, 10.92, 15.17, 18.14],
    ],
    edgeSw: 1.1,
    mini: { r: 8.64, sw: 2.16, gold: 3.6 },
};

/* Popis častí — jedna tabuľka, dva vydavatelia (reťazec pre innerHTML, prvky pre
   append). Ten istý vzor ako `iconMarkup()` / `iconSvg()`: dve cesty do DOM,
   jeden zdroj kresby. Skupina `.bc-nodes` je súčasťou kontraktu, nie kozmetika. */
function sigilParts(opts) {
    const g = SIGIL_NET;
    const gold = (opts && opts.gold) || 'var(--brand-gold)';
    if (opts && opts.step === 'core') {
        return [
            { tag: 'g', cls: 'bc-nodes', kids: [
                { tag: 'circle', a: { class: 'bc-node', cx: 12, cy: 12, r: g.mini.r,
                    fill: 'none', stroke: 'var(--accent)', 'stroke-width': g.mini.sw } },
            ] },
            { tag: 'circle', a: { class: 'bc-core', cx: 12, cy: 12, r: g.mini.gold,
                fill: gold } },
        ];
    }
    const parts = g.edges.map((e) => ({
        tag: 'path',
        a: { class: 'bc-edge', pathLength: '100', d: 'M' + e[0] + ' ' + e[1] + 'L' + e[2] + ' ' + e[3],
            fill: 'none', stroke: 'var(--accent)', 'stroke-width': g.edgeSw,
            'stroke-linecap': 'round' },
    }));
    parts.push({ tag: 'g', cls: 'bc-nodes', kids: g.nodes.map((n) => ({
        tag: 'circle',
        a: { class: 'bc-node', cx: n.x, cy: n.y, r: n.r, fill: 'none',
            stroke: 'var(--accent)', 'stroke-width': n.sw },
    })) });
    parts.push({ tag: 'circle', a: { class: 'bc-core', cx: g.core.x, cy: g.core.y,
        r: g.core.r, fill: gold } });
    return parts;
}

function sigilAttrs(a) {
    let out = '';
    Object.keys(a).forEach((k) => { out += ' ' + k + '="' + a[k] + '"'; });
    return out;
}

function sigilPartMarkup(p) {
    if (p.kids) {
        return '<g class="' + p.cls + '">' + p.kids.map(sigilPartMarkup).join('') + '</g>';
    }
    return '<' + p.tag + sigilAttrs(p.a) + '/>';
}

function sigilPartNode(p) {
    const NS = 'http://www.w3.org/2000/svg';
    const node = document.createElementNS(NS, p.tag);
    if (p.kids) {
        node.setAttribute('class', p.cls);
        p.kids.forEach((k) => { node.append(sigilPartNode(k)); });
        return node;
    }
    Object.keys(p.a).forEach((k) => { node.setAttribute(k, p.a[k]); });
    return node;
}

/** Znak ako reťazec — pre nosiče, ktoré idú do `innerHTML`. `cls` môže byť
    prázdne (nosič si rozmer drží na obale); `opts.step` je `'full'` (default)
    alebo `'core'` (redukcia pod 24 px), `opts.gold` prepíše zlatý token. */
export function sigilNetMarkup(cls, opts) {
    let out = '<svg' + (cls ? ' class="' + esc(cls) + '"' : '')
        + ' viewBox="0 0 24 24" aria-hidden="true">';
    sigilParts(opts).forEach((p) => { out += sigilPartMarkup(p); });
    return out + '</svg>';
}

/** Znak ako prvok — pre nosiče, ktoré ho `append`ujú. Nikdy nie `textContent`. */
export function sigilNetSvg(cls, opts) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    sigilParts(opts).forEach((p) => { svg.append(sigilPartNode(p)); });
    return svg;
}

