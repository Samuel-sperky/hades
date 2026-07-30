/* Panel výkonu lokálneho modelu (rozhodnutia 138 + 145, rozhranie #18).

   Čítame `GET /api/llm/stats` — endpoint stavia P5 nad tabuľkou `llm_runs`,
   ktorá v čase písania tohto balíka ešte neexistuje (migrácia je P5). Preto je
   panel navrhnutý ako čisto degradovateľný: keď endpoint nie je, karta povie
   „vrstva ešte nie je pripojená" a NIČ nespadne. Presný tvar payloadu je
   v reporte P10 ako patch pre P5/P4.

   Rozhodnutie 119 + železné pravidlo 10: appka je plne funkčná bez Ollamy,
   takže tento panel nikdy nesmie byť blokujúci ani hlásiť chybu ako poruchu. */

import { apiGet } from '../../core/api.js';
import { $, esc } from '../../core/dom.js';
import { timeAgo } from '../../core/format.js';

const STATE = {
    off:      ['—', 'nepripojené'],
    down:     ['error', 'nedostupný'],
    degraded: ['partial', 'degradovaný'],
    ok:       ['ok', 'v poriadku'],
};


/** Statická schránka; obsah dopĺňa renderLlmPanel() po odpovedi. */
export function llmCardHtml() {
    return '<div class="dash-card" id="dash-llm">'
        + '<div class="dash-head"><span class="dash-title">Lokálny model</span>'
        + '<span class="dash-note" id="llm-note">—</span></div>'
        + '<div id="llm-body"><div class="shimmer" style="width:100%;height:64px;border-radius:var(--r-md);"></div></div>'
        + '</div>';
}


function row(label, value) {
    return '<div class="llm-row"><span class="llm-k">' + esc(label) + '</span>'
        + '<span class="llm-v tnum">' + esc(value) + '</span></div>';
}


function statusLine(kind, text) {
    const meta = STATE[kind] || STATE.off;
    const dot = meta[0] === '—'
        ? '<span class="status-dot"></span>'
        : '<span class="status-dot" data-status="' + meta[0] + '"></span>';
    return '<div class="llm-status">' + dot + '<span>' + esc(text || meta[1]) + '</span></div>';
}


/** Doplní panel dátami. Bez endpointu vykreslí zmysluplný „nepripojené" stav. */
export async function renderLlmPanel() {
    const body = $('llm-body');
    const note = $('llm-note');
    if (!body) return;

    let d;
    try {
        d = await apiGet('/api/llm/stats', { retry: 0, timeoutMs: 4000 });
    } catch (e) {
        body.innerHTML = statusLine('off')
            + '<p class="llm-hint">LLM vrstva ešte nie je pripojená — AuraAI beží '
            + 'v plnom rozsahu z pamäte grafu.</p>';
        if (note) note.textContent = 'vypnuté';
        return;
    }

    const models = Array.isArray(d.models) ? d.models : [];
    const kind = d.ok ? (d.chat && d.embed ? 'ok' : 'degraded') : 'down';

    let h = statusLine(kind, d.error ? String(d.error).slice(0, 80) : null);
    if (models.length) {
        h += '<div class="llm-models">'
            + models.slice(0, 4).map((m) => '<span class="tag">' + esc(m) + '</span>').join('')
            + '</div>';
    }
    h += '<div class="llm-rows">';
    if (d.avg_tok_per_s != null) h += row('priemer', (+d.avg_tok_per_s).toFixed(1) + ' tok/s');
    if (d.runs_24h != null) h += row('behov za 24 h', String(d.runs_24h));
    if (d.memory_mb != null) h += row('pamäť', Math.round(+d.memory_mb) + ' MB');
    if (d.latency_ms != null) h += row('odozva', Math.round(+d.latency_ms) + ' ms');
    h += '</div>';

    const last = d.last || null;
    if (last && last.model) {
        h += '<p class="llm-hint">Naposledy <strong>' + esc(last.model) + '</strong>'
            + (last.task ? ' · ' + esc(last.task) : '')
            + (last.created_at ? ' · ' + esc(timeAgo(last.created_at)) : '') + '</p>';
    }

    body.innerHTML = h;
    if (note) note.textContent = d.provider ? String(d.provider) : '—';
}
