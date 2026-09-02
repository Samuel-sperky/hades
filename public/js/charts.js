/* ===========================================================================
   Hades — charts.js
   Pure SVG / CSS-grid chart builders for the Apollo-integration dashboard.
   No dependencies, no build step, no reliance on mind.js closure state (S).
   Colours are read from CSS custom properties (--heat-*, --cert-*, --accent)
   via getComputedStyle, so the charts stay theme-aware (light / dark) for free.

   API — window.HadesCharts:
     heatmap(el, data, opts)     365-day activity grid (GitHub-style, teal ramp)
     donut(el, segs, opts)       certainty split ring + centre total
     growthLine(el, series,opts) cumulative growth area+line
     sparkline(el, values, opts) trend shape beside a KPI number (no axis, no tip)
     flows(el, data, opts)       two-layer ribbon flow („sankey" bez závislosti)

   Data contracts (dashboard payload §4.4):
     heatmap: { weeks: [[{date,count,level}|null, …7], …≤53], months:{col:"aug"}, total }
     donut:   segs = [{cert:"overene|hypoteza|pasca|bez", value, label?}]
              opts = { total?, centerLabel?, size?, thickness? }
     growth:  series = { labels:["2025-08", …], values:[12,34, …] }  // cumulative
     flows:   data = { links: [{source, target, value, color?}] }

   PRÁZDNY STAV MÁ KAŽDÝ TYP a je to `emptyChart()`, nie vlastná kresba: bez dát
   sa kreslí jedna veta na mieste, kde by bola kresba. Volajúci smie vetu prepísať
   cez `opts.empty` — slová sú jeho, tvar je náš. Do 2. 9. 2026 to tak nebolo a
   tri typy z piatich hovorili inak (zmerané): heatmapa nakreslila PRÁZDNU mriežku
   s legendou „menej — viac" nad ničím, donut šedý prstenec s číslom 0 a
   growthLine nechala kontejner PRÁZDNY (0 potomkov). Prvé dve boli kresba bez
   údaja, tretia mlčanie — a kým to volajúci obchádzal vlastným `emptyCardHtml`,
   platilo to len na obrazovke, ktorá si to pamätala.

   JEDNA POMENOVANÁ VÝNIMKA: `sparkline`. Slot `.kpi-spark` je vysoký 24 px
   (computed style), `.chart-empty` má `min-height: 90px` — veta by KPI kartu
   roztiahla o 66 px a stála by vedľa čísla, ktoré tú istú nulu už hovorí
   (SVG je `aria-hidden`, hodnotu nesie text karty). Sparkline preto kontejner
   len vyprázdni. Nie je to zabudnutý typ; je to jediný typ, ktorý nie je graf
   na čítanie hodnôt.
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
        a cieľový stav do jedného štýlu a animácia sa preskočí.
     *
     * SKRYTÝ DOKUMENT DOSTANE CIEĽOVÝ STAV OKAMŽITE, bez rAF. Pri
     * `document.hidden` je `requestAnimationFrame` podľa špecifikácie zaparkované,
     * takže trieda `.in` nepribehne NIKDY — a `.flow-ribbons` má v mind.css
     * `opacity: 0` do jej príchodu (to isté platilo o `.scatter-dots`, kým
     * 2. 9. 2026 scatter neodišiel), čiže kresba by bola prázdne
     * miesto, ktoré sa po prepnutí na tab dokreslí. Zmerané v Browser pane, kde
     * je tab trvalo `document.hidden`: rAF nevystrelil ani po 900 ms a stuhy
     * stáli na `opacity: 0`. Komentár pri `@media (prefers-reduced-motion)`
     * v mind.css tú istú poruchu predvídal; toto je jej cesta bez rAF.
     * Vedľajší efekt, ktorý sa počíta: merací harness (tab je v ňom vždy skrytý)
     * odteraz vidí KONEČNÝ stav kresby, nie jej nulu.
     */
    function nextFrame(fn) {
        if (document.hidden) { fn(); return; }
        requestAnimationFrame(() => requestAnimationFrame(fn));
    }

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

    function heatmap(container, data, opts) {
        if (!container) return;
        container.__hcCell = null;
        container.innerHTML = '';
        data = data || {};
        const weeks = Array.isArray(data.weeks) ? data.weeks : [];
        const months = data.months || {};
        const cols = weeks.length;

        /* Bez stĺpcov sa kreslí VETA, nie prázdna mriežka. Zmerané pred touto
           zmenou: `heatmap(el, {weeks: []})` vyrobilo `.heat > .heat-grid`
           s nula bunkami a pod ním legendu „menej — viac", teda stupnicu farby
           nad ničím. Legenda bez údaja je horšia než priznanie, že údaj nie je.
           `days === 0` pri prítomných stĺpcoch je iný prípad (kalendár existuje,
           len je v ňom nula) a zostáva kresbou — vtedy mriežka nesie čas. */
        if (!cols) { emptyChart(container, (opts && opts.empty) || 'Zatiaľ bez dát'); return; }

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
       sum=0 → `emptyChart()` (viď hlavičku súboru); track ring sa kreslí len pod
       skutočné segmenty, takže vnútorný `if (sum > 0)` je odteraz už len stráž.
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

        /* Nula segmentov = veta, nie šedý prstenec s číslom 0. Do 2. 9. 2026
           tu bola vlastná kresba prázdna (track ring + „0 uzlov") a komentár
           nad `certColor` ju priznával ako zámer — je to však druhý slovník
           prázdneho stavu v jazyku, ktorý má `emptyChart()`. Rozhoduje `sum`,
           nie `opts.total`: keď súčet segmentov je nula, kresliť sa NEDÁ nič
           bez ohľadu na to, aké číslo príde do stredu. */
        if (sum <= 0) { emptyChart(container, opts.empty || 'Zatiaľ bez dát'); return; }

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
    function growthLine(container, series, opts) {
        if (!container) return;
        container.innerHTML = '';
        series = series || {};
        const values = Array.isArray(series.values) ? series.values.map((v) => +v || 0) : [];
        const labels = Array.isArray(series.labels) ? series.labels : [];
        const n = values.length;
        /* Prázdna séria hlási, nemlčí. `renderGrowth()` v `dnes.js` si vetu
           kreslí sám PRED volaním (a smie — slová sú jeho), takže sa tieto dva
           stavy nemôžu zraziť: keď si ju nakreslí, sem sa nedostane. Zmerané
           pred zmenou: `growthLine(el, {values: []})` nechalo kontejner s nula
           potomkami, takže každý ĎALŠÍ volajúci by dostal ticho. */
        if (!n) { emptyChart(container, (opts && opts.empty) || 'Zatiaľ bez dát'); return; }

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
        /* POPISKY OSI SÚ SLOVÁ, nie dáta. `series.dateLabels` hovorí, že prišli
           ako ISO dátumy (30-dňový pohľad z heatmapy), nie ako mesačné kľúče —
           bez toho os vypísala „2026-08-02", teda kód, nie dátum. Ten istý
           rozdiel rieši `fmtDate()` v tooltipe heatmapy; príznak sa posielal
           už predtým, ale nikto ho nečítal (nález review).

           Mesačné kľúče („2026-08") ide `fmtMonthKey()`, čo bolo aj doteraz
           správne — preto sa vetví podľa príznaku a nie podľa tvaru reťazca. */
        if (labels.length) {
            const fmt = series.dateLabels ? fmtDate : fmtMonthKey;
            const axis = el('div', 'chart-axis');
            const a = el('span'); a.textContent = labels[0] ? fmt(labels[0]) : '';
            const b = el('span'); b.textContent = labels[labels.length - 1] ? fmt(labels[labels.length - 1]) : '';
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

    /* ---- mriežka ---------------------------------------------------------
       `gridLines(svg, W, H, pad, ticks)` ODIŠLA 2. 9. 2026 SPOLU SO `scatter`
       (dôvod nižšie), pretože scatter bol jej JEDINÝ volajúci — heatmapa,
       donut, growthLine, sparkline ani flows mriežku nekreslia, a nekreslia ju
       zámerne: growthLine je 300×90 kumulatívna krivka bez čítania hodnôt,
       donut a flows sú podiely, sparkline je tvar. Nechať helper bez volajúceho
       by bola presne tá chyba, ktorú tento súbor týmto sprintom platí.

       Keď pribudne typ s HODNOTOVOU OSOU, mriežka sa vráti ako prvá — je to
       12 riadkov `<line>` v skupine `.chart-grid`. Vráť ju **spolu s volajúcim**,
       nie pred ním, a nechaj ju kresliť POD dáta v tokene `--chart-grid` (nie
       `--line-soft`), aby sa dala posunúť bez toho, aby sa pohli rámy kariet.
       Kresba `.chart-grid line` v `mind.css` odchádza v tej istej vlne ako
       `.scatter-*` (report), takže sa vracia spolu s ňou — mŕtve pravidlo, ktoré
       „na niečo čaká", je tá istá chyba o úroveň nižšie. */

    /** Textová os pod grafom — tá istá kresba pre všetky typy (`.chart-axis`). */
    function axisRow(container, labels) {
        if (!labels || !labels.length) return null;
        const axis = el('div', 'chart-axis');
        for (const l of labels) { const s = el('span'); s.textContent = l; axis.appendChild(s); }
        container.appendChild(axis);
        return axis;
    }

    /** Legenda — jeden tvar swatchu pre celú appku.
     *
     * Swatch je PRSTENEC, nie plný disk — tak, ako to pri `.chart-legend-sw`
     * v mind.css hovorí komentár (manuál §2: plné disky v legende učili zle,
     * pretože uzol na plátne je prstenec). Kým bola legenda bez volajúceho,
     * kreslila výplň a nikto si to nevšimol. Výplň je odteraz priznaná VOĽBA
     * (`it.fill`) pre grafy, ktoré kreslia PLOCHU (donut, heatmapa), nie uzly.
     *
     * Prstenec je `inset box-shadow`, nie `border`: `.chart-legend-sw` je 10×10 px
     * v content-boxe, takže border by swatch rozšíril na 13 px a rozhodil krok
     * legendy — a rozmer napísaný v JS je pre CSSOM aj tak neviditeľný.
     */
    function legendRow(container, items) {
        if (!items || !items.length) return null;
        const wrap = el('div', 'chart-legend');
        for (const it of items) {
            const row = el('span', 'chart-legend-item');
            const sw = el('i', 'chart-legend-sw');
            if (it.fill) sw.style.background = it.color;
            else sw.style.boxShadow = 'inset 0 0 0 1.5px ' + it.color;
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
       čítačku len zdržala.

       A práve preto je to JEDINÝ typ bez `emptyChart()` — pomenovaná výnimka
       s číslami, nie opomenutie: slot `.kpi-spark` má computed `height: 24px`,
       `.chart-empty` má `min-height: 90px`, takže veta by kartu roztiahla o 66 px
       a povedala nulu, ktorú číslo v karte hovorí presnejšie. Bez dvoch bodov
       teda kontejner len vyprázdnime — trend, ktorý neexistuje, nemá tvar. */
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

    /* ---- scatter: ZMAZANY 2. 9. 2026, a toto je jeho verdikt ------------
       `scatter(el, points, opts)` tu zil od vlny 28. 8. 2026 BEZ VOLAJUCEHO
       a manual to priznaval ("bez volajuceho"). Priznana nepouzita kresba je
       lepsia nez zamlcana, ale tretim stavom byt neprestala: kresba, ktoru nikto
       nevola, sa neda udrziavat ani overit - jej jedinym testom bolo, ze sa nacita.

       ROZHODLO MERANIE, nie vkus. Jedine data s dvojrozmernym tvarom "sila x vek
       uzla" posiela `/api/mind` (krmi platno Grafu): zmerane 2. 9. 2026 - 1 223
       uzlov, VSETKY nesu `strength` aj `created_at`, sila 1-25, vek 0-49 dni.
       Ten graf sa v TEJTO kresbe nakreslit NEDA:
         - plocha `viewBox` 320x180 minus `pad` 18 = 284x144 = 40 896 px2,
           bod `r = 4` = 50,3 px2 -> 1 223 bodov je 1,5x plocha grafu, teda
           150 % pretazenie farbou;
         - na odlisitelnu (polovicnu pixelovu) poziciu padne 232 z 1 223 bodov,
           cize 81 % uzlov je nerozoznatelnych - to uz nie je scatter, to je
           skvrna a odpoved by musela byt hustotna (hexbin), teda INY typ;
         - `bindTip` viaze 3 listenery na bod -> 3 669 listenerov na jednu kartu.

       A DOMOV NEBOL ANI PRE TU SKVRNU. "Statistiky Grafu" v `panels.js`
       neexistuju (grep `kpi-card|chart-|statist` v tom subore = 0 zasahov; je to
       panel uzla, legenda a rucne prepajanie hran). `kontrola.js` frontu ako
       domov ZAMERNE odmieta a pise preco ("`/api/review/queue` posiela len
       `needs_review` podmnozinu, takze by graf odpovedal na inu otazku, nez aku
       fronta klade"). Kniznica `strength` v riadku vobec nema. Dnes je jedina
       obrazovka postavena na kartach grafov, ale per-uzlovu silu ani vek
       nedostava - to by bol novy agregat na serveri, teda nove zadanie.

       CO ODISLO S NIM: `gridLines()` (scatter bol jej jediny volajuci, vid
       komentar pri osi) a nic ine - `axisRow`, `legendRow`, `bindTip`,
       `emptyChart` aj `periodSwitch` maju zivych volajucich. V `mind.css`
       zostavaju `.scatter-dots` / `.scatter-dot` a jedna zmienka v podlahe
       `prefers-reduced-motion`; tento subor ich needituje (nevlastni ich) -
       odchadzaju v reporte vlny spolu s riadkami manualu.

       KED SA VRATI: vrat ho SPOLU s obrazovkou, ktora ho vola, a pre 1 000+
       uzlov s hustotou (agregacia do buniek) a JEDNYM delegovanym tooltipom nad
       skupinou, nie s tromi listenermi na bod. */

    /* ---- toky (F2, „sankey") ---------------------------------------------
       DVOJVRSTVOVÝ tok, nie všeobecný sankey. Rozhodnutie s dôvodom: `d3-sankey`
       je samostatný balík (nová závislosť, kontrakt ju zakazuje) a jeho jediná
       výhoda — iteratívne rozvrstvenie viacúrovňového grafu — je pre otázku
       „ktorá oblasť tečie do ktorého projektu" zbytočná. Dve vrstvy sa dajú
       rozvrhnúť presne: výška uzla = jeho podiel na súčte, poradie = zostupne.

       Stuhy sú kubické Bézierove krivky s vodorovnými riadiacimi bodmi, takže
       vstup aj výstup dosadá na uzol pod pravým uhlom a stuhy sa nekrížia viac,
       než musia.

       FARBU NESIE VOLAJÚCI, nie tento súbor: `l.color` stuhy a `opts.nodeColor(name,
       side)` uzly. Je to ten istý dôvod ako pri `label` donutu — utlmenie farby
       oblasti (`mutedColor()`) aj slovník istoty (`--cert-*`) sú veci obrazovky,
       nie jazyka grafu. `nodeColor` je funkcia, nie mapa: obe strany môžu nesť
       rôzne kanály (vľavo oblasť, vpravo istota) a `side` ich rozlíši.

       OBE STRANY MERAJÚ PROTI TEJ ISTEJ VÝŠKE (`usable`) — a to je podmienka, nie
       kozmetika. Kým si každá strana odpočítala len svoje medzery, kratšia strana
       (4 uzly proti 5) dostala vyššie uzly než súčet stúh, ktoré do nich vtekajú,
       takže spodok cieľového uzla zostal prázdny bez toho, aby to čokoľvek
       znamenalo. Cenou je, že kratší stĺpec nedosiahne spodný okraj — to je
       pravda o dátach, nie chyba kresby. */
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
        const usable = H - gap * Math.max(0, Math.max(left.length, right.length) - 1);

        const place = (arr, x, sideKey) => {
            let y = 0;
            const map = new Map();
            for (const [name, v] of arr) {
                const h = Math.max(2, (v / total) * usable);
                map.set(name, {
                    x: x, y: y, h: h, v: v, name: name, cursor: y,
                    color: opts.nodeColor ? opts.nodeColor(name, sideKey) : null,
                });
                y += h + gap;
            }
            return map;
        };
        const L = place(left, 0, 'source'), R = place(right, W - nodeW, 'target');

        const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
        svg.setAttribute('aria-label', opts.label || ('Toky: ' + links.length + ' spojení, '
            + left.length + ' zdrojov, ' + right.length + ' cieľov'));
        // Rozmer je inline z toho istého dôvodu ako pri growthLine: SVG bez width
        // by v `.dash-card` (flex column) dostalo intrinzických 300 px a karta by
        // ho neroztiahla.
        svg.style.width = '100%';
        svg.style.height = 'auto';
        svg.style.display = 'block';

        // stuhy pod uzlami — uzol musí prekryť ich zakončenie
        const ribbons = svgEl('g', { class: 'flow-ribbons' });
        for (const l of [...links].sort((a, b) => (+b.value || 0) - (+a.value || 0))) {
            const a = L.get(l.source), b = R.get(l.target);
            if (!a || !b) continue;
            const t = (+l.value || 0) / total;
            const h = Math.max(1, t * usable);
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
        /* Os menuje STĹPCE, nie uzly — `.chart-axis` je `space-between`, takže
           prvý popisok sedí pod ľavým a druhý pod pravým stĺpcom. Deľba platí
           pre celý súbor: kresba je v SVG, slová v HTML. */
        if (opts.sourceLabel || opts.targetLabel) {
            axisRow(container, [String(opts.sourceLabel || ''), String(opts.targetLabel || '')]);
        }
        container.appendChild(flowAlt(links, left, right, total));
        nextFrame(() => ribbons.classList.add('in'));
    }

    /* Textová alternatíva tokov — jediná cesta k obsahu pre čítačku a klávesnicu,
       pretože hodnotu stuhy nesie inak len hrúbka a tooltip (a ten dotyk zámerne
       nedostáva). `aria-label` na SVG hlási TVAR (koľko stúh), táto tabuľka OBSAH.
       Žije v `.sr-only`, takže výšku karty neovplyvní. */
    function flowAlt(links, left, right, total) {
        const box = el('div', 'sr-only');

        const p = document.createElement('p');
        p.textContent = 'Spolu ' + fmtNum(total) + ' v ' + fmtNum(links.length)
            + ' tokoch medzi ' + fmtNum(left.length) + ' zdrojmi a '
            + fmtNum(right.length) + ' cieľmi.';
        box.appendChild(p);

        const table = document.createElement('table');
        const cap = document.createElement('caption');
        cap.textContent = 'Toky po zdrojoch';
        table.appendChild(cap);

        const thead = document.createElement('thead');
        const hr = document.createElement('tr');
        for (const h of ['Zdroj', 'Cieľ', 'Počet']) {
            const th = document.createElement('th');
            th.setAttribute('scope', 'col');
            th.textContent = h;
            hr.appendChild(th);
        }
        thead.appendChild(hr);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        // Poradie je to isté, v akom sa stĺpce kreslia (zostupne podľa súčtu),
        // aby tabuľka a kresba hovorili v jednom poradí.
        for (const [name] of left) {
            for (const l of links.filter((x) => x.source === name)
                .sort((a, b) => (+b.value || 0) - (+a.value || 0))) {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.setAttribute('scope', 'row');
                th.textContent = name;
                const t1 = document.createElement('td');
                t1.textContent = String(l.target == null ? '' : l.target);
                const t2 = document.createElement('td');
                t2.textContent = fmtNum(l.value);
                tr.appendChild(th); tr.appendChild(t1); tr.appendChild(t2);
                tbody.appendChild(tr);
            }
        }
        table.appendChild(tbody);
        box.appendChild(table);
        return box;
    }

    /* Export: jeden objekt, jeden jazyk. Nový typ grafu sa PRIDÁVA sem a musí
       použiť spoločné helpery (axisRow, legendRow, bindTip, emptyChart,
       periodSwitch; mriežku vráť podľa komentára pri osi) —
       inak sa jazyk osí a legiend rozíde presne tak, ako sa rozišiel pred vlnou 1. */
    window.HadesCharts = {
        heatmap: heatmap, donut: donut, growthLine: growthLine,
        sparkline: sparkline, flows: flows,
        periodSwitch: periodSwitch, emptyChart: emptyChart, legend: legendRow,
        /* `certColor` je vystavené preto, aby slovník istoty mal JEDNU farbu na
           celej appke: donut si ju rozhoduje sám (dostáva `cert` kľúč), ale toky
           dostávajú farbu od volajúceho — a bez tohto exportu by si ju obrazovka
           musela prečítať z `--cert-*` druhýkrát a vlastnou cestou. */
        certColor: certColor,
    };
})();
