/* AuraAI — grafy (čisté SVG / CSS grid, žiadna závislosť, žiadny build hack).

   Verejné API (ES import je preferovaný; `window.HadesCharts` / `window.AuraCharts`
   zostávajú ako spätne kompatibilné konzolové haky):
     heatmap(el, data)       365-dňová mriežka aktivity
     donut(el, segs, opts)   prstenec istoty + celkové číslo
     growthLine(el, series)  kumulatívny rast
     sparkline(el, values)   mikro-trend do KPI karty

   Dátové kontrakty (payload /api/dashboard):
     heatmap: { weeks: [[{date,count,level}|null, …7], …≤53], months:{col:'aug'}, total }
     donut:   segs = [{cert:'overene|hypoteza|pasca|bez', value}], opts {total, centerLabel}
     growth:  { labels:['2025-08', …], values:[12,34, …] }   // kumulatívne

   PREKRESLENIE PRI ZMENE TÉMY: builders čítajú farby cez getComputedStyle, teda
   len v momente kreslenia. Pred týmto balíkom prepnutie témy nechalo donut aj
   líniu v starých farbách. Každý graf si preto pamätá poslednú kresbu a observer
   nad `data-theme` ju zopakuje. `theme.js` (P9) dnes neemituje `theme:changed`;
   keď ho pridá, odoberáme aj ten — patch je v reporte P10. */

import { bus } from '../core/bus.js';
import { EV } from '../core/events.js';
import { heatmap as drawHeatmap } from './heatmap.js';
import { donut as drawDonut } from './donut.js';
import { growthLine as drawGrowthLine } from './growth-line.js';
import { sparkline as drawSparkline } from './sparkline.js';

/** container → funkcia, ktorá kresbu zopakuje (posledné argumenty). */
const lastRender = new Map();

function tracked(fn) {
    return function (container, ...args) {
        if (container) lastRender.set(container, () => fn(container, ...args));
        return fn(container, ...args);
    };
}

export const heatmap = tracked(drawHeatmap);
export const donut = tracked(drawDonut);
export const growthLine = tracked(drawGrowthLine);
export const sparkline = tracked(drawSparkline);


/** Prekreslí všetky živé grafy; odpojené kontajnery vyhodí z registra. */
export function redrawCharts() {
    for (const [container, redraw] of [...lastRender]) {
        if (!container.isConnected) { lastRender.delete(container); continue; }
        try { redraw(); } catch (e) { console.error('[aura:charts] redraw', e); }
    }
}


let observing = false;

/** Sleduje `:root[data-theme]`; idempotentné, bezpečné mimo prehliadača. */
function observeTheme() {
    if (observing || typeof MutationObserver === 'undefined') return;
    observing = true;
    new MutationObserver(redrawCharts).observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-theme'],
    });
    bus.on(EV.THEME_CHANGED, redrawCharts);
}

if (typeof document !== 'undefined') {
    observeTheme();
    const api = { heatmap, donut, growthLine, sparkline, redrawCharts };
    window.AuraCharts = api;
    window.HadesCharts = api;   // alias do konca sprintu (rovnaký objekt)
}
