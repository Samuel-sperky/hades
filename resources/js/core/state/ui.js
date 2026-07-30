/* Shell / appearance slice — screen, view, sound, visual options, forces, pack. */

import { normalizeScreen } from '../screens.js';
import { store } from '../store.js';

export const OPT_DEFAULTS = {
    panelAlpha: 0.92,
    bg: 1,
    edgeAlpha: 1,
    glow: 1,
    labelAlpha: 1,
    nodeScale: 1,
    labelSize: 1,
    sizeByDegree: false,
    edgeSoftHover: true, // FÁZA HRANY: v pokoji sú hrany jemné, rozsvietia sa pri hover/fokuse uzla
    anim: 0.5,           // FÁZA ANIMÁCIE: intenzita udalostných animácií (toky, zrod, morph; 0 = vyp)
    life: 0.5,           // FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie, drift, synapsie; 0 = pokoj)
};

// Fyzika — null = predvolená hodnota náhľadu; slidery (F2) zapisujú čísla + localStorage
export const FORCE_DEFAULTS = { charge: null, linkDistance: null, linkStrength: null, gravity: null };

function jsonOr(key, fallback) {
    try { return JSON.parse(store.raw(key) || fallback); } catch (e) { return JSON.parse(fallback); }
}

export const ui = {
    sound: store.raw('sound') !== 'off',
    audio: null,
    view: store.raw('view') || 'map',
    // FÁZA SHELL: aktívna obrazovka. Zoznam je v core/screens.js (rozhranie #16).
    // Plátno (rAF) beží len na 'graf'.
    screen: normalizeScreen(store.raw('screen')),
    opts: Object.assign({}, OPT_DEFAULTS, jsonOr('opts', '{}')),
    forces: Object.assign({}, FORCE_DEFAULTS, jsonOr('forces', '{}')),
    // FÁZA OBRAZOVKY: balík uzlov na export do Claude Code — Map(id → label). Persist 'aura.pack'.
    pack: new Map(),
};

try {
    const p = JSON.parse(store.raw('pack') || '[]');
    if (Array.isArray(p)) for (const it of p) { if (it && it.id != null) ui.pack.set(+it.id, it.label || ('#' + it.id)); }
} catch (e) { /* poškodený balík — prázdny */ }
