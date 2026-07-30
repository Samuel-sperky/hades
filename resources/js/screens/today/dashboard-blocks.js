import { $, emptyHtml, esc } from '../../core/dom.js';
import { now } from '../../core/format.js';
import { doSync, syncCardHtml } from './sync-card.js';


// Statický HTML dashboardu — KPI rad + grid kariet s prázdnymi kontajnermi pre charty (charts.js).
export function dashboardHtml(dash) {
    const counts = dash.counts || {};
    const cert = dash.certainty || {};
    const num = (n) => esc(String(n ?? 0));

    const kpi = (val, label, suffix) =>
        '<div class="kpi-card"><div class="kpi-val">' + num(val)
        + (suffix ? '<span class="kpi-suffix">' + esc(suffix) + '</span>' : '')
        + '</div><div class="kpi-label">' + esc(label) + '</div></div>';

    let h = '<div class="kpi-grid">'
        + kpi(counts.nodes, 'uzlov')
        + kpi(counts.edges, 'spojení')
        + kpi(counts.brain, 'brain')
        + kpi(counts.session, 'session')
        + kpi(counts.decisions, 'rozhodnutí')
        + kpi(cert.needs_review, 'na overenie')
        + '</div>';

    h += '<div class="dash-grid">';

    // Heatmapa aktivity — cez 2 stĺpce; .heat sám skroluje horizontálne.
    h += '<div class="dash-card span-2"><div class="dash-head">'
        + '<span class="dash-title">Aktivita</span>'
        + '<span class="dash-note">' + num((dash.heatmap || {}).total) + ' za rok</span>'
        + '</div><div id="dash-heat"></div></div>';

    // Donut istoty + legenda
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Istota</span></div>'
        + '<div style="display:flex;flex-direction:column;gap:var(--sp-2);align-items:center;">'
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

    // Sync karta
    h += syncCardHtml(dash);

    h += '</div>';
    return h;
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
            + '<span class="cl-n">' + esc(String(r[2] ?? 0)) + '</span></div>').join('')
        + '</div>';
}


// Bary per oblasť — farba oblasti cez inline --lobe (dedí sa na dot aj fill).
function perAreaHtml(areas) {
    if (!areas.length) return emptyHtml('category', 'Žiadne oblasti');
    const max = Math.max.apply(null, areas.map((a) => +a.count || 0).concat([1]));
    return areas.map((a) => {
        const pct = Math.round(((+a.count || 0) / max) * 100);
        const color = a.color || 'var(--accent)';
        return '<div class="dbar" style="--lobe:' + esc(color) + ';">'
            + '<div class="dbar-head"><span class="db-dot"></span>'
            + '<span class="db-name">' + esc(a.name || a.slug || '') + '</span>'
            + '<span class="db-n">' + esc(String(a.count || 0)) + '</span></div>'
            + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('');
}


// Napojenie chartov (charts.js) a Sync tlačidla na existujúce DOM kontajnery.
export function renderDashboardBlocks(dash) {
    if (!window.HadesCharts) return;

    const heat = $('dash-heat');
    if (heat) HadesCharts.heatmap(heat, dash.heatmap || {});

    const donutEl = $('dash-donut');
    if (donutEl) {
        const c = dash.certainty || {};
        HadesCharts.donut(donutEl, [
            { cert: 'overene', value: c.overene || 0 },
            { cert: 'hypoteza', value: c.hypoteza || 0 },
            { cert: 'pasca', value: c.pasca || 0 },
            { cert: 'bez', value: c.bez || 0 },
        ], { total: c.total || 0, centerLabel: 'uzlov' });
    }

    const growth = $('dash-growth');
    if (growth) HadesCharts.growthLine(growth, dash.growth || {});

    const syncBtn = $('sync-now');
    if (syncBtn) syncBtn.onclick = () => doSync(syncBtn);
}
