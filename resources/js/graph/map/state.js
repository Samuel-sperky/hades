/* Stavový stroj MAPY — 4 úrovne: mapa → oblasť → oddelenie → uzol (+ 'core').

   Jeden vstupný bod go({level, area, dept, node}) riadi:
     · čo je zvýraznené (render.js číta getMapState()),
     · kam letí kamera (map/camera.js, tweenované fit),
     · rotáciu konštelácie (map/rotation.js),
     · breadcrumb v hlavičke (#breadcrumb) + súrodenecké šípky,
     · hash routing (#mapa/… — map/hash.js), aby fungoval back button a deep-link.

   Úroveň 'core' je expand jadra-miniatúry (klik na jadro) — vizuálny bonus bez
   vlastného hashu, back sa vracia na 'mapa'. */

import { esc } from '../../core/dom.js';
import { S } from '../../core/state/index.js';
import { requestDraw } from '../render/frame.js';
import { K_MAX } from '../render/zoom.js';
import { mapFitPoints, mapCamTo } from './camera.js';
import { formatHash, parseHash } from './hash.js';
import { mapLayout } from './layout.js';
import {
    bottomAreaId, getRot, rotateAreaToBottom, rotatePoint,
} from './rotation.js';


const LEVELS = ['map', 'area', 'dept', 'node', 'core'];

let state = { level: 'map', areaId: null, deptId: null, nodeId: null, activeAreaId: null };
let suppressHash = false;


export function getMapState() { return state; }


function rp(el) { return rotatePoint(el.bx, el.by); }


/* ---------- prechody ---------- */

export function mapGo(next, opts = {}) {
    const lay = mapLayout();
    const animate = opts.animate !== false;
    let level = LEVELS.includes(next.level) ? next.level : 'map';

    let areaId = next.area != null ? next.area : state.areaId;
    let deptId = next.dept != null ? next.dept : state.deptId;
    let nodeId = next.node != null ? next.node : state.nodeId;

    // odvodenie kontextu z nižšej úrovne (dept → area, node → dept → area)
    if (level === 'node' && nodeId != null) {
        const leaf = lay.leafByNode.get(nodeId);
        if (leaf) { deptId = leaf.deptId; areaId = leaf.areaId; }
        else level = 'map';
    }
    if (level === 'dept' && deptId != null) {
        const dept = lay.deptById.get(deptId);
        if (dept) areaId = dept.areaId; else level = 'map';
    }
    if (level === 'map' || level === 'core') { areaId = null; deptId = null; nodeId = null; }
    if (level === 'area') { deptId = null; nodeId = null; }
    if (level === 'dept') nodeId = null;

    state = { level, areaId, deptId, nodeId, activeAreaId: state.activeAreaId };

    // aktívna oblasť dole; pri zanorení rotuj OKAMŽITE, nech fit kamery sedí na finálnu rotáciu
    if (level !== 'map' && level !== 'core' && areaId != null) {
        const area = lay.areaById.get(areaId);
        if (area) { rotateAreaToBottom(area.ang, true); state.activeAreaId = areaId; }
    }

    aimCamera(lay, animate);
    renderMapBreadcrumb();
    updateArrows();
    if (!suppressHash && !opts.fromHash) writeHash();
    requestDraw();
}


export function mapBack() {
    if (state.level === 'node') mapGo({ level: 'dept', dept: state.deptId });
    else if (state.level === 'dept') mapGo({ level: 'area', area: state.areaId });
    else if (state.level === 'area' || state.level === 'core') mapGo({ level: 'map' });
}


/* Súrodenecká navigácia ‹ › podľa aktuálnej úrovne. */
export function mapSibling(dir) {
    const lay = mapLayout();
    if (state.level === 'map') { rotateAreaStep(dir); return; }
    if (state.level === 'area') {
        const list = lay.areas;
        const i = list.findIndex((a) => a.id === state.areaId);
        if (i < 0) return;
        const a = list[(i + dir + list.length) % list.length];
        mapGo({ level: 'area', area: a.id });
    } else if (state.level === 'dept') {
        const area = lay.areaById.get(state.areaId);
        if (!area || !area.depts.length) return;
        const i = area.depts.findIndex((d) => d.id === state.deptId);
        const d = area.depts[(i + dir + area.depts.length) % area.depts.length];
        mapGo({ level: 'dept', dept: d.id });
    } else if (state.level === 'node') {
        const dept = lay.deptById.get(state.deptId);
        if (!dept || !dept.leaves.length) return;
        const i = dept.leaves.findIndex((l) => l.id === state.nodeId);
        const l = dept.leaves[(i + dir + dept.leaves.length) % dept.leaves.length];
        mapGo({ level: 'node', node: l.id });
    }
}


/* Rotácia mapy o jednu oblasť (šípky na úrovni mapy). */
function rotateAreaStep(dir) {
    const lay = mapLayout();
    if (!lay.areas.length) return;
    const sorted = [...lay.areas].sort((a, b) => a.ang - b.ang);
    const curId = state.activeAreaId != null ? state.activeAreaId : bottomAreaId(lay.areas);
    let i = sorted.findIndex((a) => a.id === curId);
    if (i < 0) i = 0;
    const a = sorted[(i + dir + sorted.length) % sorted.length];
    state.activeAreaId = a.id;
    rotateAreaToBottom(a.ang);
    updateArrows();
    requestDraw();
}


/* ---------- kamera per úroveň ---------- */

function aimCamera(lay, animate) {
    const ms = animate ? 760 : 0;
    if (state.level === 'core') {
        mapCamTo(Math.min(2.2, (Math.min(S.w, S.h) || 800) / 360), 0, 0, ms);
        return;
    }
    const pts = [];
    if (state.level === 'map') {
        pts.push({ x: 0, y: 0 });
        for (const a of lay.areas) pts.push(rp(a));
        for (const d of lay.depts) pts.push(rp(d));
        mapFitPoints(pts, 150, ms, 1.15);
    } else if (state.level === 'area') {
        const area = lay.areaById.get(state.areaId);
        if (!area) return;
        pts.push({ x: 0, y: 0 }, rp(area));
        for (const d of area.depts) { pts.push(rp(d)); for (const l of d.leaves) pts.push(rp(l)); }
        mapFitPoints(pts, 140, ms, 1.4);
    } else if (state.level === 'dept') {
        const dept = lay.deptById.get(state.deptId);
        if (!dept) return;
        pts.push(rp(dept));
        const area = lay.areaById.get(dept.areaId);
        if (area) pts.push(rp(area));
        for (const l of dept.leaves) pts.push(rp(l));
        mapFitPoints(pts, 130, ms, 2.0);
    } else if (state.level === 'node') {
        const leaf = lay.leafByNode.get(state.nodeId);
        if (!leaf) return;
        pts.push(rp(leaf));
        const dept = lay.deptById.get(leaf.deptId);
        if (dept) {
            pts.push(rp(dept));
            for (const l of dept.leaves) pts.push(rp(l));
        }
        mapFitPoints(pts, 120, ms, K_MAX);
    }
}


/** Po zmene rotácie/rozmeru prepočítaj cieľ kamery bez zmeny úrovne. */
export function reaimCamera(animate = false) { aimCamera(mapLayout(), animate); }


/* ---------- breadcrumb ---------- */

export function renderMapBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const lay = mapLayout();
    const area = state.areaId != null ? lay.areaById.get(state.areaId) : null;
    const dept = state.deptId != null ? lay.deptById.get(state.deptId) : null;
    const leaf = state.nodeId != null ? lay.leafByNode.get(state.nodeId) : null;

    const parts = [];
    const rootCurrent = state.level === 'map' || state.level === 'core';
    parts.push(rootCurrent
        ? '<span class="current">Mapa</span>'
        : '<button type="button" class="crumb" data-map-bc="map">Mapa</button>');

    if (area) {
        const cur = state.level === 'area';
        parts.push('<span class="sep">/</span>');
        parts.push(cur
            ? '<span class="current">' + esc(area.name) + '</span>'
            : '<button type="button" class="crumb" data-map-bc="area">' + esc(area.name) + '</button>');
    }
    if (dept) {
        const cur = state.level === 'dept';
        parts.push('<span class="sep">/</span>');
        parts.push(cur
            ? '<span class="current">' + esc(dept.name) + '</span>'
            : '<button type="button" class="crumb" data-map-bc="dept">' + esc(dept.name) + '</button>');
    }
    if (leaf) {
        parts.push('<span class="sep">/</span>');
        parts.push('<span class="current">' + esc(leaf.node.label || ('Uzol #' + leaf.id)) + '</span>');
    }

    bc.innerHTML = parts.join('');
    bc.querySelectorAll('.crumb[data-map-bc]').forEach((b) => {
        b.onclick = () => {
            const to = b.dataset.mapBc;
            if (to === 'map') mapGo({ level: 'map' });
            else if (to === 'area') mapGo({ level: 'area', area: state.areaId });
            else if (to === 'dept') mapGo({ level: 'dept', dept: state.deptId });
        };
    });
}


/* ---------- šípky ‹ › (DOM) ---------- */

let arrowPrev = null, arrowNext = null;


export function bindArrows(prevEl, nextEl) {
    arrowPrev = prevEl; arrowNext = nextEl;
    arrowPrev.onclick = () => mapSibling(-1);
    arrowNext.onclick = () => mapSibling(1);
    updateArrows();
}


function updateArrows() {
    if (!arrowPrev) return;
    // šípky sú aktívne na každej úrovni (mapa=rotácia oblastí, inde=súrodenci)
    const on = S.screen === 'graf' && state.level !== 'core';
    arrowPrev.classList.toggle('on', on);
    arrowNext.classList.toggle('on', on);
    const label = state.level === 'map' ? 'oblasť'
        : state.level === 'area' ? 'oblasť'
            : state.level === 'dept' ? 'oddelenie' : 'uzol';
    arrowPrev.setAttribute('aria-label', 'Predošlá ' + (label === 'uzol' ? 'položka' : label));
    arrowNext.setAttribute('aria-label', 'Ďalšia ' + (label === 'uzol' ? 'položka' : label));
}

export { updateArrows };


/* ---------- hash routing ---------- */

function writeHash() {
    const lay = mapLayout();
    const area = state.areaId != null ? lay.areaById.get(state.areaId) : null;
    const dept = state.deptId != null ? lay.deptById.get(state.deptId) : null;
    const h = formatHash(state, area, dept);
    if (('#' + location.hash.replace(/^#/, '')) !== ('#' + h.replace(/^#/, ''))) {
        history.pushState(null, '', h);
    }
}


/** Aplikuj stav z aktuálneho hashu (deep-link / back button). */
export function applyHash(opts = {}) {
    const lay = mapLayout();
    const parsed = parseHash(location.hash, lay);
    suppressHash = true;
    mapGo({ ...parsed, ...{} }, { fromHash: true, animate: opts.animate !== false });
    suppressHash = false;
}


/** Prvá inicializácia mapy: obnov stav z hashu, alebo štart na 'mapa'. */
export function initMapState() {
    const lay = mapLayout();
    if (location.hash && /^#mapa/i.test(location.hash)) {
        const parsed = parseHash(location.hash, lay);
        suppressHash = true;
        mapGo(parsed, { fromHash: true, animate: false });
        suppressHash = false;
    } else {
        // predvolená aktívna oblasť dole = najsilnejšia (najviac uzlov)
        let top = null;
        for (const a of lay.areas) if (!top || a.leafCount > top.leafCount) top = a;
        if (top) { state.activeAreaId = top.id; rotateAreaToBottom(top.ang); }
        mapGo({ level: 'map' }, { animate: false });
    }
}


// re-export pre render/loop
export { getRot };
