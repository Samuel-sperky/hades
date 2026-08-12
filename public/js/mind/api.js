import { clearLocal } from './filters.js';
import { closeNodePanel } from './panels.js';
import { draw } from './render.js';
import { buildSim, kickSim } from './sim.js';
import { S } from './state.js';
import { renderBreadcrumb, setFocus, updateHeaderMetrics } from './util.js';

// Znovunačítanie grafu bez straty pozícií existujúcich uzlov
export let reloadSeq = 0;
export async function reloadGraph() {
    const seq = ++reloadSeq;
    try {
        const res = await fetch('/api/mind?scope=' + S.graphScope);
        const data = await res.json();
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
        draw();
    } catch (e) { /* offline reload nevadí */ }
}
