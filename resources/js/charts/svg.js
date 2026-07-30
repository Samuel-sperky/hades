/* Malé DOM/SVG primitívy pre grafy. Žiadne farby, žiadny stav. */

const SVGNS = 'http://www.w3.org/2000/svg';


export function svgEl(tag, attrs) {
    const n = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
}


export function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
}


export function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
