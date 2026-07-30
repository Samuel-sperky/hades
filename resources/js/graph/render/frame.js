import { now } from '../../core/format.js';
import { S } from '../../core/state/index.js';
import { animLevel, easeInOut, lifeLevel, lifeTier } from '../animation.js';
import { isAwake } from '../awake.js';
import { canvas } from '../canvas-el.js';
import { flowCap, maybeSynapse } from '../pulses.js';
import { draw } from './draw.js';
import { stopReplay, updateTimelineLabel } from '../timeline.js';
import { syncSlider } from '../../shell/settings.js';
import { updateStateUi } from '../../shell/status-chip.js';
import { applyReadableZoom } from './zoom.js';


/* ---------- render ---------- */

export function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    canvas.width = S.w * S.dpr;
    canvas.height = S.h * S.dpr;
    canvas.style.width = S.w + 'px';
    canvas.style.height = S.h + 'px';
}


let lastFrame = now();

let framePending = false;

// FÁZA RENDER PIPELINE: strážca čitateľnosti prvého záberu. app.js po loadGraph() fitne
// kameru cez fitView() (graph/camera.js — cudzí balík), ktorý zoom počíta len z bbox uzlov:
// pri 200+ uzloch skončí pod prahom detailu, pri neznámom viewporte (0×0 pred prvým
// layoutom) až na spodnej zátke 0.14. Prvý frame po načítaní dát zoom raz zdvihne na
// čitateľné minimum (render/zoom.js). Zaniká po prvom použití — bežné oddialenie kolieskom
// ani zoom-out to nikdy nevracia späť.
let readableFitPending = true;

export function frame() {
    framePending = false;
    // FÁZA SHELL: ak sme medzitým opustili Graf, slučka zaparkuje bez kreslenia.
    if (S.screen !== 'graf') return;
    if (readableFitPending && S.nodes.length) {
        readableFitPending = false;
        if (applyReadableZoom()) S._dirty = true;
    }
    const nowMs = now();
    const dt = Math.min((nowMs - lastFrame) / 1000, 0.1);
    lastFrame = nowMs;

    // FÁZA ANIMÁCIE: monotónny čas + efektívna intenzita animácií tohto framu
    S._clock += dt;
    S._anim = animLevel();
    // FÁZA ANIMÁCIE (Living): auto-strop z EMA nákladu draw(); ambientný život až po tier gate.
    S._lifeTier = lifeTier();
    S._life = S._lifeTier >= 2 ? 0 : lifeLevel(); // tier 2 → len event-driven (žiadny ambient)
    // kurzorová aktivácia — plynulý nábeh/uvoľnenie gravitácie (uvoľní sa keď kurzor odíde/ťaháme)
    S.cursor.a += ((S.cursor.on ? 1 : 0) - S.cursor.a) * Math.min(1, dt * 10);
    if (S.cursor.a < 0.005) S.cursor.a = 0;
    maybeSynapse(); // občasná spontánna synapsia po náhodnej hrane („myseľ premýšľa")

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES); // flash cieľa nech dohasne
        }
    }

    // FÁZA ANIMÁCIE: putujúce svetlobody po hranách — po dobehnutí jemne rozsvietia cieľ
    // (staggered dobeh dáva recall „graph-walk" vlnu). Nad rozpočet sa oreže najstaršie.
    for (let i = S._flows.length - 1; i >= 0; i--) {
        const f = S._flows[i];
        if (f.wait > 0) { f.wait -= dt; continue; }
        f.t += dt * f.speed;
        if (f.t >= 1) {
            if (f.to) f.to.flash = Math.min(1, (f.to.flash || 0) + 0.28 * f.dim);
            S._flows.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES); // flash cieľa nech dohasne
        }
    }
    const cap = flowCap();
    if (S._flows.length > cap) S._flows.splice(0, S._flows.length - cap);

    // FÁZA ANIMÁCIE: morph prechod pozícií medzi náhľadmi (sim je počas neho zastavená)
    if (S._morph) {
        const m = S._morph;
        m.t = Math.min(1, m.t + dt / m.dur);
        const e = easeInOut(m.t);
        for (const n of S.nodes) {
            const a = m.from.get(n.id), b = m.to.get(n.id);
            if (a && b) { n.x = a.x + (b.x - a.x) * e; n.y = a.y + (b.y - a.y) * e; }
        }
        if (m.t >= 1) {
            for (const n of S.nodes) { const b = m.to.get(n.id); if (b) { n.x = b.x; n.y = b.y; } }
            S._morph = null;
            // mapa/sieť: jemný dotik simulácie na dosadnutie; Vrstvy majú pevné fx/fy → nechaj zastavené
            if (S.sim && S.view !== 'layers') S.sim.alpha(0.05).restart();
            requestDraw();
        }
    }

    if (S.replay.playing) {
        S.replay.t = Math.min(1, S.replay.t + dt / 22);
        const tlr = document.getElementById('tl-range');
        tlr.value = Math.round(S.replay.t * 1000);
        syncSlider(tlr);
        updateTimelineLabel();
        if (S.replay.t >= 1) stopReplay();
    }

    // FÁZA RENDER PIPELINE: dirty-flag rozhodnutie — prekresli LEN keď je čo animovať alebo je dirty.
    // responsive = stavy, čo chcú plnú frekvenciu (sim, morph, replay, interakcia, pulzy/toky, dobeh, dim).
    // ambientLife = spojitý jemný život (dýchanie/drift/gravitácia/synapsie) — throttluje sa na ~30 FPS.
    // V pokoji (Život=0 a nič sa nedeje): 0 prekreslení, tichý CPU.
    const simActive = S.sim && S.view !== 'layers' && S.sim.alpha() > S.sim.alphaMin();
    const dimTarget = isAwake() ? 1 : 0.5;
    const dimActive = Math.abs(dimTarget - S.dim) > 0.001;
    const ambientLife = S._life > 0; // už gate-nuté cez tier a screen; ambient režim ho drží nažive
    const responsive = simActive || !!S._morph || S.replay.playing || S._interacting
        || S.pulses.length > 0 || S._flows.length > 0 || S._settleFrames > 0 || dimActive;
    const active = responsive || ambientLife;

    if (S._settleFrames > 0) S._settleFrames--;

    // responzívne / dirty stavy kreslíme okamžite; čistý ambient len keď uplynulo ~33 ms (cap 30 FPS)
    let doDraw = responsive || S._dirty;
    if (!doDraw && ambientLife && (nowMs - S._lastAmbient) >= AMBIENT_MS) doDraw = true;

    if (doDraw) {
        const _t0 = performance.now();
        draw();
        // EMA nákladu kreslenia — plynulý podklad pre auto-strop (tier), aby na hranici neflikal
        S._drawMs += (Math.min(60, performance.now() - _t0) - S._drawMs) * 0.1;
        S._dirty = false;
        if (!responsive) S._lastAmbient = nowMs;
        updateStateUi();
    }

    // Reštart slučky len keď je stále čo robiť. Inak usne — udalosti ju zobudia cez requestDraw().
    if (active) scheduleFrame();
}


export function scheduleFrame() {
    // FÁZA SHELL: mimo obrazovky Graf sa plátno nekreslí vôbec — slučka zaparkuje (tichý CPU).
    // setScreen('graf') ju znovu naštartuje.
    if (S.screen !== 'graf') return;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}


// FÁZA RENDER PIPELINE: koľko frameov po dobehnutí animácie ešte kresliť, nech flash/zrod dohasne.
// flash klesá o 0.02/frame (0.5 → 0 ≈ 25 frameov); 45 dáva rezervu aj pre zrodový prstenec (0.6 s).
export const SETTLE_FRAMES = 45;


// FÁZA ANIMÁCIE (Living): interval čistého ambientného framu (~30 FPS). Responzívne stavy
// (interakcia, sim, pulzy/toky, morph) idú plnou frekvenciou; ambientný život sa throttluje sem.
const AMBIENT_MS = 32;


// Jednorazová požiadavka na prekreslenie (hover, kamera, výber, dáta, filter, téma).
// Nastaví dirty a zobudí uspatú rAF slučku (reset lastFrame, nech prvý dt nevyskočí).
export function requestDraw() {
    S._dirty = true;
    if (!framePending) { lastFrame = now(); scheduleFrame(); }
}


/* Slučka vlastní reakcie na zmenu rozmeru a návrat na tab. */
export function register(root) {
    window.addEventListener('resize', () => { resize(); requestDraw(); }); // rozmer sa zmenil → prekresli
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); requestDraw(); } // návrat na tab → istý repaint
    });
}
