/* ===========================================================================
   Hades — charts.js
   Pure SVG / CSS-grid chart builders for the Apollo-integration dashboard.
   No dependencies, no build step, no reliance on mind.js closure state (S).
   Colours are read from CSS custom properties (--heat-*, --cert-*, --accent)
   via getComputedStyle, so the charts stay theme-aware (light / dark) for free.

   API — window.HadesCharts:
     heatmap(el, data)      365-day activity grid (GitHub-style, teal ramp)
     donut(el, segs, opts)  certainty split ring + centre total
     growthLine(el, series) cumulative growth area+line

   Data contracts (dashboard payload §4.4):
     heatmap: { weeks: [[{date,count,level}|null, …7], …≤53], months:{col:"aug"}, total }
     donut:   segs = [{cert:"overene|hypoteza|pasca|bez", value, label?}]
              opts = { total?, centerLabel?, size?, thickness? }
     growth:  series = { labels:["2025-08", …], values:[12,34, …] }  // cumulative
   =========================================================================== */
(function () {
    'use strict';

    const SVGNS = 'http://www.w3.org/2000/svg';

    // Read a CSS custom property off :root (theme-aware). Trims and falls back.
    function cssVar(name, fallback) {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name);
        return (v && v.trim()) || fallback || '';
    }

    function svgEl(tag, attrs) {
        const n = document.createElementNS(SVGNS, tag);
        if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    }

    function el(tag, cls) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        return n;
    }

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

    /* -----------------------------------------------------------------------
       HEATMAP — .heat (scroll viewport) > .heat-months + .heat-grid > .heat-cell
       weeks[i] = column (Mon..Sun, 7 cells); cell = {date,count,level} | null.
       null → .heat-cell.out (transparent, no silent zero). level 0..4 → .l1..l4.
       ----------------------------------------------------------------------- */
    function heatmap(container, data) {
        if (!container) return;
        container.innerHTML = '';
        data = data || {};
        const weeks = Array.isArray(data.weeks) ? data.weeks : [];
        const months = data.months || {};
        const cols = weeks.length;

        const heat = el('div', 'heat');

        // Month labels row — one 12px column per week, label at mapped indices.
        if (cols) {
            const mrow = el('div', 'heat-months');
            mrow.style.gridTemplateColumns = 'repeat(' + cols + ', 12px)';
            for (let c = 0; c < cols; c++) {
                const s = el('span');
                if (months[c] != null) s.textContent = months[c];
                mrow.appendChild(s);
            }
            heat.appendChild(mrow);
        }

        // Grid — column flow, 7 rows. Append cells column by column.
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

        // less — [ramp] — more legend
        const legend = el('div', 'heat-legend');
        legend.appendChild(document.createTextNode('menej'));
        for (let l = 0; l <= 4; l++) {
            const c = el('span', 'heat-cell' + (l ? ' l' + l : ''));
            legend.appendChild(c);
        }
        legend.appendChild(document.createTextNode('viac'));
        container.appendChild(legend);
    }

    /* -----------------------------------------------------------------------
       DONUT — certainty split ring. .donut > svg (circles) + .donut-total.
       Colours per segment from --cert-<key> (bez/none → --cert-none).
       total=0 → track ring only, centre number 0.
       ----------------------------------------------------------------------- */
    function certColor(key) {
        const k = (key === 'bez' || key === 'none' || !key) ? 'none' : key;
        return cssVar('--cert-' + k, cssVar('--muted', '#888'));
    }

    function donut(container, segs, opts) {
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
        });

        // Track ring (always drawn, sits under the segments).
        svg.appendChild(svgEl('circle', {
            cx: cx, cy: cy, r: r, fill: 'none',
            stroke: cssVar('--track', 'rgba(0,0,0,.08)'),
            'stroke-width': thickness,
        }));

        // Rotate so segments start at 12 o'clock and run clockwise.
        const g = svgEl('g', { transform: 'rotate(-90 ' + cx + ' ' + cy + ')' });
        if (sum > 0) {
            let start = 0; // cumulative fraction 0..1
            for (const s of segs) {
                const v = +s.value || 0;
                if (v <= 0) continue;
                const frac = v / sum;
                const arc = frac * C;
                g.appendChild(svgEl('circle', {
                    cx: cx, cy: cy, r: r, fill: 'none',
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
        const num = el('span', 'dt-num');
        num.textContent = String(total);
        const lbl = el('span', 'dt-lbl');
        lbl.textContent = opts.centerLabel || 'uzlov';
        center.appendChild(num);
        center.appendChild(lbl);
        wrap.appendChild(center);

        container.appendChild(wrap);
    }

    /* -----------------------------------------------------------------------
       GROWTH LINE — cumulative area+line. Responsive: viewBox + width:100%,
       non-scaling stroke so the line stays crisp at any width.
       ----------------------------------------------------------------------- */
    function growthLine(container, series) {
        if (!container) return;
        container.innerHTML = '';
        series = series || {};
        const values = Array.isArray(series.values) ? series.values.map((v) => +v || 0) : [];
        const labels = Array.isArray(series.labels) ? series.labels : [];
        const n = values.length;
        if (!n) return;

        const W = 300, H = 90, pad = 6;
        const max = Math.max.apply(null, values.concat([1]));
        const innerH = H - pad * 2;
        const xAt = (i) => (n === 1 ? W / 2 : pad + (i / (n - 1)) * (W - pad * 2));
        const yAt = (v) => H - pad - (v / max) * innerH;

        const accent = cssVar('--accent', '#03797e');

        const svg = svgEl('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'none',
            role: 'img',
        });
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';

        let line = '', area = '';
        for (let i = 0; i < n; i++) {
            const x = xAt(i), y = yAt(values[i]);
            line += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
            area += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }
        // Flat single-point series → draw a baseline so something is visible.
        if (n === 1) { line += 'L' + (W - pad) + ' ' + yAt(values[0]).toFixed(1); }
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
        // Last-point marker.
        svg.appendChild(svgEl('circle', {
            cx: xAt(n - 1), cy: yAt(values[n - 1]), r: '2.5',
            fill: accent, 'vector-effect': 'non-scaling-stroke',
        }));

        container.appendChild(svg);

        // First / last period labels below the chart (muted mono).
        if (labels.length) {
            const axis = el('div');
            axis.style.cssText = 'display:flex;justify-content:space-between;'
                + 'font-family:var(--mono);font-size:10px;letter-spacing:var(--ls-mono);'
                + 'color:var(--muted);margin-top:4px;';
            const a = el('span'); a.textContent = labels[0] || '';
            const b = el('span'); b.textContent = labels[labels.length - 1] || '';
            axis.appendChild(a);
            if (labels.length > 1) axis.appendChild(b);
            container.appendChild(axis);
        }
    }

    window.HadesCharts = { heatmap: heatmap, donut: donut, growthLine: growthLine };
})();
