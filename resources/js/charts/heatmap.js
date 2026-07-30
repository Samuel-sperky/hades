/* HEATMAPA — 365-dňová mriežka aktivity (GitHub štýl).

   DOM: .heat (scroll viewport) > .heat-months + .heat-grid > .heat-cell
   weeks[i] = stĺpec (Po..Ne, 7 buniek); cell = {date,count,level} | null.
   null → .heat-cell.out (priehľadná, nie tichá nula). level 0..4 → .l1..l4.

   Farby rampy sú v charts.css (`--heat-*`), nie tu — bunky sú obyčajné divy,
   takže prepnutie témy ich prekreslí bez JS. */

import { clamp, el } from './svg.js';

export function heatmap(container, data) {
    if (!container) return;
    container.innerHTML = '';
    data = data || {};
    const weeks = Array.isArray(data.weeks) ? data.weeks : [];
    const months = data.months || {};
    const cols = weeks.length;

    // Prázdny stav — bez tohto by karta „Aktivita" bola prázdna plocha.
    if (!cols) {
        container.innerHTML = '<div class="empty"><span class="ms" aria-hidden="true">grid_off</span>'
            + '<p>Žiadna zaznamenaná aktivita</p></div>';
        return;
    }

    const heat = el('div', 'heat');

    // Riadok mesiacov — jeden 12px stĺpec na týždeň, popisok na mapovaných indexoch.
    const mrow = el('div', 'heat-months');
    mrow.style.gridTemplateColumns = 'repeat(' + cols + ', 12px)';
    for (let c = 0; c < cols; c++) {
        const s = el('span');
        if (months[c] != null) s.textContent = months[c];
        mrow.appendChild(s);
    }
    heat.appendChild(mrow);

    // Mriežka — tok po stĺpcoch, 7 riadkov.
    const grid = el('div', 'heat-grid');
    for (let c = 0; c < cols; c++) {
        const week = weeks[c] || [];
        for (let r = 0; r < 7; r++) {
            const cell = el('div', 'heat-cell');
            const d = week[r];
            if (d == null) {
                cell.classList.add('out');
            } else {
                const lvl = clamp(+d.level || 0, 0, 4);
                if (lvl > 0) cell.classList.add('l' + lvl);
                const n = +d.count || 0;
                const tip = (d.date || '') + (n ? ' · ' + n : ' · 0');
                cell.setAttribute('data-tip', tip);
                cell.setAttribute('title', tip);
            }
            grid.appendChild(cell);
        }
    }
    heat.appendChild(grid);
    container.appendChild(heat);

    // menej — [rampa] — viac
    const legend = el('div', 'heat-legend');
    legend.appendChild(document.createTextNode('menej'));
    for (let l = 0; l <= 4; l++) legend.appendChild(el('span', 'heat-cell' + (l ? ' l' + l : '')));
    legend.appendChild(document.createTextNode('viac'));
    container.appendChild(legend);
}
