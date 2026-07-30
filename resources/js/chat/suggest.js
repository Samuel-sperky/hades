import { $, busy, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { anchorOf } from '../graph/anchors.js';
import { draw } from '../graph/render/draw.js';
import { buildSim, kickSim } from '../graph/sim.js';
import { selectNode } from '../node/node-panel.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { showToast } from '../shell/toasts.js';


// E2: potvrdzovacia karta „Zapamätať" v chate — vytvorí uzol po úprave a potvrdení
export function renderSuggestCard(sug) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const card = document.createElement('div');
    card.className = 'suggest-card';
    const areaOpts = '<option value="">— bez oblasti —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    card.innerHTML =
        '<div class="sc-head"><span class="ms" aria-hidden="true">bookmark_add</span><span>Zapamätať:</span></div>'
        + '<input class="sc-label" maxlength="255" aria-label="Názov uzla">'
        + '<div class="sc-row">'
        +   '<select class="sc-type" aria-label="Typ">'
        +     '<option value="memory">Spomienka</option>'
        +     '<option value="skill">Skill</option>'
        +     '<option value="project">Projekt</option>'
        +   '</select>'
        +   '<select class="sc-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '</div>'
        + '<div class="sc-actions">'
        +   '<button type="button" class="primary sc-save">Uložiť</button>'
        +   '<button type="button" class="ghost sc-cancel">Zrušiť</button>'
        + '</div>';
    log.appendChild(card);
    card.querySelector('.sc-label').value = sug.label || '';
    const typeSel = card.querySelector('.sc-type');
    if (sug.type) typeSel.value = sug.type;
    log.scrollTop = 1e9;

    card.querySelector('.sc-cancel').onclick = () => card.remove();
    card.querySelector('.sc-save').onclick = (ev) => busy(ev.currentTarget, async () => {
        const label = card.querySelector('.sc-label').value.trim();
        if (!label) { showToast('Zadaj názov uzla'); return; }
        try {
            const res = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label,
                    type: typeSel.value,
                    description: sug.description || null,
                    area_id: card.querySelector('.sc-area').value ? +card.querySelector('.sc-area').value : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                showToast(d.message || 'Vytvorenie sa nepodarilo');
                return;
            }
            const data = await res.json();
            let n = S.byId.get(data.node.id); // WS echo node.created mohol byť rýchlejší
            if (!n) {
                n = { ...data.node };
                const a = anchorOf(n);
                n.x = a.x + (Math.random() - 0.5) * 50;
                n.y = a.y + (Math.random() - 0.5) * 50;
                n.flash = 1;
                S.nodes.push(n);
                S.byId.set(n.id, n);
                buildSim();
                kickSim(0.4);
            }
            updateHeaderMetrics();
            draw();
            card.remove();
            showToast('Uzol vytvorený', n.id);
            selectNode(n);
        } catch (err) {
            showToast('Vytvorenie sa nepodarilo');
        }
    }, 'Ukladám…');
}
