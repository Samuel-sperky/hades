/* ===========================================================================
   Chat — ČÍTACÍ REŽIM odpovedí modelu

   ČO TO JE: prepínač sadzby odpovede. Vypnutý je chat (14 px, tesné bubliny,
   celá šírka stĺpca) — správny pre dialóg. Zapnutý je ČÍTAČKA: 16 px, prokládka
   1,7 a miera 72 ch v strede plochy — správna pre odpoveď, ktorú človek naozaj
   ČÍTA, nie preskakuje.

   KRESBU NEPÍŠEM A NESMIEM. `.md-body` je čítací režim celej appky a je
   v `public/css/mind.css` (blok „ČÍTACÍ REŽIM", ~2576). Overené priamo na
   bežiacej stránke 31. 8. 2026, nie grepom nad repom:

     .md-body { … padding: var(--sp-3); user-select: text;
                color: var(--text-secondary); line-height: 1.7;
                font-size: var(--fs-title); }          ← mind.css na /chat

   Preto tento modul robí presne jednu vec s DOM: **pridá / odoberie triedu
   `md-body`** na kontejneri markdownu odpovede. Druhá sada pravidiel s tými
   istými hodnotami by bola druhá pravda o tom, čo je čítanie — a `w4dup.js` by
   ju našla ako dvojitú deklaráciu.

   PREČO TRIEDA NA PRVKU A NIE `body[data-read="on"] .cm-md { … }`: to druhé je
   nové pravidlo s tými istými hodnotami, teda tá druhá pravda. Trieda na prvku
   používa kresbu, ktorá už existuje. `data-read` na `<body>` sa nastavuje TIEŽ,
   ale len ako značka stavu pre chróm (tlačidlo, prípadné utíšenie okolia) —
   nikdy nie ako nosič sadzby.

   ČO SA NA TÚTO TRIEDU NEPREBIJE (a je to zámer): próza odpovede je zariadená
   blokom `:is(.cm-md, .md)` v `chat.css` a ten je 0-1-0, teda **rovnako silný**
   ako `.md-body` — a `chat.css` sa načítava DRUHÝ, takže vyhráva. Odsek, zoznam
   a `code` teda zostávajú tie, čo boli, a čítací režim mení len to, čo `.cm-md`
   nedeklaruje: veľkosť písma, prokládku a mieru riadka. To je presne to, čo
   čítací režim JE.

   ČO SA NEDOKONČÍ BEZ CSS: `.md-body` nesie `padding: var(--sp-3)` a
   `color: var(--text-secondary)`, čo sú hodnoty čítačky V KARTE, nie v bubline —
   v bubline sa padding zdvojí a farba spadne o stupeň. Obe sú v reporte ako
   potreba `chat.css`; tento modul ich nesmie prepísať inline štýlom.

   Všetko sú HOISTOVANÉ `export function` (cyklus `read → render → main`).
   =========================================================================== */

import { live, readPref, writePref } from './main.js';
import { iconSvg, iconSwap } from '../shared/icons.js';

/* Prefix `hades.chat.` — rovnako ako panely a ich šírky. Čítací režim je
   vlastnosť TEJTO plochy: `/console` je technická konzola a čítačka do nej
   nepatrí, takže zdieľaný kľúč by nastavenie preniesol tam, kde ho nikto
   nezapol. */
const KEY = 'hades.chat.read';

/* Trieda čítačky. Konstanta preto, že ju čítajú TRI miesta (nová bublina,
   prepnutie nad existujúcimi, prepínač) a preklep v jednom z nich by sa
   neprejavil chybou, ale tichým polovičným režimom. */
const READ_CLASS = 'md-body';

/** Kontejner markdownu odpovede. Jedno miesto, kde sa ten selektor píše. */
const MD_SELECTOR = '.cm-bubble.cm-md';

/** @returns {boolean} je čítací režim zapnutý? Stav drží DOM, nie kópia v module. */
export function readOn() {
    return document.body.dataset.read === 'on';
}

/**
 * Zapíše stav do DOM a dorovná už vykreslené odpovede.
 *
 * Nič si nepamätá — to je `setRead()`. Rozdelené preto, že boot musí stav
 * NASADIŤ bez toho, aby ho znova zapisoval do `localStorage` (a bez oznamu pre
 * čítačku, ktorý by pri otvorení plochy prišiel do prázdna).
 */
export function applyRead(on) {
    document.body.dataset.read = on ? 'on' : 'off';
    syncReadBubbles();
    paintReadToggle();
}

/**
 * Prepne čítací režim a stav si zapamätá.
 *
 * Do adresy sa NEZAPISUJE, a je to tá istá úvaha ako u šírok panelov v `main.js`:
 * sadzba je vlastnosť čitateľa a jeho monitora, nie obsahu. Odkaz poslaný kolegovi
 * by mu prepísal režim, ktorý si na svojom stroji vybral.
 */
export function setRead(on) {
    applyRead(on);
    writePref(KEY, on ? 'on' : 'off');
    live(on ? 'Čítací režim zapnutý.' : 'Čítací režim vypnutý.');
}

export function toggleRead() {
    setRead(!readOn());
}

/**
 * Trieda pre kontejner markdownu NOVEJ odpovede.
 *
 * `render.js` ju volá pri stavaní bubliny, takže odpoveď, ktorá pribudne počas
 * zapnutého režimu, je čitateľná OD PRVÉHO TOKENU. Bez toho by sa dorovnala až
 * pri ďalšom prepnutí — a to je presne ten druh polovičného stavu, ktorý sa
 * nikdy neohlási ako chyba.
 *
 * @returns {string} hodnota pre `class`, nikdy nie prázdny reťazec
 */
export function mdClass() {
    return readOn() ? `cm-bubble cm-md ${READ_CLASS}` : 'cm-bubble cm-md';
}

/**
 * Dorovná VŠETKY vykreslené odpovede na aktuálny režim.
 *
 * `classList.toggle(name, force)` a nie `add`/`remove` vo vetve: dvojica vetiev
 * je dve miesta, kde sa dá zabudnúť na negáciu.
 */
export function syncReadBubbles() {
    const on = readOn();

    document.querySelectorAll(MD_SELECTOR).forEach((node) => {
        node.classList.toggle(READ_CLASS, on);
    });
}

/* ---------------------------------------------------------------------------
   PREPÍNAČ V HLAVIČKE

   Tlačidlo sa skládá TU a nie v blade, pretože `chat.blade.php` tento sprint
   nevlastní. Je to jediné miesto, kde vzniká — kto ho potrebuje, nájde ho podľa
   id, nie druhým `createElement`.
   --------------------------------------------------------------------------- */

const TOGGLE_ID = 'chat-read';

/** @returns {HTMLButtonElement|null} */
export function readToggle() {
    return document.getElementById(TOGGLE_ID);
}

/**
 * Stav prepínača: `aria-pressed`, titulok a ikona.
 *
 * Ikona sa mení cez `iconSwap()`, NIKDY priradením do `textContent`: ikony sú
 * inline SVG a `textContent` na `<svg>` nezobrazí nič a výnimku nevydá (pasca
 * zapísaná v CLAUDE.md, zaplatená 28. 8. 2026 na armed-confirm tlačidlách).
 *
 * `iconSwap()` berie KONTEJNER (tlačidlo), nie kresbu — sám si v ňom nájde
 * `svg.ic` a nahradí ho. Podať mu `<svg>` znamená hľadať `svg.ic` VNÚTRI kresby,
 * teda nenájsť nič a vložiť druhú ikonu do prvej.
 */
export function paintReadToggle() {
    const btn = readToggle();
    if (!btn) return;

    const on = readOn();
    const label = on ? 'Čítací režim: zapnutý' : 'Čítací režim: vypnutý';

    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = label;
    btn.setAttribute('aria-label', label);
    iconSwap(btn, on ? 'eye' : 'eye-off');
}

/**
 * Pripojí prepínač do hlavičky.
 *
 * Stojí PRED `#chat-artifact-toggle`, teda za výberom modelu a stavom behu:
 * poradie `.ch-right` ide od vlastností ŤAHU (profil, model, stav) k prepínačom
 * PLOCHY (čítanie, artefakt), a prepínač panela je ten najpravejší, pretože
 * panel, ktorý otvára, je tiež najpravejší.
 *
 * Idempotentné — druhé volanie nespraví druhé tlačidlo.
 */
export function wireRead() {
    const right = document.querySelector('#chat-header .ch-right');
    if (!right || readToggle()) return readToggle();

    const btn = document.createElement('button');

    btn.id = TOGGLE_ID;
    btn.type = 'button';
    btn.append(iconSvg('eye-off'));
    btn.addEventListener('click', () => toggleRead());

    right.insertBefore(btn, document.getElementById('chat-artifact-toggle'));
    paintReadToggle();

    return btn;
}

/**
 * Počiatočný stav: preferencia, inak vypnuté.
 *
 * Default je VYPNUTÉ zámerne. Chat je dialóg a prvé, čo človek na ploche vidí,
 * má byť konverzácia v jej vlastnej sadzbe; čítačka je voľba pre dlhú odpoveď,
 * nie predvolený tvar plochy.
 */
export function bootRead() {
    applyRead(readPref(KEY) === 'on');
}
