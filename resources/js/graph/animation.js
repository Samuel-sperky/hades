import { REDUCED_MOTION } from '../core/motion.js';
import { S } from '../core/state/index.js';


/* ---------- FÁZA ANIMÁCIE: globálne škálovanie + toky ---------- */

// Efektívna intenzita animácií. REDUCED_MOTION → 0 (statika). Ambient režim zosilní jemné
// efekty ×1.6, inak držané veľmi jemné. Slider 'anim' (0..1) funguje aj ako vypínač na 0.
export function animLevel() {
    if (REDUCED_MOTION) return 0;
    const base = S.opts && S.opts.anim != null ? S.opts.anim : 0.5;
    if (base <= 0) return 0;
    return base * (document.body.classList.contains('ambient') ? 1.6 : 1);
}


// FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie / drift / synapsie / gravitácia).
// REDUCED_MOTION → 0 (žiadny ambient, len event pulzy). Ambient režim vždy žije (floor 0.6) a zosilní
// ×1.8. Slider 'Život' (0..1) je nezávislý od 'Animácie' a na 0 vráti dirty-only pokoj.
export function lifeLevel() {
    if (REDUCED_MOTION) return 0;
    let base = S.opts && S.opts.life != null ? S.opts.life : 0.5;
    const amb = document.body.classList.contains('ambient');
    if (amb) base = Math.max(base, 0.6); // ambient režim ožije aj so stiahnutým Životom
    if (base <= 0) return 0;
    return base * (amb ? 1.8 : 1);
}


// Auto-strop: tier z EMA nákladu draw() (S._drawMs). Plynulé, EMA tlmí flikanie na hranici.
// 0 = plný ambient, 1 = redukovaný (drift von, dýcha len jadro, menej synapsií), 2 = len event-driven.
export function lifeTier() {
    const ms = S._drawMs;
    if (ms > 33) return 2; // ~<30 FPS ekvivalent renderu → vypni ambient
    if (ms > 22) return 1; // ~<45 FPS → redukuj
    return 0;
}


// Ease-out (cubic) — zrod uzla; ease-in-out — morph náhľadov.
const easeOut = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);

export const easeInOut = (p) => { p = Math.max(0, Math.min(1, p)); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };


// Zrod uzla: násobič polomeru 0→1 (~0.5 s, ease-out). anim=0 / REDUCED_MOTION → hneď plný.
export function birthScale(n) {
    if (n._born == null || S._anim <= 0 || REDUCED_MOTION) return 1;
    const age = S._clock - n._born;
    if (age >= 0.5) return 1; // prstenec (do 0.6 s) dobehne a _born vyčistí až sám
    return easeOut(age / 0.5);
}


// FÁZA ANIMÁCIE (Living): idle dýchanie — jemná sínusová modulácia polomeru viditeľných uzlov
// (~±2–3 %, jadro výraznejšie ±5 %), fázovo rozhodené podľa id, pomalé (5–8 s). Škáluje Život.
// Auto-strop tier 1: dýcha len jadro. Zamrzne pri drag/pan, pri oddialení (k<0.5) a keď Život=0.
// Konkrétny uzol pod kurzorom nedýcha (hover ho drží pevný pre presné čítanie).
export function breatheFactor(n) {
    if (S._life <= 0 || S._interacting || S.cam.k < 0.5) return 1;
    const core = n.type === 'core';
    if (!core && (S._lifeTier >= 1 || n === S.hover)) return 1;
    if (core && n === S.hover) return 1;
    const life = Math.min(1.4, S._life);
    const amp = (core ? 0.05 : 0.025) * life;               // jadro dýcha výraznejšie
    const period = core ? 5.5 : 6 + (n.id % 5) * 0.5;       // 6–8 s podľa id
    return 1 + amp * Math.sin(S._clock * (2 * Math.PI / period) + n.id * 1.3);
}
