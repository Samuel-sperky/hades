import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { S } from '../state.js';
import { showToast } from '../toasts.js';
import { $, busy, emptyHtml, esc, getJson, plainBlock, plainInline, renderEmpty, renderLoading } from '../util.js';

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter, prepínanie filtra klientsky nad jedným fetchom),
   detail/expand dôvodu klikom na kartu a manuálne pridanie → POST /api/decisions.

   DÁTA SÚ SERVEROVÉ. Obrazovka si nič nedopočítava: os rokov (`years`), os
   oblastí (`areas`), počty (`counts`), názov oblasti riadku (`area`) aj mesiac
   pre hlavičku bloku (`month`) prichádzajú z `App\Serializers\Screen\
   RozhodnutiaScreen` — tej istej triedy, z ktorej čerpá MCP. Predtým sa roky
   aj počty počítali tu z načítaných riadkov a názov oblasti sa bral z GRAFOVÉHO
   payloadu (`S.areas`), takže človek videl oblasť, AI to isté rozhodnutie bez
   nej, a bez načítaného grafu svietilo „#7". Nedávaj to sem späť. */

export const decisionsState = {
    all: [], years: [], areas: [], counts: {}, year: null, areaId: null, adding: false,
};

export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    renderLoading(body, 'Načítavam rozhodnutia…');
    try {
        const d = await getJson('/api/decisions');
        decisionsState.all = d.decisions || [];
        decisionsState.years = d.years || [];
        decisionsState.areas = d.areas || [];
        decisionsState.counts = d.counts || {};
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
    if (decisionsState.year !== null
        && !decisionsState.years.some((y) => String(y.year) === decisionsState.year)) {
        decisionsState.year = null;
    }
    if (decisionsState.areaId !== null
        && !decisionsState.areas.some((a) => a.id === decisionsState.areaId)) {
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
    // Os období aj os oblastí prichádzajú zo servera už zoradené a s počtami nad
    // CELÝM korpusom. Počítať ich tu z `all` znamenalo, že nad stropom 500 by čip
    // hlásil iné číslo než realita — a AI by o osi nevedela nič.
    const years = decisionsState.years;
    const areas = decisionsState.areas;
    const total = decisionsState.counts.total != null ? decisionsState.counts.total : all.length;

    /* Akcia „Pridať rozhodnutie" stála na SAMOSTATNOM riadku nad filtrami, takže
       medzi podtitulom a čipmi zostal celý prázdny pás — Denník aj Knižnica dávajú
       pod hlavičku hneď ovládanie. Tlačidlo preto ide do TOHO ISTÉHO riadku ako
       posledný rad filtrov (vpravo, margin-left:auto v .dec-toolbar-row) a vlastný
       pás si vyžiada len vtedy, keď filtre nie sú (jeden rok, jedna oblasť). */
    const addBtn = '<button type="button" id="dec-add-toggle" class="chip">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button>';

    // Filtre obdobie / oblasť — s počtami, ako v Denníku. Roky idú chronologicky
    // (je to os, nie množina), oblasti podľa počtu zhora; obe poradia určuje
    // server, aby ich AI videla tak, ako človek.
    const rows = [];
    if (years.length > 1) {
        rows.push(decChip('Celé obdobie', decisionsState.year === null, 'data-year=""', total)
            + years.map((y) => decChip(String(y.year), decisionsState.year === String(y.year),
                'data-year="' + y.year + '"', y.count)).join(''));
    }
    if (areas.length > 1) {
        rows.push(decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""', total)
            + areas.map((a) => decChip(a.name, decisionsState.areaId === a.id,
                'data-area="' + a.id + '"', a.count)).join(''));
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
    // Tu `S.areas` ZOSTÁVA a je to zámer: formulár potrebuje VŠETKY oblasti, aj
    // tie, ktoré ešte žiadne rozhodnutie nemajú. Serverová os `areas` nesie len
    // oblasti s rozhodnutím, pretože to je filtračná os obrazovky, nie zoznam
    // oblastí vedomia. Sú to dve rôzne veci, nie dva zdroje tej istej.
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
    // Poradie je serverové (`decided_on` zhora, pri rovnakom dni `id` zhora) —
    // filter ho zachováva, takže vlastný `sort()` tu bol len druhá kópia pravidla.
    // Mesiac ostáva hlavičkou nad blokom; rozhodnutia vnútri mesiaca tečú do
    // viacstĺpcového bloku (.dtl-group), aby široké okno nesla obsah a nie prázdno.
    // Multi-column (nie grid): text v kartách je rôzne dlhý, tak sa stĺpce doplnia
    // bez ragged riadkov a časová os beží chronologicky DOLE po každom stĺpci.
    let out = '<div class="dtl">';
    let curMonth = null;
    for (const dec of list) {
        const ym = dec.month || '';
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
    // Názov oblasti dáva SERVER (kľúč `area`). Predtým sa čítal z grafového
    // payloadu, takže obrazovka závisela od toho, či je graf načítaný, a AI
    // dostávala to isté rozhodnutie bez oblasti.
    const area = dec.area || null;
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
        + (area ? '<span class="tag">' + esc(area) + '</span>' : '')
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
