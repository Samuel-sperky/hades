/* Rotácia konštelácie MAPY okolo jadra.

   Vzor prototypu: šípky ‹ › a drag otáčajú celú mapu, aktívna oblasť sa točí
   dole a zvýrazní sa. Mapa je tuhé teleso — každý bod sa otáča o `rot` okolo
   počiatku (jadra). render.js volá rotatePoint() na bázové pozície layoutu.

   Rotácia sa plynulo tweenuje k cieľu (šípky/snap), drag ju mení priamo. */

import { REDUCED_MOTION } from '../../core/motion.js';


let rot = 0;        // aktuálny uhol (rad)
let target = 0;     // cieľ tweenu
let tweening = false;

// Uhol, na ktorý sa „dole" premietne aktívna oblasť (spodok obrazovky = +90°).
export const BOTTOM_ANGLE = Math.PI / 2;


export function getRot() { return rot; }


export function setRot(v) { rot = v; target = v; tweening = false; }


/** Otoč bázový bod (bx,by) o aktuálnu rotáciu okolo jadra. */
export function rotatePoint(bx, by) {
    if (rot === 0) return { x: bx, y: by };
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: bx * c - by * s, y: bx * s + by * c };
}


/** Nastav cieľovú rotáciu tak, aby oblasť s bázovým uhlom `areaAng` sedela dole.
    instant=true zapadne okamžite (používa sa pri zanorení, aby fit kamery sedel
    na finálnu rotáciu); inak sa plynulo tweenuje (šípky/drag na úrovni mapy). */
export function rotateAreaToBottom(areaAng, instant = false) {
    let t = BOTTOM_ANGLE - areaAng;
    // normalizuj k najbližšej otáčke voči aktuálnemu uhlu (bez zbytočného kruhu)
    while (t - rot > Math.PI) t -= Math.PI * 2;
    while (t - rot < -Math.PI) t += Math.PI * 2;
    target = t;
    if (instant || REDUCED_MOTION) { rot = target; tweening = false; return; }
    tweening = true;
}


/** Priame otočenie dragom (v radiánoch). Zruší prebiehajúci tween. */
export function nudgeRot(delta) {
    rot += delta;
    target = rot;
    tweening = false;
}


/** Krok tweenu rotácie. Vráti true, kým sa ešte hýbe. */
export function stepRotation() {
    if (!tweening) return false;
    rot += (target - rot) * 0.14;
    if (Math.abs(target - rot) < 0.0008) { rot = target; tweening = false; return false; }
    return true;
}


/** Ktorá oblasť je práve najbližšie dole (podľa rotovaného uhla). */
export function bottomAreaId(areas) {
    let best = null, bestD = Infinity;
    for (const a of areas) {
        let d = Math.abs(normalize(a.ang + rot - BOTTOM_ANGLE));
        if (d < bestD) { bestD = d; best = a; }
    }
    return best ? best.id : null;
}


function normalize(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}
