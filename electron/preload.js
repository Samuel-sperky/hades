'use strict';

/**
 * Hades — desktop shell (preload).
 *
 * Beží v izolovanom kontexte (`contextIsolation: true`, `sandbox: true`), takže
 * stránka nikdy nevidí `ipcRenderer` naholo — dostane len úzke, menované API cez
 * `contextBridge`. Preload je jediný most medzi vizualizáciou a main procesom.
 *
 * Čo tento súbor ZÁMERNE NEROBÍ:
 *   • nesiaha na UI token (ten žije len v main procese, viď `main.js`),
 *   • nevkladá nič do `window` okrem jedného zmrazeného objektu `hades`,
 *   • nevystavuje `ipcRenderer.send/on` — každá cesta do main je konkrétna funkcia
 *     s bielou listinou hodnôt na druhej strane (`main.js`).
 *
 * Prečo tu žije pozorovateľ karty povolenia: „beh čaká na potvrdenie zápisu" je
 * stav DOM (`.perm-card`), nie správa z modelu — turn zaparkovaného zápisu žiadny
 * `end` rámec nepošle (viď CLAUDE.md, Charón). Jediné miesto, kde sa dá tento
 * okamih spoľahlivo zachytiť pre main proces (a teda pre tray notifikácie), je
 * DOM okna. Preload ho sleduje a hlási main procesu holý fakt: objavila sa /
 * zmizla karta s daným id. Rozhodnutie o notifikácii patrí main procesu.
 */

const { contextBridge, ipcRenderer } = require('electron');

/* ── Verejné API pre stránku ─────────────────────────────────────────────────
   Minimalizmus je bezpečnostná vlastnosť: čím menej mostov, tým menšia plocha.
   `isDesktop` dovolí frontendu vetviť sa (napr. skryť to, čo shell rieši sám),
   navigácia je uzavretý whitelist troch príkazov overený ešte raz v main. */

const NAV_ACTIONS = ['back', 'forward', 'reload'];

const api = {
    /** Pravda len v desktopovom obale — vo webovom prehliadači `window.hades` neexistuje. */
    isDesktop: true,

    /** Navigácia okna. Každý príkaz main proces overí proti vlastnej bielej listine. */
    nav: Object.freeze({
        back() { ipcRenderer.send('hades:nav', 'back'); },
        forward() { ipcRenderer.send('hades:nav', 'forward'); },
        reload() { ipcRenderer.send('hades:nav', 'reload'); },
    }),
};

contextBridge.exposeInMainWorld('hades', Object.freeze(api));

/* ── Pozorovateľ karty povolenia zápisu ──────────────────────────────────────
   Sleduje výskyt a zánik `.perm-card` (definícia v `public/js/console/tools.js`:
   čakajúca karta je `.perm-card:not(.decided)`, po rozhodnutí dostane `.decided`).
   Main procesu hlási len holé fakty; sám nič nezobrazuje. */

/** Id kariet, o ktorých už main proces vie ako o čakajúcich — proti dvojitým hláškam. */
const announced = new Set();

/** Je táto karta ešte čakajúca? Rozhodnutá karta má triedu `decided`. */
function isPending(card) {
    return !card.classList.contains('decided');
}

/**
 * Prejde aktuálny DOM, dorovná stav v `announced` a pošle main procesu rozdiely:
 * nová čakajúca karta → `hades:pending-write`, zmiznutá/rozhodnutá → `…-cleared`.
 * Zámerne idempotentné — dá sa volať pri každej mutácii bez rizika duplicít.
 */
function reconcile() {
    const cards = document.querySelectorAll('.perm-card');
    const stillPending = new Set();

    for (const card of cards) {
        const id = card.dataset.id || '';

        if (id === '' || !isPending(card)) {
            continue;
        }

        stillPending.add(id);

        if (!announced.has(id)) {
            announced.add(id);
            ipcRenderer.send('hades:pending-write', { id, name: card.dataset.name || '' });
        }
    }

    // Čo bolo čakajúce a už nie je (rozhodnuté alebo odstránené z DOM) — odhlás.
    for (const id of announced) {
        if (!stillPending.has(id)) {
            announced.delete(id);
            ipcRenderer.send('hades:pending-write-cleared', { id });
        }
    }
}

/** Pripojí pozorovateľa a spraví prvý zosúladenie stavu (karta môže už byť v DOM). */
function watchPermissionCards() {
    if (!document.body) {
        return;
    }

    reconcile();

    const observer = new MutationObserver(() => reconcile());

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class'],
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchPermissionCards, { once: true });
} else {
    watchPermissionCards();
}
