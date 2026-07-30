/* Karty dashboardu na obrazovke Dnes — markup + napojenie grafov.

   Grafy sa importujú ako ES moduly (nie cez `window.HadesCharts`), takže už
   neexistuje tichý „ak globál nie je, nekresli nič" stav, ktorý vedel nechať
   dashboard bez grafov, keď sa poradie načítania zmenilo. */

import { donut, growthLine, heatmap } from '../../charts/index.js';
import { $, esc } from '../../core/dom.js';
import { emptyStateHtml } from '../shared/anatomy.js';
import { coverage } from '../review/coverage.js';
import { llmCardHtml, renderLlmPanel } from './llm-panel.js';
import { doSync, syncCardHtml } from './sync-card.js';


/** Statický HTML dashboardu — karty s prázdnymi kontajnermi pre grafy. */
export function dashboardHtml(dash) {
    const cert = dash.certainty || {};

    let h = '<div class="dash-grid">';

    // Heatmapa aktivity — cez 2 stĺpce; .heat sám skroluje horizontálne.
    h += '<div class="dash-card span-2"><div class="dash-head">'
        + '<span class="dash-title">Aktivita</span>'
        + '<span class="dash-note tnum">' + esc(String((dash.heatmap || {}).total ?? 0)) + ' za rok</span>'
        + '</div><div id="dash-heat"></div></div>';

    // Donut istoty + legenda
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Istota</span>'
        + '<span class="dash-note tnum">' + certPct(cert) + ' % značené</span></div>'
        + '<div class="dash-donut-wrap">'
        + '<div id="dash-donut"></div>'
        + certLegend(cert)
        + '</div></div>';

    // Kumulatívny rast siete
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Rast siete</span>'
        + '<span class="dash-note">kumulatívne</span></div>'
        + '<div id="dash-growth"></div></div>';

    // Bary per oblasť
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Podľa oblasti</span></div>'
        + perAreaHtml(dash.per_area || []) + '</div>';

    h += syncCardHtml(dash);
    h += llmCardHtml();

    h += '</div>';
    return h;
}


/** Podiel uzlov, ktoré vôbec nesú značku istoty (celé číslo v %).
    Matematika je jedna a tá istá pre kartu Istota tu aj pre KPI pás Kontroly —
    preto žije v review/coverage.js a nie je tu skopírovaná. */
function certPct(cert) {
    return String(coverage(cert).pct);
}


// Legenda istoty — swatch + názov + počet; farby berie CSS z data-cert.
function certLegend(cert) {
    const rows = [
        ['overene', 'overené', cert.overene],
        ['hypoteza', 'hypotéza', cert.hypoteza],
        ['pasca', 'pasca', cert.pasca],
        ['bez', 'bez značky', cert.bez],
    ];
    return '<div class="cert-legend">'
        + rows.map((r) =>
            '<div class="cl-row" data-cert="' + r[0] + '">'
            + '<span class="cl-sw"></span>'
            + '<span class="cl-name">' + esc(r[1]) + '</span>'
            + '<span class="cl-n tnum">' + esc(String(r[2] ?? 0)) + '</span></div>').join('')
        + '</div>';
}


// Bary per oblasť — farba oblasti cez inline --lobe (dedí sa na dot aj fill).
function perAreaHtml(areas) {
    if (!areas.length) {
        return emptyStateHtml('category', 'Žiadne oblasti', 'Sieť ešte nemá ani jednu oblasť poznatkov.');
    }
    const max = Math.max.apply(null, areas.map((a) => +a.count || 0).concat([1]));
    return areas.map((a) => {
        const pct = Math.round(((+a.count || 0) / max) * 100);
        const color = a.color || 'var(--accent)';
        return '<div class="dbar" style="--lobe:' + esc(color) + ';">'
            + '<div class="dbar-head"><span class="db-dot"></span>'
            + '<span class="db-name">' + esc(a.name || a.slug || '') + '</span>'
            + '<span class="db-n tnum">' + esc(String(a.count || 0)) + '</span></div>'
            + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('');
}


/** Napojenie grafov, Sync tlačidla a LLM panelu na kontajnery v DOM. */
export function renderDashboardBlocks(dash) {
    const heat = $('dash-heat');
    if (heat) heatmap(heat, dash.heatmap || {});

    const donutEl = $('dash-donut');
    if (donutEl) {
        const c = dash.certainty || {};
        donut(donutEl, [
            { cert: 'overene', value: c.overene || 0 },
            { cert: 'hypoteza', value: c.hypoteza || 0 },
            { cert: 'pasca', value: c.pasca || 0 },
            { cert: 'bez', value: c.bez || 0 },
        ], { total: c.total || 0, centerLabel: 'uzlov' });
    }

    const growth = $('dash-growth');
    if (growth) growthLine(growth, dash.growth || {});

    const syncBtn = $('sync-now');
    if (syncBtn) syncBtn.onclick = () => doSync(syncBtn);

    renderLlmPanel();
}
