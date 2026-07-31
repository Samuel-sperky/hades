/* Intro choreografia pri prvom vstupe do MAPY (~2,5 s).

   Vzor prototypu: sieť sa dokresľuje — jadro, huby, oddelenia a hrany nabiehajú.
   render.js číta introProgress() (0..1) a podľa neho škáluje/odkrýva prvky a
   dokresľuje štruktúrne hrany.

   Za prefers-reduced-motion je intro vypnuté (skočí na 1). Prvé videnie je plné;
   „už videné" sa uloží do store, ďalší vstup je bez intra (skrátene = žiadne). */

import { now } from '../../core/format.js';
import { REDUCED_MOTION } from '../../core/motion.js';
import { store } from '../../core/store.js';

const SEEN_KEY = 'map.introSeen';
const DURATION_MS = 2500;

let t0 = 0;
let running = false;


/** Spusti intro, ak ho ešte netreba preskočiť. Vráti true, ak reálne beží. */
export function startIntro() {
    if (REDUCED_MOTION || store.raw(SEEN_KEY) === '1') {
        running = false;
        return false;
    }
    t0 = now();
    running = true;
    store.setRaw(SEEN_KEY, '1');
    return true;
}


export function introActive() { return running; }


/** Postup intra 0..1. Po dobehnutí sa vypne. */
export function introProgress() {
    if (!running) return 1;
    const p = Math.min(1, (now() - t0) / DURATION_MS);
    if (p >= 1) running = false;
    return p;
}


/** Iba pre testy — vynulovanie „videného" príznaku. */
export function resetIntroSeen() { store.del(SEEN_KEY); running = false; }
