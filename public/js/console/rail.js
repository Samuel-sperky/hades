/* ===========================================================================
   Charón — bočný panel vlákien: JEDEN ZÁPISOVATEĽ jeho stavu.

   Pod 900 px nie je panel stĺpec, ale PREKRYV so scrimom (`console.css`,
   `@media (max-width: 900px)`). Do 1. 9. 2026 ho zatvárala jediná vec —
   `transform: translateX(-100%)` — a to je posun, nie zatvorenie: prvky zostanú
   v tab-poradí aj v strome prístupnosti. ZMERANÉ pri 375 px na zatvorenom
   paneli: 289 fokusovateľných prvkov, z toho 289 skutočne prijalo fokus, a
   dvanásť stlačení Tabu zo skip-linku skončilo dvanásťkrát vnútri neviditeľného
   panela. Klávesnicou sa teda dala celá história vlákien prejsť naslepo.

   PREČO `inert`, A NIE `hidden` ATRIBÚT (ako na `/chat`):
   `applyPanel()` v `chat/main.js` zatvára panel atribútom `hidden`, pretože tam
   je panel stĺpec mriežky na KAŽDEJ šírke a zatvorený je legitímny stav plochy.
   Tu je zatvorenosť stav LEN v režime prekryvu — nad 900 px je panel trvalá časť
   plochy a `hidden` by z neho musel byť odoberaný podľa media query, teda tá istá
   podmienka zapísaná druhýkrát. Navyše `[hidden] { display: none }` zabije
   `transition: transform`, takže by prekryv prestal vyjazdiť a zajazdiť.
   `inert` nerobí ani jedno: nechá layout aj prechod, odoberie celý podstrom
   z tab-poradia, zo stromu prístupnosti aj z klikov (scrim tým prestáva byť
   jediná obrana — blokuje z konštrukcie, nie z poradia vrstiev).
   `aria-hidden` sám by nestačil: ten fokus neodoberá.

   PREČO SA REŽIM PREKRYVU NEČÍTA Z ŠÍRKY:
   hranica 900 px je literál v troch stylesheetoch (viď komentár nad
   `@media` v `console.css`) a `matchMedia('(max-width: 900px)')` by bol štvrtý.
   `railOverlay()` sa preto pýta CSS na jeho vlastné rozhodnutie: prekryv je
   presne to, čo má `position: fixed`. Keď sa hranica pohne, tento súbor sa
   nemusí dotknúť.

   ROLA DIALÓGU je tiež len v režime prekryvu. Otvorený panel zaberá plochu,
   scrim za ním blokuje kliky a Esc ho zatvára — to je dialóg, nie bočný panel.
   Nad 900 px by `role="dialog"` na trvalom stĺpci bola lož, preto sa rola aj
   `aria-modal` pri prechode na široké okno ODOBERAJÚ.
   `aria-modal="true"` je zároveň SĽUB, že sa z panela nedá vytabovať —
   drží ho `trapTab()` nižšie.
   =========================================================================== */

import { $, $$ } from './dom.js';

/* `:not([disabled])` je súčasťou selektora, nie filtra: vypnuté tlačidlo fokus
   neprijme a v pasci by z neho bol falošný prvý/posledný prvok. */
const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

function railNode() {
    return $('#thread-rail');
}

function toggleNode() {
    return $('#rail-toggle');
}

/** Je panel v režime prekryvu? Odpoveď dáva CSS, nie druhá kópia hranice. */
export function railOverlay() {
    const node = railNode();

    return !!node && getComputedStyle(node).position === 'fixed';
}

export function railOpen() {
    return document.body.classList.contains('rail-open');
}

/* Viditeľnosť sa meria `getClientRects()`, nie `offsetParent`: `offsetParent` je
   pri `position: fixed` podľa špecifikácie `null`, takže by hlásil skrytú
   čítačku aj paletu, hoci sú na obrazovke. */
function shown(node) {
    return !!node && node.getClientRects().length > 0;
}

/** Fokusovateľné prvky panela v poradí dokumentu. */
function focusablesIn(node) {
    return $$(FOCUSABLE, node).filter(shown);
}

/**
 * Leží nad panelom iný modálny prvok? Čítačka (`#md-overlay`) a paleta
 * (`#cmdk`) sú tiež `aria-modal` a majú vlastné Esc — keby panel na Esc reagoval
 * spod nich, jedno stlačenie by zavrelo to, na čo sa človek nepozerá.
 * Test je generický (`[aria-modal]`), aby tretí prekryv nepribudol ako výnimka.
 */
function modalAbove() {
    return $$('[aria-modal="true"]').some((n) => n.id !== 'thread-rail' && shown(n));
}

/** Rola, `aria-modal`, `inert` a `aria-expanded` na jednom mieste. */
function applyRailState() {
    const node = railNode();
    if (!node) return;

    const overlay = railOverlay();
    const open = railOpen();

    // Zatvorený prekryv nie je len mimo obrazovky — je mimo tab-poradia.
    node.inert = overlay && !open;

    if (overlay) {
        node.setAttribute('role', 'dialog');
        node.setAttribute('aria-modal', 'true');
        toggleNode()?.setAttribute('aria-expanded', open ? 'true' : 'false');
    } else {
        node.removeAttribute('role');
        node.removeAttribute('aria-modal');
        // Nad 900 px je prepínač `display: none` a panel sa nezatvára —
        // `aria-expanded` by tvrdil stav, ktorý na tejto šírke neexistuje.
        toggleNode()?.removeAttribute('aria-expanded');
    }
}

/**
 * Zapíše stav panela do DOM. JEDINÉ miesto, kde sa mení `rail-open` — panel
 * zatvárajú štyri cesty (prepínač, klik mimo, Esc, výber vlákna v panele aj
 * v palete) a keby si každá prepínala triedu sama, `inert` a `aria-expanded` by
 * sa s ňou rozišli presne v tej ceste, na ktorú sa zabudlo.
 *
 * FOKUS: zatvorenie musí fokus vyniesť VON, kým je panel ešte živý. Keby sa
 * `inert` nasadil na predka aktívneho prvku, prehliadač fokus zhodí na `<body>`
 * a klávesnica stratí miesto v dokumente. Vracia sa na prepínač — je to prvok,
 * ktorý ten stav vlastní, a je to miesto, odkiaľ človek prišel. Keď fokus v paneli
 * nebol (klik na scrim myšou), nesahá sa naň.
 */
export function setRail(on) {
    const node = railNode();
    if (!node) return;

    const wasInside = node.contains(document.activeElement);

    document.body.classList.toggle('rail-open', !!on);

    if (!on && wasInside) toggleNode()?.focus();

    applyRailState();

    /* Fokus ide na KONTEJNER, nie na prvý prvok: prvý fokusovateľný prvok
       panela je odkaz „späť do grafu" a hneď za ním hľadanie — vstupné pole by
       na mobile vytiahlo klávesnicu nad panel, ktorý sa má prezerať. Kontejner
       nesie prístupné meno („Vlákna konzoly") aj rolu dialógu, takže čítačka
       ohlási, čo sa otvorilo, a Tab pokračuje prvým ovládacím prvkom. */
    if (on && railOverlay()) node.focus();
}

/** Prekreslenie stavu po zmene šírky okna — režim prekryvu sa mení s ňou. */
export function syncRail() {
    applyRailState();
}

function trapTab(event) {
    const node = railNode();
    const list = focusablesIn(node);

    if (list.length === 0) {
        event.preventDefault();
        node.focus();

        return;
    }

    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;

    // Kontejner je v pasci „pred prvým prvkom": Shift+Tab z neho ide na posledný.
    if (!node.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === node)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

/*
 * Listener je v CAPTURE fáze, a to je podmienka, nie štýl — ten istý dôvod ako
 * u čítačky: globálne Esc v `run.js` visí na dokumente v bublinovej fáze
 * a ZASTAVUJE BEH. Keby panel čakal, kým k nemu Esc dobubluje, jedno stlačenie
 * by zavrelo panel a zároveň zabilo rozbehnutý ťah.
 */
function onRailKey(event) {
    if (!railOpen() || !railOverlay()) return;
    if (modalAbove()) return;

    if (event.key === 'Escape') {
        /* Esc v hľadaní S TEXTOM patrí hľadaniu (vyprázdni ho — `main.js`), nie
           panelu. Prázdne pole už nemá čo vyprázdniť, takže vtedy Esc zatvára. */
        if (event.target?.id === 'thread-find' && event.target.value !== '') return;

        event.preventDefault();
        event.stopPropagation();
        setRail(false);

        return;
    }

    if (event.key === 'Tab') trapTab(event);
}

export function wireRail() {
    const node = railNode();

    // Kontejner musí byť programovo fokusovateľný, aby mal otvorený dialóg kam
    // položiť fokus. `-1` ho do tab-poradia nedáva.
    if (node) node.tabIndex = -1;

    toggleNode()?.addEventListener('click', (event) => {
        // Bez zastavenia by ten istý klik dobehol na dokument nižšie a panel by
        // sa v tom istom ťahu zatvoril.
        event.stopPropagation();
        setRail(!railOpen());
    });

    document.addEventListener('click', (event) => {
        if (!railOpen() || !railOverlay()) return;
        if (event.target.closest('#thread-rail, #rail-toggle')) return;
        setRail(false);
    });

    document.addEventListener('keydown', onRailKey, true);
    window.addEventListener('resize', syncRail);

    // Prvý zápis stavu: bez neho by zatvorený panel držal tab-poradie až do
    // prvého kliknutia na prepínač.
    applyRailState();
}
