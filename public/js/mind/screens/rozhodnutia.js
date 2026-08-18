import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, getJson, plainBlock, plainInline, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter, filtrovanie klientsky nad jedným fetchom),
   detail/expand dôvodu klikom na kartu a manuálne pridanie → POST /api/decisions. */

export const decisionsState = { all: [], year: null, areaId: null, adding: false };

export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    renderLoading(body, 'Načítavam rozhodnutia…');
    try {
        const d = await getJson('/api/decisions');
        decisionsState.all = d.decisions || [];
        pruneDecisionFilters();
        renderDecisionsView();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať rozhodnutia', 'Skús obnoviť stránku.');
    }
}

/* Filter, ktorý po znovunačítaní nemá ani jeden záznam, je pasca: rady čipov sa
   vypisujú len keď je z čoho vyberať (years.length > 1), takže po uložení
   rozhodnutia v inom roku mohla obrazovka ostať prázdna BEZ čipu, ktorým sa filter
   zruší. Denník to isté robí pri projektoch (journalProject sa vynuluje) — tu to
   dosiaľ sľuboval len komentár. */
export function pruneDecisionFilters() {
    const all = decisionsState.all;
    if (decisionsState.year !== null
        && !all.some((x) => (x.decided_on || '').slice(0, 4) === decisionsState.year)) {
        decisionsState.year = null;
    }
    if (decisionsState.areaId !== null
        && !all.some((x) => x.area_id === decisionsState.areaId)) {
        decisionsState.areaId = null;
    }
}

/* Filtračný čip hovorí tým istým jazykom ako v Denníku: popisok + počet v
   .chip-n. Predtým tu čipy počty nemali, takže dve obrazovky mali dva rôzne
   filtračné idiomy — a človek nevedel, či sa filtrom niečo vôbec ukáže. */
export function decChip(label, active, attrs, n) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '" ' + attrs + '>'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

export function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    const all = decisionsState.all;

    const years = [...new Set(all.map((x) => (x.decided_on || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const areaIds = [...new Set(all.map((x) => x.area_id).filter((v) => v != null))];

    /* Akcia „Pridať rozhodnutie" stála na SAMOSTATNOM riadku nad filtrami, takže
       medzi podtitulom a čipmi zostal celý prázdny pás — Denník aj Knižnica dávajú
       pod hlavičku hneď ovládanie. Tlačidlo preto ide do TOHO ISTÉHO riadku ako
       posledný rad filtrov (vpravo, margin-left:auto v .dec-toolbar-row) a vlastný
       pás si vyžiada len vtedy, keď filtre nie sú (jeden rok, jedna oblasť). */
    const addBtn = '<button type="button" id="dec-add-toggle" class="chip">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button>';

    // Filtre obdobie / oblasť — s počtami, ako v Denníku
    const yearN = new Map();
    for (const x of all) {
        const y = (x.decided_on || '').slice(0, 4);
        if (y) yearN.set(y, (yearN.get(y) || 0) + 1);
    }
    const areaN = new Map();
    for (const x of all) {
        if (x.area_id == null) continue;
        areaN.set(x.area_id, (areaN.get(x.area_id) || 0) + 1);
    }
    const rows = [];
    if (years.length > 1) {
        // Roky zostávajú chronologicky — je to os, nie množina, ktorú by sa dalo
        // preusporiadať podľa frekvencie bez toho, aby prestala byť čitateľná.
        rows.push(decChip('Celé obdobie', decisionsState.year === null, 'data-year=""', all.length)
            + years.map((y) => decChip(y, decisionsState.year === y, 'data-year="' + y + '"', yearN.get(y) || 0)).join(''));
    }
    if (areaIds.length > 1) {
        // Oblasti podľa počtu zhora, ako projekty v Denníku: v rade tak ostanú tie,
        // ktoré sa reálne používajú, nie tie, čo prišli v dátach prvé.
        const sortedAreas = [...areaIds].sort((a, b) => (areaN.get(b) || 0) - (areaN.get(a) || 0));
        rows.push(decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""', all.length)
            + sortedAreas.map((aid) => {
                const a = S.areas.get(aid);
                return decChip(a ? a.name : ('#' + aid), decisionsState.areaId === aid,
                    'data-area="' + aid + '"', areaN.get(aid) || 0);
            }).join(''));
    }

    let h = '';
    rows.forEach((chips, i) => {
        const last = i === rows.length - 1;
        h += '<div class="dtl-filter' + (last ? ' dec-toolbar-row' : '') + '">'
            + chips + (last ? addBtn : '') + '</div>';
    });
    if (!rows.length) h += '<div class="dec-toolbar">' + addBtn + '</div>';
    if (decisionsState.adding) h += decAddFormHtml();

    const list = all.filter((x) => {
        if (decisionsState.year !== null && (x.decided_on || '').slice(0, 4) !== decisionsState.year) return false;
        if (decisionsState.areaId !== null && x.area_id !== decisionsState.areaId) return false;
        return true;
    });

    if (!list.length) {
        h += emptyHtml('gavel',
            all.length ? 'Žiadne rozhodnutia pre tento filter' : 'Zatiaľ žiadne rozhodnutia',
            all.length ? 'Zruš filter a uvidíš celú os.' : 'Objavia sa, keď Hades zaznamená prvé rozhodnutie.');
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
    return '<div class="dec-add">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div class="dec-add-row">'
        + '<select id="dec-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}

export function decisionsTimelineHtml(list) {
    const sorted = [...list].sort((a, b) => (b.decided_on || '').localeCompare(a.decided_on || ''));
    // Mesiac ostáva hlavičkou nad blokom; rozhodnutia vnútri mesiaca tečú do
    // viacstĺpcového bloku (.dtl-group), aby široké okno nesla obsah a nie prázdno.
    // Multi-column (nie grid): text v kartách je rôzne dlhý, tak sa stĺpce doplnia
    // bez ragged riadkov a časová os beží chronologicky DOLE po každom stĺpci.
    let out = '<div class="dtl">';
    let curMonth = null;
    for (const dec of sorted) {
        const ym = (dec.decided_on || '').slice(0, 7);
        if (ym !== curMonth) {
            if (curMonth !== null) out += '</div>';
            curMonth = ym;
            out += '<div class="dtl-month">' + esc(monthLabel(ym)) + '</div><div class="dtl-group">';
        }
        out += decisionCardHtml(dec);
    }
    if (curMonth !== null) out += '</div>';
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
    // Text aj dôvod chodia z mind_decision tak, ako ich zapísal Claude Code — a nesú
    // `backticky` okolo identifikátorov (zmerané na 4 zo 41 živých rozhodnutí).
    // plainInline pre jednoriadkový text, plainBlock pre dôvod (má white-space: pre-wrap,
    // takže odseky sú v ňom nositeľom štruktúry).
    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-origin="' + (dec.origin === 'brain' ? 'brain' : 'session') + '" aria-hidden="true"></span>'
        + '<button type="button" class="dtl-card" data-id="' + dec.id + '"'
        + (dec.node_id != null ? ' data-node="' + dec.node_id + '"' : '')
        + (hasReason ? ' data-reason="1" aria-expanded="false"' : '') + '>'
        + '<div class="dtl-head"><span class="dtl-date">' + esc(fmtDecDate(dec.decided_on)) + '</span>'
        + '<span class="dtl-text">' + esc(plainInline(dec.text)) + '</span></div>'
        + (hasReason ? '<div class="dtl-reason hidden">' + esc(plainBlock(dec.reason)) + '</div>' : '')
        + '<div class="dtl-meta">' + originBadge(dec.origin)
        + (area ? '<span class="tag">' + esc(area.name) + '</span>' : '')
        + (dec.node_id != null ? '<span class="tag muted">uzol #' + dec.node_id + '</span>' : '')
        // Šípka je JEDINÝ indikátor toho, či je dôvod rozbalený — statické „▾" na
        // rozbalenej karte tvrdilo, že sa dá rozbaliť ešte raz.
        + (hasReason ? '<span class="tag muted dtl-reason-chip">dôvod ▾</span>' : '')
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
                const open = reason.classList.toggle('hidden') === false;
                card.setAttribute('aria-expanded', open ? 'true' : 'false');
                const chip = card.querySelector('.dtl-reason-chip');
                if (chip) chip.textContent = open ? 'dôvod ▴' : 'dôvod ▾';
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
