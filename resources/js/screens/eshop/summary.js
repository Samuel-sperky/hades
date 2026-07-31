/* E-shop — vykreslenie súhrnu: KPI počty, obrat po menách, dni, krajiny.

   POVINNÉ OBMEDZENIA:
   - HLAVNÉ KPI SÚ POČTY. Obrat je samostatná sekcia, nikdy nie hero číslo —
     v KPI páse sa peňažná suma nesmie objaviť vôbec.
   - Obrat sa vykresľuje ako jeden riadok na menu (rozhodnutie 1). Reálne
     rozdelenie vzorky je EUR 40 · HUF 26 · RON 20 · PLN 7 · CZK 7, takže päť
     riadkov je bežný stav, nie okrajový prípad. ŽIADNY súčet naprieč menami,
     žiadny prepočet na EUR — v tomto súbore sa peňažné hodnoty vôbec nesčítavajú.
   - Rozpad podľa krajín je presný (`country` filter, rozhodnutie 3), takže tu
     nie je ani slovo o vzorke, ani o odhade, ani o requeste na objednávku. */

import { esc } from '../../core/dom.js';
import { fmtDecDate } from '../../core/format.js';
import { kpiGridHtml, sectionHtml } from '../shared/anatomy.js';
import { REVENUE_NOTE, amountHtml, fmtCount } from './data.js';

/* Rodinný `.dbar` z charts.css (P10) — jeden riadok pre dni aj pre krajiny. */
function barRowHtml(label, valueText, value, max) {
    const pct = max > 0 ? Math.round((value / max) * 100) : 0;
    return '<div class="dbar es-bar">'
        + '<div class="dbar-head"><span class="db-dot"></span>'
        + '<span class="db-name">' + esc(label) + '</span>'
        + '<span class="db-n tnum">' + esc(valueText) + '</span></div>'
        + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div>'
        + '</div>';
}


/** KPI pás — výhradne počty. Popiska okna je z API (`window.days`), nie
    z prepínača: keby backend okno obmedzil, popiska nesmie tvrdiť niečo iné. */
export function renderKpi(host, s, h) {
    if (!host) return;
    const total = s.ordersTotal ?? (h ? h.totalOrders : null);
    const products = s.productsTotal ?? (h ? h.totalProducts : null);
    host.innerHTML = kpiGridHtml([
        { value: fmtCount(total), label: 'Objednávok v e-shope', hero: true },
        { value: fmtCount(s.ordersDay), label: 'Objednávky za dnes' },
        {
            value: fmtCount(s.ordersWindow),
            label: 'Objednávky za ' + (s.windowDays ? s.windowDays + ' dní' : 'okno'),
        },
        { value: fmtCount(products), label: 'Produktov v katalógu' },
    ]);
}


/** Obrat po menách. Každý riadok je samostatná mena a nesie ISO kód pri sume;
    počet objednávok vedľa hovorí, koľko objednávok riadok pokrýva. */
export function renderRevenue(host, s) {
    if (!host) return;
    if (!s.revenue.length) { host.innerHTML = ''; return; }
    const rows = s.revenue.map((r) => (
        '<div class="es-rev-row" data-currency="' + esc(r.currency) + '">'
        + '<span class="es-rev-sum">' + amountHtml(r.total, r) + '</span>'
        + '<span class="es-rev-orders tnum">' + esc(fmtCount(r.orders)) + ' obj.</span>'
        + '</div>'
    )).join('');
    host.innerHTML = sectionHtml('Obrat po menách',
        '<p class="es-note es-note--rule">' + esc(REVENUE_NOTE) + '</p>'
        + '<div class="es-rev">' + rows + '</div>',
        { note: s.revenue.length + ' mien' });
}


export function renderDays(host, s) {
    if (!host) return;
    if (!s.byDay.length) { host.innerHTML = ''; return; }
    const max = s.byDay.reduce((m, r) => Math.max(m, r.orders), 0);
    host.innerHTML = sectionHtml('Objednávky po dňoch',
        '<div class="es-bars">'
        + s.byDay.map((r) => barRowHtml(fmtDecDate(r.date), fmtCount(r.orders), r.orders, max)).join('')
        + '</div>',
        { note: s.windowFrom && s.windowUntil ? s.windowFrom + ' – ' + s.windowUntil : 'počty z API' });
}


/** Krajiny — presné počty z `country` filtra. Bez rozpadu sa sekcia nevykreslí
    vôbec: prázdny stav s vysvetlením „rozpad tu ešte nie je" bol pravdivý len
    v v1 a dnes by lhal. */
export function renderCountries(host, s) {
    if (!host) return;
    if (!s.countries.length) { host.innerHTML = ''; return; }
    const max = s.countries.reduce((m, c) => Math.max(m, c.orders), 0);
    host.innerHTML = sectionHtml('Krajiny podľa počtu objednávok',
        '<div class="es-bars">' + s.countries.map((c) => barRowHtml(
            c.name ? c.name + ' (' + c.iso + ')' : c.iso, fmtCount(c.orders), c.orders, max,
        )).join('') + '</div>',
        { note: s.countries.length + ' krajín' });
}
