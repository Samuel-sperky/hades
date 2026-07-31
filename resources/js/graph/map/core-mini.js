/* Stredové JADRO = miniatúra celej siete (radiálna projekcia).

   Vzor prototypu: každý uzol mysle sa radiálne premietne do stredu (vzdialenosť
   d^0.8 zmenšená do CORE_MINI_R), takže jadro je doslova celá sieť v malom. Farba
   podľa oblasti. Klik na jadro = expand na samostatný pohľad (úroveň 'core').

   Projekcia sa počíta raz na layout (deterministicky, bez jitteru navyše) a
   kreslí sa ako vlastný jemne rotujúci zhluk — nezávislý od rotácie konštelácie. */

import { seededRand } from './prng.js';
import { CORE_MINI_R } from './layout.js';


let _cache = null;
let _cacheFor = null;


/** Body miniatúry: [{x,y,r,areaId}] v lokálnych súradniciach jadra. */
export function coreMini(layout) {
    if (_cache && _cacheFor === layout) return _cache;

    const pts = [];
    let maxD = 1;
    for (const leaf of layout.leaves) {
        const d = Math.hypot(leaf.bx, leaf.by);
        if (d > maxD) maxD = d;
    }
    for (const leaf of layout.leaves) {
        const d = Math.hypot(leaf.bx, leaf.by);
        const a = Math.atan2(leaf.by, leaf.bx);
        const rr = 6 + Math.pow(d / maxD, 0.8) * CORE_MINI_R;
        const jit = seededRand((leaf.id + 7) * 2246822519);
        pts.push({
            x: Math.cos(a) * rr + (jit() - 0.5) * 4,
            y: Math.sin(a) * rr + (jit() - 0.5) * 4,
            r: 1 + jit() * 1.4,
            areaId: leaf.areaId,
        });
    }
    _cache = { pts, r: CORE_MINI_R };
    _cacheFor = layout;
    return _cache;
}
