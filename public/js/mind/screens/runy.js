import { showToast } from '../toasts.js';
import { $, emptyCardHtml, esc, fmtNum, getJson, plainInline, renderEmpty, renderLoading, timeAgo } from '../util.js';

/* ---------- obrazovka Runy (/api/runs) — čo konzola robila ----------
   Časová os behov zoskupená po dňoch (rovnaký idióm ako Rozhodnutia: .dtl*),
   filtre stav/model ako .chip v .dtl-filter, detail behu sa rozbalí klikom na
   kartu a dotiahne sa z /api/runs/{uuid}.

   DÁTA SÚ SERVEROVÉ. Obrazovka si nič nedopočítava: počty podľa stavu (`counts`),
   ponuka modelov (`models`) aj kľúč dňa (`day`) prichádzajú z
   `App\Serializers\Screen\RunsScreen` — tej istej triedy, z ktorej čerpá MCP tool
   `mind_runs`. Preto sa tu nesmie objaviť ani jedno `items.filter(...).length` na
   miesto, kde je číslo v odpovedi: presne tým sa Denník aj Kontrola dostali do
   stavu, že čip sľuboval číslo, ktoré zoznam nedal.

   Čo TU zostáva vizuálne, a je to tak správne: popisok hlavičky dňa
   (dnes/včera/dátum), formát trvania a `timeAgo`. To sú slová, nie údaje. */

export const runsState = {
    items: [], counts: {}, models: [], status: null, model: null, open: null,
    details: new Map(),
    /** uuid behu, na ktorého prepínač sa má po prekreslení vrátiť fokus */
    focus: null,
};

/** Stav behu → slovo pre človeka. Beh, ktorý čaká na povolenie zápisu, NIE JE chyba. */
const STATUS_LABEL = {
    running: 'beží',
    waiting: 'čaká na povolenie',
    done: 'hotové',
    aborted: 'prerušené',
    failed: 'spadlo',
};

/** Poradie filtračných čipov je poradie, v akom to človek hľadá — nie abecedné. */
const STATUS_ORDER = ['running', 'waiting', 'failed', 'aborted', 'done'];

export async function renderRuns() {
    const body = $('runy-body');
    if (!body) return;
    renderLoading(body, 'Načítavam behy…');
    try {
        const d = await getJson('/api/runs' + query());
        runsState.items = d.items || [];
        runsState.counts = d.counts || {};
        runsState.models = d.models || [];
        pruneRunFilters();
        renderRunsView();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať behy', 'Skús obnoviť stránku.');
    }
}

/** Filtre idú na server, nie do prehliadača — inak by počty v čipoch nesedeli s obsahom. */
function query() {
    const p = new URLSearchParams();
    if (runsState.status) p.set('status', runsState.status);
    if (runsState.model) p.set('model', runsState.model);
    const q = p.toString();
    return q ? '?' + q : '';
}

/* Filter, ktorý po znovunačítaní nemá čo ukázať, je pasca — rady čipov sa
   vypisujú len keď je z čoho vyberať, takže by obrazovka mohla ostať prázdna BEZ
   čipu, ktorým sa filter zruší. Rozhodnutia to riešia rovnako (pruneDecisionFilters). */
export function pruneRunFilters() {
    if (runsState.status && !(runsState.counts[runsState.status] > 0)) runsState.status = null;
    if (runsState.model && !runsState.models.includes(runsState.model)) runsState.model = null;
}

function renderRunsView() {
    const body = $('runy-body');
    if (!body) return;

    if (!runsState.items.length && !runsState.status && !runsState.model) {
        renderEmpty(
            body,
            'bolt',
            'Konzola ešte nič nebežala',
            'Otvor Charóna a zadaj úlohu — každý ťah sa tu objaví so svojou cenou.',
        );
        return;
    }

    body.innerHTML = filtersHtml() + timelineHtml();

    body.querySelectorAll('.chip[data-status]').forEach((c) => {
        c.onclick = () => {
            const v = c.dataset.status;
            runsState.status = runsState.status === v ? null : (v || null);
            renderRuns();
        };
    });
    body.querySelectorAll('.chip[data-model]').forEach((c) => {
        c.onclick = () => {
            const v = c.dataset.model;
            runsState.model = runsState.model === v ? null : (v || null);
            renderRuns();
        };
    });
    body.querySelectorAll('button[data-toggle]').forEach((btn) => {
        btn.onclick = () => toggleRun(btn.dataset.toggle);
    });
    body.querySelectorAll('.dtl-card[data-run]').forEach((card) => {
        card.onclick = (ev) => {
            if (ev.target.closest('button, a')) return;
            toggleRun(card.dataset.run);
        };
    });
    body.querySelectorAll('button[data-rerun]').forEach((b) => {
        b.onclick = () => rerun(b.dataset.rerun, b);
    });

    // Prekreslenie zahodí celý `innerHTML`, teda aj prvok, na ktorom bol fokus —
    // ten by spadol na `<body>` a klávesnica by začínala od začiatku stránky.
    // Vracia sa preto na prepínač toho behu, s ktorým človek práve pracoval.
    if (runsState.focus) {
        body.querySelector('button[data-toggle="' + CSS.escape(runsState.focus) + '"]')?.focus();
    }
}

function filtersHtml() {
    const c = runsState.counts;
    const total = c.total || 0;
    let out = '<div class="dtl-filter">';
    out += chip('Všetky', !runsState.status, 'data-status=""', total);

    STATUS_ORDER.forEach((s) => {
        if (!c[s]) return;
        out += chip(STATUS_LABEL[s], runsState.status === s, 'data-status="' + s + '"', c[s]);
    });
    out += '</div>';

    // Ponuka modelov má zmysel len keď je z čoho vyberať.
    if (runsState.models.length > 1) {
        out += '<div class="dtl-filter">';
        out += chip('Každý model', !runsState.model, 'data-model=""');
        runsState.models.forEach((m) => {
            out += chip(m, runsState.model === m, 'data-model="' + esc(m) + '"');
        });
        out += '</div>';
    }
    return out;
}

/* `aria-pressed` je povinné: čip je prepínač a bez neho nesie zapnutý stav LEN
   farba, takže čítačka o filtri nevie nič. `#legend-areas` to v tomto projekte
   robí správne už dnes — tu to bolo opomenutie. */
function chip(label, active, attrs, n) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label)
        + (n != null ? '<span class="chip-n">' + fmtNum(n) + '</span>' : '')
        + '</button>';
}

function timelineHtml() {
    if (!runsState.items.length) {
        return '<div class="dtl">' + emptyFiltered() + '</div>';
    }

    let out = '<div class="dtl">';
    let day = null;

    runsState.items.forEach((r) => {
        if (r.day !== day) {
            day = r.day;
            out += '<div class="dtl-month">' + esc(dayLabel(day)) + '</div>';
        }
        out += runItemHtml(r);
    });

    return out + '</div>';
}

function emptyFiltered() {
    return emptyCardHtml('Tomuto filtru neodpovedá žiadny beh.');
}

/** Popisok dňa je slovo, nie údaj — kľúč `day` prišiel zo servera. */
function dayLabel(day) {
    if (!day) return 'bez dátumu';
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    if (day === iso(today)) return 'dnes';
    const y = new Date(today.getTime() - 86400000);
    if (day === iso(y)) return 'včera';
    const [yy, mm, dd] = day.split('-');
    return +dd + '. ' + +mm + '. ' + yy;
}

/* Karta NIE JE tlačidlo, hoci sa na ňu dá kliknúť.
   Bola ním (`role="button" tabindex="0"`) a bola to chyba v návrhu, nie preklep:
   vnorené `<button>` a `<a>` sú vnútri `role="button"` neplatné, a prístupné meno
   karty vyšlo na 778 znakov — obsahovalo celý diff aj JSON argumentov, takže
   čítačka namiesto „otvoriť beh" prečítala celý obsah karty.
   Rozbaľuje preto skutočné tlačidlo v hlavičke: krátke meno, `aria-controls`,
   a Enter aj Space obsluhuje prehliadač sám. Klik na telo karty zostáva ako
   pohodlie pre myš, nie ako prístupná cesta. */
function runItemHtml(r) {
    const open = runsState.open === r.uuid;
    const detail = runsState.details.get(r.uuid);
    const panelId = 'run-detail-' + r.uuid;
    const prompt = plainInline(r.prompt || '(bez zadania)');

    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-status="' + esc(r.status) + '"></span>'
        + '<article class="dtl-card run-card' + (open ? ' open' : '') + '" data-run="' + esc(r.uuid) + '">'
        + '<div class="run-head">'
        + '<span class="badge" data-status="' + esc(r.status) + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span>'
        + '<span class="run-when">' + esc(timeAgo(r.started_at)) + '</span>'
        + (r.model ? '<span class="run-model">' + esc(r.model) + '</span>' : '')
        + '<button type="button" class="run-toggle" data-toggle="' + esc(r.uuid) + '"'
        + ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="' + esc(panelId) + '"'
        + ' aria-label="' + esc((open ? 'Zavrieť beh: ' : 'Otvoriť beh: ') + clipLabel(prompt)) + '">'
        + '<span class="ms" aria-hidden="true">arrow_upward</span>'
        + '</button>'
        + '</div>'
        + '<p class="run-prompt">' + esc(prompt) + '</p>'
        + costHtml(r)
        + (r.error ? '<p class="run-error">' + esc(r.error) + '</p>' : '')
        + (open ? detailHtml(r, detail, panelId) : '')
        + '</article>'
        + '</div>';
}

/** Meno tlačidla má povedať, ČO otvorí — nie prečítať celú kartu. */
function clipLabel(text) {
    return text.length > 70 ? text.slice(0, 69) + '…' : text;
}

/* Cena behu. Trvanie je wall clock (obsahuje čas, kým sa človek rozhodoval
   o zápise), tok/s je počítané z generovacieho času správ — sú to dva rôzne
   údaje a ani jeden nie je chyba. Preto sú vedľa seba a pomenované inak. */
function costHtml(r) {
    const bits = [];
    if (r.steps) bits.push(metric(r.steps, plural(r.steps, 'krok', 'kroky', 'krokov')));
    if (r.tool_calls) bits.push(metric(r.tool_calls, plural(r.tool_calls, 'tool', 'tooly', 'toolov')));
    if (r.tokens_out) bits.push(metric(fmtNum(r.tokens_out), plural(r.tokens_out, 'token', 'tokeny', 'tokenov')));
    if (r.tokens_per_second) bits.push(metric(r.tokens_per_second, 'tok/s'));
    if (r.duration_ms) bits.push(metric(dur(r.duration_ms), 'celkom'));
    if (!bits.length) return '';
    return '<div class="run-cost">' + bits.join('') + '</div>';
}

/* Slovenčina má TRI tvary, nie dva: 1 krok, 2-4 kroky, 5+ krokov. Binárne
   jednotné/množné číslo dá „3 krokov", čo je viditeľne zlé v každom riadku
   tabuľky — a UI texty sú slovenské, takže to nie je detail. */
function plural(n, one, few, many) {
    const abs = Math.abs(Math.round(n));
    if (abs === 1) return one;
    return abs >= 2 && abs <= 4 ? few : many;
}

function metric(value, unit) {
    return '<span class="run-metric"><b>' + esc(String(value)) + '</b> ' + esc(unit) + '</span>';
}

function dur(ms) {
    if (ms < 1000) return ms + ' ms';
    const s = ms / 1000;
    if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
    const m = Math.floor(s / 60);
    return m + ' min ' + Math.round(s - m * 60) + ' s';
}

function detailHtml(r, detail, panelId) {
    const attrs = ' id="' + esc(panelId) + '" role="region" aria-label="Priebeh behu"';

    if (!detail) return '<div class="run-detail"' + attrs + '>' + emptyCardHtml('Načítavam beh…') + '</div>';

    let out = '<div class="run-detail"' + attrs + '>';

    if (r.stop_reason) {
        out += '<p class="run-stop">Ukončené: <b>' + esc(r.stop_reason) + '</b></p>';
    }

    out += '<ol class="run-steps">';
    (detail.timeline || []).forEach((e) => {
        out += e.kind === 'tool' ? toolStepHtml(e) : messageStepHtml(e);
    });
    out += '</ol>';

    out += '<div class="run-actions">';
    if (detail.thread) {
        out += '<a class="ghost" href="/console/' + esc(detail.thread) + '">Otvoriť vlákno</a>';
    }
    out += '<button type="button" class="ghost" data-rerun="' + esc(r.uuid) + '">Spustiť znovu</button>';
    out += '</div>';

    return out + '</div>';
}

function messageStepHtml(e) {
    const who = e.role === 'user' ? 'ty' : 'Charón';
    return '<li class="run-step" data-kind="message" data-role="' + esc(e.role) + '">'
        + '<span class="run-step-who">' + esc(who) + '</span>'
        + '<div class="run-step-text">' + esc(plainInline(e.text || '(bez textu)')) + '</div>'
        + '</li>';
}

/* Zamietnutý zápis je najdôležitejší záznam behu — preto má vlastný stav, nie
   len iný text. Náhľad (diff) sa ukazuje aj po zamietnutí: práve pri ňom človek
   najčastejšie chce vedieť, čo presne odmietol. */
function toolStepHtml(e) {
    const preview = e.preview || '';
    return '<li class="run-step" data-kind="tool" data-status="' + esc(e.status || '') + '">'
        + '<span class="run-step-who">' + esc(e.name || 'tool') + '</span>'
        + '<div class="run-step-text">'
        + '<span class="badge" data-status="' + esc(e.status || '') + '">' + esc(toolWord(e.status)) + '</span>'
        + (e.arguments ? '<code class="run-args">' + esc(JSON.stringify(e.arguments)) + '</code>' : '')
        + (e.error ? '<p class="run-error">' + esc(e.error) + '</p>' : '')
        + (preview ? '<pre class="run-diff">' + esc(preview) + '</pre>' : '')
        // Výsledok toolu serializér posiela obom plochám a platí za to strop 4000
        // znakov. Kým ho UI nekreslilo, človek videl MENEJ než AI — a to je presne
        // ten rozchod plôch, ktorý má tento šprint rušiť, len obrátený.
        + (e.result ? '<pre class="run-result">' + esc(e.result) + '</pre>' : '')
        + '</div>'
        + '</li>';
}

function toolWord(status) {
    return {
        done: 'vykonané', denied: 'zamietnuté', pending: 'čaká na rozhodnutie',
        failed: 'zlyhalo', running: 'beží',
    }[status] || (status || '—');
}

async function toggleRun(uuid) {
    runsState.focus = uuid;

    if (runsState.open === uuid) {
        runsState.open = null;
        renderRunsView();
        return;
    }

    runsState.open = uuid;
    renderRunsView();

    if (runsState.details.has(uuid)) return;

    try {
        const d = await getJson('/api/runs/' + encodeURIComponent(uuid));
        runsState.details.set(uuid, d);
    } catch (e) {
        runsState.details.set(uuid, { timeline: [] });
        showToast('Detail behu sa nepodarilo načítať.', null, 'warn');
    }
    if (runsState.open === uuid) renderRunsView();
}

/* „Spustiť znovu" beh NESPÚŠŤA. Vyžiada si od servera zadanie, položí ho do
   schránky a otvorí vlákno — nový ťah tak ide bežnou cestou cez konzolu, teda
   cez dvojfázovú bránu. Druhá cesta k modelu, ktorá bránu obchádza, je presne to,
   čo tu nesmie vzniknúť; brána je jediné, čo stojí medzi lokálnym modelom a
   zápisom do pamäte. Predplnenie composera je jednoriadkový doplnok v konzole
   a zámerne tu naň nečakáme. */
async function rerun(uuid, btn) {
    btn.disabled = true;
    try {
        const res = await fetch('/api/runs/' + encodeURIComponent(uuid) + '/rerun', { method: 'POST' });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(j.message || 'Beh sa nedá zopakovať.', null, 'warn');
            return;
        }
        try {
            await navigator.clipboard.writeText(j.prompt);
            showToast('Zadanie je v schránke, otváram vlákno.');
        } catch (e) {
            showToast('Vlákno otváram; zadanie skopíruj z detailu behu.', null, 'warn');
        }
        if (j.thread) window.location.href = '/console/' + j.thread;
    } finally {
        btn.disabled = false;
    }
}
