import * as d3 from 'd3-force';
import { S } from '../core/state/index.js';
import { anchorOf } from './anchors.js';
import { hubNode, nodeRadius } from './geometry.js';
import { layerLayout } from './layers.js';
import { requestDraw } from './render/frame.js';


/* ---------- sily (Obsidian forces) — efektívne predvolené podľa náhľadu ---------- */

export function forceDefault(key) {
    const net = S.view === 'net';
    return {
        charge: net ? -120 : -42,
        linkDistance: net ? 95 : 72,
        linkStrength: 1,
        gravity: 1,
    }[key];
}


/* ---------- simulácia ---------- */

function applyViewPins() {
    if (S.view === 'layers') {
        const lay = layerLayout();
        for (const n of S.nodes) {
            const p = lay.posOf.get(n.id);
            if (p) { n.fx = p.x; n.fy = p.y; n._li = p.li; }
            else { n.fx = null; n.fy = null; n._li = null; }
        }
        return;
    }

    for (const n of S.nodes) { n.fx = null; n.fy = null; }
    const h = hubNode(); // pripni hub na (0,0) — stred siete
    if (h) { h.fx = 0; h.fy = 0; }
}


export function buildSim() {
    if (S.sim) S.sim.stop();
    S._layerCache = null; // štruktúra grafu sa mohla zmeniť → prepočítaj poradie stĺpcov

    // stupeň uzla (počet hrán) — podklad pre sizeByDegree, prepočet pri každej zmene hrán
    S.degree = new Map();
    for (const e of S.edges) {
        S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
        S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
    }

    for (const n of S.nodes) {
        if (n.x === undefined) {
            const a = anchorOf(n);
            n.x = a.x + (Math.random() - 0.5) * 60;
            n.y = a.y + (Math.random() - 0.5) * 60;
        }
    }

    applyViewPins();

    const net = S.view === 'net';
    // override fyziky zo S.forces (F2 slidery) — null = predvolená hodnota náhľadu
    const F = S.forces || {};
    const grav = F.gravity != null ? F.gravity : 1;
    const linkMul = F.linkStrength != null ? F.linkStrength : 1;

    S.sim = d3.forceSimulation(S.nodes)
        .velocityDecay(0.3)
        .force('x', d3.forceX(d => net ? 0 : anchorOf(d).x)
            .strength(d => (net ? 0.03 : (d.type === 'core' ? 0.25 : 0.055)) * grav))
        .force('y', d3.forceY(d => net ? 0 : anchorOf(d).y)
            .strength(d => (net ? 0.03 : (d.type === 'core' ? 0.25 : 0.055)) * grav))
        .force('charge', d3.forceManyBody()
            .strength(F.charge != null ? F.charge : (net ? -120 : -42))
            .distanceMax(net ? 520 : 320))
        .force('collide', d3.forceCollide(d => nodeRadius(d) + 7))
        .force('link', d3.forceLink(S.edges)
            .id(d => d.id)
            .distance(F.linkDistance != null ? F.linkDistance : (net ? 95 : 72))
            .strength(e => Math.min(0.09, 0.025 * (e.weight || 1)) * linkMul))
        .alpha(0.9)
        .alphaDecay(0.015)
        // FÁZA RENDER PIPELINE: alphaTarget 0 (predtým 0.012) — po usadení (alpha < alphaMin)
        // sim prestane tikať a slučka sa uspí. Drag/dáta/prepnutie náhľadu ho reštartujú.
        .alphaTarget(0)
        .alphaMin(0.001);

    // FÁZA RENDER PIPELINE: vo Vrstvách sú pozície pevné (fx/fy) → sim netreba, hneď zastav.
    if (S.view === 'layers') S.sim.stop();

    requestDraw(); // štruktúra grafu sa zmenila — vyžiadaj prekreslenie
}


export function kickSim(alpha = 0.35) {
    // FÁZA RENDER PIPELINE: sim sa teraz usadí a zastaví (alphaTarget 0), preto ho treba
    // reštartovať (.restart()). Vo Vrstvách je sim vždy zastavený (pevné fx/fy) — len prekresli.
    if (S.view === 'layers') { requestDraw(); return; }
    if (S.sim) S.sim.alpha(Math.max(S.sim.alpha(), alpha)).restart();
    requestDraw();
}
