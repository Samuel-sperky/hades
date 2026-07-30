import { $, busy, esc, renderEmpty } from '../core/dom.js';
import { reloadGraph } from '../graph/loader.js';
import { showToast } from '../shell/toasts.js';


/* ---------- údržba: duplicity ---------- */

export async function findDuplicates() {
    const wrap = $('dup-list');
    renderEmpty(wrap, 'hourglass_empty', 'Načítavam…');
    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
    try {
        const data = await (await fetch('/api/duplicates')).json();
        const pairs = data.pairs || [];
        if (!pairs.length) { renderEmpty(wrap, 'done_all', 'Žiadne duplicity'); return; }

        const nodeHtml = (n) => '<div class="dup-node"><span class="dup-label">' + esc(n.label) + '</span>'
            + '<span class="tag muted">' + (typeNames[n.type] || esc(n.type)) + '</span></div>';

        wrap.innerHTML = pairs.map((p, i) =>
            '<div class="dup-card" data-i="' + i + '">'
            + '<div class="dup-pair">' + nodeHtml(p.a) + nodeHtml(p.b) + '</div>'
            + '<div class="dup-side"><span class="dup-pct">' + Math.round(p.percent) + ' %</span>'
            + '<button type="button" class="primary dup-merge" aria-label="Zlúčiť ' + esc(p.a.label) + ' a ' + esc(p.b.label) + '">Zlúčiť</button></div>'
            + '</div>'
        ).join('');

        wrap.querySelectorAll('.dup-card').forEach((card) => {
            const btn = card.querySelector('.dup-merge');
            btn.onclick = () => busy(btn, async () => {
                const p = pairs[+card.dataset.i];
                // slabší uzol sa zlúči do silnejšieho; pri zhode a → b
                const [loser, winner] = (p.a.strength || 0) > (p.b.strength || 0) ? [p.b, p.a] : [p.a, p.b];
                try {
                    const res = await fetch('/api/nodes/' + loser.id + '/merge/' + winner.id, { method: 'POST' });
                    if (!res.ok) { showToast('Zlúčenie sa nepodarilo'); return; }
                } catch (e) {
                    showToast('Zlúčenie sa nepodarilo');
                    return;
                }
                card.remove();
                if (!wrap.querySelector('.dup-card')) renderEmpty(wrap, 'done_all', 'Žiadne duplicity');
                showToast('Zlúčené');
                await reloadGraph();
            }, 'Zlúčujem…');
        });
    } catch (e) {
        renderEmpty(wrap, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

/* ---------- F4: prepínač Značky istoty + filter podľa značiek ----------
   Blade patrí F1, preto obidve UI injektujem z JS do existujúceho #sec-settings.
   Prepínač riadi S.certRings (canvas prstence); filter značiek plní S.filter.tags
   dynamickými checkboxami z /api/tags (pozitívny filter, perzistuje v hades.filter). */
