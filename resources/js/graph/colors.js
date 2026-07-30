import { S } from '../core/state/index.js';
import { T, THEMES } from './canvas-colors.js';

/* Farby uzlov a oblastí + základné geometrické konštanty siete. */

export const CORE_COLOR = '#b88a3a';
export const AREA_RADIUS = 640;
export const DEPT_RADIUS = 170;

// FÁZA HRANY: základné stlmenie hrán (~40 %) — uzly a popisky vyniknú nad sieťou.
export const EDGE_DIM = 0.6;


// Svetlejší/sytejší variant farby oblasti pre tmavý papier — hex→HSL→hex, cache
const _darkColorCache = new Map();

function darkAreaColor(hex) {
    const cached = _darkColorCache.get(hex);
    if (cached) return cached;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    const r = ((num >> 16) & 255) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    l = Math.max(l, 0.62);
    s = Math.min(s + 0.12, 0.9);
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0');
    const out = '#' + toHex(h + 1 / 3) + toHex(h) + toHex(h - 1 / 3);
    _darkColorCache.set(hex, out);
    return out;
}


// Farba = oblasť vo VŠETKÝCH náhľadoch; typ vyjadruje tvar (drawShape)
export function nodeColor(n) {
    let hex;
    if (n.type === 'core') hex = CORE_COLOR;
    else {
        const area = S.areas.get(n.area_id);
        hex = area ? area.color : '#2f6d8f';
    }
    return T === THEMES.dark ? darkAreaColor(hex) : hex;
}
