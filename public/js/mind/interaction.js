import { emitFlows } from './anim.js';
import { localSet, nodeVisible } from './filters.js';
import { drawRadius } from './layout.js';
import { cancelConnect, closeNodePanel, createEdge, selectNode } from './panels.js';
import { requestDraw, visibleInReplay } from './render.js';
import { goInto, goUp } from './sim.js';
import { S, canvas } from './state.js';
import { $, esc } from './util.js';

/* ---------- interakcia ---------- */

export function screenToWorld(px, py) {
    return {
        x: (px - S.w / 2 - S.cam.x) / S.cam.k,
        y: (py - S.h / 2 - S.cam.y) / S.cam.k,
    };
}

// Uzol pod kurzorom — hľadá len medzi uzlami aktuálnej úrovne (S.layout.pos).
// Prach má malý polomer, preto k nemu pridávame štedrý dosah (8 px v obrazovke).
export function pick(px, py) {
    const L = S.layout;
    if (!L) return null;
    const w = screenToWorld(px, py);
    const invK = 1 / S.cam.k;
    const loc = localSet();
    let best = null, bestD = Infinity;
    for (const [id, ent] of L.pos) {
        const n = S.byId.get(id);
        if (!n) continue;
        if (!visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        const d = Math.hypot(n.x + (n._ox || 0) - w.x, n.y + (n._oy || 0) - w.y);
        if (d < drawRadius(n, ent, invK) + 8 * invK && d < bestD) { best = n; bestD = d; }
    }
    return best;
}

// Hub (oblasť / oddelenie) pod kurzorom — huby majú prednosť pred prachom pod nimi.
export function pickHub(px, py) {
    const L = S.layout;
    if (!L) return null;
    const w = screenToWorld(px, py);
    const invK = 1 / S.cam.k;
    let best = null, bestD = Infinity;
    for (const h of L.hubs) {
        const d = Math.hypot(h.x - w.x, h.y - w.y);
        const r = Math.max(9 * invK, h.rw) + 6 * invK;
        if (d < r && d < bestD) { best = h; bestD = d; }
    }
    return best;
}

// Čo je pod kurzorom: hub > uzol > prázdno.
export function pickTarget(px, py) {
    const h = pickHub(px, py);
    if (h) return { type: h.kind === 'area' ? 'areaHub' : 'deptHub', id: h.id, hub: h };
    const n = pick(px, py);
    if (n) return { type: 'node', id: n.id, node: n };
    return null;
}

export function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;
    let lastHoverId = null;

    canvas.addEventListener('mousedown', (e) => {
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        S._interacting = true;
        canvas.style.cursor = '';
        // W2a: uzly sa neťahajú — layout je deterministický. Ťahanie plátna = pan.
        canvas.classList.add('dragging');
        requestDraw();
    });

    canvas.addEventListener('mouseleave', () => { S.cursor.on = false; });

    window.addEventListener('mousemove', (e) => {
        S.cursor.sx = e.clientX; S.cursor.sy = e.clientY;
        S.cursor.on = !dragging;
        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            S.cam.x += dx; S.cam.y += dy;
            S._camTween = null; // ručný pan preruší tween kamery
            lx = e.clientX; ly = e.clientY;
            requestDraw();
        } else {
            const prevHover = S.hover;
            const hub = pickHub(e.clientX, e.clientY);
            S.hover = hub ? null : pick(e.clientX, e.clientY);
            S._hoverHub = hub || null;
            const hid = S.hover ? S.hover.id : null;
            if (hid !== lastHoverId) {
                if (S.hover) emitFlows(S.hover, { tone: 'accent', dim: 0.7, speed: 1.0 });
                lastHoverId = hid;
            }
            if (S.hover !== prevHover || !!hub !== !!S._hoverHubPrev) requestDraw();
            S._hoverHubPrev = !!hub;
            canvas.style.cursor = S.connectFrom ? 'crosshair' : ((hub || S.hover) ? 'pointer' : '');
            updateHoverCard(e, hub);
        }
    });

    window.addEventListener('mouseup', (e) => {
        S._interacting = false;
        canvas.classList.remove('dragging');
        canvas.classList.remove('grabbing');
        if (dragging && !moved) {
            const hit = pickTarget(e.clientX, e.clientY);
            if (S.connectFrom) {
                // connect mode: klik na iný uzol prepája, klik do prázdna ruší
                if (hit && hit.type === 'node' && hit.id !== S.connectFrom) createEdge(S.connectFrom, hit.id);
                else if (!hit) cancelConnect();
            } else if (hit) {
                // W2a: klik na hub/uzol ZANORÍ; detail uzla sa otvorí spolu s tým
                if (hit.type === 'node') selectNode(hit.node);
                goInto(hit);
            } else {
                // klik do prázdna → o úroveň von (a zavri detail)
                closeNodePanel();
                goUp();
            }
        }
        dragging = false;
        requestDraw();
    });

    // Dvojklik do prázdna vyskočí až na mapu (rýchly reset zanorenia).
    canvas.addEventListener('dblclick', (e) => {
        if (pickTarget(e.clientX, e.clientY)) return;
        goUp();
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = Math.pow(1.0015, -e.deltaY);
        const before = screenToWorld(e.clientX, e.clientY);
        S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
        const after = screenToWorld(e.clientX, e.clientY);
        S.cam.x += (after.x - before.x) * S.cam.k;
        S.cam.y += (after.y - before.y) * S.cam.k;
        S._camTween = null;
        requestDraw();
    }, { passive: false });

}

export function updateHoverCard(e, hub) {
    const card = $('hover-card');
    const n = S.hover;

    if (!n && !hub) {
        card.classList.remove('show');
        return;
    }

    if (hub) {
        const kind = hub.kind === 'area' ? 'oblasť' : 'oddelenie';
        card.innerHTML = '<div class="t">' + esc(hub.name) + '</div>'
            + '<div class="m">' + kind + ' · ' + hub.count + ' uzlov · klik zanorí</div>';
    } else {
        const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
        const area = S.areas.get(n.area_id);
        const dept = S.departments.get(n.department_id);
        const meta = [typeNames[n.type], area && area.name, dept && dept.name]
            .filter(Boolean)
            .map((v) => esc(String(v)))
            .join(' · ');
        card.innerHTML = '<div class="t">' + esc(n.label) + '</div><div class="m">' + meta + '</div>';
    }
    card.classList.remove('hidden');
    card.classList.add('show');

    const pad = 14;
    const r = card.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
}
