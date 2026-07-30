/* prefers-reduced-motion — rozhodnutie #81.

   Doteraz to riešil len statický @media blok v css/base/motion.css, ktorý pokrýva
   CSS animácie chrome. Canvas si však kreslí sám a číta S.opts.anim / S.opts.life,
   takže pri zapnutom „reduce motion" ďalej dýchal a pulzoval.

   Tento modul:
     1. stampuje :root[data-reduced-motion="1"], aby CSS mohlo reagovať aj mimo
        @media (napr. pri ladení alebo v testoch),
     2. znuluje pohyb canvasu BEZ zápisu do localStorage — používateľské hodnoty
        sa uložia do snapshotu a po vypnutí preferencie sa vrátia,
     3. reaguje na zmenu preferencie za behu (listener, nie jednorazová kontrola).
*/

import { S } from '../core/state/index.js';
import { requestDraw } from '../graph/render/frame.js';

const MOTION_KEYS = ['anim', 'life'];

let snapshot = null;

const query = () => (typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : null);


export function reducedMotion() {
    const q = query();
    return !!(q && q.matches);
}


/** Používateľ hýbal sliderom pohybu počas aktívnej preferencie → snapshot je neplatný. */
export function dropMotionSnapshot(key) {
    if (snapshot && MOTION_KEYS.includes(key)) snapshot = null;
}


function apply(reduce) {
    if (reduce) document.documentElement.dataset.reducedMotion = '1';
    else delete document.documentElement.dataset.reducedMotion;

    if (reduce) {
        if (!snapshot) {
            snapshot = {};
            MOTION_KEYS.forEach((k) => { snapshot[k] = S.opts[k]; });
        }
        MOTION_KEYS.forEach((k) => { S.opts[k] = 0; });
    } else if (snapshot) {
        MOTION_KEYS.forEach((k) => { S.opts[k] = snapshot[k]; });
        snapshot = null;
    }
    requestDraw();
}


/** Registruje sa zo shell/settings.js (app.js je zdieľaný súbor). */
export function register() {
    const q = query();
    apply(!!(q && q.matches));
    if (!q || typeof q.addEventListener !== 'function') return;
    q.addEventListener('change', (e) => apply(!!e.matches));
}
