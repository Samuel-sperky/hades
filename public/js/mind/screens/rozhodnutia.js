import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, renderEmpty } from '../util.js';

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter, filtrovanie klientsky nad jedným fetchom),
   detail/expand dôvodu klikom na kartu a manuálne pridanie → POST /api/decisions. */

export const decisionsState = { all: [], year: null, areaId: null, adding: false };

export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    renderEmpty(body, 'hourglass_empty', 'Načítavam…');
    try {
        const d = await (await fetch('/api/decisions')).json();
        decisionsState.all = d.decisions || [];
        // filtre, ktoré prestali existovať, vynuluj
        renderDecisionsView();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

export function decChip(label, active, attrs) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '" ' + attrs + '>' + esc(label) + '</button>';
}

export function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    const all = decisionsState.all;

    const years = [...new Set(all.map((x) => (x.decided_on || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const areaIds = [...new Set(all.map((x) => x.area_id).filter((v) => v != null))];

    // Toolbar + manuálne pridanie
    let h = '<div class="dec-toolbar" style="display:flex;justify-content:flex-end;margin-bottom:var(--sp-2);">'
        + '<button type="button" id="dec-add-toggle" class="chip">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button></div>';
    if (decisionsState.adding) h += decAddFormHtml();

    // Filtre obdobie / oblasť
    if (years.length > 1) {
        h += '<div class="dtl-filter">'
            + decChip('Celé obdobie', decisionsState.year === null, 'data-year=""')
            + years.map((y) => decChip(y, decisionsState.year === y, 'data-year="' + y + '"')).join('')
            + '</div>';
    }
    if (areaIds.length > 1) {
        h += '<div class="dtl-filter">'
            + decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""')
            + areaIds.map((aid) => {
                const a = S.areas.get(aid);
                return decChip(a ? a.name : ('#' + aid), decisionsState.areaId === aid, 'data-area="' + aid + '"');
            }).join('')
            + '</div>';
    }

    const list = all.filter((x) => {
        if (decisionsState.year !== null && (x.decided_on || '').slice(0, 4) !== decisionsState.year) return false;
        if (decisionsState.areaId !== null && x.area_id !== decisionsState.areaId) return false;
        return true;
    });

    if (!list.length) {
        h += emptyHtml('gavel', all.length ? 'Žiadne rozhodnutia pre tento filter' : 'Zatiaľ žiadne rozhodnutia');
    } else {
        h += decisionsTimelineHtml(list);
    }

    body.innerHTML = h;
    wireDecisions(body);
}

export function decAddFormHtml() {
    const areaOpts = '<option value="">— oblasť (voliteľné) —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    const today = new Date().toISOString().slice(0, 10);
    return '<div class="dec-add" style="display:flex;flex-direction:column;gap:var(--sp-1);'
        + 'background:var(--panel-solid);border:1px solid var(--border);border-radius:var(--r-md);'
        + 'padding:var(--sp-2);margin-bottom:var(--sp-2);">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div style="display:flex;gap:var(--sp-1);flex-wrap:wrap;align-items:center;">'
        + '<select id="dec-area" aria-label="Oblasť" style="flex:1;min-width:160px;">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum" style="flex:0 0 auto;">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}

export function decisionsTimelineHtml(list) {
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

export function monthLabel(ym) {
    if (!ym) return 'Bez dátumu';
    const parts = ym.split('-');
    const dt = new Date(+parts[0], (+parts[1] || 1) - 1, 1);
    return dt.toLocaleDateString('sk', { month: 'long', year: 'numeric' });
}

export function fmtDecDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}

export function decisionCardHtml(dec) {
    const area = dec.area_id != null ? S.areas.get(dec.area_id) : null;
    const hasReason = !!(dec.reason && String(dec.reason).trim());
    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-origin="' + (dec.origin === 'brain' ? 'brain' : 'session') + '" aria-hidden="true"></span>'
        + '<button type="button" class="dtl-card" data-id="' + dec.id + '"'
        + (dec.node_id != null ? ' data-node="' + dec.node_id + '"' : '')
        + (hasReason ? ' data-reason="1"' : '') + '>'
        + '<div class="dtl-head"><span class="dtl-date">' + esc(fmtDecDate(dec.decided_on)) + '</span>'
        + '<span class="dtl-text">' + esc(dec.text) + '</span></div>'
        + (hasReason ? '<div class="dtl-reason hidden">' + esc(dec.reason) + '</div>' : '')
        + '<div class="dtl-meta">' + originBadge(dec.origin)
        + (area ? '<span class="tag">' + esc(area.name) + '</span>' : '')
        + (dec.node_id != null ? '<span class="tag muted">uzol #' + dec.node_id + '</span>' : '')
        + (hasReason ? '<span class="tag muted">dôvod ▾</span>' : '')
        + '</div></button></div>';
}

export function wireDecisions(body) {
    const toggle = $('dec-add-toggle');
    if (toggle) toggle.onclick = () => { decisionsState.adding = !decisionsState.adding; renderDecisionsView(); if (decisionsState.adding) { const t = $('dec-text'); if (t) t.focus(); } };

    const saveBtn = $('dec-save');
    if (saveBtn) saveBtn.onclick = () => saveDecision(saveBtn);

    body.querySelectorAll('.dtl-filter [data-year]').forEach((c) => {
        c.onclick = () => { decisionsState.year = c.dataset.year || null; renderDecisionsView(); };
    });
    body.querySelectorAll('.dtl-filter [data-area]').forEach((c) => {
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
            const res = await fetch('/api/decisions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || j.error || 'Uloženie zlyhalo', null, 'error');
                return;
            }
            decisionsState.adding = false;
            showToast('Rozhodnutie uložené', null, 'success');
            renderDecisions();
        } catch (e) {
            showToast('Uloženie zlyhalo', null, 'error');
        }
    }, 'Ukladám…');
}
