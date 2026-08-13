/* Hades — živá neurónová sieť vedomia */

import { setupCmdk } from './cmdk.js';
import { setupControls } from './controls.js';
import { clearLocal, setLocal } from './filters.js';
import { installFetchGuard } from './http.js';
import { setupPrompt } from './chat.js';
import { setupInput } from './interaction.js';
import { setupPack } from './pack.js';
import { buildLegend } from './panels.js';
import { checkJournalUnread } from './rail.js';
import { draw, fitView, frame, publishNavApi, requestDraw, resize, scheduleFrame, setupVisibilityRepaint } from './render.js';
import { setScreen } from './screens.js';
import { setupHints, setupShortcuts } from './shortcuts.js';
import { setView } from './sim.js';
import { S } from './state.js';
import { initialTheme, setTheme } from './theme.js';
import { computeReplayBounds } from './timeline.js';
import { applyOpts, isAwake, markAwake, renderBreadcrumb, setFocus, updateHeaderMetrics, updateStateUi } from './util.js';
import { connectWs } from './ws.js';

/* ---------- štart ---------- */

// Chybový hero cez plátno — vedomie sa nepodarilo načítať
function renderInitError() {
    const el = document.createElement('div');
    el.className = 'empty empty-network';
    el.innerHTML = '<span class="ms" aria-hidden="true">cloud_off</span>'
        + '<h4 class="title">Vedomie sa nepodarilo prebudiť</h4>'
        + '<p class="hint">Server neodpovedá — skontroluj, či Hades beží.</p>'
        + '<button type="button" class="primary" id="retry-init">Skúsiť znova</button>';
    document.body.appendChild(el);
    el.querySelector('#retry-init').onclick = () => location.reload();
}

async function init() {
    // MUSÍ byť prvé — obaľuje window.fetch (CSRF token pre zápisy + hláška pri
    // zamknutom okruhu), takže to treba stihnúť skôr, než čokoľvek fetchne.
    installFetchGuard();
    setTheme(initialTheme());
    resize();
    window.addEventListener('resize', () => { resize(); requestDraw(); }); // rozmer sa zmenil → prekresli

    let data;
    try {
        const res = await fetch('/api/mind?scope=' + S.graphScope);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
    } catch (e) {
        renderInitError();
        return;
    }

    S.name = data.name;
    S.awakeMinutes = 5;
    if (data.state.awake) markAwake();

    for (const a of data.areas) S.areas.set(a.id, a);
    for (const d of data.departments) S.departments.set(d.id, d);

    S.nodes = data.nodes.map((n) => ({ ...n }));
    for (const n of S.nodes) S.byId.set(n.id, n);

    S.edges = data.edges
        .filter((e) => S.byId.has(e.source_id) && S.byId.has(e.target_id))
        .map((e) => ({ ...e, source: S.byId.get(e.source_id), target: S.byId.get(e.target_id) }));

    computeReplayBounds();
    setupInput();
    setupControls();
    setupShortcuts();
    buildLegend();
    updateHeaderMetrics();
    renderBreadcrumb();
    applyOpts();
    setView(S.view);
    setupCmdk();
    setupPack();
    setupPrompt();
    setupHints();
    connectWs(data.ws);
    checkJournalUnread();

    // FÁZA SHELL: aktivuj uloženú obrazovku (default 'dnes'). Na 'graf' prebudí slučku,
    // inak vyrenderuje príslušnú DOM obrazovku a plátno ostane zaparkované.
    setScreen(S.screen);

    // FÁZA DE-CLUTTER: dream() náhodné pulzy zrušené — sieť v pokoji nič nebudí, spí ticho.
    setInterval(computeReplayBounds, 60000);

    // FÁZA RENDER PIPELINE: strážca stavu bdenia — slučka spí, takže prechod bdie↔spí
    // (a s ním útlm S.dim + stavový čip) treba prebudiť ručne. Lacné: raz za 1,5 s.
    let _wasAwake = isAwake();
    setInterval(() => {
        const a = isAwake();
        if (a !== _wasAwake) { _wasAwake = a; requestDraw(); } // zmena stavu → rozbehni dim prechod
        updateStateUi();
    }, 1500);

    window.HADES = { S, draw, frame, setTheme, setFocus, fitView, setLocal, clearLocal };
    publishNavApi();   // doplní go / currentPath / computeLayout

    scheduleFrame();
    setupVisibilityRepaint(); // návrat na tab → istý repaint (listener v render.js)
}

// window.HADES sa priraďuje až na konci init(), takže bez tohto catchu sa každá
// výnimka v inicializácii javí navonok len ako „HADES neexistuje" — async rejection
// sa nikde nelogovala a diagnostika bola slepá.
init().catch((e) => {
    console.error('HADES init zlyhal:', e);
    document.body.dataset.initFailed = '1';
});
