import { ApiError, apiGet } from '../core/api.js';
import { S } from '../core/state/index.js';
import { markAwake } from './awake.js';
import { refreshVisibility } from './filters.js';
import { setFocus } from './focus.js';
import { clearLocal } from './local.js';
import { draw } from './render/draw.js';
import { buildSim, kickSim } from './sim.js';
import { computeReplayBounds } from './timeline.js';
import { closeNodePanel } from '../node/node-panel.js';
import { renderBreadcrumb } from '../shell/breadcrumb.js';
import { updateHeaderMetrics } from '../shell/header.js';
import { showToast } from '../shell/toasts.js';


// Slovenský text k ApiError kódu (§4.1). Ticho sa prehliadne len to, čo používateľ
// vyvolal sám (aborted) alebo čo si všimne aj bez nás (offline).
export function apiErrorText(err) {
    const code = err instanceof ApiError ? err.code : 'server';
    if (code === 'unauthorized') return 'Prístup zamietnutý — vedomie odmietlo požiadavku.';
    if (code === 'rate_limited') return 'Priveľa požiadaviek — skús to o chvíľu.';
    if (code === 'unavailable') return 'Vedomie je momentálne nedostupné.';
    if (code === 'timeout') return 'Vedomie neodpovedalo včas.';
    if (code === 'server') return 'Chyba servera pri načítaní grafu.';
    return null; // offline / aborted / bad_request — bez vyrušovania
}


function graphQuery() {
    return { query: { scope: S.graphScope } };
}


// Znovunačítanie grafu bez straty pozícií existujúcich uzlov
let reloadSeq = 0;

export async function reloadGraph() {
    const seq = ++reloadSeq;
    let data;
    try {
        data = await apiGet('/api/mind', graphQuery());
    } catch (e) {
        // reload je na pozadí (WS reconnect, zmena rozsahu) — 401/429 sa už nestratí v tichu
        const msg = apiErrorText(e);
        if (msg) showToast(msg, null, 'error');
        return;
    }
    if (seq !== reloadSeq) return; // medzitým beží novší reload — táto odpoveď je zastaraná

    S.areas = new Map(data.areas.map((a) => [a.id, a]));
    S.departments = new Map(data.departments.map((d) => [d.id, d]));

    const old = S.byId;
    S.nodes = data.nodes.map((n) => {
        const prev = old.get(n.id);
        return prev ? Object.assign(prev, n) : { ...n };
    });
    S.byId = new Map(S.nodes.map((n) => [n.id, n]));

    S.edges = data.edges
        .filter((e) => S.byId.has(e.source_id) && S.byId.has(e.target_id))
        .map((e) => ({ ...e, source: S.byId.get(e.source_id), target: S.byId.get(e.target_id) }));

    if (S.selected && !S.byId.has(S.selected.id)) closeNodePanel();
    if (S.focus.areaId && !S.areas.has(S.focus.areaId)) setFocus(null, null);
    if (S.local && !S.byId.has(S.local.rootId)) clearLocal();
    S._localFor = null; // nové hrany — BFS množinu prepočítať

    buildSim();
    kickSim(0.3);
    updateHeaderMetrics();
    renderBreadcrumb();
    refreshVisibility();
    draw();
}


/* Prvé načítanie grafu (GET /api/mind). Vracia payload — app.js z neho berie ws config.
   Chyba sa vyhodí ako ApiError (§4.1) — app.js na ňu vykreslí chybový hero. */
export async function loadGraph() {
    const data = await apiGet('/api/mind', graphQuery());

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
    refreshVisibility();
    return data;
}
