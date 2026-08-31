/* ===========================================================================
   DETAIL ZÁZNAMU — jeden pravý panel pre Runy a Rozhodnutia
   ===========================================================================
   Kontrakt 28. 8. 2026, G6. Panel nesie ZÁZNAM z tabuľky; obsah skladá
   obrazovka, ktorá ho otvorila, takže tento modul o behoch ani rozhodnutiach
   nevie nič. Vie len: otvor, zavri, vráť fokus, zapíš do adresy.

   ADRESU NESIE KĽÚČ OBRAZOVKY, nie vlastný kľúč panelu (`ruo` pre Runy, `roo`
   pre Rozhodnutia). Slovník v `urlstate.js` má kľúče viazané na obrazovku, takže
   sa pri prepnutí obrazovky zahodia samy — a dva panely sa v jednej adrese
   otvoriť nedajú. Spoločný kľúč `rec` by tú vlastnosť zrušil a obnova stránky by
   musela hádať, ktorý panel vyhráva.
   =========================================================================== */

import { $ } from './util.js';
import { writeUrl } from './urlstate.js';

/* Kto je otvorený: `{ ns, id, urlKey }` alebo `null`. Menný priestor je
   obrazovka, aby si Runy a Rozhodnutia nepomiešali otvorený záznam. */
let openRec = null;

/* Kam vrátiť fokus po zavretí. Panel otvára klik alebo Enter na riadku tabuľky,
   takže bez tohto by fokus spadol na <body> a Tab by začínal od začiatku
   dokumentu — presne to, čo si už raz zaplatila paleta Ctrl-K. */
let returnFocus = null;

export function recOpenId(ns) {
    return openRec && openRec.ns === ns ? openRec.id : null;
}

export function recPanelOpen() { return !!openRec; }

/**
 * Otvorí panel.
 *
 * `o`: { ns, id, urlKey, title, html }
 *   `title` je krátke meno záznamu (nadpis aj `aria-label`),
 *   `html` je hotové telo — volajúci ho už escapoval.
 */
export function openRecPanel(o) {
    const panel = $('rec-panel');
    if (!panel || !o) return;
    if (!openRec) returnFocus = document.activeElement;
    openRec = { ns: o.ns, id: String(o.id), urlKey: o.urlKey };

    $('rec-panel-title').textContent = o.title || '';
    /* Meno panelu sa dopisuje z obsahu: statické „Detail záznamu" by čítačke
       nepovedalo, detail čoho práve otvorila. */
    panel.setAttribute('aria-label', o.title ? ('Detail: ' + o.title) : 'Detail záznamu');
    $('rec-panel-body').innerHTML = o.html || '';
    panel.classList.remove('hidden');
    if (o.urlKey) writeUrl({ [o.urlKey]: String(o.id) }, 'replace');
}

/** Prekreslí telo bez toho, aby panel „skočil" (dopočítaný detail dobehol). */
export function updateRecPanel(html) {
    if (!openRec) return;
    $('rec-panel-body').innerHTML = html || '';
}

export function closeRecPanel() {
    const panel = $('rec-panel');
    if (!panel) return;
    const key = openRec && openRec.urlKey;
    panel.classList.add('hidden');
    openRec = null;
    if (key) writeUrl({ [key]: null }, 'replace');
    const back = returnFocus;
    returnFocus = null;
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus();
}

/** Zatvorí panel BEZ zápisu do adresy — pri prepnutí obrazovky. */
export function dropRecPanel() {
    const panel = $('rec-panel');
    if (panel) panel.classList.add('hidden');
    openRec = null;
    returnFocus = null;
}

export function wireRecPanel() {
    const btn = $('rec-panel-close');
    if (btn) btn.onclick = closeRecPanel;
    /* Esc zatvára, ale LEN keď je panel otvorený a fokus nie je v poli — inak by
       si bral Esc obrazovkám, ktoré ho používajú na zrušenie filtra. Globálna
       kaskáda skratiek je v shortcuts.js; toto je jej lokálny doplnok pri
       komponente, ktorý o nej nemusí vedieť. */
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !openRec) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.stopPropagation();
        closeRecPanel();
    });
}
