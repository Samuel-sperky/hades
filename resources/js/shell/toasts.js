import { $, esc } from '../core/dom.js';
import { REDUCED_MOTION } from '../core/motion.js';
import { S } from '../core/state/index.js';
import { focusNode } from '../graph/camera.js';
import { selectNode } from '../node/node-panel.js';


/* ---------- toasty, pomocnik, hinty ---------- */

export function showToast(text, nodeId, variant) {
    const wrap = $('toasts');
    // button — prístupné z klávesnice, klik naviguje na uzol
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('role', 'status');
    el.className = 'toast' + (variant ? ' ' + variant : '');
    // variantná ikona (success/warn/error); default hub
    const icon = { success: 'check_circle', warn: 'warning', error: 'error' }[variant] || 'hub';
    const parts = String(text).split(/:\s(.+)/);
    el.innerHTML = parts.length > 1
        ? '<span class="ms" aria-hidden="true">' + icon + '</span><span>' + esc(parts[0]) + ': <strong>' + esc(parts[1]) + '</strong></span>'
        : '<span class="ms" aria-hidden="true">' + icon + '</span><span>' + esc(text) + '</span>';

    const leave = (node) => {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), REDUCED_MOTION ? 0 : 200);
    };
    const arm = () => { el._t = setTimeout(() => leave(el), REDUCED_MOTION ? 0 : 5200); };

    el.onclick = () => {
        const n = nodeId ? S.byId.get(nodeId) : null;
        if (n) {
            S.cam.k = Math.max(S.cam.k, 1);
            focusNode(n);
            selectNode(n);
        }
        leave(el);
    };
    el.addEventListener('mouseenter', () => clearTimeout(el._t));
    el.addEventListener('mouseleave', () => { el._t = setTimeout(() => leave(el), REDUCED_MOTION ? 0 : 2500); });

    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    arm();
}


// Undo toast — variant success s tlačidlom „Späť" (armed-inline akcie: skip). Na
// rozdiel od showToast (button) je to div, aby sme mohli vnoriť undo tlačidlo.
export function showUndoToast(text, onUndo) {
    const wrap = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast success';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ms" aria-hidden="true">check_circle</span><span>' + esc(text) + '</span>';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'toast-undo chip';
    undo.textContent = 'Späť';
    el.appendChild(undo);

    const leave = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), REDUCED_MOTION ? 0 : 200); };
    let t = setTimeout(leave, REDUCED_MOTION ? 0 : 6000);
    undo.onclick = () => { clearTimeout(t); leave(); if (onUndo) onUndo(); };
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => { t = setTimeout(leave, REDUCED_MOTION ? 0 : 2500); });

    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
}

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter, filtrovanie klientsky nad jedným fetchom),
   detail/expand dôvodu klikom na kartu a manuálne pridanie → POST /api/decisions. */
