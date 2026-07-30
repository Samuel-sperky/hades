import { $, busy, esc, renderEmpty } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { spawnPulse } from '../graph/pulses.js';
import { draw } from '../graph/render/draw.js';
import { buildSim, kickSim } from '../graph/sim.js';
import { selectNode } from './node-panel.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { showToast } from '../shell/toasts.js';


// A8: „Možno súvisí" — algoritmické návrhy prepojení pod susedmi
export async function renderSuggestions(n) {
    const sec = $('node-suggestions-sec');
    const wrap = $('node-suggestions');
    if (!sec || !wrap) return;
    // jadro nikdy nedostáva návrhy — celá sekcia sa skryje
    if (n.type === 'core') { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');

    let list = [];
    try {
        const res = await fetch('/api/nodes/' + n.id + '/suggestions');
        const data = await res.json();
        list = data.suggestions || [];
    } catch (e) { return; } // offline — sekcia ostáva prázdna, žiadny šum

    if (!S.selected || S.selected.id !== n.id) return; // medzitým iný výber

    if (!list.length) { renderEmpty(wrap, 'hub', 'Žiadne návrhy'); return; }

    wrap.innerHTML = list.map((s) => {
        const area = S.areas.get(s.area_id);
        const color = area ? area.color : 'var(--muted)';
        return '<div class="sug-row" data-id="' + s.id + '">'
            + '<span class="swatch" style="background:' + esc(color) + '" aria-hidden="true"></span>'
            + '<span class="sug-label">' + esc(s.label) + '</span>'
            + '<span class="sug-score">' + esc(Number(s.score).toFixed(2)) + '</span>'
            + '<button type="button" class="ghost ms sug-add" title="Prepojiť" aria-label="Prepojiť">add_link</button>'
            + '</div>';
    }).join('');

    wrap.querySelectorAll('.sug-add').forEach((btn) => {
        btn.onclick = () => {
            const row = btn.closest('.sug-row');
            busy(btn, () => linkSuggestion(n, +row.dataset.id, row));
        };
    });
}


// Prepojenie z návrhu — rovnaká konštrukcia hrany ako createEdge (connect mode)
async function linkSuggestion(source, targetId, row) {
    try {
        const res = await fetch('/api/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: source.id, target_id: targetId }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Prepojenie sa nepodarilo');
            return;
        }
        const data = await res.json();
        const e = data.edge;
        if (e) {
            const existing = S.edges.find((x) => x.id === e.id);
            if (existing) {
                existing.weight = e.weight;
                spawnPulse(existing.source, existing.target, { speed: 1.4 });
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
            }
            updateHeaderMetrics();
        }
        row.remove();
        draw();
        showToast('Prepojené');
        if (S.selected && S.selected.id === source.id) selectNode(S.selected); // čerství susedia + návrhy
    } catch (err) {
        showToast('Prepojenie sa nepodarilo');
    }
}
