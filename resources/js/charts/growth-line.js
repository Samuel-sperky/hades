/* RAST SIETE — kumulatívna plocha + línia.

   Responzívne: viewBox + `vector-effect: non-scaling-stroke`, takže línia
   zostane ostrá pri každej šírke. Výšku dáva `--chart-h-sm` cez triedu
   `.chart-growth` v charts.css — akceptačné kritérium „už žiadne height="60"
   v markupe". Trieda má tvrdý px fallback, takže graf je nenulový aj keby token
   chýbal (nespoliehame sa na cudzí `.chart-box-sm`, ktorý by pri chýbajúcom
   importe zrazil svg na 0 px — presne ten regres, čo grafy raz už rozbil). */

import { chartColor } from './chart-theme.js';
import { el, svgEl } from './svg.js';

export function growthLine(container, series) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.add('chart-growth');
    series = series || {};
    const values = Array.isArray(series.values) ? series.values.map((v) => +v || 0) : [];
    const labels = Array.isArray(series.labels) ? series.labels : [];
    const n = values.length;

    // Prázdny stav — bez tohto je karta „Rast siete" prázdna plocha.
    if (!n) {
        container.innerHTML = '<div class="empty"><span class="ms" aria-hidden="true">show_chart</span>'
            + '<p>Zatiaľ nie je čo vykresliť</p></div>';
        return;
    }

    const W = 300, H = 90, pad = 6;
    const max = Math.max.apply(null, values.concat([1]));
    const innerH = H - pad * 2;
    const xAt = (i) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2));
    const yAt = (v) => H - pad - (v / max) * innerH;

    const accent = chartColor('growth');

    // Výšku a šírku dáva `.chart-growth > svg` v charts.css (token --chart-h-sm).
    const svg = svgEl('svg', {
        viewBox: '0 0 ' + W + ' ' + H,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': 'Kumulatívny rast siete, naposledy ' + values[n - 1],
    });

    let line = '', area = '';
    for (let i = 0; i < n; i++) {
        const x = xAt(i), y = yAt(values[i]);
        line += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        area += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    // Jednobodová rada → dokresli základnicu, aby bolo niečo vidieť.
    if (n === 1) line += 'L' + (W - pad) + ' ' + yAt(values[0]).toFixed(1);
    area += 'L' + xAt(n - 1).toFixed(1) + ' ' + (H - pad)
          + 'L' + xAt(0).toFixed(1) + ' ' + (H - pad) + 'Z';

    svg.appendChild(svgEl('path', {
        d: area, fill: accent, 'fill-opacity': '0.10', stroke: 'none',
    }));
    svg.appendChild(svgEl('path', {
        d: line, fill: 'none', stroke: accent,
        'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        'vector-effect': 'non-scaling-stroke',
    }));
    // Značka posledného bodu.
    svg.appendChild(svgEl('circle', {
        cx: xAt(n - 1), cy: yAt(values[n - 1]), r: '2.5',
        fill: accent, 'vector-effect': 'non-scaling-stroke',
    }));

    container.appendChild(svg);

    // Prvé / posledné obdobie pod grafom (tichá mono os).
    if (labels.length) {
        const axis = el('div', 'chart-axis');
        const a = el('span'); a.textContent = labels[0] || '';
        const b = el('span'); b.textContent = labels[labels.length - 1] || '';
        axis.appendChild(a);
        if (labels.length > 1) axis.appendChild(b);
        container.appendChild(axis);
    }
}
