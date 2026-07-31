/* Obrazovka Agenti — živé „command centre" agentov mysle (vlna W2).

   Vzor skilltree.altari.ai „Command Centers": vidno agentov, ktorí reálne
   pracujú, ako pracujú, a dajú sa spustiť/pozastaviť. Zdroj pravdy je statický
   AgentRegistry (W0) cez GET /api/agents; behy žijú v agent_runs a priebeh tečie
   živo cez WebSocket kanál 'agents' (event 'pulse', AgentPulse).

   Anatómia (vzor screens/today.js): page-head (blade) → súhrnný KPI pás →
   sekcie po kategóriách (Údržba / LLM / Ingest / Workforce), každá s kartami.
   Karta = label + popis + badge autonómie + badge stavu + progres + krok +
   posledný beh + nabehne + akcie (Spustiť / Pozastaviť / Log).

   Bezpečnosť: deštruktívne agenty sú vizuálne označené a pred spustením pýtajú
   potvrdenie; keď je poistka vypnutá, backend vráti 423 a UI to nenásilne povie.
   Placeholder (workforce) sa nedá spustiť — tlačidlo je disabled, badge „Čoskoro". */

import { apiGet, apiSend } from '../core/api.js';
import { bus } from '../core/bus.js';
import { $, esc } from '../core/dom.js';
import { EV } from '../core/events.js';
import { timeAgo } from '../core/format.js';
import { subscribe } from '../core/realtime.js';
import { kpiGridHtml, listSkeletonHtml, renderApiError } from './shared/anatomy.js';
import { showToast } from '../shell/toasts.js';


/* ---------- slovníky (SK) ---------- */

const AUTONOMY = {
    manual: { label: 'Manuálne', cls: 'manual' },
    assisted: { label: 'Asistované', cls: 'assisted' },
    autonomous: { label: 'Autonómne', cls: 'autonomous' },
};

const STATUS = {
    queued: { label: 'Čaká', cls: 'queued' },
    running: { label: 'Beží', cls: 'running' },
    paused: { label: 'Pozastavené', cls: 'paused' },
    done: { label: 'Hotovo', cls: 'done' },
    failed: { label: 'Chyba', cls: 'failed' },
};

const CATEGORIES = [
    { key: 'maintenance', label: 'Údržba', icon: 'build' },
    { key: 'llm', label: 'LLM / modely', icon: 'neurology' },
    { key: 'ingest', label: 'Ingest', icon: 'download' },
    { key: 'workforce', label: 'Workforce', icon: 'groups' },
];

/** Stavy, ktoré znamenajú „práve prebieha" (progres má zmysel zobraziť). */
const ACTIVE = new Set(['queued', 'running', 'paused']);


/* ---------- čisté helpery (testovateľné) ---------- */

/** SK meta badge autonómie. */
export function autonomyMeta(autonomy) {
    return AUTONOMY[autonomy] || { label: autonomy || '—', cls: 'manual' };
}

/** SK meta badge stavu z latest_run.status (null = ešte nebežal). */
export function statusMeta(status) {
    return STATUS[status] || null;
}

/** Mapuje AgentPulse (type + data) na čiastočnú zmenu stavu behu karty.
    Vracia null pre typy, ktoré stav karty nemenia (run.log). */
export function pulseToState(type, data = {}) {
    switch (type) {
        case 'run.started':
            return { status: 'running', progress: 10, step: 'Spúšťam…' };
        case 'run.progress':
            return {
                status: 'running',
                progress: typeof data.progress === 'number' ? data.progress : undefined,
                step: data.step,
            };
        case 'run.done':
            return { status: 'done', progress: 100, step: 'Hotovo' };
        case 'run.failed':
            return { status: 'failed', step: 'Zlyhalo', message: data.message || null };
        case 'run.paused':
            return { status: 'paused', step: 'Pozastavené' };
        default:
            return null;
    }
}

/** Zoskupí agentov podľa kategórie v pevnom poradí CATEGORIES. */
export function groupByCategory(agents) {
    return CATEGORIES
        .map((c) => ({ ...c, agents: (agents || []).filter((a) => a.category === c.key) }))
        .filter((g) => g.agents.length > 0);
}


/* ---------- karta agenta ---------- */

function badgeHtml(cls, text, extraCls) {
    return '<span class="ag-badge ag-badge--' + cls + (extraCls ? ' ' + extraCls : '') + '">'
        + esc(text) + '</span>';
}

function progressHtml(run) {
    const pct = run && typeof run.progress === 'number' ? Math.max(0, Math.min(100, run.progress)) : 0;
    return '<div class="ag-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100"'
        + ' aria-valuenow="' + pct + '">'
        + '<div class="ag-progress-bar" style="width:' + pct + '%;"></div></div>';
}

/** Vnútro karty (bez obalu) — používa sa aj pri živej aktualizácii. */
export function agentCardInnerHtml(agent, destructiveEnabled) {
    const run = agent.latest_run || null;
    const st = run ? statusMeta(run.status) : null;
    const auto = autonomyMeta(agent.autonomy);
    const placeholder = agent.placeholder === true;
    const active = run && ACTIVE.has(run.status);

    let badges = badgeHtml('auto-' + auto.cls, auto.label);
    if (placeholder) badges += badgeHtml('soon', 'Čoskoro');
    else if (st) badges += badgeHtml('status-' + st.cls, st.label, 'ag-status');
    if (agent.destructive) {
        badges += '<span class="ag-badge ag-badge--destructive" title="Deštruktívny agent — mení dáta">'
            + '<span class="ms" aria-hidden="true">warning</span>Deštruktívny</span>';
    }

    let h = '<div class="ag-head">'
        + '<h3 class="ag-name">' + esc(agent.label) + '</h3>'
        + '<div class="ag-badges">' + badges + '</div></div>';

    h += '<p class="ag-desc">' + esc(agent.description) + '</p>';

    // Progres + krok len keď beh reálne prebieha (inak by svietil mŕtvy pruh).
    if (active) {
        h += progressHtml(run);
        h += '<p class="ag-step">' + esc(run.step || '—') + '</p>';
    }

    // Meta riadok — posledný beh + nabehne (rozvrh).
    const last = run && run.finished_at ? timeAgo(run.finished_at) : (run ? 'práve beží' : 'zatiaľ nikdy');
    h += '<dl class="ag-meta">'
        + '<div><dt>Posledný beh</dt><dd>' + esc(last) + '</dd></div>'
        + '<div><dt>Nabehne</dt><dd>' + esc(agent.next_run || agent.schedule || '—') + '</dd></div></dl>';

    // Akcie.
    const running = run && (run.status === 'running' || run.status === 'queued');
    let actions = '';
    if (placeholder) {
        actions += '<button type="button" class="ag-btn" disabled aria-label="Koncept sa nedá spustiť">'
            + '<span class="ms" aria-hidden="true">play_arrow</span>Spustiť</button>';
    } else {
        const runTitle = agent.destructive && !destructiveEnabled
            ? 'Deštruktívny agent je vypnutý (bezpečnostná poistka)'
            : 'Spustiť agenta';
        actions += '<button type="button" class="ag-btn ag-btn--run" data-act="run"'
            + ' title="' + esc(runTitle) + '" aria-label="Spustiť ' + esc(agent.label) + '">'
            + '<span class="ms" aria-hidden="true">play_arrow</span>Spustiť</button>';
        actions += '<button type="button" class="ag-btn ag-btn--pause" data-act="pause"'
            + (running ? '' : ' hidden')
            + ' aria-label="Pozastaviť ' + esc(agent.label) + '">'
            + '<span class="ms" aria-hidden="true">pause</span>Pozastaviť</button>';
    }
    actions += '<button type="button" class="ag-btn ag-btn--log" data-act="log"'
        + ' aria-label="Log agenta ' + esc(agent.label) + '">'
        + '<span class="ms" aria-hidden="true">terminal</span>Log</button>';
    h += '<div class="ag-actions">' + actions + '</div>';

    return h;
}

/** Celá karta agenta s obalom + data-* atribútmi. */
export function agentCardHtml(agent, destructiveEnabled) {
    const run = agent.latest_run || null;
    const status = run ? run.status : 'idle';
    const cls = 'ag-card'
        + (agent.placeholder ? ' ag-card--placeholder' : '')
        + (agent.destructive ? ' ag-card--destructive' : '');
    return '<article class="' + cls + '" data-agent-key="' + esc(agent.key) + '"'
        + ' data-status="' + esc(status) + '"'
        + ' data-category="' + esc(agent.category) + '">'
        + agentCardInnerHtml(agent, destructiveEnabled) + '</article>';
}


/* ---------- stav modulu ---------- */

const state = {
    agents: [],
    byKey: new Map(),
    destructiveEnabled: false,
    summary: null,
    logKey: null,     // otvorený log v drawri
    logRunId: null,
};


function summaryKpiHtml(summary) {
    if (!summary) return '';
    return kpiGridHtml([
        { value: summary.total, label: 'Agentov v centre', hero: true },
        { value: summary.running, label: 'Práve beží' },
        { value: summary.autonomous, label: 'Autonómnych' },
    ]);
}


/* ---------- render ---------- */

function agentiSkeleton() {
    return '<div class="page-stack">'
        + '<div class="kpi-grid">' + [0, 0, 0].map(() => listSkeletonHtml(1, '62px')).join('') + '</div>'
        + '<div class="ag-grid">' + [0, 0, 0, 0].map(() => listSkeletonHtml(1, '150px')).join('') + '</div>'
        + '</div>';
}


export async function renderAgenti() {
    const body = $('agenti-body');
    if (!body) return;
    body.innerHTML = agentiSkeleton();

    let payload;
    try {
        payload = await apiGet('/api/agents');
    } catch (e) {
        renderApiError(body, e, renderAgenti);
        return;
    }

    state.agents = Array.isArray(payload.agents) ? payload.agents : [];
    state.destructiveEnabled = payload.destructive_enabled === true;
    state.summary = payload.summary || null;
    state.byKey = new Map(state.agents.map((a) => [a.key, a]));

    const groups = groupByCategory(state.agents);
    let h = '<div class="page-stack">';
    h += summaryKpiHtml(state.summary);

    if (!state.destructiveEnabled && state.agents.some((a) => a.destructive)) {
        h += '<p class="ag-safety"><span class="ms" aria-hidden="true">shield</span>'
            + 'Deštruktívne agenty sú vypnuté bezpečnostnou poistkou — z UI ich nespustíš.</p>';
    }

    for (const g of groups) {
        h += '<section class="ag-cat">'
            + '<h2 class="ag-cat-title"><span class="ms" aria-hidden="true">' + g.icon + '</span>'
            + esc(g.label) + '</h2>'
            + '<div class="ag-grid">' + g.agents.map((a) => agentCardHtml(a, state.destructiveEnabled)).join('') + '</div>'
            + '</section>';
    }
    h += '</div>';
    body.innerHTML = h;

    body.querySelectorAll('.ag-card').forEach(wireCard);
}


function wireCard(card) {
    const key = card.dataset.agentKey;
    card.querySelectorAll('[data-act]').forEach((btn) => {
        btn.onclick = () => {
            const act = btn.dataset.act;
            if (act === 'run') return runAgent(key);
            if (act === 'pause') return pauseAgent(key);
            if (act === 'log') return openLog(key);
            return undefined;
        };
    });
}


/** Prekreslí jednu kartu z aktuálneho stavu a znovu ju nadrôtuje. */
function repaintCard(key) {
    const card = document.querySelector('.ag-card[data-agent-key="' + cssEscape(key) + '"]');
    const agent = state.byKey.get(key);
    if (!card || !agent) return;
    const run = agent.latest_run || null;
    card.dataset.status = run ? run.status : 'idle';
    card.innerHTML = agentCardInnerHtml(agent, state.destructiveEnabled);
    wireCard(card);
}

/** Bezpečné escapovanie kľúča do CSS selektora (kľúče sú [a-z-], ale buďme opatrní). */
function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}


/* ---------- akcie ---------- */

async function runAgent(key) {
    const agent = state.byKey.get(key);
    if (!agent || agent.placeholder) return;

    if (agent.destructive) {
        if (!state.destructiveEnabled) {
            showToast('Deštruktívny agent je vypnutý (bezpečnostná poistka).', null, 'warn');
            return;
        }
        // eslint-disable-next-line no-alert
        if (!window.confirm('Naozaj spustiť deštruktívneho agenta „' + agent.label + '"? Mení dáta.')) {
            return;
        }
    }

    try {
        const res = await apiSend('POST', '/api/agents/' + encodeURIComponent(key) + '/run');
        // Optimisticky: karta prejde do stavu „Čaká", než dorazí prvý pulz.
        agent.latest_run = res && res.run ? res.run : { status: 'queued', progress: 0, step: 'V rade' };
        repaintCard(key);
        showToast('Agent „' + agent.label + '" zaradený do fronty.', null, 'success');
    } catch (e) {
        handleRunError(e, agent);
    }
}

function handleRunError(e, agent) {
    const code = e && e.body && e.body.error;
    if (e && e.status === 423 && code === 'destructive_disabled') {
        showToast('Deštruktívny agent je vypnutý (bezpečnostná poistka).', null, 'warn');
        return;
    }
    if (e && e.status === 422 && code === 'placeholder') {
        showToast('Tento agent je zatiaľ len koncept.', null, 'warn');
        return;
    }
    if (e && e.status === 429) {
        showToast('Priveľa spustení naraz — skús o chvíľu.', null, 'warn');
        return;
    }
    showToast('Agenta „' + agent.label + '" sa nepodarilo spustiť.', null, 'warn');
}

async function pauseAgent(key) {
    const agent = state.byKey.get(key);
    if (!agent) return;
    try {
        await apiSend('POST', '/api/agents/' + encodeURIComponent(key) + '/pause');
        agent.latest_run = { ...(agent.latest_run || {}), status: 'paused', step: 'Pozastavené' };
        repaintCard(key);
        showToast('Beh agenta „' + agent.label + '" pozastavený.', null, 'success');
    } catch (e) {
        if (e && e.status === 409) {
            showToast('Agent práve nebeží.', null, 'warn');
            return;
        }
        showToast('Pozastavenie sa nepodarilo.', null, 'warn');
    }
}


/* ---------- log drawer ---------- */

function logDrawer() { return $('agent-log'); }

function renderLogLines(lines) {
    const box = $('agent-log-body');
    if (!box) return;
    if (!lines || !lines.length) {
        box.innerHTML = '<p class="ag-log-empty">Zatiaľ žiadny výstup.</p>';
        return;
    }
    box.innerHTML = '<pre class="ag-log-pre">' + lines.map((l) => esc(String(l))).join('\n') + '</pre>';
    box.scrollTop = box.scrollHeight;
}

function appendLogLines(lines) {
    const box = $('agent-log-body');
    if (!box || !lines || !lines.length) return;
    let pre = box.querySelector('.ag-log-pre');
    if (!pre) { box.innerHTML = '<pre class="ag-log-pre"></pre>'; pre = box.querySelector('.ag-log-pre'); }
    const prefix = pre.textContent ? '\n' : '';
    pre.textContent += prefix + lines.map((l) => String(l)).join('\n');
    box.scrollTop = box.scrollHeight;
}

async function openLog(key) {
    const agent = state.byKey.get(key);
    const drawer = logDrawer();
    if (!drawer || !agent) return;
    state.logKey = key;
    state.logRunId = null;

    const title = $('agent-log-title');
    if (title) title.textContent = agent.label;
    drawer.classList.remove('hidden');
    drawer.setAttribute('aria-hidden', 'false');

    const box = $('agent-log-body');
    if (box) box.innerHTML = listSkeletonHtml(4, '18px');

    let runsPayload;
    try {
        runsPayload = await apiGet('/api/agents/' + encodeURIComponent(key) + '/runs');
    } catch (e) {
        if (box) renderApiError(box, e, () => openLog(key));
        return;
    }
    const runs = (runsPayload && runsPayload.runs) || [];
    if (!runs.length) { renderLogLines(null); return; }

    const latest = runs[0];
    state.logRunId = latest.id;
    try {
        const detail = await apiGet('/api/agent-runs/' + latest.id);
        const log = detail && detail.run ? detail.run.log : null;
        renderLogLines(log ? String(log).split(/\r\n|\r|\n/) : null);
    } catch (e) {
        if (box) renderApiError(box, e, () => openLog(key));
    }
}

function closeLog() {
    const drawer = logDrawer();
    if (!drawer) return;
    drawer.classList.add('hidden');
    drawer.setAttribute('aria-hidden', 'true');
    state.logKey = null;
    state.logRunId = null;
}


/* ---------- živý pulz ---------- */

/** Aplikuje jeden pulz na stav + DOM. Exportované kvôli testom. */
export function applyPulse(agentKey, type, data = {}) {
    const agent = state.byKey.get(agentKey);
    if (!agent) return;

    // Log riadky idú do drawra, ak je otvorený pre tohto agenta.
    if (type === 'run.log') {
        if (state.logKey === agentKey && Array.isArray(data.lines)) appendLogLines(data.lines);
        return;
    }

    const change = pulseToState(type, data);
    if (!change) return;

    const prev = agent.latest_run || {};
    const next = { ...prev };
    if (change.status !== undefined) next.status = change.status;
    if (change.progress !== undefined) next.progress = change.progress;
    if (change.step !== undefined) next.step = change.step;
    if (change.message !== undefined) next.message = change.message;
    if (type === 'run.done' || type === 'run.failed' || type === 'run.paused') {
        next.finished_at = new Date().toISOString();
    }
    if (data.run_id) next.id = data.run_id;
    agent.latest_run = next;

    repaintCard(agentKey);
    // Súhrn „práve beží" sa mohol zmeniť — prepočítaj lacno z aktuálneho stavu.
    refreshSummaryKpi();
}

function refreshSummaryKpi() {
    if (!state.summary) return;
    const running = state.agents.filter((a) => {
        const s = a.latest_run && a.latest_run.status;
        return s === 'running' || s === 'queued';
    }).length;
    state.summary.running = running;
    const grid = document.querySelector('#agenti-body .kpi-grid');
    if (grid) grid.outerHTML = summaryKpiHtml(state.summary);
}


/* ---------- register ---------- */

let wired = false;

export function register(root) {
    const host = root && root.querySelector ? root.querySelector('#screen-agenti') : null;
    if (!host) return;

    const closeBtn = host.querySelector('#agent-log-close');
    if (closeBtn) closeBtn.onclick = closeLog;
    const backdrop = host.querySelector('#agent-log-backdrop');
    if (backdrop) backdrop.onclick = closeLog;

    if (wired) return;
    wired = true;

    // Živý kanál agentov — rovnaký ws config ako graf, vlastné (nezávislé) spojenie.
    subscribe('agents', 'pulse', (msg) => {
        if (!msg || !msg.agent_key) return;
        applyPulse(msg.agent_key, msg.type, msg.data || {});
    });

    // Render-on-enter (vzor eshop.js) — router obrazovku 'agenti' rendruje aj priamo,
    // toto je poistka pre moduly bez importu routera.
    bus.on(EV.SCREEN_CHANGED, (p) => { if (p && p.to === 'agenti') renderAgenti(); });
}
