import { edgeCategoryHidden, edgeSkeletal } from './edges.js';
import { localSet, nodeVisible } from './filters.js';
import { hash01 } from './layout.js';
import { SETTLE_FRAMES, requestDraw, visibleInReplay } from './render.js';
import { REDUCED_MOTION, S } from './state.js';
import { nodeColor } from './util.js';

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

export function neighborsOf(node) {
    const out = [];
    for (const e of S.edges) {
        if (e.source.id === node.id) out.push(e.target);
        else if (e.target.id === node.id) out.push(e.source);
    }
    return out;
}

/* ---------- FÁZA ANIMÁCIE: globálne škálovanie + toky ---------- */

// Efektívna intenzita animácií. REDUCED_MOTION → 0 (statika). Ambient režim zosilní jemné
// efekty ×1.6, inak držané veľmi jemné. Slider 'anim' (0..1) funguje aj ako vypínač na 0.
export function animLevel() {
    if (REDUCED_MOTION) return 0;
    const base = S.opts && S.opts.anim != null ? S.opts.anim : 0.5;
    if (base <= 0) return 0;
    return base * (document.body.classList.contains('ambient') ? 1.6 : 1);
}

// FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie / drift / synapsie / gravitácia).
// REDUCED_MOTION → 0 (žiadny ambient, len event pulzy). Ambient režim vždy žije (floor 0.6) a zosilní
// ×1.8. Slider 'Život' (0..1) je nezávislý od 'Animácie' a na 0 vráti dirty-only pokoj.
export function lifeLevel() {
    if (REDUCED_MOTION) return 0;
    let base = S.opts && S.opts.life != null ? S.opts.life : 0.5;
    const amb = document.body.classList.contains('ambient');
    if (amb) base = Math.max(base, 0.6); // ambient režim ožije aj so stiahnutým Životom
    if (base <= 0) return 0;
    return base * (amb ? 1.8 : 1);
}

// Auto-strop: tier z EMA nákladu draw() (S._drawMs). Plynulé, EMA tlmí flikanie na hranici.
// 0 = plný ambient, 1 = redukovaný (drift von, dýcha len jadro, menej synapsií), 2 = len event-driven.
export function lifeTier() {
    const ms = S._drawMs;
    if (ms > 33) return 2; // ~<30 FPS ekvivalent renderu → vypni ambient
    if (ms > 22) return 1; // ~<45 FPS → redukuj
    return 0;
}

// Ease-out (cubic) — zrod uzla; ease-in-out — morph náhľadov.
export function easeOut(p) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3); }
export function easeInOut(p) { p = Math.max(0, Math.min(1, p)); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }

// Strop súbežných tokov (klesá s anim=0). FÁZA DE-CLUTTER: bez FPS auto-stropu — po
// optimalizácii pipeline netreba throttlovať, slučka aj tak v pokoji spí.
export function flowCap() {
    return Math.max(0, Math.round(20 * Math.min(1.2, Math.max(S._anim, S._life))));
}

// FÁZA ANIMÁCIE (Living): počet práve bežiacich spontánnych synapsií (flow.spont).
export function synapseCount() {
    let c = 0;
    for (const f of S._flows) if (f.spont) c++;
    return c;
}

// Vyber náhodnú viditeľnú kostrovú hranu pre spontánnu synapsiu — uprednostni hranu v zábere,
// nech je „premýšľanie" vidieť. Pár náhodných pokusov (lacné aj pri veľkej sieti).
export function pickSynapseEdge() {
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

// W2a — POKOJ: spontánne synapsie sú vypnuté. Používateľ výslovne chce pokoj:
// dýcha len jadro, prach sa unáša veľmi pomaly, ostatné stojí. Animácia sa spúšťa
// len udalosťou (zanorenie = morph kamery/pozícií, zrod nového uzla, recall).
// Funkcia ostáva exportovaná (volá ju render.frame()) a je zámerne no-op —
// v ambient režime (telo .ambient) sa jemné „premýšľanie" povolí naspäť.
export function maybeSynapse() {
    if (!document.body.classList.contains('ambient')) return;
    if (S._life <= 0 || S._lifeTier >= 2 || REDUCED_MOTION || document.hidden || S.replay.on) return;
    if (S._clock < S._nextSynapse) return;
    const life = Math.min(1.6, S._life);
    S._nextSynapse = S._clock + (3 + hash01(Math.floor(S._clock)) * 4) / Math.max(0.2, life);
    if (synapseCount() >= 2) return;
    const e = pickSynapseEdge();
    if (!e) return;
    S._flows.push({
        from: e.source, to: e.target, e, t: 0,
        speed: 0.55, tone: 'accent', dim: 0.7, wait: 0, spont: true,
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

// Zrod uzla: násobič polomeru 0→1 (~0.5 s, ease-out). anim=0 / REDUCED_MOTION → hneď plný.
export function birthScale(n) {
    if (n._born == null || S._anim <= 0 || REDUCED_MOTION) return 1;
    const age = S._clock - n._born;
    if (age >= 0.5) return 1; // prstenec (do 0.6 s) dobehne a _born vyčistí až sám
    return easeOut(age / 0.5);
}

// W2a — POKOJ: dýcha LEN jadro (~±5 %, perióda 5,5 s). Ostatné uzly stoja.
// Zamrzne pri drag/pan a keď je Život na nule. Uzol pod kurzorom nedýcha (presné čítanie).
export function breatheFactor(n) {
    if (S._life <= 0 || S._interacting) return 1;
    if (n.type !== 'core' || n === S.hover) return 1;
    const life = Math.min(1.4, S._life);
    return 1 + 0.05 * life * Math.sin(S._clock * (2 * Math.PI / 5.5));
}

// W2a — prach sa unáša veľmi pomaly. Deterministická fáza z hashu id (žiadny random),
// amplitúda v obrazovkových pixeloch (invK), perióda ~26 s → takmer nepostrehnuteľný pohyb.
/* Vracia ZDIEĽANÝ objekt, nie nový. Volá sa raz na každý prachový uzol v každom
   frame (~1400× pri 2672 uzloch, teda ~84 000 krátkodobých objektov za sekundu) a
   jediný odberateľ z neho hneď prečíta x/y a zabudne ho. Kto by si ho chcel odložiť,
   dostane hodnoty ďalšieho uzla — preto sa výsledok čítá okamžite (render.js). */
const _drift = { x: 0, y: 0 };
export function dustDrift(id, invK) {
    if (S._life <= 0 || S._interacting || S._lifeTier >= 2) return null;
    const life = Math.min(1.2, S._life);
    const ph = hash01(id) * 6.2831853;
    const a = 2.2 * life * invK;
    _drift.x = Math.sin(S._clock * 0.24 + ph) * a;
    _drift.y = Math.cos(S._clock * 0.19 + ph * 1.7) * a;
    return _drift;
}
