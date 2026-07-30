import { busy, esc } from '../../core/dom.js';
import { now, timeAgo } from '../../core/format.js';
import { renderToday } from '../today.js';
import { showToast } from '../../shell/toasts.js';


// Sync karta — stav (status-dot), štatistiky posledného behu, brain-write guard, „Sync teraz".
export function syncCardHtml(dash) {
    const sync = dash.sync || {};
    const status = ['ok', 'partial', 'error', 'running'].includes(sync.status) ? sync.status : 'ok';
    const statusLabel = { ok: 'v poriadku', partial: 'čiastočne', error: 'chyba', running: 'prebieha' }[status];
    const guardOn = !!(dash.brain_write_enabled != null ? dash.brain_write_enabled : sync.brain_write_enabled);

    const rowStyle = 'display:flex;align-items:center;gap:var(--sp-1);';
    const bits = [
        ['+' + (sync.created ?? 0), 'nových'],
        ['~' + (sync.updated ?? 0), 'zmien'],
        ['−' + (sync.deleted ?? 0), 'zmazaných'],
        ['»' + (sync.skipped ?? 0), 'preskočených'],
    ];
    const stats = '<div style="display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-2);'
        + 'font-family:var(--mono);font-size:var(--fs-small);color:var(--muted);">'
        + bits.map((b) => '<span><strong style="color:var(--text-secondary);">' + esc(b[0]) + '</strong> '
            + esc(b[1]) + '</span>').join('') + '</div>';

    return '<div class="dash-card"><div class="dash-head">'
        + '<span class="dash-title">Synchronizácia</span>'
        + '<span class="dash-note">' + (sync.finished_at ? esc(timeAgo(sync.finished_at)) : '—') + '</span>'
        + '</div>'
        + '<div style="' + rowStyle + 'font-size:var(--fs-small);color:var(--text-secondary);">'
        + '<span class="status-dot" data-status="' + status + '"></span><span>' + esc(statusLabel) + '</span></div>'
        + (sync.message ? '<p style="font-size:var(--fs-small);color:var(--muted);margin:0;">' + esc(sync.message) + '</p>' : '')
        + stats
        + '<div style="' + rowStyle + 'font-family:var(--mono);font-size:var(--fs-caption);color:var(--muted);">'
        + '<span class="ms" aria-hidden="true" style="font-size:var(--icon-sm);">' + (guardOn ? 'lock_open' : 'lock') + '</span>'
        + 'Zápis do brain: <strong style="color:var(--text-secondary);">' + (guardOn ? 'zapnutý' : 'vypnutý') + '</strong></div>'
        + '<button type="button" id="sync-now" class="primary" style="align-self:flex-start;display:inline-flex;align-items:center;gap:6px;">'
        + '<span class="ms" aria-hidden="true">sync</span> Sync teraz</button>'
        + '</div>';
}


// „Sync teraz" → POST /api/sync; 423 = lock (už beží). Po úspechu toast + refresh dashboardu.
export async function doSync(btn) {
    await busy(btn, async () => {
        let res;
        try {
            res = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
        } catch (e) {
            showToast('Sync zlyhal', null, 'error');
            return;
        }
        if (res.status === 423) { showToast('Sync už prebieha', null, 'warn'); return; }
        let j = {};
        try { j = await res.json(); } catch (e) { /* prázdna odpoveď */ }
        if (!res.ok) { showToast(j.message || j.error || 'Sync zlyhal', null, 'error'); return; }
        const st = j.stats || j.sync || j.run || j;
        showToast('Sync hotový: +' + (st.created ?? 0) + ' / ~' + (st.updated ?? 0), null, 'success');
        renderToday();
    }, 'Sync…');
}
