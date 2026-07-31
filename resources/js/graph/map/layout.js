/* Deterministický radiálny layout MAPY mysle — počítaný NA KLIENTOVI.

   Vzor: docs/PROTOTYP-hades-aura-graf.html (radiálne huby po kruhu, oddelenia ako
   huby okolo oblasti, listy okolo oddelenia). Na rozdiel od prototypu tu máme
   REÁLNE dáta z /api/mind (oblasti majú uhol, oddelenia area_id, listy
   department_id), takže nič nedopočítavame — len rozmiestňujeme.

   Pozície sú BÁZOVÉ (bx, by) — bez rotácie konštelácie. Rotáciu (map/rotation.js)
   aplikuje render až pri kreslení, aby bola mapa tuhé teleso otáčané okolo jadra.

   Layout je čistá funkcia stavu grafu: rovnaké ID → rovnaké pozície medzi
   návštevami (seed z ID, mulberry32). Memoizuje sa na referenciu S.nodes. */

import { rad } from '../../core/format.js';
import { S } from '../../core/state/index.js';
import { seededRand } from './prng.js';


// Geometria (world jednotky). Vzdialenosti volené tak, aby sa 5 oblastí × ~15
// oddelení nekrylo a jadro-miniatúra mala okolo seba dýchací priestor.
export const AREA_R = 320;     // oblasť (hub) od jadra
export const DEPT_R = 128;     // oddelenie od hubu oblasti
export const DEPT_R_JITTER = 30;
export const LEAF_MIN = 30;    // najbližší list od oddelenia
export const LEAF_SPAN = 58;
export const LEAF_FAN = 1.45;  // uhlový rozptyl listov (rad)
export const LEAF_RING = 22;   // prírastok polomeru na ďalší „prstenec" listov
export const CORE_MINI_R = 74; // polomer jadra-miniatúry


let _cache = null;
let _cacheFor = null;


/** Postaví (a nacachuje) layout mapy z aktuálneho stavu grafu. */
export function mapLayout() {
    if (_cache && _cacheFor === S.nodes) return _cache;

    const areasRaw = [...S.areas.values()];
    const n = areasRaw.length || 1;

    const areas = [];
    const areaById = new Map();
    areasRaw.forEach((a, i) => {
        const angleDeg = a.angle != null ? a.angle : (i * 360) / n;
        const ang = rad(angleDeg);
        const area = {
            id: a.id,
            name: a.name,
            slug: a.slug,
            color: a.color,
            ang,
            bx: Math.cos(ang) * AREA_R,
            by: Math.sin(ang) * AREA_R,
            depts: [],
            leafCount: 0,
        };
        areas.push(area);
        areaById.set(a.id, area);
    });

    // oddelenia zoskupené podľa oblasti (stabilné poradie podľa id)
    const deptsByArea = new Map();
    for (const d of S.departments.values()) {
        if (!areaById.has(d.area_id)) continue;
        let arr = deptsByArea.get(d.area_id);
        if (!arr) { arr = []; deptsByArea.set(d.area_id, arr); }
        arr.push(d);
    }
    for (const arr of deptsByArea.values()) arr.sort((p, q) => p.id - q.id);

    const depts = [];
    const deptById = new Map();
    const span = ((Math.PI * 2) / n) * 0.9;

    for (const area of areas) {
        const arr = deptsByArea.get(area.id) || [];
        arr.forEach((d, di) => {
            const frac = arr.length <= 1 ? 0.5 : di / (arr.length - 1);
            const r = seededRand(d.id * 2654435761);
            const ang = area.ang - span / 2 + span * frac + (r() - 0.5) * 0.06;
            const dr = DEPT_R + r() * DEPT_R_JITTER;
            const dept = {
                id: d.id,
                areaId: area.id,
                name: d.name,
                slug: d.slug,
                ang,               // smer von od hubu (kam rastú listy)
                bx: area.bx + Math.cos(ang) * dr,
                by: area.by + Math.sin(ang) * dr,
                leaves: [],
                todayCount: 0,
            };
            depts.push(dept);
            deptById.set(d.id, dept);
            area.depts.push(dept);
        });
    }

    // listy = uzly s department_id (mimo jadra) okolo svojho oddelenia
    const leaves = [];
    const leafByNode = new Map();
    const perDept = new Map();
    for (const node of S.nodes) {
        if (node.type === 'core' || node.department_id == null) continue;
        const dept = deptById.get(node.department_id);
        if (!dept) continue;
        let idx = perDept.get(dept.id) || 0;
        const r = seededRand((node.id + 1) * 40503);
        const ang = dept.ang + (r() * 2 - 1) * LEAF_FAN;
        const dist = LEAF_MIN + r() * LEAF_SPAN + Math.floor(idx / 6) * LEAF_RING;
        const leaf = {
            id: node.id,
            node,
            deptId: dept.id,
            areaId: dept.areaId,
            bx: dept.bx + Math.cos(ang) * dist,
            by: dept.by + Math.sin(ang) * dist,
        };
        leaves.push(leaf);
        leafByNode.set(node.id, leaf);
        dept.leaves.push(leaf);
        idx += 1;
        perDept.set(dept.id, idx);
    }

    for (const area of areas) {
        area.leafCount = area.depts.reduce((s, d) => s + d.leaves.length, 0);
    }

    _cache = { areas, areaById, depts, deptById, leaves, leafByNode, coreR: CORE_MINI_R };
    _cacheFor = S.nodes;
    return _cache;
}


/** Zruší cache (po reloade grafu). */
export function invalidateMapLayout() {
    _cache = null;
    _cacheFor = null;
}
