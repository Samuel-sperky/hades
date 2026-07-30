/* Obrazovka Rozhodnutia — časová os po mesiacoch, filtre rok + oblasť,
   inline pridávanie.

   Anatómia: hlavička (blade) → .screen-toolbar (Pridať + filtre) → formulár
   (keď je otvorený) → časová os. Inline štýly formulára a toolbaru z monolitu
   sú preložené na triedy (.dec-*), aby dedili density tokeny P9. */

import { ApiError, apiGet, apiSend } from '../core/api.js';
import { $, busy, esc } from '../core/dom.js';
import { fmtDecDate, monthLabel } from '../core/format.js';
import { S } from '../core/state/index.js';
import { emptyStateHtml, listSkeletonHtml, renderApiError } from './shared/anatomy.js';
import { originBadge } from './shared/origin-badge.js';
import { openNodeFromAnywhere } from '../shell/router.js';
import { showToast } from '../shell/toasts.js';


const decisionsState = { all: [], year: null, areaId: null, adding: false };


export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    body.innerHTML = listSkeletonHtml(5, '64px');
    try {
        const d = await apiGet('/api/decisions');
        decisionsState.all = d.decisions || [];
        renderDecisionsView();
    } catch (e) {
        renderApiError(body, e, renderDecisions);
    }
}


function decChip(label, active, attrs) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '" ' + attrs + '>' + esc(label) + '</button>';
}


function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    const all = decisionsState.all;

    const years = [...new Set(all.map((x) => (x.decided_on || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const areaIds = [...new Set(all.map((x) => x.area_id).filter((v) => v != null))];

    // Toolbar: pridanie + filtre obdobia a oblasti v jednom rade
    let toolbar = '<button type="button" id="dec-add-toggle" class="chip chip--action">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button>';

    if (years.length > 1) {
        toolbar += '<span class="toolbar-sep" aria-hidden="true"></span>'
            + decChip('Celé obdobie', decisionsState.year === null, 'data-year=""')
            + years.map((y) => decChip(y, decisionsState.year === y, 'data-year="' + y + '"')).join('');
    }
    if (areaIds.length > 1) {
        toolbar += '<span class="toolbar-sep" aria-hidden="true"></span>'
            + decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""')
            + areaIds.map((aid) => {
                const a = S.areas.get(aid);
                return decChip(a ? a.name : ('#' + aid), decisionsState.areaId === aid, 'data-area="' + aid + '"');
            }).join('');
    }
    toolbar += '<span class="toolbar-note tnum">' + all.length + ' rozhodnutí</span>';

    let h = '<div class="screen-toolbar dec-toolbar">' + toolbar + '</div>';
    if (decisionsState.adding) h += decAddFormHtml();

    const list = all.filter((x) => {
        if (decisionsState.year !== null && (x.decided_on || '').slice(0, 4) !== decisionsState.year) return false;
        if (decisionsState.areaId !== null && x.area_id !== decisionsState.areaId) return false;
        return true;
    });

    if (!list.length) {
        h += all.length
            ? emptyStateHtml('filter_alt_off', 'Pre tento filter nič nie je', 'Uvoľni obdobie alebo oblasť.')
            : emptyStateHtml('gavel', 'Zatiaľ žiadne rozhodnutia',
                'Rozhodnutia sú trvalé „prečo" tvojich projektov. Prvé pridaj tlačidlom vyššie.');
    } else {
        h += decisionsTimelineHtml(list);
    }

    body.innerHTML = h;
    wireDecisions(body);
}


function decAddFormHtml() {
    const areaOpts = '<option value="">— oblasť (voliteľné) —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    const today = new Date().toISOString().slice(0, 10);
    return '<div class="dec-add">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div class="dec-add-row">'
        + '<select id="dec-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}


function decisionsTimelineHtml(list) {
    const sorted = [...list].sort((a, b) => (b.decided_on || '').localeCompare(a.decided_on || ''));
    let out = '<div class="dtl">';
    let curMonth = '';
    for (const dec of sorted) {
        const ym = (dec.decided_on || '').slice(0, 7);
        if (ym !== curMonth) { curMonth = ym; out += '<div class="dtl-month">' + esc(monthLabel(ym)) + '</div>'; }
        out += decisionCardHtml(dec);
    }
    return out + '</div>';
}


function decisionCardHtml(dec) {
    const area = dec.area_id != null ? S.areas.get(dec.area_id) : null;
    const hasReason = !!(dec.reason && String(dec.reason).trim());
    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-origin="' + (dec.origin === 'brain' ? 'brain' : 'session') + '" aria-hidden="true"></span>'
        + '<button type="button" class="dtl-card" data-id="' + dec.id + '"'
        + (dec.node_id != null ? ' data-node="' + dec.node_id + '"' : '')
        + (hasReason ? ' data-reason="1"' : '') + '>'
        + '<div class="dtl-head"><span class="dtl-date tnum">' + esc(fmtDecDate(dec.decided_on)) + '</span>'
        + '<span class="dtl-text">' + esc(dec.text) + '</span></div>'
        + (hasReason ? '<div class="dtl-reason hidden">' + esc(dec.reason) + '</div>' : '')
        + '<div class="dtl-meta">' + originBadge(dec.origin)
        + (area ? '<span class="tag">' + esc(area.name) + '</span>' : '')
        + (dec.node_id != null ? '<span class="tag muted">uzol #' + dec.node_id + '</span>' : '')
        + (hasReason ? '<span class="tag muted">dôvod ▾</span>' : '')
        + '</div></button></div>';
}


function wireDecisions(body) {
    const toggle = $('dec-add-toggle');
    if (toggle) {
        toggle.onclick = () => {
            decisionsState.adding = !decisionsState.adding;
            renderDecisionsView();
            if (decisionsState.adding) { const t = $('dec-text'); if (t) t.focus(); }
        };
    }

    const saveBtn = $('dec-save');
    if (saveBtn) saveBtn.onclick = () => saveDecision(saveBtn);

    body.querySelectorAll('.dec-toolbar [data-year]').forEach((c) => {
        c.onclick = () => { decisionsState.year = c.dataset.year || null; renderDecisionsView(); };
    });
    body.querySelectorAll('.dec-toolbar [data-area]').forEach((c) => {
        c.onclick = () => { decisionsState.areaId = c.dataset.area ? +c.dataset.area : null; renderDecisionsView(); };
    });

    body.querySelectorAll('.dtl-card').forEach((card) => {
        card.onclick = () => {
            const reason = card.querySelector('.dtl-reason');
            if (card.dataset.reason && reason) {
                reason.classList.toggle('hidden');
            } else if (card.dataset.node) {
                openNodeFromAnywhere({ id: +card.dataset.node });
            }
        };
    });
}


export async function saveDecision(btn) {
    const text = ($('dec-text').value || '').trim();
    if (!text) { showToast('Napíš text rozhodnutia'); $('dec-text').focus(); return; }
    const reason = ($('dec-reason').value || '').trim();
    const areaVal = $('dec-area').value;
    const dateVal = $('dec-date').value;
    const payload = { text };
    if (reason) payload.reason = reason;
    if (areaVal) payload.area = areaVal;
    if (dateVal) payload.decided_on = dateVal;

    await busy(btn, async () => {
        try {
            await apiSend('POST', '/api/decisions', payload);
        } catch (e) {
            const b = e instanceof ApiError ? e.body : null;
            showToast((b && (b.message || b.error)) || 'Uloženie zlyhalo', null, 'error');
            return;
        }
        decisionsState.adding = false;
        showToast('Rozhodnutie uložené', null, 'success');
        renderDecisions();
    }, 'Ukladám…');
}
