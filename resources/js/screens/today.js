import { $, esc, renderEmpty } from '../core/dom.js';
import { plural, timeAgo } from '../core/format.js';
import { bindPackButtons, packBtn } from '../dock/pack.js';
import { dashboardHtml, renderDashboardBlocks } from './today/dashboard-blocks.js';
import { openCmdk } from '../shell/cmdk.js';
import { openNodeFromAnywhere } from '../shell/router.js';


// Shimmer skeleton počas načítania dashboardu (loading stav)
function todaySkeleton() {
    const bar = (w, h) => '<div class="shimmer" style="width:' + w + ';height:' + h + ';border-radius:var(--r-md);"></div>';
    return '<div style="display:flex;flex-direction:column;gap:var(--gutter);">'
        + bar('100%', '46px')
        + '<div class="kpi-grid">' + [0, 0, 0, 0].map(() => bar('100%', '58px')).join('') + '</div>'
        + '<div class="dash-grid">' + bar('100%', '160px') + bar('100%', '160px') + '</div>'
        + '</div>';
}


export async function renderToday() {
    const body = $('dnes-body');
    if (!body) return;
    // Dashboard potrebuje viac miesta než 920px čítacia šírka ostatných obrazoviek.
    const screen = $('screen-dnes');
    if (screen) screen.style.maxWidth = '1120px';
    body.innerHTML = todaySkeleton();

    // /api/today je ľahký (sessions/records/projekty); ťažké agregáty sú v /api/dashboard (§4.1).
    const [todayRes, dashRes] = await Promise.allSettled([
        fetch('/api/today').then((r) => r.json()),
        fetch('/api/dashboard').then((r) => r.json()),
    ]);

    if (todayRes.status !== 'fulfilled') {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
        return;
    }
    const d = todayRes.value;
    const dash = dashRes.status === 'fulfilled' ? dashRes.value : null;
    const wb = d.week_added || {};

    // Veľké hľadacie pole — primárny prvok obrazovky (otvorí Cmd-K paletu)
    let h = '<button type="button" id="today-search" class="today-search">'
        + '<span class="ms" aria-hidden="true">search</span>'
        + '<span class="ts-text">Hľadaj vo vedomí — skilly, záznamy, projekty…</span>'
        + '<kbd>Ctrl K</kbd></button>';

    h += '<p class="today-line">Tento týždeň pribudlo <strong>' + esc(String(wb.nodes ?? 0))
        + '</strong> ' + plural(wb.nodes ?? 0, 'poznatok', 'poznatky', 'poznatkov')
        + ', <strong>' + esc(String(wb.sessions ?? 0)) + '</strong> '
        + plural(wb.sessions ?? 0, 'záznam', 'záznamy', 'záznamov') + '.</p>';

    // ---- Dashboard agregáty (KPI + charty + Sync) z /api/dashboard ----
    if (dash) h += dashboardHtml(dash);

    // ---- Naposledy / záznamy / projekty (z /api/today) ----
    const sessions = d.recent_sessions || [];
    if (sessions.length) {
        h += '<section class="today-sec"><h2>Naposledy si robil na…</h2><div class="today-grid">'
            + sessions.slice(0, 6).map((s) => todaySessionCard(s)).join('')
            + '</div></section>';
    }

    const records = d.recent_records || [];
    if (records.length) {
        h += '<section class="today-sec"><h2>Posledné záznamy</h2><div class="today-list">'
            + records.map((r) => todayRow('article', r.id, r.label, r.project, r.snippet, r.created_at)).join('')
            + '</div></section>';
    }

    const projects = d.top_projects || [];
    if (projects.length) {
        h += '<section class="today-sec"><h2>Aktívne projekty</h2><div class="today-chips">'
            + projects.map((p) => '<span class="today-chip">' + esc(p.project)
                + '<span class="n">' + (p.count || 0) + '</span></span>').join('')
            + '</div></section>';
    }

    body.innerHTML = h;

    // Charty + Sync wiring — kontajnery sú už v DOM po nastavení innerHTML.
    if (dash) renderDashboardBlocks(dash);

    const searchBtn = $('today-search');
    if (searchBtn) searchBtn.onclick = openCmdk;
    body.querySelectorAll('.today-item[data-id], .today-card-link[data-id]').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(body);
}


function todaySessionCard(s) {
    return '<div class="today-card-wrap">'
        + '<button type="button" class="today-card-link" data-id="' + s.id + '" data-label="' + esc(s.label || '') + '">'
        + '<span class="tcl-title">' + esc(s.label || '') + '</span>'
        + '<span class="tcl-meta">'
        + (s.project ? '<span class="tcl-proj">' + esc(s.project) + '</span>' : '')
        + (s.created_at ? '<span class="tcl-time">' + esc(timeAgo(s.created_at)) + '</span>' : '')
        + '</span></button>'
        + packBtn(s.id, s.label) + '</div>';
}


function todayRow(icon, id, label, project, snippet, iso) {
    return '<div class="li-wrap">'
        + '<button type="button" class="today-item" data-id="' + id + '" data-label="' + esc(label || '') + '">'
        + '<span class="ms ti-ico" aria-hidden="true">' + icon + '</span>'
        + '<span class="ti-text"><span class="ti-title">' + esc(label || '') + '</span>'
        + (snippet ? '<span class="ti-snip">' + esc(snippet) + '</span>' : '')
        + '</span>'
        + (project ? '<span class="ti-tag">' + esc(project) + '</span>' : '')
        + (iso ? '<span class="ti-time">' + esc(timeAgo(iso)) + '</span>' : '')
        + '</button>'
        + packBtn(id, label) + '</div>';
}

/* ---------- certainty badge (.cert) — zdieľaný helper (F3; F4 ho reuse-uje) ----
   §4.5/§4.8: data-cert="overene|hypoteza|pasca|bez|pending"; ikony
   verified/science/warning/radio_button_unchecked/pending. iconOnly = .cert--icon. */
