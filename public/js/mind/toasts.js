import { selectNode } from './panels.js';
import { focusNode } from './render.js';
import { REDUCED_MOTION, S } from './state.js';
import { $, esc } from './util.js';

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

/* PREFERENCIA POKOJA SA TYKA POHYBU, NIE CASU NA CITANIE.
   Do 28. 8. 2026 sa pod `prefers-reduced-motion` nulovala aj DOBA ZOBRAZENIA
   (5200 / 6000 / 2500 ms na 0), takze toast zmizol v tom istom ramci, v ktorom
   vznikol — clovek s tou preferenciou oznamenie NIKDY neprecital a moznost
   „Spat" mu zmizla pod rukami. Znulovat sa smie VYHRADNE 200 ms odchodovy
   prechod, co je pohyb. Doba zobrazenia zostava rovnaka alebo dlhsia. */
    const leave = (node) => {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), REDUCED_MOTION ? 0 : 200);
    };
    const arm = () => { el._t = setTimeout(() => leave(el), 5200); };

    el.onclick = () => {
        const n = nodeId ? S.byId.get(nodeId) : null;
        if (n) {
            S.cam.k = Math.max(S.cam.k, 1);
            focusNode(n);
            selectNode(n);
        }
        leave(el);
    };
    const hold = () => clearTimeout(el._t);
    const release = () => { el._t = setTimeout(() => leave(el), 2500); };
    el.addEventListener('mouseenter', hold);
    el.addEventListener('mouseleave', release);
    /* Pauza platí aj pre fokus, nielen pre myš. Toast je fokusovateľný (button,
       resp. v undo variante nesie tlačidlo „Späť") a klávesnicový používateľ sa
       k nemu dostane Tabom — bez tejto vetvy mu odpočet beží ďalej a možnosť
       vrátiť akciu mu zmizne pod rukami. `focusin`/`focusout` (nie focus/blur),
       lebo fokus dostáva vnorené tlačidlo, nie samotný toast. */
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', release);

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
    let t = setTimeout(leave, 6000);
    undo.onclick = () => { clearTimeout(t); leave(); if (onUndo) onUndo(); };
    const hold = () => clearTimeout(t);
    const release = () => { t = setTimeout(leave, 2500); };
    el.addEventListener('mouseenter', hold);
    el.addEventListener('mouseleave', release);
    // Fokus drží toast rovnako ako myš — viď poznámku v showToast().
    el.addEventListener('focusin', hold);
    el.addEventListener('focusout', release);

    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
}
