/* Tweenovaná kamera MAPY (ease-in-out cubic, zoom-to-fit).

   Prototyp prelieta kameru medzi úrovňami plynulo (animateTo/frameTo). Existujúca
   graph/camera.js robí len skokový fitView(), preto má mapa vlastný tween, ktorý
   píše do toho istého S.cam (rovnaká transformácia ako render/draw.js), takže
   screenToWorld() a zoom tlačidlá ostávajú kompatibilné.

   Cieľ kamery: stred bbox bodov sa premietne do stredu obrazovky
   (cam.x = -cx·k), zoom obsiahne bbox s okrajom. */

import { easeInOut } from '../animation.js';
import { now } from '../../core/format.js';
import { REDUCED_MOTION } from '../../core/motion.js';
import { S } from '../../core/state/index.js';
import { K_MAX, K_MIN } from '../render/zoom.js';


let cam = null; // { t0, ms, k0,x0,y0, k1,x1,y1 }


/** Naštartuj prelet kamery na cieľ (k, x, y). Pri REDUCED_MOTION skočí. */
export function mapCamTo(k1, x1, y1, ms = 720) {
    k1 = Math.min(K_MAX, Math.max(K_MIN, k1));
    if (REDUCED_MOTION || ms <= 0) {
        S.cam.k = k1; S.cam.x = x1; S.cam.y = y1; cam = null;
        return;
    }
    cam = { t0: now(), ms, k0: S.cam.k, x0: S.cam.x, y0: S.cam.y, k1, x1, y1 };
}


/** Prelet tak, aby bbox bodov (world) padol do viewportu s okrajom. */
export function mapFitPoints(points, pad = 120, ms = 720, kMax = 1.6) {
    if (!points.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }
    const bw = Math.max(maxX - minX, 60);
    const bh = Math.max(maxY - minY, 60);
    const vw = S.w || window.innerWidth;
    const vh = S.h || window.innerHeight;
    let k = Math.min((vw - 2 * pad) / bw, (vh - 2 * pad) / bh);
    k = Math.min(kMax, Math.max(K_MIN, k));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    mapCamTo(k, -cx * k, -cy * k, ms);
}


/** Krok tweenu. Vráti true, kým prebieha. */
export function stepMapCam() {
    if (!cam) return false;
    const p = Math.min(1, (now() - cam.t0) / cam.ms);
    const e = easeInOut(p);
    S.cam.k = cam.k0 + (cam.k1 - cam.k0) * e;
    S.cam.x = cam.x0 + (cam.x1 - cam.x0) * e;
    S.cam.y = cam.y0 + (cam.y1 - cam.y0) * e;
    if (p >= 1) { cam = null; return false; }
    return true;
}


export function mapCamActive() { return !!cam; }


/** Zruš prebiehajúci prelet (napr. keď používateľ chytí drag). */
export function cancelMapCam() { cam = null; }
