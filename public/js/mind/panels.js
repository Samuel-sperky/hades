import { spawnPulse } from './anim.js';
import { renderNodeBadges } from './certainty.js';
import { persistFilter, setLocal } from './filters.js';
import { anchorOf } from './layout.js';
import { updatePackUi } from './pack.js';
import { draw, focusNode, requestDraw } from './render.js';
import { buildSim, kickSim } from './sim.js';
import { S, canvas } from './state.js';
import { showToast } from './toasts.js';
import { $, busy, emptyHtml, esc, nodeColor, renderEmpty, timeAgo, updateHeaderMetrics } from './util.js';

/* ---------- panely ---------- */
export async function selectNode(n) {
    // aktívny lokálny graf sa preväzuje na novo zvolený uzol (Obsidian re-root)
    if (S.local && S.local.rootId !== n.id) setLocal(n.id, S.local.depth);
    closeCreateMode(); // výber uzla vždy vracia panel do detailného režimu
    S.selected = n;
    requestDraw(); // nový výber → prekresli zvýraznenie (slučka mohla spať)
    updatePackUi(); // node-pack tlačidlo odzrkadlí stav balíka pre tento uzol
    $('node-panel').classList.remove('hidden');
    $('node-form').classList.add('hidden');
    $('node-view').classList.remove('hidden');
    $('node-type-label').textContent = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' }[n.type] || n.type;
    const nc = nodeColor(n); // farba oblasti — typ hovorí tvar, nie farba
    $('node-swatch').style.background = nc;
    $('node-panel').style.setProperty('--node-c', nc);
    $('node-label').textContent = n.label;
    $('node-desc').textContent = n.description || '';
    $('node-meta').textContent = 'sila ' + (n.strength || 1).toFixed(0);
    renderNodeBadges(n); // F4: origin + cert + značky

    $('node-neighbors').innerHTML = '';
    $('node-history').innerHTML = '';
    $('node-record').innerHTML = '';
    $('node-suggestions').innerHTML = '';
    $('node-md').classList.add('hidden'); // dokument sa odhalí až po načítaní meta

    renderSuggestions(n); // A8: algoritmické návrhy prepojení (vlastný fetch)

    try {
        const res = await fetch('/api/nodes/' + n.id);
        const data = await res.json();
        renderNodeRecord(data.node);

        // C4: tlačidlo dokumentu len ak uzol má markdown zdroj (summary_path / path)
        const nm = data.node.meta || {};
        $('node-md').classList.toggle('hidden', !(nm.summary_path || nm.path));
        const meta = [];
        if (data.node.area_name) meta.push(data.node.area_name);
        if (data.node.department_name) meta.push(data.node.department_name);
        meta.push('sila ' + data.node.strength.toFixed(0));
        $('node-meta').textContent = meta.join(' · ');

        // riadok suseda: chip (navigácia) + × (zrušenie spojenia) — edge id z S.edges podľa páru
        $('node-neighbors').innerHTML = data.neighbors.map((m) => {
            const edge = S.edges.find((x) =>
                (x.source_id === n.id && x.target_id === m.id)
                || (x.source_id === m.id && x.target_id === n.id));
            return '<div class="nb-row">'
                + '<button type="button" class="chip" data-id="' + m.id + '">' + esc(m.label) + '</button>'
                + (edge
                    ? '<button type="button" class="ghost ms nb-del" data-edge="' + edge.id
                        + '" title="Zrušiť spojenie" aria-label="Zrušiť spojenie">close</button>'
                    : '')
                + '</div>';
        }).join('') || emptyHtml('hub', 'Bez spojení');

        $('node-neighbors').querySelectorAll('.chip').forEach((chip) => {
            chip.onclick = () => {
                const target = S.byId.get(+chip.dataset.id);
                if (target) { selectNode(target); focusNode(target); }
            };
        });

        $('node-neighbors').querySelectorAll('.nb-del').forEach((btn) => {
            btn.onclick = () => busy(btn, () => deleteEdge(+btn.dataset.edge));
        });

        $('node-history').innerHTML = data.activations.map((a) => {
            const kinds = { learn: 'naučené', activate: 'aktivované', merge: 'zlúčené', recall: 'spomenuté', seed: 'zasiate' };
            return '<div class="hist">' + (kinds[a.kind] || a.kind) + ' · ' + new Date(a.created_at).toLocaleString('sk') + '</div>';
        }).join('') || emptyHtml('history', 'Zatiaľ žiadna aktivita');
    } catch (e) { /* offline detail nevadí */ }
}

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
export async function linkSuggestion(source, targetId, row) {
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
                    kickSim();
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

// Detail záznamu (session / digest / archive) v paneli uzla — stavia sa z node.meta
export const RECORD_SOURCES = ['session', 'digest', 'archive'];

export function renderNodeRecord(node) {
    const wrap = $('node-record');
    wrap.innerHTML = '';
    const meta = node && node.meta;
    if (!meta || !RECORD_SOURCES.includes(node.source)) return;

    const clip = (s, max) => {
        s = String(s);
        return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
    };

    let html = '';

    if (Array.isArray(meta.prompts) && meta.prompts.length) {
        html += '<h3>Prompty</h3><ol class="rec-prompts">'
            + meta.prompts.map((p) => '<li>' + esc(clip(p, 140)) + '</li>').join('')
            + '</ol>';
    }

    if (Array.isArray(meta.files) && meta.files.length) {
        html += '<h3>Súbory</h3><div class="rec-files">'
            + meta.files.slice(0, 10).map((f) => {
                const s = String(f);
                const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
                const dir = i >= 0 ? s.slice(0, i + 1) : '';
                const base = i >= 0 ? s.slice(i + 1) : s;
                return '<span class="meta-chip" title="' + esc(s) + '">'
                    + (dir ? '<span class="dir">' + esc(dir) + '</span>' : '')
                    + '<strong>' + esc(base) + '</strong></span>';
            }).join('')
            + '</div>';
    }

    if (Array.isArray(meta.commits) && meta.commits.length) {
        html += '<h3>Commity</h3>'
            + meta.commits.map((c) => {
                const label = typeof c === 'string' ? c : (c && (c.message || c.hash)) || '';
                return '<div class="rec-commit"><span class="ms" aria-hidden="true">commit</span>'
                    + '<span>' + esc(clip(label, 160)) + '</span></div>';
            }).join('');
    }

    // meta.tools je objekt {name: count}; pole necháme ako fallback starších záznamov
    let toolChips = '';
    if (Array.isArray(meta.tools)) {
        toolChips = meta.tools.map((t) => '<span class="meta-chip">' + esc(t) + '</span>').join('');
    } else if (meta.tools && typeof meta.tools === 'object') {
        toolChips = Object.entries(meta.tools).map(([name, count]) =>
            '<span class="meta-chip"><strong>' + esc(name) + '</strong>&nbsp;×' + esc(String(count)) + '</span>'
        ).join('');
    }
    if (toolChips) {
        html += '<h3>Nástroje</h3><div class="rec-tools">' + toolChips + '</div>';
    }

    if (meta.final) {
        html += '<h3>Záver</h3><p class="rec-final">' + esc(clip(meta.final, 400)) + '</p>';
    }

    wrap.innerHTML = html;
}
// Tvarové glyfy typov — neutrálny ink (var(--muted)); farba v legende patrí len oblastiam.
// Jadro je jediná výnimka: dvojitý zlatý prstenec (brand moment).
export const TYPE_GLYPHS = {
    memory: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/></svg>',
    skill: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/><circle cx="8" cy="8" r="2.3" fill="var(--bg)"/></svg>',
    project: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="var(--muted)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.2"/></svg>',
    core: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="var(--gold)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--gold)" stroke-opacity=".5" stroke-width="1.2"/></svg>',
};

export function buildLegend() {
    const typeNames = { memory: 'Spomienka', skill: 'Skill', project: 'Projekt', core: 'Jadro' };

    $('legend-types').innerHTML = Object.keys(typeNames).map(
        (t) => '<div class="legend-row">' + TYPE_GLYPHS[t] + '<span>' + typeNames[t] + '</span></div>'
    ).join('');

    // oblasti sú klikateľné filtre — riadok prepína viditeľnosť oblasti na plátne
    $('legend-areas').innerHTML = [...S.areas.values()].map((a) => {
        const off = S.filter.areas.has(a.id);
        return '<button type="button" class="legend-row legend-area' + (off ? ' off' : '')
            + '" data-area="' + a.id + '" aria-pressed="' + (off ? 'false' : 'true')
            + '" title="Prepnúť viditeľnosť oblasti">'
            + '<span class="swatch" style="background:' + esc(a.color)
            + ';box-shadow:0 0 6px ' + esc(a.color) + '"></span>'
            + '<span class="la-name">' + esc(a.name) + '</span>'
            + '<span class="ms la-eye" aria-hidden="true">' + (off ? 'visibility_off' : 'visibility') + '</span>'
            + '</button>';
    }).join('');

    $('legend-areas').querySelectorAll('.legend-area').forEach((row) => {
        row.onclick = () => {
            const id = +row.dataset.area;
            const off = !S.filter.areas.has(id);
            if (off) S.filter.areas.add(id); else S.filter.areas.delete(id);
            row.classList.toggle('off', off);
            row.setAttribute('aria-pressed', off ? 'false' : 'true');
            row.querySelector('.la-eye').textContent = off ? 'visibility_off' : 'visibility';
            persistFilter();
            draw();
        };
    });

    const strengthEl = $('legend-strength');
    if (strengthEl) {
        strengthEl.innerHTML = '<div class="legend-row legend-strength">'
            + [6, 10, 14].map((d) =>
                '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="' + (d / 2) + '" fill="var(--muted)"/></svg>'
            ).join('')
            + '<span class="cap">slabšia → silnejšia</span></div>';
    }

    // A10 + FÁZA HRANY: druhy spojení — jedna ink farba, rozlíšenie štýlom čiary.
    // relation (part_of kostra, uses) má prednosť pred kind (aktivácia, podobnosť).
    const connEl = $('legend-connections');
    if (connEl) {
        const line = (dash, w) =>
            '<svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">'
            + '<line x1="1" y1="5" x2="25" y2="5" stroke="var(--muted)" stroke-width="' + (w || 1.4) + '"'
            + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
        connEl.innerHTML =
            '<div class="legend-row">' + line('', 1) + '<span>Kostra · part_of</span></div>'
            + '<div class="legend-row">' + line('') + '<span>Ručné · silné</span></div>'
            + '<div class="legend-row">' + line('6 4') + '<span>Použitie · uses</span></div>'
            + '<div class="legend-row">' + line('5 3') + '<span>Spoločná aktivácia</span></div>'
            + '<div class="legend-row">' + line('1.5 3') + '<span>Podobnosť</span></div>';
    }
}

export function closeNodePanel() {
    S.selected = null;
    createMode = false;
    $('edit-type-row').classList.add('hidden');
    $('node-panel').classList.add('hidden');
    requestDraw(); // zrušený výber → prekresli (zmizne zvýraznenie)
}
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
                kickSim();
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
        kickSim();
        updateHeaderMetrics();
        draw();
        showToast('Spojenie zrušené');
        if (S.selected) selectNode(S.selected);
    } catch (err) {
        showToast('Zrušenie sa nepodarilo');
    }
}

/* ---------- nový uzol (create mode v paneli uzla) ---------- */

export let createMode = false;

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
            kickSim();
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
export async function refreshStats() {
    let st;
    try {
        const res = await fetch('/api/mind/stats');
        st = await res.json();
    } catch (e) {
        renderEmpty($('stats-cards'), 'cloud_off', 'Nepodarilo sa načítať');
        return;
    }

    const card = (label, value, sub) =>
        '<div class="metric"><div class="metric-val">' + value + '</div>'
        + '<div class="metric-label">' + label + '</div>'
        + (sub ? '<div class="metric-sub">' + sub + '</div>' : '') + '</div>';

    const w = st.week || {};
    $('stats-cards').innerHTML =
        card('uzlov', st.totals.nodes, '+' + (w.new_nodes || 0) + ' tento týždeň')
        + card('skillov', st.totals.skills || 0, '')
        + card('záznamov', st.totals.sessions || 0, '+' + (w.new_sessions || 0) + ' tento týždeň')
        + card('spojení', st.totals.edges, '');

    $('stats-recent').innerHTML = (st.recent_records || []).map((r) =>
        '<button type="button" class="mini-record" data-id="' + r.id + '">'
        + '<span class="ms" aria-hidden="true">article</span>'
        + '<span class="mr-title">' + esc(r.label) + '</span>'
        + '<span class="mr-time">' + timeAgo(r.created_at) + '</span></button>'
    ).join('') || emptyHtml('receipt_long', 'Zatiaľ žiadne záznamy');

    $('stats-recent').querySelectorAll('.mini-record').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (n) { S.cam.k = Math.max(S.cam.k, 1); focusNode(n); selectNode(n); }
        };
    });

    $('stats-areas').innerHTML = [...S.areas.values()].map((a) =>
        '<div class="stat-row"><span><span class="swatch" style="background:' + a.color + '"></span>'
        + esc(a.name) + '</span><span class="val">' + (st.by_area[a.id] || 0) + '</span></div>'
    ).join('');

    $('stats-top').innerHTML = st.top_nodes.map(
        (n) => row(esc(n.label), n.strength.toFixed(0))
    ).join('') || emptyHtml('leaderboard', 'Zatiaľ žiadne uzly');

    const gc = $('growth-chart');
    const dpr = window.devicePixelRatio || 1;
    if (gc.clientWidth > 0) {
        gc.width = gc.clientWidth * dpr;
        gc.height = 60 * dpr;
    }
    const gctx = gc.getContext('2d');
    gctx.clearRect(0, 0, gc.width, gc.height);
    if (st.growth.length) {
        const max = Math.max(...st.growth.map((g) => g.count));
        const bw = gc.width / Math.max(st.growth.length, 10);
        st.growth.forEach((g, i) => {
            const h = (g.count / max) * (gc.height - 6 * dpr);
            gctx.fillStyle = '#03797e';
            gctx.globalAlpha = 0.9;
            gctx.fillRect(i * bw + dpr, gc.height - h, Math.max(bw - 2 * dpr, 2), h);
        });
    }

    function row(k, v) {
        return '<div class="stat-row"><span>' + k + '</span><span class="val">' + v + '</span></div>';
    }
}
