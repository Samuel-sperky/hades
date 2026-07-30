import { S } from '../core/state/index.js';
import { areaAnchor } from './anchors.js';
import { screenToWorld } from './camera.js';
import { canvas } from './canvas-el.js';
import { setFocus } from './focus.js';
import { updateHoverCard } from './hover-card.js';
import { pick } from './pick.js';
import { emitFlows } from './pulses.js';
import { requestDraw } from './render/frame.js';
import { cancelConnect, createEdge } from '../node/edge-admin.js';
import { closeNodePanel, selectNode } from '../node/node-panel.js';


export function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;
    let dragNode = null; // Obsidian-style grab & fling — ťahanie uzla v mape/sieti

    let lastHoverId = null; // FÁZA ANIMÁCIE: hover na NOVÝ uzol spustí tok po jeho hranách

    canvas.addEventListener('mousedown', (e) => {
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        S._interacting = true; // pauza idle dýchania počas drag/pan
        dragNode = null;
        canvas.style.cursor = ''; // inline kurzor by prebil .grabbing/.dragging z CSS
        if (S.view !== 'layers' && !S.connectFrom) { // pri prepájaní je klik čistý výber cieľa
            const n = pick(e.clientX, e.clientY);
            if (n) {
                dragNode = n;
                n.fx = n.x; n.fy = n.y;
                if (S.sim) S.sim.alphaTarget(0.3).restart();
            }
        }
        canvas.classList.add(dragNode ? 'grabbing' : 'dragging');
        requestDraw(); // začiatok interakcie → zobuď slučku
    });

    // FÁZA ANIMÁCIE (Living): kurzor pre gravitáciu/parallax uzlov. Aktívny len keď NIE je drag/pan
    // (počas ťahania sa gravitácia uvoľní). mouseleave nižšie ju uvoľní pri odchode z plátna.
    canvas.addEventListener('mouseleave', () => { S.cursor.on = false; });

    window.addEventListener('mousemove', (e) => {
        S.cursor.sx = e.clientX; S.cursor.sy = e.clientY;
        S.cursor.on = !dragging;
        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            if (dragNode) {
                const w = screenToWorld(e.clientX, e.clientY);
                dragNode.fx = w.x;
                dragNode.fy = w.y;
            } else {
                S.cam.x += dx; S.cam.y += dy;
            }
            lx = e.clientX; ly = e.clientY;
            requestDraw(); // kamera/ťahaný uzol sa pohli → prekresli
        } else {
            const prevHover = S.hover;
            S.hover = pick(e.clientX, e.clientY);
            // FÁZA ANIMÁCIE (Q10): tok len pri prechode na nový uzol, nie na každý pohyb myšou
            const hid = S.hover ? S.hover.id : null;
            if (hid !== lastHoverId) {
                if (S.hover) emitFlows(S.hover, { tone: 'accent', dim: 0.7, speed: 1.0 });
                lastHoverId = hid;
            }
            if (S.hover !== prevHover) requestDraw(); // zmena hoveru → prekresli zvýraznenie
            // nad uzlom 'grab' (mapa/sieť — dá sa ťahať), vrstvy len klik → pointer
            canvas.style.cursor = S.connectFrom
                ? 'crosshair'
                : (S.hover ? (S.view === 'layers' ? 'pointer' : 'grab') : '');
            updateHoverCard(e);
        }
    });

    window.addEventListener('mouseup', (e) => {
        S._interacting = false; // koniec drag/pan → idle dýchanie sa môže vrátiť
        canvas.classList.remove('dragging');
        canvas.classList.remove('grabbing');
        if (dragNode) {
            // FÁZA RENDER PIPELINE: po pustení uzla sa vráť na alphaTarget 0 — sim dobehne a zastane
            if (S.sim) S.sim.alphaTarget(0);
            if (dragNode.type === 'core' && dragNode.label === S.name) {
                dragNode.fx = 0; dragNode.fy = 0; // hlavné jadro ostáva prišpendlené v strede
            } else {
                // uvoľnenie: sieť — uzol si nechá rýchlosť (fling); mapa — kotvy ho pritiahnu domov
                dragNode.fx = null; dragNode.fy = null;
            }
            dragNode = null;
        }
        if (dragging && !moved) {
            const n = pick(e.clientX, e.clientY);
            if (S.connectFrom) {
                // connect mode: klik na iný uzol prepája, klik do prázdna ruší
                if (n && n.id !== S.connectFrom) createEdge(S.connectFrom, n.id);
                else if (!n) cancelConnect();
            } else if (n) selectNode(n);
            else closeNodePanel();
        }
        dragging = false;
        requestDraw(); // koniec interakcie / zmena výberu → prekresli (a dobehni usadenie sim)
    });

    // Dvojklik pri kotve oblasti (do 260 world-jednotiek) prepína focus mód
    canvas.addEventListener('dblclick', (e) => {
        const w = screenToWorld(e.clientX, e.clientY);
        let best = null, bestD = 260;
        for (const area of S.areas.values()) {
            const a = areaAnchor(area);
            const d = Math.hypot(a.x - w.x, a.y - w.y);
            if (d < bestD) { best = area; bestD = d; }
        }
        if (best) setFocus(S.focus.areaId === best.id ? null : best.id, null);
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = Math.pow(1.0015, -e.deltaY);
        const before = screenToWorld(e.clientX, e.clientY);
        S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
        const after = screenToWorld(e.clientX, e.clientY);
        S.cam.x += (after.x - before.x) * S.cam.k;
        S.cam.y += (after.y - before.y) * S.cam.k;
        requestDraw(); // zoom zmenil kameru → prekresli
    }, { passive: false });

}


export function register(root) {
    setupInput(root);
}
