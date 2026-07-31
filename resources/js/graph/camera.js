import { S } from '../core/state/index.js';
import { nodeVisible } from './filters.js';
import { layerLayout } from './layers.js';
import { localSet } from './local.js';
import { draw } from './render/draw.js';
import { requestDraw } from './render/frame.js';
import { K_FIT_MAX, K_MAX, K_MIN } from './render/zoom.js';
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


/* Hranice kamery majú jediný kanonický zdroj — render/zoom.js (kontrakt
   čitateľnosti plátna). Tu sa len re-exportujú, aby volajúci a testy mohli
   ďalej čítať camera.K_MIN / camera.K_MAX bez zmeny rozhrania. */
export { K_MIN, K_MAX };


// Zoom okolo bodu na obrazovke (px). Jediné miesto, kde sa mení S.cam.k —
// wheel, tlačidlá aj klávesnica idú cez toto, takže strop/podlaha platí vždy.
export function zoomAt(px, py, factor) {
    const before = screenToWorld(px, py);
    S.cam.k = Math.min(K_MAX, Math.max(K_MIN, S.cam.k * factor));
    const after = screenToWorld(px, py);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    requestDraw(); // zoom zmenil kameru → prekresli
}


export function zoomBy(factor) {
    // pivot okolo stredu obrazovky — rovnaká technika ako wheel handler
    zoomAt(S.w / 2, S.h / 2, factor);
}


// Posun kamery o pixely obrazovky (klávesová obsluha plátna).
export function panBy(dx, dy) {
    S.cam.x += dx;
    S.cam.y += dy;
    requestDraw(); // kamera sa posunula → prekresli
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
    // Pomenované hranice namiesto literálov — hodnoty sú rovnaké ako doteraz
    // (K_FIT_MAX = 1.6, K_MIN = 0.14). Podlahu na čitateľné minimum zdvihne až
    // applyReadableZoom() z render/zoom.js, preto tu ostáva K_MIN, nie K_FIT_MIN.
    S.cam.k = Math.min(K_FIT_MAX, Math.max(K_MIN, Math.min((S.w - 2 * pad) / bw, (S.h - 2 * pad) / bh)));
    S.cam.x = -((minX + maxX) / 2) * S.cam.k;
    S.cam.y = -((minY + maxY) / 2) * S.cam.k;
    draw();
}


/* Ovládanie kamery — drôtuje sa na data-zoom (§4.7), nie na id: markup smie
   prežiť prestavbu layoutu, kontrakt je atribút. */
export function register(root) {
    const actions = {
        in: () => zoomBy(1.3),
        out: () => zoomBy(1 / 1.3),
        reset: () => fitView(),
    };
    root.querySelectorAll('[data-zoom]').forEach((el) => {
        const fn = actions[el.dataset.zoom];
        if (fn) el.onclick = fn;
    });
}
