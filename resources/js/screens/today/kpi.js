/* KPI pás obrazovky Dnes.

   Aura rytmus dashboardu (UX plán, vlna 3): KPI strip → hero graf → dva stĺpce.
   Hodnoty sú VŽDY z payloadu, nikdy z konštanty. Chýbajúca hodnota = 0, nie
   vymyslené číslo. „na overenie" je klikateľné — vedie na obrazovku Kontrola,
   ktorá s tým číslom vie niečo urobiť. */

import { kpiGridHtml } from '../shared/anatomy.js';
import { sparkline } from '../../charts/index.js';
import { $ } from '../../core/dom.js';

/** Posledných `days` dní denných počtov aktivity z heatmapy dashboardu. */
export function recentActivity(heatmap, days = 14) {
    const weeks = Array.isArray(heatmap && heatmap.weeks) ? heatmap.weeks : [];
    const cells = [];
    for (const week of weeks) {
        for (const cell of (week || [])) {
            if (cell && cell.date) cells.push(cell);
        }
    }
    cells.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return cells.slice(-days).map((c) => +c.count || 0);
}


/** Skladba KPI kariet z /api/today + /api/dashboard. */
export function todayKpiHtml(today, dash) {
    const counts = (dash && dash.counts) || {};
    const cert = (dash && dash.certainty) || {};
    const week = (today && today.week_added) || {};

    return kpiGridHtml([
        { value: counts.nodes ?? 0, label: 'uzlov', hero: true, spark: 'kpi-spark-nodes' },
        { value: counts.edges ?? 0, label: 'spojení' },
        { value: week.nodes ?? 0, label: 'nových 7 dní' },
        { value: week.sessions ?? 0, label: 'sessions 7 dní' },
        { value: counts.brain ?? 0, label: 'brain (.md)' },
        { value: counts.decisions ?? 0, label: 'rozhodnutí' },
        { value: cert.needs_review ?? 0, label: 'na overenie', cert: 'pending' },
    ]);
}


/** Dokreslí sparkline do hero karty. Plochá/prázdna rada sa nekreslí. */
export function renderTodayKpiSpark(dash) {
    const host = $('kpi-spark-nodes');
    if (!host) return;
    const drawn = sparkline(host, recentActivity((dash && dash.heatmap) || {}), {
        label: 'Aktivita za posledné dva týždne',
    });
    if (!drawn) host.remove();
}
