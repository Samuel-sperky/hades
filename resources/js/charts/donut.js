/* DONUT — prstenec rozdelenia istoty + celkové číslo v strede.

   DOM: .donut > svg (kruhy) + .donut-total
   segs = [{cert:'overene|hypoteza|pasca|bez', value, label?}]
   opts = { total?, centerLabel?, size?, thickness? }
   total = 0 → len track prstenec a nula v strede (nie prázdna plocha). */

import { certColor, chartColor } from './chart-theme.js';
import { el, svgEl } from './svg.js';

export function donut(container, segs, opts) {
    if (!container) return;
    container.innerHTML = '';
    opts = opts || {};
    segs = Array.isArray(segs) ? segs : [];

    const size = +opts.size || 132;
    const thickness = +opts.thickness || 16;
    const r = (size - thickness) / 2;
    const cx = size / 2, cy = size / 2;
    const C = 2 * Math.PI * r;

    const sum = segs.reduce((a, s) => a + (+s.value || 0), 0);
    const total = (opts.total != null) ? +opts.total : sum;

    const wrap = el('div', 'donut');
    const svg = svgEl('svg', {
        width: size, height: size,
        viewBox: '0 0 ' + size + ' ' + size,
        role: 'img',
        'aria-label': (opts.centerLabel || 'položiek') + ': ' + total,
    });

    // Track prstenec (vždy, leží pod segmentmi).
    svg.appendChild(svgEl('circle', {
        cx, cy, r, fill: 'none',
        stroke: chartColor('track'),
        'stroke-width': thickness,
    }));

    // Rotácia, aby segmenty začínali na 12. hodine a bežali v smere hodín.
    const g = svgEl('g', { transform: 'rotate(-90 ' + cx + ' ' + cy + ')' });
    if (sum > 0) {
        let start = 0; // kumulatívny podiel 0..1
        for (const s of segs) {
            const v = +s.value || 0;
            if (v <= 0) continue;
            const frac = v / sum;
            const arc = frac * C;
            g.appendChild(svgEl('circle', {
                cx, cy, r, fill: 'none',
                stroke: certColor(s.cert),
                'stroke-width': thickness,
                'stroke-dasharray': arc + ' ' + (C - arc),
                'stroke-dashoffset': String(-start * C),
            }));
            start += frac;
        }
    }
    svg.appendChild(g);
    wrap.appendChild(svg);

    const center = el('div', 'donut-total');
    const num = el('span', 'dt-num tnum');
    num.textContent = String(total);
    const lbl = el('span', 'dt-lbl');
    lbl.textContent = opts.centerLabel || 'uzlov';
    center.appendChild(num);
    center.appendChild(lbl);
    wrap.appendChild(center);

    container.appendChild(wrap);
}
