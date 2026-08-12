import { S } from './state.js';
import { T } from './theme.js';
import { focusPass, syncSlider } from './util.js';

/* ---------- sily (Obsidian forces) — efektívne predvolené podľa náhľadu ---------- */

export function forceDefault(key) {
    const net = S.view === 'net';
    return {
        charge: net ? -120 : -42,
        linkDistance: net ? 95 : 72,
        linkStrength: 1,
        gravity: 1,
    }[key];
}

// Slidery síl ukazujú override, alebo efektívnu predvolenú hodnotu aktuálneho náhľadu
export function syncForceSliders() {
    document.querySelectorAll('input[data-force]').forEach((inp) => {
        const k = inp.dataset.force;
        const v = S.forces[k] != null ? S.forces[k] : forceDefault(k);
        inp.value = v;
        syncSlider(inp);
    });
}

// pathNodes (voliteľné, len Vrstvy): uzly na vrstvovej ceste sa netlmia ako cudzie
export function nodeAlphaMul(n, hl, pathNodes) {
    let mul = 1;
    if (hl && !hl.has(n.id) && !(pathNodes && pathNodes.has(n.id))) mul *= 0.18;
    if (!focusPass(n)) mul *= 0.15;
    // podlaha na SÚČINE (hover × focus) — tlmené uzly ostávajú čitateľné
    return Math.max(T.nodeFloor, mul);
}

// pathSet (voliteľné, len Vrstvy): hrany vrstvovej cesty sa berú ako priame (netlmené)
export function edgeAlphaMul(e, hl, anchor, pathSet) {
    let mul = 1;
    const onPath = (anchor && (e.source.id === anchor.id || e.target.id === anchor.id))
        || (pathSet && pathSet.has(e));
    if (hl && !onPath) mul *= 0.18;
    if (!(focusPass(e.source) && focusPass(e.target))) mul *= 0.15;
    return Math.max(T.edgeFloor, mul);
}
