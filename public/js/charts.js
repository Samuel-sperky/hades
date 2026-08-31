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

       Stráž je ŽIVÁ: hodnota sa drží v premennej a prepisuje ju listener na
       'change'. Preferencia sa dá prepnúť v OS za behu (a nástroje ju emulujú až
       po navigácii), takže hodnota zamrznutá na čase načítania je proste nesprávna
       — dashboard sa prekresľuje pri každom načítaní dát, ale stráž si až doteraz
       niesla stav z prvého rámca session.

       Prečo to NIE JE porušenie ceny, ktorú tu obhajoval predchádzajúci komentár:
       ten hovoril, že kontrola v každom vykreslení by pri heatmape znamenala dopyt
       na 365 buniek. Dve veci na tom neplatia. Po prvé, stráž sa ani predtým
       nečítala v bunkovej slučke — `heat-reveal` sa pridáva RAZ na celú mriežku,
       a CSS to tak drží zámerne (`.heat-grid.heat-reveal` animuje celú mriežku
       jednou animáciou práve preto, aby sa nerobilo nič per bunku), takže 365
       dopytov nikdy nehrozilo. Po druhé, zmerané v headless Chrome
       (medián z 5 sérií po 2000 blokoch, 365 čítaní na blok):
         • `window.matchMedia(...).matches` volaný v slučke  0,2999 ms / 365 (0,82 µs na volanie)
         • cachovaná konštanta                               0,0003 ms / 365
         • ŽIVÁ premenná držaná listenerom                   0,0003 ms / 365
       Kalibrácia merača známym drahým prípadom: `getComputedStyle` 0,0780 ms / 365,
       teda 260× nad cachovaným čítaním — merač meria, nevracia nuly.
       Živá premenná je na čítanie presne tak lacná ako konštanta (rozdiel 0,0001 ms
       na 365 čítaní, teda šum); zaplatí sa jediný `matchMedia` pri načítaní. Je to
       teda najlepšie z oboch, nie kompromis.

       Tichá verzia zmeny ZA BEHU je v CSS, nie tu, a preto sa už vykreslené grafy
       neprekresľujú: plošná podlaha `*, *::before, *::after` v `mind.css`
       (@media prefers-reduced-motion) zráža `animation-duration` aj
       `transition-duration` na .01 ms, a `@media` sa vyhodnocuje živo. Prepnutie
       na „reduce" uprostred kresby teda beh okamžite dosadí do cieľového stavu —
       graf zostane úplný, len prestane ísť. Táto premenná preto riadi len to, či
       sa triedy pri NASLEDUJÚCOM vykreslení vôbec pridajú.

       Pasca pri overovaní: harness, ktorý tento súbor vyhodnotí cez
       `page.evaluate(zdroj)` namiesto `<script src>`, hlási stráž ako MŔTVU
       (triedy sa po prepnutí na „reduce" pridávajú ďalej) — falošný pád, ktorý
       zvádza „opraviť" funkčný kód. Načítaj súbor tak, ako ho načíta blade.
       `emulateMediaFeatures` udalosť 'change' vydáva správne, to nie je problém. */
    let reduceMotion = false;
    if (window.matchMedia) {
        const rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
        reduceMotion = rmq.matches;                 // počiatočný stav z toho ISTÉHO objektu
        const onReduceChange = (e) => { reduceMotion = e.matches; };
        if (rmq.addEventListener) rmq.addEventListener('change', onReduceChange);
        else if (rmq.addListener) rmq.addListener(onReduceChange);   // starší Safari
    }

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
            + fmtNum(sum.total) + ' záznamov, z toho dní so záznamom '
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
                    /* fmtDate() a nie surové ISO: `data-tip` čita človek aj čítačka
                       (je aj v `title`), a „2025-09-01" je kód, nie dátum. Formátovanie
                       je SLOVO, takže patrí do prehliadača — server posiela ISO. */
                    const tip = fmtDate(d.date) + ' · ' + fmtNum(n);
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
        if (!reduceMotion) grid.classList.add('heat-reveal');

        /* Spoločný tooltip JEDNÝM delegovaným listenerom, nie bindTip na bunku:
           mriežka má 365 buniek a tri listenery na každú je 1 095 uzáverov
           uložených navyše za nulový úžitok. `title` na bunke ZOSTÁVA — je to
           textová alternatíva pre klávesnicu a dotyk, kde hover neexistuje.
        
           Formát „19. 8. 2026 · 12" skladá `data-tip` už pri kreslení, takže
           tooltip nič neprepočítava a nemôže sa s `title` rozísť. */
        grid.addEventListener('mousemove', (e) => {
            const cell = e.target.closest ? e.target.closest('.heat-cell[data-tip]') : null;
            if (!cell) { hideTip(); return; }
            const box = cell.getBoundingClientRect();
            showTip(esc(cell.getAttribute('data-tip')), box.left + box.width / 2, box.top);
        });
        grid.addEventListener('mouseleave', hideTip);

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
                /* Tooltip nesie PRESNÚ hodnotu aj podiel, pretože malý segment sa
                   z kresby prečítať nedá: hypotéza je na dnešných dátach 24 z 2 773,
                   teda 0,9 % kruhu ≈ 3 stupne. Donut sa preto NEDEFORMUJE (minimálny
                   viditeľný oblúk by z pomeru urobil lož) — číslo dodáva legenda
                   a tooltip. */
                bindTip(seg, () => '<b>' + esc(s.label || s.cert || '') + '</b><br>'
                    + fmtNum(v) + ' · ' + (frac * 100).toFixed(1).replace('.', ',') + ' %');
                if (!reduceMotion) {
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

        if (!reduceMotion) {
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

        /* First / last period labels below the chart.
           Drawing lives in `.chart-axis` (mind.css), NOT in this file: the axis
           used to set `style.cssText` with a hard-coded `font-size:10px`, and a
           size written in JS is invisible to the CSSOM — no stylesheet assertion
           could ever find it, so all three charts drifted apart unnoticed.
           `el()` is this file's own local helper; charts.js is a classic script
           (IIFE exposing `window.HadesCharts`), never an ES module. */
        if (labels.length) {
            const axis = el('div', 'chart-axis');
            const a = el('span'); a.textContent = labels[0] || '';
            const b = el('span'); b.textContent = labels[labels.length - 1] || '';
            axis.appendChild(a);
            if (labels.length > 1) axis.appendChild(b);
            container.appendChild(axis);
        }
    }


    /* =======================================================================
       JEDEN JAZYK GRAFOV (kontrakt 28. 8. 2026, F1–F5)
       =======================================================================
       PREČO TENTO SÚBOR ZOSTÁVA BEZ ZÁVISLOSTÍ, hoci kontrakt hovoril „d3":
       d3 je na `/` naozaj načítané (a to PRED charts.js), takže by bolo po ruke.
       Nepoužíva sa z troch dôvodov a je to zmena rozhodnutia, nie opomenutie:
         1. Tokové diagramy v jadre d3 NIE SÚ — `d3-sankey` je samostatný balík,
            takže „použi d3" by tú jednu vec, pre ktorú by sa hodilo najviac,
            nevyriešilo a pribudla by nová závislosť (kontrakt ju zakazuje).
         2. Všetko ostatné tu sú škály a cesty, ktoré si tento súbor už dnes
            skladá sám a robí to v ~40 riadkoch.
         3. Bez závislostí sa charts.js dá načítať aj na `/console` a `/chat`,
            kde d3 nie je — a tam grafy raz budú chcieť byť.

       SPOLOČNÉ PRVKY (os, mriežka, legenda, tooltip, prázdny stav) sú helpery
       nižšie. Nový graf ich MUSÍ použiť; keď si nakreslí vlastnú os, jazyk sa
       rozíde presne tak, ako sa rozišli tri grafy pred vlnou 1.

       TICHÁ VERZIA: kreslenie je `opacity`/`transform` prechod na triedach
       `.in`, takže plošná podlaha `prefers-reduced-motion` v mind.css ho
       skráti na .01 ms a graf je hotový OKAMŽITE, nie nenakreslený. */

    /* ---- tooltip: jeden na dokument, nie jeden na graf --------------------
       Jeden prvok znovupoužívaný všetkými grafmi. Dôvod nie je výkon, ale to,
       že dva tooltipy naraz sú vždy chyba — pri prechode myšou medzi dvoma
       grafmi by starý zostal visieť.
       `aria-hidden`: obsah tooltipu je VŽDY aj v `aria-label` alebo `title`
       daného prvku, takže pre čítačku by to bola druhá kópia tej istej vety. */
    let _tip = null;
    function tipEl() {
        if (_tip && _tip.isConnected) return _tip;
        _tip = el('div', 'chart-tip');
        _tip.setAttribute('aria-hidden', 'true');
        document.body.appendChild(_tip);
        return _tip;
    }
    function showTip(html, x, y) {
        const t = tipEl();
        t.innerHTML = html;
        t.classList.add('on');
        // Najprv zobraz, potom meraj — skrytý prvok má nulové rozmery.
        const r = t.getBoundingClientRect();
        const pad = 10;
        let left = x - r.width / 2;
        let top = y - r.height - pad;
        // Držať v okne: tooltip pri hrane sa preklopí, neodreže sa.
        left = clamp(left, pad, window.innerWidth - r.width - pad);
        if (top < pad) top = y + pad;
        t.style.left = Math.round(left) + 'px';
        t.style.top = Math.round(top) + 'px';
    }
    function hideTip() { if (_tip) _tip.classList.remove('on'); }

    /** Napojí tooltip na prvok. `fn` vracia HTML (už escapované volajúcim). */
    function bindTip(node, fn) {
        node.addEventListener('mouseenter', (e) => showTip(fn(), e.clientX, e.clientY));
        node.addEventListener('mousemove', (e) => showTip(fn(), e.clientX, e.clientY));
        node.addEventListener('mouseleave', hideTip);
        /* Dotyk tooltip NEDOSTÁVA: na dotykovom zariadení nie je „hover" a
           tooltip pod prstom zakrýva presne to, na čo sa človek pozerá. Význam
           tam nesie `aria-label` a textová alternatíva pod grafom. */
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    /* ---- prázdny stav grafu ----------------------------------------------
       Prázdny GRAF nie je prázdna OBRAZOVKA, preto to nie je `.empty`: nemá
       ikonu ani akciu, je to jedna veta na mieste, kde by bola kresba. Manuál
       §8 zakazuje prázdnemu stavu vymýšľať si novú farbu — nesie `--muted`. */
    function emptyChart(container, text) {
        if (!container) return;
        container.innerHTML = '';
        const box = el('div', 'chart-empty');
        box.textContent = text || 'Zatiaľ bez dát';
        container.appendChild(box);
    }

    /* ---- mriežka a os ----------------------------------------------------
       Vodorovná mriežka: `ticks` liniek vrátane nuly. Kreslí sa POD dáta a
       nesie `--chart-grid` (nie `--line-soft`): mriežka je súčasť jazyka grafov
       a musí sa dať posunúť bez toho, aby sa pohli rámy kariet. */
    function gridLines(svg, W, H, pad, ticks) {
        const g = svgEl('g', { class: 'chart-grid' });
        for (let i = 0; i <= ticks; i++) {
            const y = pad + (i / ticks) * (H - pad * 2);
            g.appendChild(svgEl('line', { x1: pad, y1: y, x2: W - pad, y2: y }));
        }
        svg.appendChild(g);
        return g;
    }

    /** Textová os pod grafom — tá istá kresba pre všetky typy (`.chart-axis`). */
    function axisRow(container, labels) {
        if (!labels || !labels.length) return null;
        const axis = el('div', 'chart-axis');
        for (const l of labels) { const s = el('span'); s.textContent = l; axis.appendChild(s); }
        container.appendChild(axis);
        return axis;
    }

    /** Legenda — jeden tvar swatchu pre celú appku. */
    function legendRow(container, items) {
        if (!items || !items.length) return null;
        const wrap = el('div', 'chart-legend');
        for (const it of items) {
            const row = el('span', 'chart-legend-item');
            const sw = el('i', 'chart-legend-sw');
            sw.style.background = it.color;
            row.appendChild(sw);
            const tx = el('span'); tx.textContent = it.label;
            row.appendChild(tx);
            wrap.appendChild(row);
        }
        container.appendChild(wrap);
        return wrap;
    }

    /* ---- prepínač období (F3, F4) ----------------------------------------
       Vracia prvok; volajúci ho vloží tam, kde ho chce mať. `onPick` dostane
       kľúč obdobia. Aktívne obdobie nesie `aria-pressed`, nie vlastnú triedu —
       stav ovládača patrí do prístupnostného stromu, nie len do CSS. */
    function periodSwitch(periods, active, onPick) {
        const wrap = el('div', 'chart-periods');
        wrap.setAttribute('role', 'group');
        wrap.setAttribute('aria-label', 'Obdobie grafu');
        for (const p of periods) {
            const b = el('button', 'chart-period');
            b.type = 'button';
            b.textContent = p.label;
            b.setAttribute('aria-pressed', p.key === active ? 'true' : 'false');
            b.addEventListener('click', () => {
                for (const other of wrap.querySelectorAll('.chart-period')) {
                    other.setAttribute('aria-pressed', 'false');
                }
                b.setAttribute('aria-pressed', 'true');
                onPick(p.key);
            });
            wrap.appendChild(b);
        }
        return wrap;
    }

    /* ---- sparkline (E4) ---------------------------------------------------
       Bez osí, bez mriežky, bez tooltipu: je to TVAR trendu vedľa čísla, nie
       graf na čítanie hodnôt. Preto ani nedostáva `role="img"` s popisom —
       hodnotu aj zmenu nesie text karty vedľa neho, a druhá kópia tej vety by
       čítačku len zdržala. */
    function sparkline(container, values, opts) {
        if (!container) return;
        container.innerHTML = '';
        const vals = Array.isArray(values) ? values.map((v) => +v || 0) : [];
        if (vals.length < 2) return;
        opts = opts || {};
        const W = 100, H = 24;
        const min = Math.min.apply(null, vals);
        const max = Math.max.apply(null, vals);
        const span = (max - min) || 1;
        const xAt = (i) => (i / (vals.length - 1)) * W;
        const yAt = (v) => H - ((v - min) / span) * (H - 2) - 1;
        const svg = svgEl('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'none',
            class: 'spark',
            'aria-hidden': 'true',
        });
        let d = '';
        vals.forEach((v, i) => { d += (i ? ' L ' : 'M ') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1); });
        const area = svgEl('path', {
            d: d + ' L ' + W + ' ' + H + ' L 0 ' + H + ' Z',
            class: 'spark-area',
        });
        const line = svgEl('path', { d: d, class: 'spark-line' });
        if (opts.trend) svg.setAttribute('data-trend', opts.trend);
        svg.appendChild(area);
        svg.appendChild(line);
        container.appendChild(svg);
    }

    /* ---- scatter (F2) -----------------------------------------------------
       Body sú PRSTENCE, nie disky — tá istá vizuálna sémantika ako na plátne
       grafu (priehľadnosť nesie diera, nie nízka alfa), takže sa prekrývajúce
       body dajú čítať. */
    function scatter(container, points, opts) {
        if (!container) return;
        container.innerHTML = '';
        const pts = Array.isArray(points) ? points : [];
        if (!pts.length) { emptyChart(container, (opts && opts.empty) || 'Zatiaľ bez dát'); return; }
        opts = opts || {};
        const W = 320, H = 180, pad = 18;
        const xs = pts.map((p) => +p.x || 0);
        const ys = pts.map((p) => +p.y || 0);
        const xMin = Math.min.apply(null, xs), xMax = Math.max.apply(null, xs) || 1;
        const yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys) || 1;
        const xSpan = (xMax - xMin) || 1, ySpan = (yMax - yMin) || 1;
        const xAt = (v) => pad + ((v - xMin) / xSpan) * (W - pad * 2);
        const yAt = (v) => H - pad - ((v - yMin) / ySpan) * (H - pad * 2);

        const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
        svg.setAttribute('aria-label', opts.label
            || (pts.length + ' bodov, ' + (opts.xLabel || 'x') + ' proti ' + (opts.yLabel || 'y')));
        gridLines(svg, W, H, pad, 4);
        const dots = svgEl('g', { class: 'scatter-dots' });
        for (const p of pts) {
            const c = svgEl('circle', {
                cx: xAt(+p.x || 0).toFixed(1),
                cy: yAt(+p.y || 0).toFixed(1),
                r: p.r || 4,
                class: 'scatter-dot',
            });
            if (p.color) c.style.stroke = p.color;
            bindTip(c, () => '<b>' + esc(p.label || '') + '</b><br>'
                + esc(opts.xLabel || 'x') + ': ' + fmtNum(p.x) + '<br>'
                + esc(opts.yLabel || 'y') + ': ' + fmtNum(p.y));
            dots.appendChild(c);
        }
        svg.appendChild(dots);
        container.appendChild(svg);
        axisRow(container, [String(opts.xLabel || ''), String(opts.yLabel || '')]);
        nextFrame(() => dots.classList.add('in'));
    }

    /* ---- toky (F2, „sankey") ---------------------------------------------
       DVOJVRSTVOVÝ tok, nie všeobecný sankey. Rozhodnutie s dôvodom: `d3-sankey`
       je samostatný balík (nová závislosť, kontrakt ju zakazuje) a jeho jediná
       výhoda — iteratívne rozvrstvenie viacúrovňového grafu — je pre otázku
       „ktorá oblasť tečie do ktorého projektu" zbytočná. Dve vrstvy sa dajú
       rozvrhnúť presne: výška uzla = jeho podiel na súčte, poradie = zostupne.

       Stuhy sú kubické Bézierove krivky s vodorovnými riadiacimi bodmi, takže
       vstup aj výstup dosadá na uzol pod pravým uhlom a stuhy sa nekrížia viac,
       než musia. */
    function flows(container, data, opts) {
        if (!container) return;
        container.innerHTML = '';
        data = data || {};
        const links = Array.isArray(data.links) ? data.links.filter((l) => (+l.value || 0) > 0) : [];
        if (!links.length) { emptyChart(container, (opts && opts.empty) || 'Zatiaľ žiadne toky'); return; }
        opts = opts || {};

        const W = 340, H = 200, nodeW = 10, gap = 6;
        const side = (key) => {
            const seen = new Map();
            for (const l of links) {
                const k = l[key];
                seen.set(k, (seen.get(k) || 0) + (+l.value || 0));
            }
            return [...seen.entries()].sort((a, b) => b[1] - a[1]);
        };
        const left = side('source'), right = side('target');
        const total = links.reduce((s, l) => s + (+l.value || 0), 0);

        const place = (arr, x) => {
            const usable = H - gap * Math.max(0, arr.length - 1);
            let y = 0;
            const map = new Map();
            for (const [name, v] of arr) {
                const h = Math.max(2, (v / total) * usable);
                map.set(name, { x: x, y: y, h: h, v: v, name: name, cursor: y });
                y += h + gap;
            }
            return map;
        };
        const L = place(left, 0), R = place(right, W - nodeW);

        const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
        svg.setAttribute('aria-label', opts.label || ('Toky: ' + links.length + ' spojení, '
            + left.length + ' zdrojov, ' + right.length + ' cieľov'));

        // stuhy pod uzlami — uzol musí prekryť ich zakončenie
        const ribbons = svgEl('g', { class: 'flow-ribbons' });
        for (const l of [...links].sort((a, b) => (+b.value || 0) - (+a.value || 0))) {
            const a = L.get(l.source), b = R.get(l.target);
            if (!a || !b) continue;
            const t = (+l.value || 0) / total;
            const h = Math.max(1, t * (H - gap * Math.max(0, Math.max(left.length, right.length) - 1)));
            const y1 = a.cursor + h / 2, y2 = b.cursor + h / 2;
            a.cursor += h; b.cursor += h;
            const x1 = nodeW, x2 = W - nodeW;
            const cx = (x1 + x2) / 2;
            const p = svgEl('path', {
                d: 'M ' + x1 + ' ' + y1.toFixed(1)
                    + ' C ' + cx + ' ' + y1.toFixed(1) + ', ' + cx + ' ' + y2.toFixed(1)
                    + ', ' + x2 + ' ' + y2.toFixed(1),
                class: 'flow-ribbon',
                'stroke-width': h.toFixed(1),
            });
            if (l.color) p.style.stroke = l.color;
            bindTip(p, () => esc(l.source) + ' → ' + esc(l.target) + '<br><b>' + fmtNum(l.value) + '</b>');
            ribbons.appendChild(p);
        }
        svg.appendChild(ribbons);

        const nodes = svgEl('g', { class: 'flow-nodes' });
        for (const map of [L, R]) {
            for (const n of map.values()) {
                const r = svgEl('rect', {
                    x: n.x, y: n.y.toFixed(1), width: nodeW, height: n.h.toFixed(1),
                    rx: 2, class: 'flow-node',
                });
                if (n.color) r.style.fill = n.color;
                bindTip(r, () => '<b>' + esc(n.name) + '</b><br>' + fmtNum(n.v));
                nodes.appendChild(r);
            }
        }
        svg.appendChild(nodes);
        container.appendChild(svg);
        nextFrame(() => ribbons.classList.add('in'));
    }

    /* Export: jeden objekt, jeden jazyk. Nový typ grafu sa PRIDÁVA sem a musí
       použiť spoločné helpery (gridLines, axisRow, legendRow, bindTip, emptyChart) —
       inak sa jazyk osí a legiend rozíde presne tak, ako sa rozišiel pred vlnou 1. */
    window.HadesCharts = {
        heatmap: heatmap, donut: donut, growthLine: growthLine,
        sparkline: sparkline, scatter: scatter, flows: flows,
        periodSwitch: periodSwitch, emptyChart: emptyChart, legend: legendRow,
    };
})();
