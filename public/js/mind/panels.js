import { spawnPulse } from './anim.js';
import { closeDock } from './dock.js';
import { renderNodeBadges } from './certainty.js';
import { persistFilter, setLocal } from './filters.js';
import { anchorOf } from './layout.js';
import { updatePackUi } from './pack.js';
import { draw, focusNode, requestDraw } from './render.js';
import { buildSim, go, kickSim } from './sim.js';
import { S, canvas } from './state.js';
import { T, mutedColor } from './theme.js';
import { showToast } from './toasts.js';

/* Pod 900 px dostanú dock aj detail uzla v mind.css rovnaké `right: var(--edge)`
   a rovnakú šírku, takže otvorené naraz ležia presne na sebe. V CSS sa to vyriešiť
   nedá — stylesheet nevie, ktorý z nich je práve otvorený. Preto sa vylučujú tu.
   Hranica MUSÍ sedieť s @media (max-width: 900px) v mind.css; keď sa tam zmení,
   zmeň ju aj tu. */
const NARROW = window.matchMedia('(max-width: 900px)');

import { $, busy, emptyCardHtml, esc, nodeColor, plainBlock, plainInline, prettyProject, renderEmpty, timeAgo, typeName, updateHeaderMetrics } from './util.js';

/* ---------- panely ---------- */
export async function selectNode(n) {
    // aktívny lokálny graf sa preväzuje na novo zvolený uzol (Obsidian re-root)
    if (S.local && S.local.rootId !== n.id) setLocal(n.id, S.local.depth);
    closeCreateMode(); // výber uzla vždy vracia panel do detailného režimu
    S.selected = n;
    requestDraw(); // nový výber → prekresli zvýraznenie (slučka mohla spať)
    updatePackUi(); // #node-charon + .pack-btn odzrkadlia členstvo uzla v kontexte doku (A8)
    if (NARROW.matches) closeDock(); // úzke okno: dock a detail ležia na sebe
    $('node-panel').classList.remove('hidden');
    $('node-form').classList.add('hidden');
    $('node-view').classList.remove('hidden');
    $('node-type-label').textContent = typeName(n.type);
    const nc = nodeColor(n); // farba oblasti — typ hovorí tvar, nie farba
    $('node-swatch').style.background = nc;
    $('node-panel').style.setProperty('--node-c', nc);
    /* 21 projektových uzlov nemá vlastný názov a nesie strojový slug
       („adoring-driscoll-6e9398"). Denník na ten istý stav už hovorí „bez projektu";
       panel to teraz hovorí tiež, aby appka na jednu vec nemala dva jazyky. */
    /* plainInline() PRED prettyProject(): labely chodia z DB tak, ako ich zapísal
       Claude Code, teda s `backtickami` okolo identifikátorov — v živých dátach ich
       má päť uzlov (napr. „Bug: `dateOrNull()` in"). Poradie je zámerné, nie náhodné:
       isMachineName() testuje vzor slugu bez interpunkcie, takže obalený slug by mu
       unikol a v paneli by svietil „`adoring-driscoll-6e9398`" namiesto „bez projektu".
       Taký uzol dnes v dátach nie je — je to obrana, nie oprava nálezu. */
    $('node-label').textContent = prettyProject(plainInline(n.label));
    // Popis záznamu je markdown („**Čo:** … **Výsledok:** …"). Panel ho vykresľuje
    // ako text s pre-wrap, takže bez plainBlock() v ňom svietila surová syntax;
    // riadkovanie zostáva, lebo v ňom je štruktúra záznamu.
    $('node-desc').textContent = plainBlock(n.description);
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
        /* Oblasť a oddelenie boli do 20. 8. 2026 obyčajný text, takže panel bol
           slepá ulička: zo suseda sa dalo pokračovať, z vlastnej oblasti nie —
           človek musel panel zavrieť a hľadať ju v strome Štruktúry. Teraz zúžia
           filter rovnako ako breadcrumb, cez go({level, area|dept}). */
        renderNodeMeta(data.node);

        // riadok suseda: chip (navigácia) + × (zrušenie spojenia) — edge id z S.edges podľa páru
        $('node-neighbors').innerHTML = data.neighbors.map((m) => {
            const edge = S.edges.find((x) =>
                (x.source_id === n.id && x.target_id === m.id)
                || (x.source_id === m.id && x.target_id === n.id));
            return '<div class="nb-row">'
                + '<button type="button" class="chip" data-id="' + m.id + '">' + esc(prettyProject(plainInline(m.label))) + '</button>'
                + (edge
                    ? '<button type="button" class="ghost ms nb-del" data-edge="' + edge.id
                        + '" title="Zrušiť spojenie" aria-label="Zrušiť spojenie">close</button>'
                    : '')
                + '</div>';
        }).join('') || emptyCardHtml('Bez spojení');

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
        }).join('') || emptyCardHtml('Zatiaľ žiadna aktivita');
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

    // karta „Možno súvisí" už má nadpis — ikona pod ním hovorí to isté druhýkrát
    if (!list.length) { wrap.innerHTML = emptyCardHtml('Žiadne návrhy'); return; }

    wrap.innerHTML = list.map((s) => {
        const area = S.areas.get(s.area_id);
        const color = area ? mutedColor(area.color) : 'var(--muted)';
        return '<div class="sug-row" data-id="' + s.id + '">'
            + '<span class="swatch" style="background:' + esc(color) + '" aria-hidden="true"></span>'
            + '<span class="sug-label">' + esc(prettyProject(plainInline(s.label))) + '</span>'
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
// Glyfy legendy MUSIA hovoriť ten istý jazyk ako plátno. Od vlny „Graf B" sú uzly
// prstence (priehľadnosť nesie diera, nie nízka alfa), takže plné disky by legenda
// učila nesprávne: spomienka = jeden prstenec, skill = dva súosé, projekt = prstenec
// s plným stredom, jadro = jediný plný, zlatý prvok.
export const TYPE_GLYPHS = {
    memory: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--muted)" stroke-width="1.6"/></svg>',
    skill: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--muted)" stroke-width="1.6"/><circle cx="8" cy="8" r="2.6" fill="none" stroke="var(--muted)" stroke-width="1.2"/></svg>',
    project: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--muted)" stroke-width="1.6"/><circle cx="8" cy="8" r="1.8" fill="var(--muted)"/></svg>',
    core: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="var(--gold)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--gold)" stroke-opacity=".5" stroke-width="1.2"/></svg>',
};

export function buildLegend() {
    /* Názvy typov chodia z typeName() v util.js — JEDEN zdroj pravdy. Tu stála
       siedma kópia toho istého objektu (a s vlastným pravopisom: „Spomienka" veľkým,
       kým TYPE_NAMES má „spomienka"), takže legenda vedela ukázať iné slovo než čipy
       v Kontrole. TYPE_NAMES je zámerne malým — je to vetná podoba pre čipy — takže
       legenda si prvé písmeno zvýrazní sama; to je formátovanie, nie druhý slovník. */
    const cap = (w) => w.charAt(0).toLocaleUpperCase('sk-SK') + w.slice(1);
    $('legend-types').innerHTML = Object.keys(TYPE_GLYPHS).map(
        (t) => '<div class="legend-row">' + TYPE_GLYPHS[t] + '<span>' + esc(cap(typeName(t))) + '</span></div>'
    ).join('');

    // oblasti sú klikateľné filtre — riadok prepína viditeľnosť oblasti na plátne
    $('legend-areas').innerHTML = [...S.areas.values()].map((a) => {
        const off = S.filter.areas.has(a.id);
        return '<button type="button" class="legend-row legend-area' + (off ? ' off' : '')
            + '" data-area="' + a.id + '" aria-pressed="' + (off ? 'false' : 'true')
            + '" title="Prepnúť viditeľnosť oblasti">'
            + '<span class="swatch" style="background:' + esc(mutedColor(a.color))
            + ';box-shadow:0 0 6px ' + esc(mutedColor(a.color)) + '"></span>'
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
        // Sila = POLOMER PRSTENCA, nie plnosť disku. Plné disky tu učili nesprávne:
        // uzly sú od vlny „Graf B" prstence (priehľadnosť nesie diera), presne ako
        // to hovorí komentár nad TYPE_GLYPHS o pár riadkov vyššie.
        strengthEl.innerHTML = '<div class="legend-row legend-strength">'
            + [6, 10, 14].map((d) =>
                '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
                + '<circle cx="8" cy="8" r="' + (d / 2) + '" fill="none" stroke="var(--muted)" stroke-width="1.5"/></svg>'
            ).join('')
            + '<span class="cap">slabšia → silnejšia</span></div>';
    }

    /* FÁZA HRANY → vlna BRAND: legenda musí učiť to, čo plátno KRESLÍ.
       Učila štyri vzory prerušovania, ktoré v celej sieti nikdy nevzniknú:
       drawEdges() zapína dash len v režime `real`, a ten platí pri ≤ 140 uzloch
       v layoute alebo v lokálnom grafe. Po vlne A je v L.pos VŽDY všetkých 1065
       uzlov (zanorenie je filter, nie výmena scény), takže celá sieť ide vždy
       režimom `mesh` = samé plné vlásky. Typ hrany tam nesie JASNOSŤ, konkrétne
       edgeKindDim() v edges.js: part_of / uses / ručné = 1, spoločná aktivácia
       = 0,6, podobnosť = 0,4.

       Tiery preto kódujeme ŠÍRKOU, nie alfou. Alfa by bola vernejšia, ale glyf
       legendy je informačná grafika s prahom 3:1 a --muted pod ~0,7 alfy ho
       nespĺňa (merané: 2,33:1 na tmavej pri 0,55; 2,81:1 na svetlej už pri 0,7).
       Šírka rozdiel ukáže a kontrast nechá nedotknutý.

       Prerušovanie je pravda len v lokálnom grafe uzla (G), preto je z neho
       poznámka pod riadkami, nie hlavný jazyk legendy. */
    const connEl = $('legend-connections');
    if (connEl) {
        /* Šírky boli 2,2 / 1,3 / 0,8 px v 26×10 boxe a tri tiery sa nedali odlíšiť:
           0,8 px je POD podlahou, ktorú si projekt už raz zmeral pri prstencoch uzlov
           (RING_LW = 1,5 px — „pri 1,1 px zoberie antialiasing viac než polovicu
           kontrastu"). Tá istá fyzika platí aj tu, takže najtenšia čiara sedí na
           podlahe 1,5 px a ďalšie dva stupne sú jej celé násobky (×2, ×3). Trojnásobok
           medzi najtenšou a najhrubšou vidí oko bez porovnávania — a každá čiara
           zostáva nad prahom 3:1. Box je 14 px vysoký, aby sa 4,5 px čiara zmestila. */
        const line = (w) =>
            '<svg width="30" height="14" viewBox="0 0 30 14" aria-hidden="true">'
            + '<line x1="1" y1="7" x2="29" y2="7" stroke="var(--muted)" stroke-width="' + w + '"'
            + ' stroke-linecap="round"/></svg>';
        connEl.innerHTML =
            '<div class="legend-row">' + line(4.5) + '<span>Kostra, použitie, ručné</span></div>'
            + '<div class="legend-row">' + line(3) + '<span>Spoločná aktivácia</span></div>'
            + '<div class="legend-row">' + line(1.5) + '<span>Podobnosť</span></div>'
            + '<p class="legend-note">V celej sieti sú spojenia plné a líšia sa jasnosťou.'
            + ' Prerušované vzory podľa typu ukazuje až lokálny graf uzla (G).</p>';
    }
}

/** Meta riadok detailu: oblasť a oddelenie sú navigácia, nie popiska. */
function renderNodeMeta(node) {
    const box = $('node-meta');
    if (!box) return;
    box.textContent = '';

    const sep = () => box.appendChild(document.createTextNode(' · '));
    const crumb = (text, target) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'meta-link';
        b.textContent = text;
        b.onclick = () => go(target);
        box.appendChild(b);
    };

    if (node.area_name && node.area_id != null) {
        crumb(node.area_name, { level: 'area', area: node.area_id });
    } else if (node.area_name) {
        box.appendChild(document.createTextNode(node.area_name));
    }

    if (node.department_name) {
        if (box.childNodes.length) sep();
        if (node.department_id != null) {
            crumb(node.department_name, { level: 'dept', area: node.area_id, dept: node.department_id });
        } else {
            box.appendChild(document.createTextNode(node.department_name));
        }
    }

    if (box.childNodes.length) sep();
    box.appendChild(document.createTextNode('sila ' + node.strength.toFixed(0)));
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
/* POZOR, DNES JE TO MŔTVA CESTA. Sekciu doku `#sec-stats` („Prehľad") zmazal
   nález A10 (24. 8. 2026) a `dock.js` odvtedy `openDock('stats')` PREPOSIELA na
   obrazovku Dnes cez DOCK_ALIAS, takže `dockOpen` už nikdy nenadobudne hodnotu
   `'stats'` — a to je jediná podmienka, pod ktorou `ws.js:179` túto funkciu volá.
   Funkcia zostáva len preto, že ju `ws.js` importuje; zmazať sa musia obe miesta
   naraz, inak modul spadne pri načítaní. Preto tu pribudol aj strážca nižšie:
   kontejnery v DOM nie sú a `$('stats-cards').innerHTML` by hodilo TypeError
   v obsluhe WS správy. */
export async function refreshStats() {
    if (!$('stats-cards')) return;
    let st;
    try {
        const res = await fetch('/api/mind/stats');
        st = await res.json();
    } catch (e) {
        renderEmpty($('stats-cards'), 'cloud_off', 'Nepodarilo sa načítať prehľad', 'Skús obnoviť stránku.');
        return;
    }

    /* D9: jedna rodina pre „číslo s popiskom". Toto bola `.metric-*`, teda druhá
       rodina pre to isté, čo `.kpi-*` na obrazovkách; ostáva `.kpi-*` a dvojriadková
       podoba je modifikátor `--block`. Mriežka `#stats-cards` musí mať pri oživení
       aj `.kpi-grid .kpi-grid--pair` — `auto-fit` dá v 300px paneli jeden stĺpec. */
    const card = (label, value, sub) =>
        '<div class="kpi-card kpi-card--block"><div class="kpi-val">' + value + '</div>'
        + '<div class="kpi-label">' + label + '</div>'
        + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';

    const w = st.week || {};
    $('stats-cards').innerHTML =
        card('uzlov', st.totals.nodes, '+' + (w.new_nodes || 0) + ' tento týždeň')
        + card('skillov', st.totals.skills || 0, '')
        + card('záznamov', st.totals.sessions || 0, '+' + (w.new_sessions || 0) + ' tento týždeň')
        + card('spojení', st.totals.edges, '');

    $('stats-recent').innerHTML = (st.recent_records || []).map((r) =>
        '<button type="button" class="mini-record" data-id="' + r.id + '">'
        + '<span class="ms" aria-hidden="true">article</span>'
        + '<span class="mr-title">' + esc(prettyProject(plainInline(r.label))) + '</span>'
        + '<span class="mr-time">' + timeAgo(r.created_at) + '</span></button>'
    ).join('') || emptyCardHtml('Zatiaľ žiadne záznamy');

    $('stats-recent').querySelectorAll('.mini-record').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (n) { S.cam.k = Math.max(S.cam.k, 1); focusNode(n); selectNode(n); }
        };
    });

    $('stats-areas').innerHTML = [...S.areas.values()].map((a) =>
        '<div class="stat-row"><span><span class="swatch" style="background:' + esc(mutedColor(a.color)) + '"></span>'
        + esc(a.name) + '</span><span class="val">' + (st.by_area[a.id] || 0) + '</span></div>'
    ).join('');

    $('stats-top').innerHTML = st.top_nodes.map(
        (n) => row(esc(prettyProject(plainInline(n.label))), n.strength.toFixed(0))
    ).join('') || emptyCardHtml('Zatiaľ žiadne uzly');

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
            // akcent z témy, nie zadrôtovaný hex — inak sparkline zostane pri starej
            // farbe a na tmavej téme stmavne do nečitateľna
            gctx.fillStyle = `rgb(${T.accent})`;
            gctx.globalAlpha = 0.9;
            gctx.fillRect(i * bw + dpr, gc.height - h, Math.max(bw - 2 * dpr, 2), h);
        });
    }

    function row(k, v) {
        return '<div class="stat-row"><span>' + k + '</span><span class="val">' + v + '</span></div>';
    }
}
