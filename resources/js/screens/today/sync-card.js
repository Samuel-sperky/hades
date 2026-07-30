/* Sync karta — stav behu, štatistiky, brain-write guard, „Sync teraz".

   Inline štýly z monolitu sú preložené na triedy (.sync-*, viď screens/today.css),
   takže karta dedí density tokeny P9 namiesto zadrôtovaných hodnôt.
   Volanie ide cez core/api.js (rozhranie #1) — 423 (lock) a ostatné stavy sa
   rozlišujú podľa ApiError.status, nie podľa res.ok. */

import { ApiError, apiSend } from '../../core/api.js';
import { busy, esc } from '../../core/dom.js';
import { timeAgo } from '../../core/format.js';
import { renderToday } from '../today.js';
import { describeApiError } from '../shared/anatomy.js';
import { showToast } from '../../shell/toasts.js';

const STATUS_LABEL = { ok: 'v poriadku', partial: 'čiastočne', error: 'chyba', running: 'prebieha' };


export function syncCardHtml(dash) {
    const sync = dash.sync || {};
    const status = Object.prototype.hasOwnProperty.call(STATUS_LABEL, sync.status) ? sync.status : 'ok';
    const guardOn = !!(dash.brain_write_enabled != null ? dash.brain_write_enabled : sync.brain_write_enabled);

    const bits = [
        ['+' + (sync.created ?? 0), 'nových'],
        ['~' + (sync.updated ?? 0), 'zmien'],
        ['−' + (sync.deleted ?? 0), 'zmazaných'],
        ['»' + (sync.skipped ?? 0), 'preskočených'],
    ];
    const stats = '<div class="sync-stats">'
        + bits.map((b) => '<span><strong class="tnum">' + esc(b[0]) + '</strong> ' + esc(b[1]) + '</span>').join('')
        + '</div>';

    return '<div class="dash-card"><div class="dash-head">'
        + '<span class="dash-title">Synchronizácia</span>'
        + '<span class="dash-note">' + (sync.finished_at ? esc(timeAgo(sync.finished_at)) : '—') + '</span>'
        + '</div>'
        + '<div class="sync-state"><span class="status-dot" data-status="' + status + '"></span>'
        + '<span>' + esc(STATUS_LABEL[status]) + '</span></div>'
        + (sync.message ? '<p class="sync-msg">' + esc(sync.message) + '</p>' : '')
        + stats
        + '<div class="sync-guard">'
        + '<span class="ms" aria-hidden="true">' + (guardOn ? 'lock_open' : 'lock') + '</span>'
        + 'Zápis do brain: <strong>' + (guardOn ? 'zapnutý' : 'vypnutý') + '</strong></div>'
        + '<button type="button" id="sync-now" class="primary sync-btn">'
        + '<span class="ms" aria-hidden="true">sync</span> Sync teraz</button>'
        + '</div>';
}


/** „Sync teraz" → POST /api/sync; 423 = beží. Po úspechu toast + refresh Dnes. */
export async function doSync(btn) {
    await busy(btn, async () => {
        let j;
        try {
            j = await apiSend('POST', '/api/sync', {});
        } catch (e) {
            if (e instanceof ApiError && e.status === 423) {
                showToast('Sync už prebieha', null, 'warn');
                return;
            }
            const body = e instanceof ApiError ? e.body : null;
            const msg = (body && (body.message || body.error)) || describeApiError(e).title;
            showToast(msg, null, 'error');
            return;
        }
        const st = (j && (j.stats || j.sync || j.run)) || j || {};
        showToast('Sync hotový: +' + (st.created ?? 0) + ' / ~' + (st.updated ?? 0), null, 'success');
        renderToday();
    }, 'Sync…');
}
