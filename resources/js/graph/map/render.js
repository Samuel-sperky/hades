/* Kreslenie radiálnej MAPY na existujúce plátno (canvas 2D).

   Prenáša LOGIKU prototypu (SVG) na canvas render pipeline projektu: rovnaká
   kamera transformácia ako render/draw.js (S.cam), farby z Aura tokenov (T) a
   z dát oblastí (nodeColor / area.color), veľkosť uzla = strength, hrany na
   úrovni mapy len ŠTRUKTÚRNE (jadro→oblasť→oddelenie), listy až po zanorení.

   Zvýraznenie (lit/dim) sa počíta zo stavu (map/state.js), nie z DOM tried. */

import { ts } from '../../core/format.js';
import { S } from '../../core/state/index.js';
import { canvas, ctx } from '../canvas-el.js';
import { T } from '../canvas-colors.js';
import { CORE_COLOR, nodeColor } from '../colors.js';
import { AREA_R } from './layout.js';
import { coreMini } from './core-mini.js';
import { getMapState } from './state.js';
import { getRot, rotatePoint } from './rotation.js';
import { introActive, introProgress } from './intro.js';
import { mapLayout } from './layout.js';


const DIM = 0.12;
const AREA_HUB_R = 15;
const DEPT_DOT_R = 6;


// „Dnes aktívne" — množina id uzlov s last_activated_at == dnes (klient). Memo na S.nodes.
let _todayFor = null, _todaySet = null;
function todaySet() {
    if (_todayFor === S.nodes) return _todaySet;
    const set = new Set();
    const d = new Date();
    const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
    for (const n of S.nodes) {
        if (!n.last_activated_at) continue;
        const t = new Date(ts(n.last_activated_at));
        if (t.getFullYear() === y && t.getMonth() === m && t.getDate() === day) set.add(n.id);
    }
    _todayFor = S.nodes; _todaySet = set;
    return set;
}


function edgeReveal(p, dist, maxDist) {
    if (p >= 1) return 1;
    const norm = maxDist > 0 ? dist / maxDist : 0;
    return Math.max(0, Math.min(1, (p - norm * 0.35) / 0.65));
}


export function drawMap() {
    const lay = mapLayout();
    const st = getMapState();
    const rot = getRot();
    const rp = (el) => rotatePoint(el.bx, el.by);
    const p = introActive() ? introProgress() : 1;
    const nodeGrow = p; // uzly nabiehajú so scale

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);
    const invK = 1 / S.cam.k;

    // viditeľnosť podľa úrovne
    const areaLit = (id) => st.level === 'map' || st.level === 'core' ? 1 : (st.areaId === id ? 1 : DIM);
    const deptLit = (dept) => {
        if (st.level === 'map' || st.level === 'core') return 1;
        if (st.level === 'area') return dept.areaId === st.areaId ? 1 : DIM;
        return dept.id === st.deptId ? 1 : (dept.areaId === st.areaId ? 0.28 : DIM);
    };
    const showLeaves = st.level === 'area' || st.level === 'dept' || st.level === 'node';

    const maxDist = AREA_R + 260;

    /* ---------- koncentrické prstence (jemné) ---------- */
    ctx.lineWidth = 0.8 * invK;
    ctx.strokeStyle = 'rgba(' + T.edge + ',' + (0.06 * S.dim) + ')';
    for (const r of [AREA_R * 0.62, AREA_R, AREA_R * 1.42]) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, 7);
        ctx.stroke();
    }

    /* ---------- štruktúrne hrany jadro→oblasť ---------- */
    for (const area of lay.areas) {
        const a = rp(area);
        const rev = edgeReveal(p, Math.hypot(a.x, a.y), maxDist);
        if (rev <= 0) continue;
        const al = areaLit(area.id) * 0.5;
        ctx.strokeStyle = 'rgba(' + T.edge + ',' + (al * S.dim) + ')';
        ctx.lineWidth = 1.4 * invK;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(a.x * rev, a.y * rev);
        ctx.stroke();
    }

    /* ---------- štruktúrne hrany oblasť→oddelenie ---------- */
    for (const dept of lay.depts) {
        const area = lay.areaById.get(dept.areaId);
        if (!area) continue;
        const a = rp(area), d = rp(dept);
        const rev = edgeReveal(p, Math.hypot(d.x, d.y), maxDist);
        if (rev <= 0) continue;
        const al = deptLit(dept) * 0.45;
        ctx.strokeStyle = 'rgba(' + T.edge + ',' + (al * S.dim) + ')';
        ctx.lineWidth = 1 * invK;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + (d.x - a.x) * rev, a.y + (d.y - a.y) * rev);
        ctx.stroke();
    }

    /* ---------- listy + ich hrany (len zanorená oblasť) ---------- */
    if (showLeaves) {
        const today = todaySet();
        const area = lay.areaById.get(st.areaId);
        const depts = area ? area.depts : [];
        for (const dept of depts) {
            const d = rp(dept);
            const dl = deptLit(dept);
            for (const leaf of dept.leaves) {
                const l = rp(leaf);
                let lit = dl;
                if (st.level === 'dept') lit = dept.id === st.deptId ? 1 : DIM;
                if (st.level === 'node') {
                    lit = leaf.id === st.nodeId ? 1
                        : (dept.id === st.deptId ? 0.5 : DIM);
                }
                if (lit <= DIM + 0.001 && st.level !== 'area') continue; // šetri kreslenie
                // hrana oddelenie→list
                ctx.strokeStyle = 'rgba(' + T.edge + ',' + (lit * 0.4 * S.dim) + ')';
                ctx.lineWidth = 0.8 * invK;
                ctx.beginPath();
                ctx.moveTo(d.x, d.y);
                ctx.lineTo(l.x, l.y);
                ctx.stroke();

                const str = leaf.node.strength || 1;
                const r = (3.2 + Math.min(str, 10) * 0.55) * nodeGrow;
                ctx.globalAlpha = lit * S.dim;
                ctx.fillStyle = nodeColor(leaf.node);
                ctx.beginPath();
                ctx.arc(l.x, l.y, r, 0, 7);
                ctx.fill();

                // badge „Dnes aktívne"
                if (today.has(leaf.id) && lit > 0.4) {
                    ctx.globalAlpha = lit * S.dim;
                    ctx.strokeStyle = CORE_COLOR;
                    ctx.lineWidth = 1.6 * invK;
                    ctx.beginPath();
                    ctx.arc(l.x, l.y, r + 3.5 * invK, 0, 7);
                    ctx.stroke();
                }
                ctx.globalAlpha = 1;

                // popisok listu (zanorené oddelenie/uzol)
                if (lit >= 0.9 && (st.level === 'dept' || st.level === 'node')) {
                    drawLabel(leaf.node.label, l.x, l.y + r + 11 * invK, invK, lit);
                }
            }
        }
    }

    /* ---------- oddelenia (bodky + popisky) ---------- */
    for (const dept of lay.depts) {
        const d = rp(dept);
        const lit = deptLit(dept);
        const area = lay.areaById.get(dept.areaId);
        const col = area ? colorOf(area) : 'rgb(' + T.muted + ')';
        const rr = DEPT_DOT_R * nodeGrow;
        ctx.globalAlpha = lit * S.dim;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.2 * invK;
        ctx.beginPath();
        ctx.arc(d.x, d.y, rr, 0, 7);
        ctx.stroke();
        ctx.fillStyle = col;
        ctx.globalAlpha = lit * S.dim * 0.85;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2.2 * nodeGrow, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 1;

        // názov oddelenia — na úrovni mapy len pri zvýraznenej oblasti, inak vždy pri zanorení
        const showName = (st.level === 'area' && dept.areaId === st.areaId)
            || (st.level === 'dept' || st.level === 'node') && dept.areaId === st.areaId;
        if (showName && lit > 0.2) {
            drawLabel(dept.name, d.x, d.y - rr - 6 * invK, invK, lit, true);
        }
    }

    /* ---------- huby oblastí ---------- */
    for (const area of lay.areas) {
        const a = rp(area);
        const lit = areaLit(area.id);
        const col = colorOf(area);
        const r = AREA_HUB_R * nodeGrow;
        // halo
        ctx.globalAlpha = 0.10 * lit * S.dim;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r * 1.9, 0, 7);
        ctx.fill();
        // disk
        ctx.globalAlpha = lit * S.dim;
        ctx.fillStyle = T.paper;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, 7);
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.6 * invK;
        ctx.stroke();
        // aktívna oblasť (mapa) — zvýraznený prstenec
        if (st.level === 'map' && area.id === st.activeAreaId) {
            ctx.strokeStyle = CORE_COLOR;
            ctx.lineWidth = 2 * invK;
            ctx.beginPath();
            ctx.arc(a.x, a.y, r + 5 * invK, 0, 7);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        // názov oblasti
        if (lit > 0.3 || st.level === 'map') {
            const away = 1 + (AREA_HUB_R + 26) / (Math.hypot(a.x, a.y) || 1);
            drawAreaLabel(area.name, a.x * away, a.y * away, invK, lit, area.leafCount);
        }
    }

    /* ---------- stredové jadro (miniatúra + ♛) ---------- */
    drawCore(lay, invK, st, rot, p);

    ctx.globalAlpha = 1;
}


function colorOf(area) {
    // farba oblasti z dát (theme-aware cez nodeColor s falošným uzlom)
    return nodeColor({ type: 'skill', area_id: area.id });
}


function drawCore(lay, invK, st, rot, p) {
    const mini = coreMini(lay);
    const expanded = st.level === 'core';
    const scale = expanded ? 3.4 : 1;
    const coreAlpha = (st.level === 'map' || st.level === 'core') ? 1 : 0.28;

    ctx.save();
    ctx.globalAlpha = coreAlpha * S.dim * Math.min(1, p * 1.2);
    // zhluk sa jemne stáča s rotáciou konštelácie (bez ambientnej slučky — mapa je
    // dirty-driven, W1 nemá prach/halo, takže CPU spí keď sa nič nedeje)
    ctx.rotate(rot * 0.2);
    ctx.scale(scale, scale);
    for (const pt of mini.pts) {
        ctx.fillStyle = nodeColor({ type: 'skill', area_id: pt.areaId });
        ctx.globalAlpha = coreAlpha * S.dim * 0.7 * Math.min(1, p * 1.2);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.r, 0, 7);
        ctx.fill();
    }
    ctx.restore();

    // jadro-uzol (♛) — zlatý stred s jemným halo (statické, bez ambientu)
    ctx.globalAlpha = S.dim * Math.min(1, p * 1.2);
    ctx.fillStyle = CORE_COLOR;
    ctx.globalAlpha = 0.16 * S.dim;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, 7);
    ctx.fill();
    ctx.globalAlpha = S.dim * Math.min(1, p * 1.2);
    ctx.fillStyle = T.paper;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, 7);
    ctx.fill();
    ctx.strokeStyle = CORE_COLOR;
    ctx.lineWidth = 1.6 * invK;
    ctx.stroke();
    ctx.fillStyle = CORE_COLOR;
    ctx.font = (16 * invK) + 'px "Playfair Display", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('♛', 0, 1 * invK);
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
}


function drawLabel(text, x, y, invK, alpha, dept) {
    if (!text) return;
    ctx.globalAlpha = Math.min(1, alpha) * S.dim;
    ctx.fillStyle = dept ? 'rgb(' + T.muted + ')' : T.ink;
    ctx.font = ((dept ? 9 : 10.5) * invK) + 'px "Geist", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(truncate(text, 26), x, y);
    ctx.globalAlpha = 1;
}


function drawAreaLabel(text, x, y, invK, alpha, count) {
    ctx.globalAlpha = Math.max(0.35, Math.min(1, alpha)) * S.dim;
    ctx.textAlign = 'center';
    ctx.fillStyle = T.ink;
    ctx.font = '600 ' + (13 * invK) + 'px "Playfair Display", Georgia, serif';
    ctx.fillText(String(text).toUpperCase(), x, y);
    ctx.globalAlpha = 0.5 * S.dim;
    ctx.fillStyle = 'rgb(' + T.muted + ')';
    ctx.font = (8.5 * invK) + 'px "Geist", system-ui, sans-serif';
    ctx.fillText(count + ' uzlov', x, y + 13 * invK);
    ctx.globalAlpha = 1;
}


function truncate(s, n) {
    const a = Array.from(String(s));
    return a.length > n ? a.slice(0, n - 1).join('') + '…' : s;
}


// re-export pre input (hit-testing zdieľa geometriu s renderom)
export { canvas };
