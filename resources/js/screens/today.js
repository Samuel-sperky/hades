/* Obrazovka Dnes — dashboard vedomia.

   Anatómia (Aura vlna 3): hero hľadanie → KPI pás → mriežka kariet (heatmapa,
   istota, rast, oblasti, sync, lokálny model) → sekcie „naposledy / záznamy /
   projekty". Šírku dáva `.screen--wide` v blade, nie inline style v JS.

   Dva zdroje: /api/today je ľahký (sessions/records/projekty), /api/dashboard
   nesie agregáty. Padne len jeden? Obrazovka sa vykreslí z toho, čo prišlo —
   dashboard bez /api/today ani /api/today bez dashboardu nie je prázdna plocha. */

import { apiGet } from '../core/api.js';
import { $, esc } from '../core/dom.js';
import { timeAgo } from '../core/format.js';
import { bindPackButtons, packBtn } from '../dock/pack.js';
import { barHtml, emptyStateHtml, renderApiError, sectionHtml } from './shared/anatomy.js';
import { dashboardHtml, renderDashboardBlocks } from './today/dashboard-blocks.js';
import { renderTodayKpiSpark, todayKpiHtml } from './today/kpi.js';
import { openCmdk } from '../shell/cmdk.js';
import { openNodeFromAnywhere, setScreen } from '../shell/router.js';


// Shimmer skeleton počas načítania dashboardu (loading stav)
function todaySkeleton() {
    return '<div class="page-stack">'
        + barHtml('100%', '58px')
        + '<div class="kpi-grid">' + [0, 0, 0, 0, 0, 0].map(() => barHtml('100%', '62px')).join('') + '</div>'
        + '<div class="dash-grid">' + barHtml('100%', '160px') + barHtml('100%', '160px') + '</div>'
        + '</div>';
}


function searchHtml() {
    return '<button type="button" id="today-search" class="today-search">'
        + '<span class="ms" aria-hidden="true">search</span>'
        + '<span class="ts-text">Hľadaj vo vedomí — skilly, záznamy, projekty…</span>'
        + '<kbd>Ctrl K</kbd></button>';
}


export async function renderToday() {
    const body = $('dnes-body');
    if (!body) return;
    body.innerHTML = todaySkeleton();

    const [todayRes, dashRes] = await Promise.allSettled([
        apiGet('/api/today'),
        apiGet('/api/dashboard'),
    ]);

    // Oba zdroje mimo → jediný chybový stav s možnosťou skúsiť znova.
    if (todayRes.status !== 'fulfilled' && dashRes.status !== 'fulfilled') {
        renderApiError(body, todayRes.reason, renderToday);
        return;
    }

    const d = todayRes.status === 'fulfilled' ? todayRes.value : {};
    const dash = dashRes.status === 'fulfilled' ? dashRes.value : null;

    let h = '<div class="page-stack">' + searchHtml();
    h += todayKpiHtml(d, dash);

    if (dash) {
        h += dashboardHtml(dash);
    } else {
        h += emptyStateHtml('insights', 'Agregáty sa nenačítali',
            'Grafy a synchronizácia sú dočasne nedostupné — zoznamy nižšie sú v poriadku.');
    }

    h += listsHtml(d);
    h += '</div>';
    body.innerHTML = h;

    if (dash) {
        renderDashboardBlocks(dash);
        renderTodayKpiSpark(dash);
    }
    wireToday(body);
}


/** Sekcie zo /api/today. Keď nie je nič, jeden zmysluplný prázdny stav. */
function listsHtml(d) {
    const sessions = d.recent_sessions || [];
    const records = d.recent_records || [];
    const projects = d.top_projects || [];

    if (!sessions.length && !records.length && !projects.length) {
        return emptyStateHtml('bedtime', 'Dnes je vo vedomí ticho',
            'Zatiaľ žiadne sessions ani záznamy. Pribudnú pri ďalšom ingeste z Claude Code.');
    }

    let h = '';
    if (sessions.length) {
        h += sectionHtml('Naposledy si robil na…',
            '<div class="today-grid">' + sessions.slice(0, 6).map(todaySessionCard).join('') + '</div>');
    }
    if (records.length) {
        h += sectionHtml('Posledné záznamy',
            '<div class="today-list">'
            + records.map((r) => todayRow('article', r.id, r.label, r.project, r.snippet, r.created_at)).join('')
            + '</div>');
    }
    if (projects.length) {
        h += sectionHtml('Aktívne projekty',
            '<div class="today-chips">'
            + projects.map((p) => '<span class="today-chip">' + esc(p.project)
                + '<span class="n tnum">' + esc(String(p.count || 0)) + '</span></span>').join('')
            + '</div>');
    }
    return h;
}


function wireToday(body) {
    const searchBtn = $('today-search');
    if (searchBtn) searchBtn.onclick = openCmdk;

    // KPI „na overenie" vedie tam, kde sa s tým číslom dá niečo urobiť.
    const reviewKpi = body.querySelector('.kpi-card[data-cert="pending"]');
    if (reviewKpi) {
        reviewKpi.classList.add('kpi-card--link');
        reviewKpi.setAttribute('role', 'button');
        reviewKpi.setAttribute('tabindex', '0');
        reviewKpi.title = 'Otvoriť Kontrolu';
        const go = () => setScreen('kontrola');
        reviewKpi.onclick = go;
        reviewKpi.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    }

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
