import { REDUCED_MOTION } from '../core/motion.js';
import { S } from '../core/state/index.js';
import { nodeColor } from './colors.js';
import { nodeVisible } from './filters.js';
import { localSet } from './local.js';
import { edgeCategoryHidden, edgeSkeletal } from './render/edges.js';
import { SETTLE_FRAMES, requestDraw } from './render/frame.js';
import { visibleInReplay } from './timeline.js';


/* ---------- pulzy ---------- */

export function spawnPulse(fromNode, toNode, opts = {}) {
    if (!fromNode || !toNode || S.replay.on) return;
    if (REDUCED_MOTION) {
        // žiadny cestujúci pulz — cieľový uzol sa staticky zvýrazní cez flash a nechá vyhasnúť
        toNode.flash = 1;
        S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
        requestDraw();
        return;
    }
    S.pulses.push({
        from: fromNode, to: toNode,
        t: 0,
        speed: opts.speed || 0.9 + Math.random() * 0.5,
        color: opts.color || nodeColor(toNode),
        dim: opts.dim || 1,
    });
    requestDraw(); // pulz sa práve narodil → zobuď slučku
}


// Strop súbežných tokov (klesá s anim=0). FÁZA DE-CLUTTER: bez FPS auto-stropu — po
// optimalizácii pipeline netreba throttlovať, slučka aj tak v pokoji spí.
export function flowCap() {
    return Math.max(0, Math.round(20 * Math.min(1.2, Math.max(S._anim, S._life))));
}


// FÁZA ANIMÁCIE (Living): počet práve bežiacich spontánnych synapsií (flow.spont).
function synapseCount() {
    let c = 0;
    for (const f of S._flows) if (f.spont) c++;
    return c;
}


// Vyber náhodnú viditeľnú kostrovú hranu pre spontánnu synapsiu — uprednostni hranu v zábere,
// nech je „premýšľanie" vidieť. Pár náhodných pokusov (lacné aj pri veľkej sieti).
function pickSynapseEdge() {
    if (!S.edges.length) return null;
    const loc = localSet();
    const vp = S._vp;
    let fallback = null;
    for (let tries = 0; tries < 14; tries++) {
        const e = S.edges[(Math.random() * S.edges.length) | 0];
        if (!e || !e.source || !e.target) continue;
        if ((e.weight || 1) < S.minWeight) continue;
        if (edgeCategoryHidden(e)) continue;
        if (!loc && !edgeSkeletal(e)) continue; // v pozadí len kostra (bez hairballu)
        if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
        if (!(visibleInReplay(e.source) && visibleInReplay(e.target))) continue;
        fallback = e;
        if (!vp) return e;
        const a = e.source, b = e.target;
        const inView = !(Math.max(a.x, b.x) < vp.x0 || Math.min(a.x, b.x) > vp.x1
            || Math.max(a.y, b.y) < vp.y0 || Math.min(a.y, b.y) > vp.y1);
        if (inView) return e;
    }
    return fallback;
}


// Občas (interval ~2–5 s × 1/život) vyšle slabý svetlobod po náhodnej viditeľnej hrane.
// Znovupoužíva S._flows (dobeh rozsvieti cieľ). Strop 2–3 súbežné (auto-strop ich stíši).
export function maybeSynapse() {
    if (S._life <= 0 || S._lifeTier >= 2 || REDUCED_MOTION || document.hidden || S.replay.on) return;
    if (S._clock < S._nextSynapse) return;
    const life = Math.min(1.6, S._life);
    S._nextSynapse = S._clock + (2 + Math.random() * 3) / Math.max(0.2, life);
    const cap = S._lifeTier === 1 ? 1 : (document.body.classList.contains('ambient') ? 3 : 2);
    if (synapseCount() >= cap) return;
    const e = pickSynapseEdge();
    if (!e) return;
    const fwd = Math.random() < 0.5;
    S._flows.push({
        from: fwd ? e.source : e.target,
        to: fwd ? e.target : e.source,
        e, t: 0,
        speed: 0.5 + Math.random() * 0.35,
        tone: Math.random() < 0.5 ? 'accent' : 'ink',
        dim: 0.7, wait: 0, spont: true,
    });
    requestDraw();
}


// Vyšle putujúce svetlobody po incidentných hranách uzla (len na aktivitu, nie nepretržite).
// Respektuje filtre hrán, auto-strop aj anim. tone: 'accent' (teal) | 'ink' | hex.
export function emitFlows(node, opts = {}) {
    if (!node || REDUCED_MOTION || (S._anim <= 0 && S._life <= 0) || document.hidden || S.replay.on) return;
    const cap = flowCap();
    if (cap <= 0) return;
    for (const e of S.edges) {
        if (e.source.id !== node.id && e.target.id !== node.id) continue;
        if ((e.weight || 1) < S.minWeight) continue;
        if (edgeCategoryHidden(e)) continue;
        if (S._flows.length >= cap) break;
        const to = e.source.id === node.id ? e.target : e.source;
        S._flows.push({
            from: node, to, e, t: 0,
            speed: opts.speed || 0.8 + Math.random() * 0.35,
            tone: opts.tone || 'accent',
            dim: opts.dim != null ? opts.dim : 1,
            wait: opts.wait || 0, // oneskorenie štartu (staggered recall vlna)
        });
    }
    if (S._flows.length) requestDraw(); // vznikli toky → zobuď slučku
}
