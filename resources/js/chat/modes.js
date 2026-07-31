/* Tri režimy nad jedným stavom (rozhodnutie 82).

     quickbar → dnešná lišta pri spodnom okraji, rýchly vstup
     overlay  → fullscreen nad ktoroukoľvek obrazovkou (poloprieh­ľadný nad grafom)
     screen   → samostatná obrazovka „Chat" v raili (rozhranie #16)

   Prepnutie NESMIE zhodiť konverzáciu: blok `#chat-composer` sa medzi hostmi
   fyzicky presúva (ten istý DOM = ten istý draft), zoznam správ sa poskládá
   znovu zo stavu. Nič sa nekopíruje. */

import { bus } from '../core/bus.js';
import { $ } from '../core/dom.js';
import { EV } from '../core/events.js';
import { S } from '../core/state/index.js';
import { setScreen } from '../shell/router.js';
import { autoresize, collapsePrompt, composerEl, focusComposer } from './composer.js';
import { renderLog } from './log.js';
import { chatState, setMode } from './state.js';
import { renderThreads } from './threads.js';

const COMPOSER_HOST = {
    quickbar: 'prompt',
    overlay: 'chat-overlay-composer',
    screen: 'chat-screen-composer',
};

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

let lastFocused = null;

export const overlayEl = () => $('chat-overlay');
export const overlayOpen = () => !!overlayEl() && !overlayEl().classList.contains('hidden');

function moveComposer(mode) {
    const comp = composerEl();
    const host = $(COMPOSER_HOST[mode]);
    if (!comp || !host || comp.parentElement === host) return;
    const hadFocus = document.activeElement === $('prompt-input');
    host.appendChild(comp);
    autoresize();
    if (hadFocus) focusComposer();
}

/** Presuň composer, prekresli log a zosúlaď viditeľnosť vrstiev. */
export function applyMode(mode, { focus = false, streamingId = null } = {}) {
    const prev = chatState.mode;
    const next = setMode(mode);
    document.body.dataset.chatMode = next;

    const ov = overlayEl();
    if (ov) {
        const show = next === 'overlay';
        ov.classList.toggle('hidden', !show);
        ov.setAttribute('aria-hidden', show ? 'false' : 'true');
    }
    // Do quickbaru sa vracia zbalená lišta (jej otvorenie je gesto používateľa);
    // pri odchode z quickbaru sa lišta zbalí, aby nezostala visieť pod overlayom.
    if (next !== 'quickbar') collapsePrompt();

    moveComposer(next);
    renderLog(streamingId);
    renderThreads();          // každý režim má vlastného hosta vlákien
    if (focus) focusComposer();

    if (prev !== next) bus.emit(EV.CHAT_MODE, { mode: next });
    return next;
}

export function openOverlay() {
    lastFocused = document.activeElement;
    applyMode('overlay', { focus: true });
    bus.emit(EV.CHAT_OPENED, { mode: 'overlay' });
}

export function closeOverlay() {
    // Zavretie overlayu sa vracia tam, odkiaľ prišlo: na obrazovke Chat je to
    // režim `screen` (inak by composer skončil v spodnej lište a log obrazovky
    // by zostal prázdny), inde quickbar.
    applyMode(S.screen === 'chat' ? 'screen' : 'quickbar');
    const back = lastFocused;
    lastFocused = null;
    if (back && document.contains(back)) back.focus();
    else collapsePrompt();
}

/** Prepni na samostatnú obrazovku Chat — cez router, aby sa zosúladil rail. */
export function openScreen() {
    if (S.screen !== 'chat') setScreen('chat');
    applyMode('screen', { focus: true });
    bus.emit(EV.CHAT_OPENED, { mode: 'screen' });
}

function trapTab(e) {
    if (e.key !== 'Tab' || !overlayOpen()) return;
    const ov = overlayEl();
    const items = [...ov.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function registerModes() {
    const ov = overlayEl();
    if (ov) {
        // Esc zavrie overlay a NEsmie pokračovať do kaskády v shell/shortcuts.js (P9).
        ov.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); closeOverlay(); return; }
            trapTab(e);
        });
        ov.addEventListener('click', (e) => { if (e.target === ov) closeOverlay(); });
        const close = $('chat-overlay-close');
        if (close) close.addEventListener('click', (e) => { e.preventDefault(); closeOverlay(); });
    }

    const expand = $('chat-expand');
    if (expand) expand.addEventListener('click', () => (overlayOpen() ? closeOverlay() : openOverlay()));

    // Rail/router vedie na obrazovku Chat → prepni režim; odchod z nej → quickbar.
    bus.on(EV.SCREEN_CHANGED, ({ to }) => {
        if (to === 'chat') { if (chatState.mode !== 'screen') applyMode('screen'); return; }
        if (chatState.mode === 'screen') applyMode('quickbar');
    });

    // Počiatočný režim: uložený `screen` platí len ak sme naozaj na obrazovke Chat.
    const start = chatState.mode === 'screen' && S.screen !== 'chat' ? 'quickbar'
        : (chatState.mode === 'overlay' ? 'quickbar' : chatState.mode);
    applyMode(start);
}
