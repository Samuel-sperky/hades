import { reloadGraph } from './api.js';
import { dockOpen } from './dock.js';
import { S } from './state.js';
import { mutedColor } from './theme.js';
import { showToast } from './toasts.js';
import { $, busy, deferSkeleton, emptyHtml, esc, getJson, markTreeActive, renderEmpty, renderError, renderLoading, setFocus, typeName } from './util.js';
import { iconMarkup } from '../shared/icons.js';

/* ---------- štruktúra (oblasti a oddelenia) ---------- */

export async function renderStructure() {
    const wrap = $('structure-tree');
    // Skeleton v tvare obsahu: strom je zoznam riadkov, teda tvar sa dá predkresliť.
    const cancelSkeleton = deferSkeleton(wrap, 'list');
    try {
        const data = await getJson('/api/structure');
        cancelSkeleton();
        const cnt = (v) => (v && typeof v === 'object') ? (v.node_count || v.count || 0) : (v || 0);

        let html = '';
        for (const a of data.areas || []) {
            html += '<div class="tree-row area" role="button" tabindex="0" data-area="' + a.id + '">'
                + '<span class="dot" style="background:' + esc(mutedColor(a.color || '#566964')) + '"></span>'
                + '<span class="t-name">' + esc(a.name) + '</span>'
                + '<span class="count">' + (a.node_count || 0) + '</span></div>';
            for (const d of a.departments || []) {
                html += '<div class="tree-row dept" role="button" tabindex="0" data-area="' + a.id + '" data-dept="' + d.id + '">'
                    + '<span class="t-name">' + esc(d.name) + '</span>'
                    + '<span class="count">' + (d.node_count || 0) + '</span>'
                    + '<button type="button" class="ghost dept-more" data-more="' + d.id
                    + '" title="Možnosti oddelenia" aria-label="Možnosti oddelenia">'
                    + iconMarkup('ellipsis') + '</button>'
                    + '</div>';
            }
        }
        const core = cnt(data.core);
        const unassigned = cnt(data.unassigned);
        if (core > 0) html += '<div class="tree-muted"><span>Jadro</span><span class="count">' + core + '</span></div>';
        if (unassigned > 0) html += '<div class="tree-muted"><span>Nezaradené</span><span class="count">' + unassigned + '</span></div>';

        // Prázdny stav UČÍ: čo to je aj prečo je prázdne. Akcia tu nie je, pretože
        // oblasti sa nezakladajú z tohto panela — vznikajú zaradením uzlov.
        wrap.innerHTML = html || emptyHtml('tree', 'Zatiaľ žiadna štruktúra',
            'Oblasti a oddelenia pribudnú, keď Hades zaradí prvé uzly.');

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
        cancelSkeleton();
        // Do 27. 8. 2026 tu stálo „Nepodarilo sa načítať" — bez predmetu aj bez rady,
        // teda najtichšie priznanie chyby v celej appke. Predmet skládá helper.
        renderError(wrap, 'štruktúru', renderStructure);
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
        busy(del, () => deptRequest(deptId, 'DELETE', null, 'Oddelenie zmazané'), 'Maže sa…');
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
            showToast(data.message || 'Akcia sa nepodarila', null, 'error');
            return;
        }
        if (S.focus.departmentId === deptId && method === 'DELETE') setFocus(S.focus.areaId, null);
        showToast(okMsg);
        await reloadGraph();
        if (dockOpen === 'structure') renderStructure();
    } catch (e) {
        showToast('Akcia sa nepodarila', null, 'error');
    }
}
/* ---------- údržba: duplicity ---------- */

export async function findDuplicates() {
    const wrap = $('dup-list');
    /* Dýchajúci znak ZOSTÁVA (nie skeleton): hľadanie duplicít je porovnávanie
       párov a dopredu nie je známe ani to, či nejaký pár nájde — predkresliť sa
       teda nedá tvar, ktorý ešte neexistuje. */
    renderLoading(wrap, 'Hľadajú sa duplicity…');
    try {
        const data = await getJson('/api/duplicates');
        const pairs = data.pairs || [];
        if (!pairs.length) {
            renderEmpty(wrap, 'check-double', 'Žiadne duplicity',
                'Nič sa v pamäti neopakuje — nie je čo zlučovať.');
            return;
        }

        const nodeHtml = (n) => '<div class="dup-node"><span class="dup-label">' + esc(n.label) + '</span>'
            + '<span class="tag muted">' + esc(typeName(n.type)) + '</span></div>';

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
                    if (!res.ok) { showToast('Zlúčenie sa nepodarilo', null, 'error'); return; }
                } catch (e) {
                    showToast('Zlúčenie sa nepodarilo', null, 'error');
                    return;
                }
                card.remove();
                if (!wrap.querySelector('.dup-card')) {
                    renderEmpty(wrap, 'check-double', 'Žiadne duplicity',
                        'Nič sa v pamäti neopakuje — nie je čo zlučovať.');
                }
                // Bez hlásenia (J2): karta duplicity zmizla, prípadne nastúpil
                // prázdny stav, a graf sa prekreslil zlúčeným uzlom.
                await reloadGraph();
            }, 'Zlučuje sa…');
        });
    } catch (e) {
        // to isté ako v `renderStructure()`: predmet aj rada boli doteraz nikde
        renderError(wrap, 'duplicity', findDuplicates);
    }
}
