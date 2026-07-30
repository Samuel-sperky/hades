import { S } from '../core/state/index.js';
import { canvas } from '../graph/canvas-el.js';
import { spawnPulse } from '../graph/pulses.js';
import { draw } from '../graph/render/draw.js';
import { buildSim, kickSim } from '../graph/sim.js';
import { selectNode } from './node-panel.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { showToast } from '../shell/toasts.js';


/* ---------- ručné prepájanie (connect mode) + správa hrán ---------- */

export function cancelConnect() {
    S.connectFrom = null;
    canvas.classList.remove('linking');
}


export async function createEdge(sourceId, targetId) {
    cancelConnect(); // režim končí prvým platným klikom — žiadne duplicitné POSTy
    try {
        const res = await fetch('/api/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Prepojenie sa nepodarilo');
            return;
        }
        const data = await res.json();
        const e = data.edge;
        if (!e) return;
        const existing = S.edges.find((x) => x.id === e.id);
        if (existing) {
            // pár už existoval — backend zvýšil váhu (WS echo edge.strengthened je idempotentné)
            existing.weight = e.weight;
            spawnPulse(existing.source, existing.target, { speed: 1.4 });
            showToast('Spojenie posilnené');
        } else {
            const src = S.byId.get(e.source_id);
            const tgt = S.byId.get(e.target_id);
            if (src && tgt) {
                S.edges.push({ ...e, source: src, target: tgt });
                S._localFor = null; // hrany sa zmenili — BFS cache neplatí
                buildSim();
                kickSim(0.3);
                spawnPulse(src, tgt, { speed: 1.2 });
            }
            showToast('Prepojené');
        }
        updateHeaderMetrics();
        draw();
        if (S.selected) selectNode(S.selected); // čerstvý zoznam susedov v paneli
    } catch (err) {
        showToast('Prepojenie sa nepodarilo');
    }
}


export async function deleteEdge(edgeId) {
    try {
        const res = await fetch('/api/edges/' + edgeId, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Zrušenie sa nepodarilo');
            return;
        }
        // optimistické odstránenie — WS echo edge.deleted už hranu nenájde (no-op)
        const i = S.edges.findIndex((x) => x.id === edgeId);
        if (i !== -1) S.edges.splice(i, 1);
        S._localFor = null;
        buildSim();
        kickSim(0.2);
        updateHeaderMetrics();
        draw();
        showToast('Spojenie zrušené');
        if (S.selected) selectNode(S.selected);
    } catch (err) {
        showToast('Zrušenie sa nepodarilo');
    }
}


/* Ručné prepájanie — klik na 'link' zapne connect mode, cieľ sa vyberá klikom na plátne */
export function register(root) {
    const btn = root.querySelector('#node-connect');
    if (!btn) return;
    btn.onclick = () => {
        if (!S.selected) return;
        S.connectFrom = S.selected.id;
        canvas.classList.add('linking');
        showToast('Klikni na cieľový uzol — Esc zruší');
    };
}
