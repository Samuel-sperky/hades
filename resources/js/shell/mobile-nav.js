/* Mobilná navigácia — rozhodnutie #76 / #78.

   Bottom nav (4 destinácie + „Viac") a spodný list so zvyškom obrazoviek.
   Číta ten istý data-screen kontrakt ako rail (§4.7), takže router o mobile
   nemusí vedieť nič. Viditeľnosť riadi výhradne resources/css/mobile.css —
   tento modul je aktívny aj na desktope, len tam nemá čo obsluhovať.

   register() volá shell/rail.js (navigácia je jeden celok a app.js je zdieľaný
   súbor; presun do boot sekvencie je patch pre integrátora v W2-P9-REPORT.md). */

import { bus } from '../core/bus.js';
import { EV } from '../core/events.js';
import { S } from '../core/state/index.js';
import { trapFocus } from './focus-trap.js';
import { setScreen } from './router.js';

let releaseTrap = null;


/** Zosúladí aktívny stav bottom navu a spodného listu s aktuálnou obrazovkou. */
export function syncMobileNav(name) {
    const screen = name || S.screen;
    document.querySelectorAll('#mobile-nav .mdest[data-screen]').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === screen);
    });
    document.querySelectorAll('#mobile-sheet .msheet-item[data-screen]').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === screen);
    });
    // „Viac" svieti, keď je aktívna obrazovka mimo štvorice v bottom nave.
    const more = document.querySelector('#mobile-more');
    if (more) {
        const inBar = [...document.querySelectorAll('#mobile-nav .mdest[data-screen]')]
            .some((b) => b.dataset.screen === screen);
        more.classList.toggle('active', !inBar);
    }
}


export function openMobileSheet() {
    const sheet = document.querySelector('#mobile-sheet');
    if (!sheet) return;
    sheet.classList.remove('hidden');
    const more = document.querySelector('#mobile-more');
    if (more) more.setAttribute('aria-expanded', 'true');
    releaseTrap = trapFocus(sheet);
}


export function closeMobileSheet() {
    const sheet = document.querySelector('#mobile-sheet');
    if (!sheet || sheet.classList.contains('hidden')) return;
    sheet.classList.add('hidden');
    const more = document.querySelector('#mobile-more');
    if (more) more.setAttribute('aria-expanded', 'false');
    if (releaseTrap) { releaseTrap(); releaseTrap = null; }
}


export function mobileSheetOpen() {
    const sheet = document.querySelector('#mobile-sheet');
    return !!sheet && !sheet.classList.contains('hidden');
}


export function register(root) {
    const nav = root.querySelector('#mobile-nav');
    if (!nav) return;

    nav.querySelectorAll('.mdest[data-screen]').forEach((b) => {
        b.onclick = () => { closeMobileSheet(); setScreen(b.dataset.screen); };
    });

    const more = root.querySelector('#mobile-more');
    if (more) more.onclick = () => (mobileSheetOpen() ? closeMobileSheet() : openMobileSheet());

    const sheet = root.querySelector('#mobile-sheet');
    if (sheet) {
        sheet.addEventListener('click', (e) => { if (e.target === sheet) closeMobileSheet(); });
        sheet.querySelectorAll('.msheet-item[data-screen]').forEach((b) => {
            b.onclick = () => { closeMobileSheet(); setScreen(b.dataset.screen); };
        });
        const close = root.querySelector('#mobile-sheet-close');
        if (close) close.onclick = () => closeMobileSheet();

        // Nastavenia a Pomoc nemajú obrazovku — otvárajú dock/overlay cez existujúce
        // tlačidlá v rely. Klik sa deleguje, aby tu nevznikol druhý zdroj pravdy.
        const proxy = (id, targetId) => {
            const el = root.querySelector(id);
            const target = document.querySelector(targetId);
            if (el && target) el.onclick = () => { closeMobileSheet(); target.click(); };
        };
        proxy('#mobile-settings', '#btn-settings');
        proxy('#mobile-help', '#btn-help');
    }

    // Tlačidlo vo výzve „graf je desktop-only"
    root.querySelectorAll('#mobile-graph-note [data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });

    bus.on(EV.SCREEN_CHANGED, (p) => syncMobileNav(p && p.to));
    syncMobileNav();
}
