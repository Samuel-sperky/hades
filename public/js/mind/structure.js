import { reloadGraph } from './api.js';
import { dockOpen } from './dock.js';
import { S } from './state.js';
import { showToast } from './toasts.js';
import { $, busy, emptyHtml, esc, markTreeActive, renderEmpty, setFocus } from './util.js';

/* ---------- štruktúra (oblasti a oddelenia) ---------- */

export async function renderStructure() {
    const wrap = $('structure-tree');
    renderEmpty(wrap, 'hourglass_empty', 'Načítavam…');
    try {
        const data = await (await fetch('/api/structure')).json();
        const cnt = (v) => (v && typeof v === 'object') ? (v.node_count || v.count || 0) : (v || 0);

        let html = '';
        for (const a of data.areas || []) {
            html += '<div class="tree-row area" role="button" tabindex="0" data-area="' + a.id + '">'
                + '<span class="dot" style="background:' + esc(a.color || '#566964') + '"></span>'
                + '<span class="t-name">' + esc(a.name) + '</span>'
                + '<span class="count">' + (a.node_count || 0) + '</span></div>';
            for (const d of a.departments || []) {
                html += '<div class="tree-row dept" role="button" tabindex="0" data-area="' + a.id + '" data-dept="' + d.id + '">'
                    + '<span class="t-name">' + esc(d.name) + '</span>'
                    + '<span class="count">' + (d.node_count || 0) + '</span>'
                    + '<button type="button" class="ghost ms dept-more" data-more="' + d.id
                    + '" title="Možnosti oddelenia" aria-label="Možnosti oddelenia">more_horiz</button>'
                    + '</div>';
            }
        }
        const core = cnt(data.core);
        const unassigned = cnt(data.unassigned);
        if (core > 0) html += '<div class="tree-muted"><span>Jadro</span><span class="count">' + core + '</span></div>';
        if (unassigned > 0) html += '<div class="tree-muted"><span>Nezaradené</span><span class="count">' + unassigned + '</span></div>';

        wrap.innerHTML = html || emptyHtml('account_tree', 'Zatiaľ žiadna štruktúra');

        const rowActivate = (row, fn) => {
            row.onclick = (e) => { if (!e.target.closest('.dept-more')) fn(); };
            row.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
            };
        };

        wrap.querySelectorAll('.tree-row.area').forEach((row) => {
            const id = +row.dataset.area;
            rowActivate(row, () => {
                if (S.focus.areaId === id && !S.focus.departmentId) setFocus(null, null);
                else setFocus(id, null);
            });
        });

        wrap.querySelectorAll('.tree-row.dept').forEach((row) => {
            const aid = +row.dataset.area;
            const did = +row.dataset.dept;
            rowActivate(row, () => {
                if (S.focus.departmentId === did) setFocus(null, null);
                else setFocus(aid, did);
            });
        });

        wrap.querySelectorAll('.dept-more').forEach((btn) => {
            btn.onclick = (e) => { e.stopPropagation(); toggleDeptActions(+btn.dataset.more); };
        });

        markTreeActive();
    } catch (e) {
        renderEmpty(wrap, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

// Malý inline action riadok pod oddelením — žiadny modál
export function toggleDeptActions(deptId) {
    const wrap = $('structure-tree');
    const existing = wrap.querySelector('.dept-actions');
    const wasOpen = existing && +existing.dataset.dept === deptId;
    if (existing) existing.remove();
    if (wasOpen) return;

    const row = wrap.querySelector('.tree-row.dept[data-dept="' + deptId + '"]');
    if (!row) return;

    const box = document.createElement('div');
    box.className = 'dept-actions';
    box.dataset.dept = deptId;
    box.innerHTML = '<button type="button" data-act="rename">Premenovať</button>'
        + '<button type="button" data-act="move">Presunúť do…</button>'
        + '<button type="button" data-act="delete">Zmazať</button>';
    row.after(box);

    box.querySelector('[data-act="rename"]').onclick = () => {
        const d = S.departments.get(deptId);
        box.innerHTML = '<input type="text" maxlength="255" aria-label="Nový názov oddelenia">';
        const inp = box.querySelector('input');
        inp.value = d ? d.name : '';
        inp.focus();
        inp.select();
        inp.onkeydown = (ev) => {
            if (ev.key === 'Escape') { ev.stopPropagation(); box.remove(); return; }
            if (ev.key !== 'Enter') return;
            const name = inp.value.trim();
            if (name) deptRequest(deptId, 'PUT', { name }, 'Oddelenie premenované');
        };
    };

    box.querySelector('[data-act="move"]').onclick = () => {
        const d = S.departments.get(deptId);
        box.innerHTML = '<select aria-label="Cieľová oblasť">'
            + [...S.areas.values()].map((a) =>
                '<option value="' + a.id + '"' + (d && d.area_id === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'
            ).join('')
            + '</select>';
        const sel = box.querySelector('select');
        sel.focus();
        sel.onchange = () => deptRequest(deptId, 'PUT', { area_id: +sel.value }, 'Oddelenie presunuté');
    };

    // Zmazanie cez arm pattern: prvý klik ozbrojí (.danger + text), druhý do 3 s maže
    const del = box.querySelector('[data-act="delete"]');
    del.onclick = () => {
        if (!del.classList.contains('danger')) {
            del.classList.add('danger');
            del.textContent = 'Naozaj zmazať?';
            setTimeout(() => {
                if (del.isConnected) { del.classList.remove('danger'); del.textContent = 'Zmazať'; }
            }, 3000);
            return;
        }
        busy(del, () => deptRequest(deptId, 'DELETE', null, 'Oddelenie zmazané'), 'Mažem…');
    };
}

export async function deptRequest(deptId, method, body, okMsg) {
    try {
        const res = await fetch('/api/departments/' + deptId, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.message || 'Akcia sa nepodarila');
            return;
        }
        if (S.focus.departmentId === deptId && method === 'DELETE') setFocus(S.focus.areaId, null);
        showToast(okMsg);
        await reloadGraph();
        if (dockOpen === 'structure') renderStructure();
    } catch (e) {
        showToast('Akcia sa nepodarila');
    }
}
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
