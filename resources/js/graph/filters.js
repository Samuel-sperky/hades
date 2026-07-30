import { S } from '../core/state/index.js';
import { store } from '../core/store.js';
import { updateGraphSummary } from './input.js';
import { localSet } from './local.js';
import { draw } from './render/draw.js';
import { showToast } from '../shell/toasts.js';


/* ---------- filtre siete (typy / zdroje / oblasti) ---------- */

export function filterActive() {
    return S.filter.types.size > 0 || S.filter.sources.size > 0
        || S.filter.areas.size > 0 || S.filter.tags.size > 0;
}


// Zdrojový kôš uzla pre filter: session / skill (playbook) / digest+archive / ručné
function sourceBucket(n) {
    if (n.source === 'session') return 'session';
    if (n.source === 'skill') return 'skill';
    if (n.source === 'digest' || n.source === 'archive') return 'digest';
    if (!n.source) return 'manual';
    return null;
}


// Jadro sa nikdy nefiltruje; skryté typy/zdroje/oblasti uzol vyradia z kreslenia
function filterPass(n) {
    if (n.type === 'core') return true;
    if (S.filter.types.has(n.type)) return false;
    const b = sourceBucket(n);
    if (b && S.filter.sources.has(b)) return false;
    if (n.area_id && S.filter.areas.has(n.area_id)) return false;
    // pozitívny filter značiek: aktívny len keď je niečo vybrané; uzol musí niesť
    // aspoň jednu vybranú značku (uzly bez značiek pri aktívnom filtri vypadnú)
    if (S.filter.tags.size > 0) {
        const tags = n.tags;
        if (!Array.isArray(tags) || !tags.some((t) => S.filter.tags.has(t))) return false;
    }
    return true;
}


// Jediná brána viditeľnosti: aktívny lokálny graf vyhráva (BFS už množinu obmedzil)
export function nodeVisible(n, loc) {
    if (loc) return loc.has(n.id);
    return filterPass(n);
}


// Koľko uzlov prejde aktuálnou viditeľnosťou — podklad pre prázdny stav aj a11y sumár.
// Jadro sa nefiltruje, takže „nič nevidno" znamená nula NEjadrových uzlov.
export function visibleCounts() {
    const loc = localSet();
    let total = 0, nonCore = 0;
    for (const n of S.nodes) {
        if (!nodeVisible(n, loc)) continue;
        total++;
        if (n.type !== 'core') nonCore++;
    }
    return { total, nonCore };
}


export function persistFilter() {
    store.setRaw('filter', JSON.stringify({
        types: [...S.filter.types],
        sources: [...S.filter.sources],
        areas: [...S.filter.areas],
        tags: [...S.filter.tags],
    }));
}


export function persistRelFilter() {
    store.setRaw('relfilter', JSON.stringify([...S.filter.relations]));
}


// Zruší všetky filtre uzlov aj vzťahov a zosynchronizuje zaškrtávacie polia v doku,
// aby sa UI a stav nerozišli (checked = viditeľné).
export function clearAllFilters() {
    for (const k of ['types', 'sources', 'areas', 'tags', 'relations']) S.filter[k].clear();
    persistFilter();
    persistRelFilter();
    document.querySelectorAll('input[data-ftype], input[data-fsource], input[data-frel]')
        .forEach((inp) => { inp.checked = true; });
    document.querySelectorAll('input[data-ftag]').forEach((inp) => { inp.checked = false; });
    refreshVisibility();
    draw();
}


/* ---------- prázdny stav filtrov ---------- */

// Plávajúca karta nad plátnom: filtre môžu skryť celú sieť a plátno by inak
// vyzeralo ako prázdna appka. Stavia ju JS (rovnaký vzor ako #local-chip).
let notice = null;

function buildNotice() {
    notice = document.createElement('div');
    notice.id = 'filter-empty';
    notice.className = 'hidden';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<span class="ms" aria-hidden="true">filter_alt_off</span>'
        + '<div class="fe-text"><strong>Filtre skryli celú sieť</strong>'
        + '<span>Žiadny uzol neprešel aktuálnym filtrom.</span></div>'
        + '<button type="button" class="fe-reset">Zrušiť filtre</button>';
    document.body.appendChild(notice);
    notice.querySelector('.fe-reset').onclick = () => {
        clearAllFilters();
        showToast('Filtre zrušené');
    };
}


export function updateFilterNotice() {
    if (S.local) { if (notice) notice.classList.add('hidden'); return; } // lokálny graf má vždy koreň
    const show = filterActive() && S.nodes.length > 0 && visibleCounts().nonCore === 0;
    if (!show) { if (notice) notice.classList.add('hidden'); return; }
    if (!notice) buildNotice();
    notice.classList.remove('hidden');
}


/* Zmena viditeľnosti uzlov — prázdny stav a a11y sumár musia ísť vždy spolu,
   inak čítač obrazovky ohlási počty, ktoré na plátne už neplatia. */
export function refreshVisibility() {
    updateFilterNotice();
    updateGraphSummary();
}


/* Filtre siete — typy, zdroje, kategórie vzťahov, kostra, min. váha spojení. */
export function register(root) {
    // Filtre typov a zdrojov — checked = viditeľné; S.filter drží skryté hodnoty
    root.querySelectorAll('input[data-ftype], input[data-fsource]').forEach((inp) => {
        const key = inp.dataset.ftype ? 'types' : 'sources';
        const val = inp.dataset.ftype || inp.dataset.fsource;
        inp.checked = !S.filter[key].has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter[key].delete(val);
            else S.filter[key].add(val);
            persistFilter();
            refreshVisibility();
            draw();
        };
    });

    // Filter kategórií vzťahov — checked = viditeľné; S.filter.relations drží skryté kategórie
    root.querySelectorAll('input[data-frel]').forEach((inp) => {
        const val = inp.dataset.frel;
        inp.checked = !S.filter.relations.has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter.relations.delete(val);
            else S.filter.relations.add(val);
            persistRelFilter();
            draw();
        };
    });

    // Kostra — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    const skBtn = root.querySelector('#skeleton-toggle');
    if (skBtn) {
        const syncSkBtn = () => skBtn.setAttribute('aria-checked', S.skeleton ? 'true' : 'false');
        syncSkBtn();
        skBtn.onclick = () => {
            S.skeleton = !S.skeleton;
            store.setRaw('skeleton', S.skeleton ? '1' : '0');
            syncSkBtn();
            draw();
            showToast(S.skeleton ? 'Kostra zapnutá' : 'Kostra vypnutá');
        };
    }

    // A7 + FÁZA HRANY: min. váha spojení — samostatný stav (nie data-opt), surová hodnota v odpočte
    const mw = root.querySelector('#minweight-slider');
    if (mw) {
        const syncMw = () => {
            mw.style.setProperty('--pct', (parseFloat(mw.value) / 5) * 100 + '%');
            const wrap = mw.closest('label.slider');
            const out = wrap && wrap.querySelector('output');
            if (out) out.textContent = parseFloat(mw.value).toFixed(1);
        };
        mw.value = S.minWeight;
        syncMw();
        mw.oninput = () => {
            S.minWeight = parseFloat(mw.value);
            store.setRaw('minWeight', String(S.minWeight));
            syncMw();
            draw();
        };
    }
}
