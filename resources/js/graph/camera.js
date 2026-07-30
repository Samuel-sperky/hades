import { S } from '../core/state/index.js';
import { nodeVisible } from './filters.js';
import { layerLayout } from './layers.js';
import { localSet } from './local.js';
import { draw } from './render/draw.js';
import { requestDraw } from './render/frame.js';
import { visibleInReplay } from './timeline.js';


/* ---------- interakcia ---------- */

export function screenToWorld(px, py) {
    return {
        x: (px - S.w / 2 - S.cam.x) / S.cam.k,
        y: (py - S.h / 2 - S.cam.y) / S.cam.k,
    };
}


export function focusNode(n) {
    S.cam.x = -n.x * S.cam.k;
    S.cam.y = -n.y * S.cam.k;
    requestDraw(); // kamera sa presunula na uzol → prekresli
}


export function zoomBy(factor) {
    // pivot okolo stredu obrazovky — rovnaká technika ako wheel handler
    const before = screenToWorld(S.w / 2, S.h / 2);
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
    const after = screenToWorld(S.w / 2, S.h / 2);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    requestDraw(); // zoom tlačidlom zmenil kameru → prekresli
}


// Fit view — kamera obsiahne všetky viditeľné uzly aktuálneho náhľadu
export function fitView(pad = 90) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const loc = localSet();

    if (S.view === 'layers') {
        // deterministický layout — bbox sub-stĺpcov + hlavičky (vždy v zábere)
        const lay = layerLayout();
        add(lay.minX, -lay.maxHalf - 66);
        add(lay.maxX, lay.maxHalf);
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.fx != null ? n.fx : n.x, n.fy != null ? n.fy : n.y);
        }
    } else {
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.x, n.y);
        }
    }

    if (minX > maxX) { S.cam = { x: 0, y: 0, k: 0.85 }; draw(); return; }

    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    S.cam.k = Math.min(1.6, Math.max(0.14, Math.min((S.w - 2 * pad) / bw, (S.h - 2 * pad) / bh)));
    S.cam.x = -((minX + maxX) / 2) * S.cam.k;
    S.cam.y = -((minY + maxY) / 2) * S.cam.k;
    draw();
}


/* Ovládanie kamery (data-zoom). */
export function register(root) {
    const wire = (id, fn) => { const el = root.querySelector('#' + id); if (el) el.onclick = fn; };
    wire('zoom-in', () => zoomBy(1.3));
    wire('zoom-out', () => zoomBy(1 / 1.3));
    wire('zoom-reset', () => fitView());
}
