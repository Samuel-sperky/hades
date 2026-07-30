import { isAwake } from '../graph/awake.js';


/* ---------- stav (bdie / spí) ---------- */

let lastStateUi = '';

export function updateStateUi() {
    const awake = isAwake();
    const key = awake ? 'awake' : 'asleep';
    if (key === lastStateUi) return;
    lastStateUi = key;
    const brand = document.getElementById('brand-core');
    brand.classList.toggle('awake', awake);
    brand.classList.toggle('asleep', !awake);
    brand.title = awake ? 'Hades — bdie' : 'Hades — spí';

    // stavový čip v hlavičke (bdie / spí)
    const chip = document.getElementById('status-chip');
    if (chip) {
        chip.classList.toggle('awake', awake);
        const txt = chip.querySelector('.txt');
        if (txt) txt.textContent = awake ? 'bdie' : 'spí';
    }
}
