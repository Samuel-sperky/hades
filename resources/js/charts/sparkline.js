/* SPARKLINE — mikro-trend do KPI karty (bez osí, bez popiskov).

   values = [n, n, …]; posledný bod dostane značku. Prázdna/plochá rada sa
   nevykreslí vôbec (vracia false), aby KPI karta nemala v sebe prázdnu dieru. */

import { chartColor } from './chart-theme.js';
import { svgEl } from './svg.js';

export function sparkline(container, values, opts) {
    if (!container) return false;
    container.innerHTML = '';
    opts = opts || {};
    const vals = Array.isArray(values) ? values.map((v) => +v || 0) : [];
    if (vals.length < 2) return false;
    if (vals.every((v) => v === vals[0])) return false;

    const W = 100, H = 24, pad = 2;
    const max = Math.max.apply(null, vals);
    const min = Math.min.apply(null, vals);
    const span = max - min || 1;
    const xAt = (i) => pad + (i / (vals.length - 1)) * (W - pad * 2);
    const yAt = (v) => H - pad - ((v - min) / span) * (H - pad * 2);

    const stroke = chartColor(opts.role || 'accent');
    const svg = svgEl('svg', {
        viewBox: '0 0 ' + W + ' ' + H,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': opts.label || 'trend',
        class: 'spark',
    });

    let d = '';
    for (let i = 0; i < vals.length; i++) {
        d += (i ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(vals[i]).toFixed(1);
    }
    svg.appendChild(svgEl('path', {
        d, fill: 'none', stroke,
        'stroke-width': '1.5', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
    }));
    svg.appendChild(svgEl('circle', {
        cx: xAt(vals.length - 1), cy: yAt(vals[vals.length - 1]), r: '1.8',
        fill: stroke, 'vector-effect': 'non-scaling-stroke',
    }));

    container.appendChild(svg);
    return true;
}
