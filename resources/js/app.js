/* AuraAI — entry point.

   Replaces the implicit hoisting of the old single-IIFE mind.js: with ES modules
   the boot order is explicit and is a contract (see CLAUDE.md). Every module that
   touches the DOM exposes register(root) and is wired here, exactly once. */

import './charts/index.js';

import { store } from './core/store.js';
import { S } from './core/state/index.js';
import { renderInitError } from './core/dom.js';

import { setTheme, register as registerTheme } from './theme.js';
import { canvas } from './graph/canvas-el.js';

import { draw } from './graph/render/draw.js';
import { frame, resize, scheduleFrame, requestDraw, register as registerFrame } from './graph/render/frame.js';
import { setView } from './graph/view.js';
import { fitView, register as registerCamera } from './graph/camera.js';
import { setFocus } from './graph/focus.js';
import { setLocal, clearLocal } from './graph/local.js';
import { isAwake } from './graph/awake.js';
import { loadGraph } from './graph/loader.js';
import { connectWs } from './graph/ws.js';
import { computeReplayBounds, register as registerTimeline } from './graph/timeline.js';
import { updateStateUi } from './shell/status-chip.js';

import { register as registerAmbient } from './shell/ambient.js';
import { applyOpts, register as registerSettings } from './shell/settings.js';
import { register as registerFilters } from './graph/filters.js';
import { register as registerCertFilter } from './graph/filters-cert.js';
import { register as registerViewSwitch } from './shell/view-switch.js';
import { checkJournalUnread, register as registerRail } from './shell/rail.js';
import { register as registerDock } from './shell/dock.js';
import { register as registerHelp } from './shell/help.js';
import { register as registerNodePanel } from './node/node-panel.js';
import { register as registerCreateNode } from './node/create-node.js';
import { register as registerEdgeAdmin } from './node/edge-admin.js';
import { register as registerMdOverlay } from './node/md-overlay.js';
import { register as registerLibrary } from './screens/library.js';
import { register as registerEshop } from './screens/eshop.js';
import { register as registerGraphInput } from './graph/input.js';
import { register as registerMap } from './graph/map/index.js';
import { drawMap } from './graph/map/render.js';
import { register as registerShortcuts } from './shell/shortcuts.js';
import { register as registerCmdk } from './shell/cmdk.js';
import { register as registerPack } from './dock/pack.js';
import { register as registerChat } from './chat/controller.js';
import { register as registerHints } from './shell/hints.js';

import { buildLegend } from './shell/legend.js';
import { updateHeaderMetrics } from './shell/header.js';
import { renderBreadcrumb } from './shell/breadcrumb.js';
import { setScreen } from './shell/router.js';

async function boot() {
    store.migrateLegacy();                       // hades.* → aura.*, raz, idempotentne

    setTheme(store.raw('theme') || 'light');
    resize();

    // Registrácie čítajú len stav z localStorage (nie dáta grafu), takže bežia
    // pred načítaním — v poradí, v akom bolo drôtovanie v pôvodnom monolite.
    const root = document.body;
    registerFrame(root);
    registerTheme(root);
    registerAmbient(root);
    registerSettings(root);
    registerFilters(root);
    registerCertFilter(root);
    // Časová os: markup (#tl-range) aj CSS aj testy existujú, ale register() sa nikdy
    // nevolal — importoval sa len computeReplayBounds. Slider bol teda v UI, mal
    // aria-label a nič nerobil.
    registerTimeline(root);
    registerViewSwitch(root);
    registerRail(root);
    registerDock(root);
    registerHelp(root);
    registerCamera(root);
    registerNodePanel(root);
    registerCreateNode(root);
    registerEdgeAdmin(root);
    registerMdOverlay(root);
    registerLibrary(root);
    registerEshop(root);
    registerGraphInput(canvas);
    registerMap(root);           // W1: radiálna MAPA = render obrazovky 'graf'
    registerShortcuts(root);
    registerCmdk(root);
    registerPack(root);
    registerChat(root);

    let data;
    try {
        data = await loadGraph();
    } catch (e) {
        renderInitError();
        return;
    }

    buildLegend();
    updateHeaderMetrics();
    renderBreadcrumb();
    applyOpts();
    setView(S.view);
    // prvé načítanie: nechaj simuláciu usadiť (~150 tikov spolu so setView) a fitni znova
    if (S.sim && S.view !== 'layers') { S.sim.tick(120); fitView(); }
    registerHints(root);
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

    // Debug hook. window.HADES zostáva vo W0 nezmenené; window.AURA je alias
    // na ten istý objekt, aby existujúce konzolové skripty fungovali.
    window.HADES = { S, draw, frame, setTheme, setFocus, fitView, setLocal, clearLocal, drawMap };
    window.AURA = window.HADES;

    scheduleFrame();
}

boot();
