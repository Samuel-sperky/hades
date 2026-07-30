import { $, busy, esc } from '../core/dom.js';
import { S } from '../core/state/index.js';
import { renderStructure } from '../dock/structure.js';
import { anchorOf } from '../graph/anchors.js';
import { reloadGraph } from '../graph/loader.js';
import { draw } from '../graph/render/draw.js';
import { buildSim, kickSim } from '../graph/sim.js';
import { closeNodePanel, selectNode } from './node-panel.js';
import { dockOpen } from '../shell/dock.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { showToast } from '../shell/toasts.js';


/* ---------- nový uzol (create mode v paneli uzla) ---------- */

let createMode = false;


export function openCreateNode() {
    createMode = true;
    $('node-panel').classList.remove('hidden');
    $('node-view').classList.add('hidden');
    $('node-form').classList.remove('hidden');
    $('node-label').textContent = 'Nový uzol';
    $('node-panel').style.removeProperty('--node-c');
    $('edit-label').value = '';
    $('edit-desc').value = '';
    $('edit-type').value = 'memory';
    $('edit-type-row').classList.remove('hidden');
    fillMoveSelects({ area_id: null, department_id: null });
    setTimeout(() => $('edit-label').focus(), 60);
}


export function closeCreateMode() {
    createMode = false;
    $('edit-type-row').classList.add('hidden');
}


export async function createNode() {
    const label = $('edit-label').value.trim();
    if (!label) { showToast('Zadaj názov uzla'); return; }
    try {
        const res = await fetch('/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label,
                type: $('edit-type').value,
                description: $('edit-desc').value.trim() || null,
                area_id: $('edit-area').value ? +$('edit-area').value : null,
                department_id: $('edit-dept').value ? +$('edit-dept').value : null,
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
            // spawn pri kotve zvolenej oblasti/oddelenia, inak pri strede
            const a = anchorOf(n);
            n.x = a.x + (Math.random() - 0.5) * 50;
            n.y = a.y + (Math.random() - 0.5) * 50;
            n.flash = 1;
            S.nodes.push(n);
            S.byId.set(n.id, n);
            buildSim();
            kickSim(0.4);
        }
        closeCreateMode();
        updateHeaderMetrics();
        draw();
        selectNode(n);
        showToast('Uzol vytvorený', n.id);
    } catch (err) {
        showToast('Vytvorenie sa nepodarilo');
    }
}


// Presun uzla — naplnenie selectov Oblasť / Oddelenie v edit forme
export function fillMoveSelects(n) {
    const aSel = $('edit-area');
    aSel.innerHTML = '<option value="">— bez oblasti —</option>'
        + [...S.areas.values()].map((a) =>
            '<option value="' + a.id + '">' + esc(a.name) + '</option>'
        ).join('');
    aSel.value = n.area_id || '';
    fillDeptOptions(n.area_id || null, n.department_id || null);
}


export function fillDeptOptions(areaId, deptId) {
    const dSel = $('edit-dept');
    const depts = areaId ? [...S.departments.values()].filter((d) => d.area_id === areaId) : [];
    dSel.innerHTML = '<option value="">— bez oddelenia —</option>'
        + depts.map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('');
    dSel.value = deptId || '';
}


/** createMode patrí tomuto modulu; node-panel.js ho vypína pri zatvorení panela. */
export function setCreateMode(v) { createMode = v; }

/* Nový uzol + formulár úpravy (zdieľaný medzi vytvorením a editáciou). */
export function register(root) {
    const newBtn = root.querySelector('#btn-new-node');
    if (newBtn) newBtn.onclick = openCreateNode;

    root.querySelector('#node-edit').onclick = () => {
        if (!S.selected) return;
        closeCreateMode(); // edit mód — select typu patrí len vytváraniu
        $('edit-label').value = S.selected.label;
        $('edit-desc').value = S.selected.description || '';
        fillMoveSelects(S.selected);
        $('node-view').classList.add('hidden');
        $('node-form').classList.remove('hidden');
    };

    $('edit-area').onchange = () => fillDeptOptions(+$('edit-area').value || null, null);

    $('edit-cancel').onclick = () => {
        if (createMode) {
            closeCreateMode();
            if (S.selected) selectNode(S.selected); // návrat na detail predtým zvoleného uzla
            else closeNodePanel();
            return;
        }
        $('node-form').classList.add('hidden');
        $('node-view').classList.remove('hidden');
    };

    $('edit-save').onclick = () => busy($('edit-save'), async () => {
        if (createMode) { await createNode(); return; }
        if (!S.selected) return;
        try {
            const res = await fetch('/api/nodes/' + S.selected.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: $('edit-label').value.trim(),
                    description: $('edit-desc').value.trim() || null,
                    area_id: $('edit-area').value ? +$('edit-area').value : null,
                    department_id: $('edit-dept').value ? +$('edit-dept').value : null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                Object.assign(S.selected, data.node);
                selectNode(S.selected);
                await reloadGraph();
                if (dockOpen === 'structure') renderStructure();
                draw();
                showToast('Uložené');
            } else {
                showToast('Uloženie sa nepodarilo');
            }
        } catch (e) {
            showToast('Uloženie sa nepodarilo');
        }
    }, 'Ukladám…');
}
