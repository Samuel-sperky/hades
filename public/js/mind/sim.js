import { animLevel } from './anim.js';
import { syncForceSliders } from './forces.js';
import { computeLayout } from './layout.js';
import { draw, fitBBox, fitCam, requestDraw } from './render.js';
import { REDUCED_MOTION, S } from './state.js';
import { renderBreadcrumb } from './util.js';

/* ---------- W2a: STAVOVÝ STROJ ZANORENIA ----------

   Jediný graf, štyri úrovne: 'map' → 'area' → 'dept' → 'node'.
   Vstupný bod je go({ level, area, dept, node }), stav sa čita cez currentPath().
   Pozície sú deterministické (layout.js), d3 simulácia je zrušená — nie je potrebná
   a jej náhodnosť by rozbila požiadavku „rovnaké dáta → rovnaké pozície".
*/

export const LEVEL_ORDER = ['map', 'area', 'dept', 'node'];

/* ---------- pozície ---------- */

// Prenesie vypočítaný layout do n.x/n.y. Uzly mimo úrovne si nechajú staré pozície,
// ale nekreslia sa (render aj pick idú výhradne cez S.layout.pos).
export function applyLayoutPositions(L) {
    for (const n of S.nodes) {
        const e = L.pos.get(n.id);
        if (e) { n.x = e.x; n.y = e.y; }
        else if (n.x === undefined) { n.x = 0; n.y = 0; }
        n.fx = null; n.fy = null;
    }
}

// Spätne kompatibilný názov (volal ho buildSim; iné moduly ho neimportujú).
export function applyViewPins() {
    applyLayoutPositions(computeLayout());
}

/* ---------- normalizácia cieľa ---------- */

function firstAreaId() {
    let best = null, bestC = -1;
    const cnt = new Map();
    for (const n of S.nodes) if (n.area_id != null) cnt.set(n.area_id, (cnt.get(n.area_id) || 0) + 1);
    for (const [id, c] of cnt) if (c > bestC) { best = id; bestC = c; }
    return best;
}

function firstDeptId(areaId) {
    const cnt = new Map();
    for (const n of S.nodes) if (n.department_id) cnt.set(n.department_id, (cnt.get(n.department_id) || 0) + 1);
    let best = null, bestC = -1;
    for (const [id, c] of cnt) {
        const d = S.departments.get(id);
        if (!d || (areaId != null && d.area_id !== areaId)) continue;
        if (c > bestC) { best = id; bestC = c; }
    }
    return best;
}

// Doplní chýbajúci kontext (uzol pozná svoje oddelenie a oblasť) a zhodí úroveň
// nižšie, ak cieľ neexistuje. Graceful — go() sa nikdy nesekne na neplatnom id.
export function clampNav(t) {
    let level = LEVEL_ORDER.includes(t && t.level) ? t.level : 'map';
    let area = t.area != null ? +t.area : null;
    let dept = t.dept != null ? +t.dept : null;
    let node = t.node != null ? +t.node : null;

    if (node != null && S.byId.has(node)) {
        const n = S.byId.get(node);
        if (dept == null && n.department_id) dept = n.department_id;
        if (area == null && n.area_id != null) area = n.area_id;
    }
    if (dept != null && S.departments.has(dept) && area == null) area = S.departments.get(dept).area_id;

    if (level === 'node' && (node == null || !S.byId.has(node))) level = dept != null ? 'dept' : (area != null ? 'area' : 'map');
    if (level === 'dept' && (dept == null || !S.departments.has(dept))) level = area != null ? 'area' : 'map';
    if (level === 'area' && (area == null || !S.areas.has(area))) level = 'map';

    if (level === 'map') { area = null; dept = null; node = null; }
    else if (level === 'area') { dept = null; node = null; }
    else if (level === 'dept') { node = null; }
    return { level, area, dept, node };
}

function navKey(n) { return n.level + ':' + n.area + ':' + n.dept + ':' + n.node; }

// S.focus je od W2a už len zrkadlo úrovne pre breadcrumb a strom štruktúry —
// stmievanie si render/edges počítajú samy z layoutu (ent.dim), nie z focusPass.
function syncFocus(nav) {
    const areaId = nav.level === 'map' ? null : nav.area;
    const deptId = (nav.level === 'dept' || nav.level === 'node') ? nav.dept : null;
    S.focus = { areaId: areaId || null, departmentId: deptId || null };
    S._navFocusKey = S.focus.areaId + ':' + S.focus.departmentId;
}

/* ---------- verejné API ---------- */

// Stupeň uzla (podklad pre nodeRadius) — prepočíta sa raz, buildSim ho obnoví.
function ensureDegree() {
    if (S.degree && S.degree.size) return;
    S.degree = new Map();
    for (const e of S.edges) {
        S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
        S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
    }
}

// Prechod na úroveň. Kamera aj pozície sa tweenujú (ease-in-out cubic, ~600 ms).
export function go(target = {}) {
    ensureDegree();
    const next = clampNav(Object.assign({}, S.nav, target));
    const changed = navKey(next) !== navKey(S.nav);
    const first = !S.layout;
    // klik na už zanorený cieľ nemá trhnúť kamerou — používateľ si ju možno posunul
    if (!changed && !first) { requestDraw(); return next; }

    const animate = changed && S.nodes.length > 0 && !REDUCED_MOTION && animLevel() > 0;
    const from = animate ? new Map() : null;
    if (animate) for (const n of S.nodes) if (n.x != null) from.set(n.id, { x: n.x, y: n.y });
    const camFrom = { x: S.cam.x, y: S.cam.y, k: S.cam.k };

    S.nav = next;
    try { localStorage.setItem('hades.nav', JSON.stringify(next)); } catch (e) { /* full storage — nič */ }
    syncFocus(next);
    S.view = 'graph';

    const L = computeLayout(true);
    applyLayoutPositions(L);
    // fitBBox (nie L.bbox) — zaráta polomer hubov aj miesto na ich popisky, inak by
    // hub na okraji scény vyliezol pod hlavičku
    const camTo = fitCam(fitBBox(L));

    markViewSwitch(next.level);
    renderBreadcrumb();

    if (!animate) {
        S.cam.x = camTo.x; S.cam.y = camTo.y; S.cam.k = camTo.k;
        S._morph = null; S._camTween = null;
        requestDraw();
        return next;
    }

    // uzly, ktoré na predošlej úrovni neboli, priletia z hubu svojho kontextu
    const to = new Map();
    for (const [id, e] of L.pos) to.set(id, { x: e.x, y: e.y });
    const fallback = { x: 0, y: 0 };
    const full = new Map();
    for (const [id, t] of to) full.set(id, from.get(id) || fallback);

    S._camTween = { from: camFrom, to: camTo, t: 0, dur: 0.6 };
    S._morph = { from: full, to, t: 0, dur: 0.6 };
    for (const n of S.nodes) { const f = full.get(n.id); if (f) { n.x = f.x; n.y = f.y; } }
    draw(); // prekresli na štartové pozície, nech cieľ nezabliká pred prvým rAF framom
    requestDraw();
    return next;
}

// Čitateľný stav pre breadcrumb / iné vlny.
export function currentPath() {
    const nav = S.nav;
    const area = nav.area != null ? S.areas.get(nav.area) : null;
    const dept = nav.dept != null ? S.departments.get(nav.dept) : null;
    const node = nav.node != null ? S.byId.get(nav.node) : null;
    const crumbs = [{ level: 'map', label: S.name || 'Hades', id: null }];
    if (area) crumbs.push({ level: 'area', label: area.name, id: area.id });
    if (dept) crumbs.push({ level: 'dept', label: dept.name, id: dept.id });
    if (node) crumbs.push({ level: 'node', label: node.label, id: node.id });
    return {
        level: nav.level,
        area: nav.area, dept: nav.dept, node: nav.node,
        areaName: area ? area.name : null,
        deptName: dept ? dept.name : null,
        nodeName: node ? node.label : null,
        crumbs,
    };
}

// O úroveň von (klik do prázdna, Esc).
export function goUp() {
    const nav = S.nav;
    if (nav.level === 'node') return go({ level: nav.dept != null ? 'dept' : (nav.area != null ? 'area' : 'map') });
    if (nav.level === 'dept') return go({ level: nav.area != null ? 'area' : 'map' });
    if (nav.level === 'area') return go({ level: 'map' });
    return nav;
}

// Zanorenie na to, na čo sa kliklo (hub oblasti / hub oddelenia / uzol).
export function goInto(hit) {
    if (!hit) return goUp();
    if (hit.type === 'areaHub') return go({ level: 'area', area: hit.id });
    if (hit.type === 'deptHub') return go({ level: 'dept', dept: hit.id });
    if (hit.type === 'node') {
        const n = hit.node;
        if (S.nav.level === 'map') return go({ level: 'area', area: n.area_id });
        if (S.nav.level === 'area') {
            if (n.department_id && S.departments.has(n.department_id)) return go({ level: 'dept', dept: n.department_id });
            return go({ level: 'node', node: n.id });
        }
        return go({ level: 'node', node: n.id });
    }
    return S.nav;
}

// #view-switch (tri tlačidlá z minulého sveta) — active class podľa úrovne.
function markViewSwitch(level) {
    const map = { map: 'map', area: 'net', dept: 'layers', node: 'layers' };
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === map[level]);
    });
}

/* ---------- spätná kompatibilita ---------- */

// Legacy vstup z controls.js / shortcuts.js / chat.js. Náhľady sú zrušené, takže
// klávesy 1/2/3 a tri tlačidlá teraz prepínajú ÚROVEŇ: 1 = mapa, 2 = oblasť, 3 = oddelenie.
export function setView(view) {
    if (view === 'map') return go({ level: 'map' });
    if (view === 'net') {
        const a = S.nav.area != null ? S.nav.area : firstAreaId();
        return go({ level: 'area', area: a });
    }
    if (view === 'layers') {
        const a = S.nav.area != null ? S.nav.area : firstAreaId();
        const d = S.nav.dept != null ? S.nav.dept : firstDeptId(a);
        return go({ level: 'dept', area: a, dept: d });
    }
    // main.js volá setView(S.view) na štarte — S.view je 'graph', čo znamená
    // „obnov uložený stav zanorenia" (localStorage 'hades.nav').
    syncForceSliders();
    return go(S.nav);
}

// Prepočet po zmene dát (WS zrod, reload, presun uzla, filtre).
export function buildSim() {
    S.sim = null;   // d3 simulácia zrušená — layout je deterministický

    S.degree = new Map();
    for (const e of S.edges) {
        S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
        S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
    }

    const next = clampNav(S.nav);
    if (navKey(next) !== navKey(S.nav)) { S.nav = next; syncFocus(next); renderBreadcrumb(); }

    const L = computeLayout(true);
    applyLayoutPositions(L);
    syncForceSliders();
    requestDraw();
    return L;
}

// Legacy „nakopnutie simulácie" — bez simulácie stačí prekresliť.
export function kickSim() {
    requestDraw();
}

// Zmena S.focus zvonku (strom štruktúry, Esc, breadcrumb v util.js) → dorovnaj úroveň.
// Volá to render.frame(), takže externý setFocus() naďalej funguje bez zmeny util.js.
export function syncNavFromFocus() {
    const key = S.focus.areaId + ':' + S.focus.departmentId;
    if (key === S._navFocusKey) return false;
    S._navFocusKey = key;
    if (S.focus.departmentId) go({ level: 'dept', area: S.focus.areaId, dept: S.focus.departmentId });
    else if (S.focus.areaId) go({ level: 'area', area: S.focus.areaId });
    else go({ level: 'map' });
    return true;
}
