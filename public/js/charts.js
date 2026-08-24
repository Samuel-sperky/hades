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

    /* Slová (nie dáta) pre textové alternatívy grafov. Skratky mesiacov sú tie
       isté, aké posiela server v heatmap.months — tu ich potrebujeme kľúčované
       podľa mesiaca dátumu, nie podľa stĺpca mriežky. */
    const MONTHS_SK = ['jan', 'feb', 'mar', 'apr', 'máj', 'jún', 'júl', 'aug', 'sep', 'okt', 'nov', 'dec'];

    /** 1234 → „1 234" (pevná medzera, aby sa číslo v popise nezlomilo). */
    function fmtNum(n) {
        return String(+n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    }

    /** „2026-08-19" → „19. 8. 2026" (čítačka to prečíta ako dátum, nie ako kód). */
    function fmtDate(iso) {
        const p = String(iso || '').split('-');
        if (p.length !== 3) return String(iso || '');
        return (+p[2]) + '. ' + (+p[1]) + '. ' + p[0];
    }

    /** „2026-08" → „aug 2026" */
    function fmtMonthKey(key) {
        const p = String(key || '').split('-');
        const m = MONTHS_SK[(+p[1] || 0) - 1];
        return m ? m + ' ' + p[0] : String(key || '');
    }

    /* Zrod grafu: dáta sa kreslia, nie zjavujú. Pohyb je jediný, ktorý si graf
       smie dovoliť — nesie poradie čítania (donut od dvanástky, krivka zľava,
       heatmapa od najstaršieho týždňa), nie dekoráciu.

       Stráž je JEDNA a číta sa RAZ pri načítaní: kontrolovať matchMedia v každom
       vykreslení by pri heatmape znamenalo dopyt na 365 buniek. */
    const REDUCED = !!(window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    /** Spustí prechod až v ďalšom rámci — inak prehliadač zlúči počiatočný
        a cieľový stav do jedného štýlu a animácia sa preskočí. */
    function nextFrame(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

    /* -----------------------------------------------------------------------
       AUTO-FIT — grafy berú výšku z REÁLNEHO boxu kontejnera, nie z konštanty.
       Kontejnery sú v CSS flex: 1 1 0 s min-height, takže obsah nemôže tlačiť
       kartu → prepočet nemení box, ktorý meriame, a ResizeObserver nemôže
       oscilovať. Observer žije na kontejneri a pri novom renderi sa recykluje
       (charts sa prekresľujú pri každom načítaní dashboardu).
       ----------------------------------------------------------------------- */
    function autoFit(container, fit) {
        const run = () => { if (container.clientHeight > 0 && container.clientWidth > 0) fit(); };
        if (container.__hcFit) container.__hcFit.disconnect();
        run();
        if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(run);
            ro.observe(container);
            container.__hcFit = ro;
            return;
        }
        // fallback bez ResizeObserveru — aspoň na resize okna
        if (container.__hcWinFit) window.removeEventListener('resize', container.__hcWinFit);
        container.__hcWinFit = run;
        window.addEventListener('resize', run);
        container.__hcFit = { disconnect: () => window.removeEventListener('resize', run) };
    }

    /* -----------------------------------------------------------------------
       HEATMAP — .heat (scroll viewport) > .heat-months + .heat-grid > .heat-cell
       weeks[i] = column (Mon..Sun, 7 cells); cell = {date,count,level} | null.
       null → .heat-cell.out (transparent, no silent zero). level 0..4 → .l1..l4.
       ----------------------------------------------------------------------- */
    /* Rozmer bunky heatmapy z reálnej výšky .heat (viac miesta = vyššie bunky).
       Šírka je zhora ohraničená dostupnou šírkou, aby nevznikol vodorovný
       posuvník tam, kde predtým nebol; výška smie byť najviac HEAT_ASPECT×
       širšia, aby z políčok nevznikli prúžky. Zbytok dorovná .heat centrovaním. */
    const HEAT_GAP = 3, HEAT_MIN = 12, HEAT_MAX = 30, HEAT_ASPECT = 1.35;

    function fitHeatmap(container) {
        const heat = container.querySelector('.heat');
        const grid = heat && heat.querySelector('.heat-grid');
        if (!heat || !grid) return;
        const cols = Math.max(1, Math.ceil(grid.children.length / 7));
        // Miesto pre mriežku = vnútro .heat mínus riadok mesiacov a vlastný padding.
        // (scrollHeight sa na to použiť nedá: .heat obsah centruje, takže pri
        // voľnom mieste vracia rovno clientHeight a fit by nikdy nenarástol.)
        const hs = getComputedStyle(heat);
        let overhead = (parseFloat(hs.paddingTop) || 0) + (parseFloat(hs.paddingBottom) || 0);
        const months = heat.querySelector('.heat-months');
        if (months) {
            overhead += months.offsetHeight + (parseFloat(getComputedStyle(months).marginBottom) || 0);
        }
        const availH = heat.clientHeight - overhead;
        const availW = heat.clientWidth;
        if (availH <= 0 || availW <= 0) return;
        const byW = Math.floor((availW - (cols - 1) * HEAT_GAP) / cols);
        const byH = Math.floor((availH - 6 * HEAT_GAP) / 7);
        const w = clamp(byW, HEAT_MIN, HEAT_MAX);
        const h = clamp(Math.min(byH, Math.round(w * HEAT_ASPECT)), HEAT_MIN, HEAT_MAX);
        if (container.__hcCell === w + 'x' + h) return;   // nič sa nemení → nekresli
        container.__hcCell = w + 'x' + h;
        container.style.setProperty('--heat-cell-w', w + 'px');
        container.style.setProperty('--heat-cell-h', h + 'px');
    }

    /* Textová alternatíva heatmapy (P6): to isté, čo inak nesie iba farba —
       slovami a číslami. Žije v `.sr-only`, takže na papieri zostáva graf grafom.
       Vstup je súhrn spočítaný pri kreslení mriežky, nie druhé čítanie z DOM.

       Že je `.sr-only` `position: absolute` a 1×1 px, tu nie je len kozmetika:
       autoFit meria REÁLNU výšku kontejnera, takže blok v toku by odkrojil
       miesto mriežke a ResizeObserver by prepočítaval bunky proti sebe. */
    function heatAlt(sum) {
        const box = el('div', 'sr-only');

        const p = document.createElement('p');
        let t = 'Aktivita za posledných ' + fmtNum(sum.days) + ' dní: spolu '
            + fmtNum(sum.total) + ' záznamov, z toho dní so záznamom '
            + fmtNum(sum.activeDays) + '.';
        if (sum.best && sum.best.count > 0) {
            t += ' Najrušnejší deň ' + fmtDate(sum.best.date) + ' s '
                + fmtNum(sum.best.count) + ' záznamami.';
        }
        p.textContent = t;
        box.appendChild(p);

        if (sum.months.length) {
            const table = document.createElement('table');
            const cap = document.createElement('caption');
            cap.textContent = 'Záznamy po mesiacoch';
            table.appendChild(cap);

            const thead = document.createElement('thead');
            const hr = document.createElement('tr');
            for (const h of ['Mesiac', 'Záznamov']) {
                const th = document.createElement('th');
                th.setAttribute('scope', 'col');
                th.textContent = h;
                hr.appendChild(th);
            }
            thead.appendChild(hr);
            table.appendChild(thead);

            const tbody = document.createElement('tbody');
            for (const m of sum.months) {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.setAttribute('scope', 'row');
                th.textContent = fmtMonthKey(m.key);
                const td = document.createElement('td');
                td.textContent = fmtNum(m.count);
                tr.appendChild(th);
                tr.appendChild(td);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            box.appendChild(table);
        }

        return box;
    }

    function heatmap(container, data) {
        if (!container) return;
        container.__hcCell = null;
        container.innerHTML = '';
        data = data || {};
        const weeks = Array.isArray(data.weeks) ? data.weeks : [];
        const months = data.months || {};
        const cols = weeks.length;

        // Súhrn pre popis a textovú alternatívu — počíta sa v tom istom prechode,
        // ktorý skladá mriežku. Druhýkrát a z DOM by to boli tie isté čísla
        // odvodené inak, teda ďalšie miesto, kde sa plochy vedia rozísť.
        let days = 0, sum = 0, activeDays = 0, best = null;
        const byMonth = new Map();          // „YYYY-MM" → počet záznamov

        const heat = el('div', 'heat');

        // Month labels row — one 12px column per week, label at mapped indices.
        if (cols) {
            const mrow = el('div', 'heat-months');
            // stĺpec = šírka bunky, ktorú dopočíta fitHeatmap do --heat-cell-w
            // (12px je fallback pre stav pred prvým fitom / bez JS merania)
            mrow.style.gridTemplateColumns = 'repeat(' + cols + ', var(--heat-cell-w, 12px))';
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
                    days++;
                    sum += n;
                    if (n > 0) activeDays++;
                    if (!best || n > best.count) best = { count: n, date: d.date || '' };
                    const mk = String(d.date || '').slice(0, 7);
                    if (mk) byMonth.set(mk, (byMonth.get(mk) || 0) + n);
                }
                grid.appendChild(cell);
            }
        }
        if (!REDUCED) grid.classList.add('heat-reveal');
        heat.appendChild(grid);
        container.appendChild(heat);

        /* Prístupnosť heatmapy (P6). Rozhodnutie: JEDEN fokusovateľný kontejner,
           bunky bez `tabindex` a bez vlastného popisu.
           — `role="img"` robí z 365 buniek kresbu (potomkovia sú pre čítačku
             prezentačné), takže `title` na bunke prestáva byť jediným nosičom
             údaja; ten nesie popis nižšie a `.sr-only` alternatíva pod grafom.
           — `tabindex="0"` tu nie je preto, aby sa dalo „prejsť po bunkách"
             (365 zastávok Tabom je samo o sebe chyba), ale preto, že `.heat` je
             vodorovný scroll kontejner (`overflow-x: auto`): bez fokusovateľného
             prvku sa jeho obsah v Chromiu klávesnicou neodskroluje.
           — Prsteň dáva globálne `:focus-visible` z `mind.css`; tu sa CSS nepíše. */
        // Spolu berieme zo servera (rovnaké číslo ako čip „N aktivít za rok"
        // na obrazovke Dnes); vlastný súčet je len záloha pre neúplný payload.
        const total = (data.total != null) ? (+data.total || 0) : sum;

        if (days) {
            let label = 'Heatmapa aktivity: ' + fmtNum(days) + ' dní, spolu '
                + fmtNum(total) + ' záznamov';
            label += (best && best.count > 0)
                ? ', najviac ' + fmtNum(best.count) + ' dňa ' + fmtDate(best.date) + '.'
                : ', žiadny deň so záznamom.';
            heat.setAttribute('role', 'img');
            heat.setAttribute('tabindex', '0');
            heat.setAttribute('aria-label', label);
        }

        // less — [ramp] — more legend
        const legend = el('div', 'heat-legend');
        // Legenda je stupnica farby, nie údaj — bez farby nehovorí nič a čítačke
        // by ostalo len „menej viac". Údaj, ktorý vysvetľuje, je v .sr-only nižšie.
        legend.setAttribute('aria-hidden', 'true');
        legend.appendChild(document.createTextNode('menej'));
        for (let l = 0; l <= 4; l++) {
            const c = el('span', 'heat-cell' + (l ? ' l' + l : ''));
            legend.appendChild(c);
        }
        legend.appendChild(document.createTextNode('viac'));
        container.appendChild(legend);

        if (days) {
            const mkeys = Array.from(byMonth.keys()).sort();
            container.appendChild(heatAlt({
                days: days,
                total: total,
                activeDays: activeDays,
                best: best,
                months: mkeys.map((k) => ({ key: k, count: byMonth.get(k) })),
            }));
        }

        autoFit(container, () => fitHeatmap(container));
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
        const pending = [];
        let drawn = 0;
        if (sum > 0) {
            let start = 0; // cumulative fraction 0..1
            for (const s of segs) {
                const v = +s.value || 0;
                if (v <= 0) continue;
                const frac = v / sum;
                const arc = frac * C;
                const seg = svgEl('circle', {
                    cx: cx, cy: cy, r: r, fill: 'none',
                    stroke: certColor(s.cert),
                    'stroke-width': thickness,
                    'stroke-dasharray': arc + ' ' + (C - arc),
                    'stroke-dashoffset': String(-start * C),
                });
                if (!REDUCED) {
                    // narastá od svojho začiatku, nie od stredu kruhu
                    seg.setAttribute('stroke-dasharray', '0 ' + C);
                    seg.style.transitionDelay = (drawn * 90) + 'ms';
                    seg.classList.add('seg-draw');
                    pending.push([seg, arc + ' ' + (C - arc)]);
                }
                g.appendChild(seg);
                start += frac;
                drawn++;
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
        if (pending.length) nextFrame(() => {
            for (const [node, val] of pending) node.setAttribute('stroke-dasharray', val);
        });
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

        const accent = cssVar('--accent', '#6d3fb5');

        const svg = svgEl('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'none',
            role: 'img',
        });
        svg.style.width = '100%';
        // preserveAspectRatio="none" + non-scaling-stroke → SVG smie vyplniť celú
        // výšku karty bez toho, aby čiara zhrubla. flex-grow berie zbytok miesta,
        // 'auto' základ drží pôvodný pomer 300×90, keď je karta nízka.
        svg.style.height = 'auto';
        svg.style.flex = '1 1 auto';
        svg.style.minHeight = '0';
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

        const areaEl = svgEl('path', {
            d: area, fill: accent, 'fill-opacity': '0.10', stroke: 'none',
        });
        const lineEl = svgEl('path', {
            d: line, fill: 'none', stroke: accent,
            'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            'vector-effect': 'non-scaling-stroke',
        });
        // Last-point marker.
        const dotEl = svgEl('circle', {
            cx: xAt(n - 1), cy: yAt(values[n - 1]), r: '2.5',
            fill: accent, 'vector-effect': 'non-scaling-stroke',
        });
        svg.appendChild(areaEl);
        svg.appendChild(lineEl);
        svg.appendChild(dotEl);

        container.appendChild(svg);

        if (!REDUCED) {
            // getTotalLength() potrebuje prvok V DOKUMENTE — preto až po appendChild.
            const len = lineEl.getTotalLength();
            lineEl.style.strokeDasharray = len;
            lineEl.style.strokeDashoffset = len;
            lineEl.classList.add('line-draw');
            areaEl.classList.add('chart-fade');
            dotEl.classList.add('chart-fade', 'chart-fade-late');
            nextFrame(() => {
                lineEl.style.strokeDashoffset = '0';
                areaEl.classList.add('in');
                dotEl.classList.add('in');
            });
        }

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
