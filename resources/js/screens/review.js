/* Obrazovka Kontrola — triedič istoty poznatkov.

   ROZHODNUTIE P10 (detail v W2-P10-REPORT.md): vrstvu `certainty` NERUŠÍME.
   Nesie 64 overených a 6 pascí — pasca je najcennejší signál v celej sieti
   (zabráni agentovi zopakovať chybu). Rozbitá nebola vrstva, ale obrazovka:
   ukazovala výhradne `needs_review`, čo je backendom nastavovaný príznak s 5
   výskytmi zo 684, takže Kontrola 99 % času vyzerala prázdna a 614 neoznačených
   uzlov sa nedalo dosiahnuť. Preto tu teraz sú:
     1. KPI pás pokrytia (koľko % siete vôbec nesie značku),
     2. fronta „Na overenie"  — needs_review, ako doteraz,
     3. fronta „Bez istoty"   — 614 uzlov, ktoré nikto nikdy neoznačil,
     4. najslabšie pokryté oblasti — kde má triedenie najväčší efekt.
   Rozhodnutie 132/49 platí: certainty nikdy nedopĺňa model, len človek tu.

   VEREJNÉ ROZHRANIE (importuje shell/shortcuts.js a shell/router.js — nemeniť):
   renderKontrola, kontrolaState, kontrolaMove, kontrolaNodeRef, kontrolaBtn,
   kontrolaVerify, kontrolaResolve, armKontrolaAction, disarmKontrolaBtn.
   `kontrolaState.items` vždy zrkadlí AKTÍVNU frontu, takže j/k/v/r fungujú v oboch. */

import { ApiError, apiGet, apiSend } from '../core/api.js';
import { $, busy } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { clearLocal } from '../graph/local.js';
import { listSkeletonHtml, renderApiError } from './shared/anatomy.js';
import { applyMark, decNeedsReview } from './review/coverage.js';
import { hintsHtml, queueItemHtml } from './review/queue-item.js';
import { loadUnmarked } from './review/triage-source.js';
import { areaSectionHtml, emptyForTabHtml, sourceNoteHtml, statsHtml, tabsHtml } from './review/view.js';
import { setRailBadge } from '../shell/rail.js';
import { openNodeFromAnywhere } from '../shell/router.js';
import { showToast, showUndoToast } from '../shell/toasts.js';


export const kontrolaState = {
    items: [],        // aktívna fronta (čítajú ju skratky)
    idx: 0,
    total: 0,         // needs_review total → rail badge
    tab: 'review',    // 'review' | 'bez'
    queue: [],        // cache fronty needs_review
    unmarked: null,   // cache fronty bez istoty (null = ešte nenačítané)
    cert: null,       // blok certainty z /api/dashboard
    perArea: [],
    source: null,     // 'knowledge' | 'graph' — odkiaľ prišli neoznačené
};

export async function renderKontrola() {
    const body = $('kontrola-body');
    if (!body) return;
    body.innerHTML = listSkeletonHtml(5, '68px');

    const [queueRes, dashRes] = await Promise.allSettled([
        apiGet('/api/review/queue'),
        apiGet('/api/dashboard'),
    ]);

    if (queueRes.status !== 'fulfilled' && dashRes.status !== 'fulfilled') {
        renderApiError(body, queueRes.reason, renderKontrola);
        return;
    }

    if (queueRes.status === 'fulfilled') {
        const d = queueRes.value;
        kontrolaState.queue = d.queue || [];
        kontrolaState.total = d.total != null ? d.total : kontrolaState.queue.length;
    }
    if (dashRes.status === 'fulfilled') {
        kontrolaState.cert = dashRes.value.certainty || null;
        kontrolaState.perArea = dashRes.value.per_area || [];
    }
    kontrolaState.unmarked = null;
    kontrolaState.idx = 0;
    rerenderKontrola();
}


/* ---------- KPI pokrytia + prepínač fronty (markup je v review/view.js) ---------- */

function renderStats() {
    const host = $('kontrola-stats');
    if (host) host.innerHTML = statsHtml(kontrolaState.cert);
}


function renderTabs() {
    const host = $('kontrola-tabs');
    if (!host) return;
    host.innerHTML = tabsHtml(kontrolaState);
    host.querySelectorAll('[data-tab]').forEach((b) => {
        b.onclick = () => switchTab(b.dataset.tab);
    });
}


function switchTab(tab) {
    if (kontrolaState.tab === tab) return;
    kontrolaState.tab = tab;
    kontrolaState.idx = 0;
    if (tab === 'bez' && kontrolaState.unmarked === null) { loadTriage(); return; }
    rerenderKontrola();
}


async function loadTriage() {
    const body = $('kontrola-body');
    renderTabs();
    if (body) body.innerHTML = listSkeletonHtml(6, '68px');
    try {
        const { items, source } = await loadUnmarked();
        kontrolaState.unmarked = items;
        kontrolaState.source = source;
    } catch (e) {
        kontrolaState.unmarked = [];
        if (body) renderApiError(body, e, loadTriage);
        return;
    }
    rerenderKontrola();
}


/* ---------- zoznam ---------- */

function activeList() {
    return kontrolaState.tab === 'bez' ? (kontrolaState.unmarked || []) : kontrolaState.queue;
}


function rerenderKontrola() {
    const body = $('kontrola-body');
    if (!body) return;
    setRailBadge('kontrola', kontrolaState.total);
    renderStats();
    renderTabs();

    const items = activeList();
    kontrolaState.items = items;

    if (!items.length) {
        body.innerHTML = emptyForTabHtml(kontrolaState) + areaSectionHtml(kontrolaState.perArea);
        wireAreaJump(body);
        return;
    }

    kontrolaState.idx = Math.max(0, Math.min(kontrolaState.idx, items.length - 1));
    const acts = kontrolaState.tab === 'bez' ? ['verify', 'skip'] : ['verify', 'resolve', 'skip'];
    body.innerHTML = '<div class="queue">'
        + items.map((n, i) => queueItemHtml(n, i, i === kontrolaState.idx, acts)).join('')
        + '</div>'
        + sourceNoteHtml(kontrolaState)
        + hintsHtml(kontrolaState.tab !== 'bez')
        + areaSectionHtml(kontrolaState.perArea);
    wireKontrola(body);
    wireAreaJump(body);
}


function wireAreaJump(body) {
    const btn = body.querySelector('#kontrola-goto-bez');
    if (btn) btn.onclick = () => switchTab('bez');
}


export function kontrolaNodeRef(id) {
    const n = kontrolaState.items.find((x) => x.id === id);
    return n ? { id: n.id, label: n.label, type: n.type, area_id: n.area_id } : { id };
}


export function kontrolaBtn(id, act) {
    return document.querySelector('#kontrola-body .queue-item[data-id="' + id + '"] .act-' + act);
}


function wireKontrola(body) {
    body.querySelectorAll('.queue-item').forEach((item) => {
        const id = +item.dataset.id;
        const idx = +item.dataset.idx;
        item.addEventListener('mousedown', () => { kontrolaState.idx = idx; markKontrolaSelected(); });
        const bodyEl = item.querySelector('.queue-body');
        if (bodyEl) bodyEl.onclick = () => { kontrolaState.idx = idx; openNodeFromAnywhere(kontrolaNodeRef(id)); };
        const v = item.querySelector('.act-verify');
        if (v) v.onclick = (e) => { e.stopPropagation(); kontrolaVerify(id); };
        const r = item.querySelector('.act-resolve');
        if (r) r.onclick = (e) => { e.stopPropagation(); kontrolaResolve(id); };
        const s = item.querySelector('.act-skip');
        if (s) s.onclick = (e) => { e.stopPropagation(); armKontrolaAction(s, id, 'skip'); };
    });
}


function markKontrolaSelected() {
    const items = document.querySelectorAll('#kontrola-body .queue-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === kontrolaState.idx));
    const cur = items[kontrolaState.idx];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
}


export function kontrolaMove(delta) {
    if (!kontrolaState.items.length) return;
    const n = kontrolaState.items.length;
    kontrolaState.idx = (kontrolaState.idx + delta + n) % n;
    markKontrolaSelected();
}


/** Odober položku z aktívnej fronty. `decBadge` znižuje rail počítadlo. */
function removeKontrolaItem(id, decBadge) {
    const list = activeList();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    if (decBadge) {
        kontrolaState.total = Math.max(0, kontrolaState.total - 1);
        if (kontrolaState.cert) kontrolaState.cert = decNeedsReview(kontrolaState.cert);
    }
    if (kontrolaState.idx > i) kontrolaState.idx--;
    rerenderKontrola();
}


export async function kontrolaVerify(id) {
    const btn = kontrolaBtn(id, 'verify') || document.createElement('button');
    const wasUnmarked = kontrolaState.tab === 'bez';
    await busy(btn, async () => {
        let j;
        try {
            j = await apiSend('POST', '/api/nodes/' + id + '/verify');
        } catch (e) {
            const b = e instanceof ApiError ? e.body : null;
            showToast((b && (b.message || b.error)) || 'Overenie zlyhalo', null, 'error');
            return;
        }
        // pokrytie sa hýbe hneď: uzol prešiel z „bez značky" na „overené"
        if (kontrolaState.cert) kontrolaState.cert = applyMark(kontrolaState.cert, 'overene');
        if (wasUnmarked) {
            // verify zhodí aj needs_review, ale tento uzol v tej fronte nebol
            removeKontrolaItem(id, false);
        } else {
            removeKontrolaItem(id, true);
        }
        const warns = (j && j.warnings) || [];
        showToast(warns.length ? ('Overené — ' + warns[0]) : 'Overené', null, 'success');
    }, '…');
}


export async function kontrolaResolve(id) {
    const btn = kontrolaBtn(id, 'resolve') || document.createElement('button');
    if (kontrolaState.tab === 'bez') { showToast('Táto fronta nemá čo vyriešiť — over alebo preskoč'); return; }
    await busy(btn, async () => {
        try {
            await apiSend('POST', '/api/nodes/' + id + '/resolve-review');
        } catch (e) {
            const b = e instanceof ApiError ? e.body : null;
            showToast((b && (b.message || b.error)) || 'Akcia zlyhala', null, 'error');
            return;
        }
        removeKontrolaItem(id, true);
        showToast('Vyriešené', null, 'success');
    }, '…');
}


/* Armed-inline (žiadny natívny confirm): 1. akcia ozbrojí tlačidlo, 2. potvrdí.
   kind='skip' (lokálne preskočenie + undo) alebo 'delete' (DELETE uzla). */
export function disarmKontrolaBtn(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    btn.classList.add('ms');
    btn.textContent = 'redo';
    delete btn.dataset.armKind;
}


export function armKontrolaAction(btn, id, kind) {
    if (!btn) return;
    if (btn.classList.contains('armed') && btn.dataset.armKind === kind) {
        disarmKontrolaBtn(btn);
        if (kind === 'delete') kontrolaDelete(id); else kontrolaSkip(id);
        return;
    }
    document.querySelectorAll('#kontrola-body .act-skip.armed').forEach(disarmKontrolaBtn);
    btn.classList.add('armed');
    btn.classList.remove('ms');
    btn.dataset.armKind = kind;
    btn.textContent = kind === 'delete' ? 'Zmazať uzol?' : 'Preskočiť?';
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmKontrolaBtn(btn); }, 3000);
}


function kontrolaSkip(id) {
    const list = activeList();
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [removed] = list.splice(i, 1);
    if (kontrolaState.idx > i || kontrolaState.idx >= list.length) {
        kontrolaState.idx = Math.max(0, kontrolaState.idx - (kontrolaState.idx > i ? 1 : 0));
    }
    const tab = kontrolaState.tab;
    rerenderKontrola();
    // preskočenie je len lokálne (uzol ostáva v serverovej fronte) → total badge nemeníme
    showUndoToast('Preskočené', () => {
        const back = tab === 'bez' ? (kontrolaState.unmarked || []) : kontrolaState.queue;
        back.splice(Math.min(i, back.length), 0, removed);
        kontrolaState.tab = tab;
        kontrolaState.idx = i;
        rerenderKontrola();
    });
}


async function kontrolaDelete(id) {
    const wasInReviewQueue = kontrolaState.queue.some((n) => n.id === id);
    try {
        await apiSend('DELETE', '/api/nodes/' + id);
    } catch (e) {
        const b = e instanceof ApiError ? e.body : null;
        showToast((b && b.message) || 'Nepodarilo sa zmazať', null, 'error');
        return;
    }
    // dorovnaj aj graf, ak je uzol načítaný (rovnako ako node-panel delete)
    if (S.byId.has(id)) {
        S.nodes = S.nodes.filter((m) => m.id !== id);
        S.edges = S.edges.filter((e) => e.source.id !== id && e.target.id !== id);
        S.byId.delete(id);
        if (S.local && S.local.rootId === id) clearLocal();
    }
    removeKontrolaItem(id, wasInReviewQueue);
    showToast('Uzol zmazaný', null, 'success');
}
