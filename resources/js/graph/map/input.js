/* Vstupná vrstva MAPY (myš + klávesnica), oddelená od starého graph/input.js.

   · klik na jadro / hub oblasti / oddelenie / list = zanorenie (go)
   · klik do prázdna = o úroveň späť
   · drag na úrovni mapy = rotácia konštelácie; hlbšie = pan kamery
   · koliesko = zoom (cez zdieľané zoomAt)
   · šípky ‹ › + klávesy Left/Right = súrodenci, Esc/Up = späť, Down = zanoriť

   Hit-testing zdieľa geometriu s renderom: bod obrazovky → world (screenToWorld) →
   odrotovanie na bázové súradnice layoutu → najbližší prvok. */

import { S } from '../../core/state/index.js';
import { canvas } from '../canvas-el.js';
import { screenToWorld, zoomAt } from '../camera.js';
import { requestDraw } from '../render/frame.js';
import { isMapActive } from './active.js';
import { cancelMapCam } from './camera.js';
import { mapLayout } from './layout.js';
import { getMapState, mapBack, mapGo, mapSibling } from './state.js';
import { getRot, nudgeRot } from './rotation.js';

const SLOP = 4;
const ROT_PER_PX = 0.005;
const CORE_HIT = 24;


function baseAt(px, py) {
    const w = screenToWorld(px, py);
    const rot = getRot();
    const c = Math.cos(-rot), s = Math.sin(-rot);
    return { x: w.x * c - w.y * s, y: w.x * s + w.y * c };
}


function pickMap(px, py) {
    const lay = mapLayout();
    const st = getMapState();
    const b = baseAt(px, py);

    // listy — len keď sú zobrazené (zanorená oblasť)
    if (st.level === 'area' || st.level === 'dept' || st.level === 'node') {
        const area = lay.areaById.get(st.areaId);
        if (area) {
            let best = null, bestD = 16 * 16;
            for (const dept of area.depts) {
                for (const leaf of dept.leaves) {
                    const dx = leaf.bx - b.x, dy = leaf.by - b.y;
                    const dd = dx * dx + dy * dy;
                    if (dd < bestD) { bestD = dd; best = leaf; }
                }
            }
            if (best) return { kind: 'leaf', id: best.id };
        }
    }

    // oddelenia
    let bestDept = null, bestDeptD = 18 * 18;
    for (const dept of lay.depts) {
        const dx = dept.bx - b.x, dy = dept.by - b.y;
        const dd = dx * dx + dy * dy;
        if (dd < bestDeptD) { bestDeptD = dd; bestDept = dept; }
    }
    if (bestDept) return { kind: 'dept', id: bestDept.id };

    // huby oblastí
    let bestArea = null, bestAreaD = 26 * 26;
    for (const area of lay.areas) {
        const dx = area.bx - b.x, dy = area.by - b.y;
        const dd = dx * dx + dy * dy;
        if (dd < bestAreaD) { bestAreaD = dd; bestArea = area; }
    }
    if (bestArea) return { kind: 'area', id: bestArea.id };

    // jadro
    if (Math.hypot(b.x, b.y) < CORE_HIT) return { kind: 'core', id: null };
    return { kind: null, id: null };
}


function activate(hit) {
    const st = getMapState();
    if (!hit || hit.kind === null) { mapBack(); return; }
    if (hit.kind === 'core') { st.level === 'core' ? mapBack() : mapGo({ level: 'core' }); return; }
    if (hit.kind === 'area') { mapGo({ level: 'area', area: hit.id }); return; }
    if (hit.kind === 'dept') { mapGo({ level: 'dept', dept: hit.id }); return; }
    if (hit.kind === 'leaf') { mapGo({ level: 'node', node: hit.id }); return; }
}


export function setupMapInput() {
    let dragging = false, moved = false, lx = 0, ly = 0, pid = null;

    canvas.addEventListener('pointerdown', (e) => {
        if (!isMapActive() || e.pointerType === 'touch' || e.button !== 0) return;
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY; pid = e.pointerId;
        cancelMapCam();
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* pointer zmizol */ }
        canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isMapActive() || !dragging || e.pointerId !== pid) return;
        const dx = e.clientX - lx, dy = e.clientY - ly;
        if (Math.abs(dx) + Math.abs(dy) > SLOP) moved = true;
        if (getMapState().level === 'map') {
            // rotácia konštelácie dragom (horizontálny pohyb)
            nudgeRot(dx * ROT_PER_PX);
        } else {
            S.cam.x += dx; S.cam.y += dy;
        }
        lx = e.clientX; ly = e.clientY;
        requestDraw();
    });

    const end = (e) => {
        if (!dragging || (pid !== null && e.pointerId !== pid)) return;
        const wasMoved = moved;
        dragging = false; pid = null;
        canvas.classList.remove('dragging');
        if (!wasMoved && isMapActive()) activate(pickMap(e.clientX, e.clientY));
        requestDraw();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { dragging = false; pid = null; canvas.classList.remove('dragging'); });

    canvas.addEventListener('wheel', (e) => {
        if (!isMapActive()) return;
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.pow(1.0015, -e.deltaY));
    }, { passive: false });

    canvas.addEventListener('keydown', (e) => {
        if (!isMapActive()) return;
        switch (e.key) {
            case 'ArrowLeft': mapSibling(-1); break;
            case 'ArrowRight': mapSibling(1); break;
            case 'Escape': case 'ArrowUp': mapBack(); break;
            case 'ArrowDown': descend(); break;
            default: return;
        }
        e.preventDefault();
    });
}


function descend() {
    const lay = mapLayout();
    const st = getMapState();
    if (st.level === 'map') { if (st.activeAreaId != null) mapGo({ level: 'area', area: st.activeAreaId }); }
    else if (st.level === 'area') { const a = lay.areaById.get(st.areaId); if (a && a.depts[0]) mapGo({ level: 'dept', dept: a.depts[0].id }); }
    else if (st.level === 'dept') { const d = lay.deptById.get(st.deptId); if (d && d.leaves[0]) mapGo({ level: 'node', node: d.leaves[0].id }); }
}
