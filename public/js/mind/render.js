import { animLevel, birthScale, breatheFactor, dustDrift, easeInOut, flowCap, lifeLevel, lifeTier, maybeSynapse } from './anim.js';
import { drawEdges, drawRibbons, drawStubs } from './edges.js';
import { localSet, nodeVisible } from './filters.js';
import { screenToWorld } from './interaction.js';
import { computeLayout, drawRadius, viewInsets } from './layout.js';
import { applyLayoutPositions, currentPath, go, syncNavFromFocus } from './sim.js';
import { REDUCED_MOTION, S, canvas, ctx } from './state.js';
import { T, certColors } from './theme.js';
import { stopReplay, updateTimelineLabel } from './timeline.js';
import { highlightSet, isAwake, nodeColor, now, syncSlider, ts, updateStateUi } from './util.js';

/* ---------- render ---------- */

// FÁZA SHELL / W2a: plátno žije LEN na obrazovke Graf. Zdroj pravdy je atribút
// data-screen na <body> (píše ho setScreen), S.screen je fallback pri prvom framu.
export function graphActive() {
    const ds = document.body ? document.body.dataset.screen : null;
    return ds ? ds === 'graf' : S.screen === 'graf';
}

export function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    canvas.width = S.w * S.dpr;
    canvas.height = S.h * S.dpr;
    canvas.style.width = S.w + 'px';
    canvas.style.height = S.h + 'px';
    // W2a: layout je aspect-aware — zmena rozmeru prepočíta scénu a znovu ju nafitne
    if (S.nodes.length) {
        const L = computeLayout();
        applyLayoutPositions(L);
        S._morph = null; S._camTween = null;
        const c = fitCam(fitBBox(L));
        S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
    }
}

// Časticový systém odstránený — žiadna hmla na papieri. No-op kvôli existujúcim volaniam.
export function makeStars() {
    S.stars = [];
}

export function visibleInReplay(n) {
    if (!S.replay.on) return true;
    const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    return n.type === 'core' || ts(n.created_at) <= cutoff;
}

// Layout aktuálnej úrovne + istota, že n.x/n.y sedia (napr. po zmene viewportu).
function ensureLayout() {
    const prev = S.layout;
    const L = computeLayout();
    if (L !== prev) { applyLayoutPositions(L); S._morph = null; }
    return L;
}

// Alfa uzla: základ z layoutu (kontext je stmavnutý na ~15 %) × zvýraznenie hoverom.
function entAlpha(n, ent, hl) {
    const base = ent.dim != null ? ent.dim : 1;
    let a = base;
    if (hl && !hl.has(n.id)) a *= 0.30;
    if (base >= 0.5) a = Math.max(T.nodeFloor, a);
    return a * S.dim;
}

export function draw() {
    // W2a: API stavového stroja pre iné vlny (main.js prepisuje window.HADES, preto tu)
    if (!S._navApi) {
        S._navApi = 1;
        window.HADES = Object.assign(window.HADES || {}, { go, currentPath, computeLayout });
    }

    const targetDim = isAwake() ? 1 : 0.5;
    S.dim += (targetDim - S.dim) * 0.02;
    if (Math.abs(targetDim - S.dim) < 0.001) S.dim = targetDim;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    const L = ensureLayout();
    const level = L.level;

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    const invK = 1 / S.cam.k;

    // viewport culling — svetové hranice viditeľnej plochy + okraj
    const _vTL = screenToWorld(0, 0);
    const _vBR = screenToWorld(S.w, S.h);
    const VM = 140 * invK;
    const vpX0 = _vTL.x - VM, vpY0 = _vTL.y - VM, vpX1 = _vBR.x + VM, vpY1 = _vBR.y + VM;
    const inView = (x, y) => x >= vpX0 && x <= vpX1 && y >= vpY0 && y <= vpY1;
    const edgeInView = (a, b) => !(Math.max(a.x, b.x) < vpX0 || Math.min(a.x, b.x) > vpX1
        || Math.max(a.y, b.y) < vpY0 || Math.min(a.y, b.y) > vpY1);
    S._vp = { x0: vpX0, y0: vpY0, x1: vpX1, y1: vpY1 };

    const hl = highlightSet();
    const hlAnchor = S.hover || S.selected;
    const loc = localSet();
    const softHoverActive = S.opts.edgeSoftHover && !hlAnchor && !loc;

    /* ---- pozadie: jemná technická mriežka ---- */
    const bgLevel = S.opts.bg * (level === 'map' ? 0.7 : 1);
    if (bgLevel > 0.01) {
        const _step = 240;
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + T.gridColor + ',' + (T.gridAlpha * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = Math.floor(_vTL.x / _step) * _step; gx <= _vBR.x; gx += _step) { ctx.moveTo(gx, _vTL.y); ctx.lineTo(gx, _vBR.y); }
        for (let gy = Math.floor(_vTL.y / _step) * _step; gy <= _vBR.y; gy += _step) { ctx.moveTo(_vTL.x, gy); ctx.lineTo(_vBR.x, gy); }
        ctx.stroke();
    }

    /* ---- spojenia: agregované stuhy (map/area) alebo reálne hrany (dept/node) ---- */
    if (L.edgeMode === 'real') {
        drawEdges(L, loc, hl, hlAnchor, softHoverActive, edgeInView);
        drawStubs(L);
    } else {
        drawRibbons(L);
    }

    ctx.globalCompositeOperation = 'source-over';

    /* ---- pulzy + putujúce svetlobody (len medzi uzlami tejto úrovne) ---- */
    for (const p of S.pulses) {
        if (!L.pos.has(p.from.id) || !L.pos.has(p.to.id)) continue;
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, 8 * invK, 0, 7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    const _flowI = Math.max(S._anim, S._life);
    if (_flowI > 0 && S._flows.length) {
        const fr = 3 * invK;
        for (const f of S._flows) {
            if (f.wait > 0) continue;
            if (!L.pos.has(f.from.id) || !L.pos.has(f.to.id)) continue;
            const x = f.from.x + (f.to.x - f.from.x) * f.t;
            const y = f.from.y + (f.to.y - f.from.y) * f.t;
            const a = Math.min(0.7, 0.6 * f.dim * Math.min(1.2, _flowI)) * Math.sin(Math.PI * Math.min(f.t, 1));
            if (a < 0.02) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = f.tone === 'ink' ? 'rgb(' + T.edge + ')'
                : f.tone === 'accent' ? 'rgb(' + T.accent + ')' : f.tone;
            ctx.beginPath();
            ctx.arc(x, y, fr, 0, 7);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    /* ---- PRACH (kind dust/ctx): dávkovo po farbách, bez hrán a popiskov ----
       LOD: prach je konštantne malý v obrazovkových pixeloch a veľmi priehľadný —
       pri oddialení nesie len tvar galaxie, pri priblížení nepridáva šum. */
    const dustPaths = new Map();   // color → { path, alpha }
    const solid = [];              // uzly s tvarom (kind node/center/core)
    for (const [id, ent] of L.pos) {
        const n = S.byId.get(id);
        if (!n) continue;
        if (!visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        if (ent.kind === 'dust' || ent.kind === 'ctx') {
            const dr = dustDrift(id, invK);
            const x = n.x + (dr ? dr.x : 0), y = n.y + (dr ? dr.y : 0);
            n._ox = dr ? dr.x : 0; n._oy = dr ? dr.y : 0;
            if (!inView(x, y)) continue;
            if (n === S.hover || n === S.selected) { solid.push({ n, ent, x, y }); continue; }
            const col = nodeColor(n);
            const key = col + '|' + (ent.kind === 'ctx' ? 'c' : 'd') + Math.round((ent.dim || 1) * 20);
            let b = dustPaths.get(key);
            if (!b) {
                b = { col, path: new Path2D(), alpha: (ent.kind === 'ctx' ? 0.85 : 0.42) * (ent.dim || 1) };
                dustPaths.set(key, b);
            }
            const r = drawRadius(n, ent, invK);
            b.path.moveTo(x + r, y);
            b.path.arc(x, y, r, 0, 7);
            continue;
        }
        n._ox = 0; n._oy = 0;
        if (!inView(n.x, n.y)) continue;
        solid.push({ n, ent, x: n.x, y: n.y });
    }
    for (const b of dustPaths.values()) {
        ctx.globalAlpha = b.alpha * S.dim * (hl ? 0.45 : 1);
        ctx.fillStyle = b.col;
        ctx.fill(b.path);
    }
    ctx.globalAlpha = 1;

    /* ---- UZLY S TVAROM — dual-channel: farba = oblasť, tvar = typ ---- */
    const showCert = level === 'dept' || level === 'node';
    for (const { n, ent, x, y } of solid) {
        let r = drawRadius(n, ent, invK);
        if (S.hover === n) r *= 1.18;
        r *= breatheFactor(n) * birthScale(n);
        if (n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
        const alpha = entAlpha(n, ent, hl);
        ctx.globalAlpha = alpha;
        drawShape(n, x, y, r, nodeColor(n), { cert: showCert && ent.dim >= 0.5, dim: ent.dim < 0.5 });

        if (ent.dim < 0.5) { if (n.flash) n.flash = Math.max(0, n.flash - 0.02); continue; }

        // ŽIARA — nedávno aktívne uzly jemne pulzujú teal (event-driven, aj pri REDUCED_MOTION)
        const glowA = (n.flash || 0) * (0.55 + 0.45 * Math.sin(S._clock * 6 + n.id));
        if (glowA > 0.03) {
            ctx.globalAlpha = Math.min(0.55, glowA) * alpha;
            ctx.lineWidth = 1.4 * invK;
            ctx.strokeStyle = 'rgb(' + T.accent + ')';
            ctx.beginPath();
            ctx.arc(x, y, r + 3 * invK, 0, 7);
            ctx.stroke();
        }

        // zrod uzla — krátky rozpínavý prstenec
        if (n._born != null) {
            const age = S._clock - n._born;
            if (age < 0.6 && S._anim > 0 && !REDUCED_MOTION) {
                const p = age / 0.6;
                ctx.globalAlpha = (1 - p) * 0.6 * alpha;
                ctx.lineWidth = 1.4 * invK;
                ctx.strokeStyle = 'rgb(' + T.accent + ')';
                ctx.beginPath();
                ctx.arc(x, y, r + (3 + p * 14) * invK, 0, 7);
                ctx.stroke();
            } else if (age >= 0.6) {
                n._born = null;
            }
        }

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }
    ctx.globalAlpha = 1;

    /* ---- HUBY oblastí / oddelení ---- */
    for (const h of L.hubs) drawHub(h, invK);

    /* ---- POPISKY ---- */
    // popisky hubov si rezervujú miesto ako prvé; popisky uzlov sa im uhnú
    const reserved = drawHubLabels(L, invK);
    drawNodeLabels(L, solid, hl, invK, reserved);
}

/* ---------- huby ---------- */

function drawHub(h, invK) {
    const r = Math.max(6 * invK, h.rw);
    const a = h.dim * S.dim;
    // mäkké halo — hub sa vynorí nad prachom svojej oblasti
    ctx.globalAlpha = 0.13 * a;
    ctx.fillStyle = h.color;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 1.85, 0, 7);
    ctx.fill();
    // telo (papierové) + farebný prstenec
    ctx.globalAlpha = 0.92 * a;
    ctx.fillStyle = T.paper;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 0.28 * a;
    ctx.fillStyle = h.color;
    ctx.fill();
    ctx.globalAlpha = Math.min(1, 0.95 * a);
    ctx.lineWidth = Math.max(1.2 * invK, r * 0.10);
    ctx.strokeStyle = h.color;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// Popisky hubov idú NAVRCH všetkého a majú papierový podklad — inak ich prach prekryje
// (to bola jedna z konkrétnych bolestí starého grafu).
function drawHubLabels(L, invK) {
    const strong = L.hubs.filter((h) => h.dim >= 0.5);
    if (!strong.length) return [];
    ctx.textAlign = 'center';
    const fs = (L.level === 'map' ? 14 : 12) * invK;
    const sub = fs * 0.82;
    const taken = [];
    for (const h of strong.slice().sort((a, b) => b.count - a.count)) {
        const r = Math.max(6 * invK, h.rw);
        ctx.font = '600 ' + fs + 'px "Geist", system-ui, sans-serif';
        const name = h.name;
        const w = Math.max(ctx.measureText(name).width, 20 * invK);
        const y = h.y + r + fs * 1.35;
        const rect = { x: h.x - w / 2 - 5 * invK, y: y - fs, w: w + 10 * invK, h: fs * 1.35 + sub * 1.2 };
        const hit = taken.some((t) => rect.x < t.x + t.w && t.x < rect.x + rect.w
            && rect.y < t.y + t.h && t.y < rect.y + rect.h);
        if (hit) continue;
        taken.push(rect);

        ctx.globalAlpha = 0.93 * S.dim;
        ctx.fillStyle = T.paper;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

        ctx.globalAlpha = 0.97 * S.dim;
        ctx.fillStyle = T.ink;
        ctx.fillText(name, h.x, y);

        ctx.globalAlpha = 0.88 * S.dim;
        ctx.fillStyle = T.inkSoft;
        ctx.font = '600 ' + sub + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(String(h.count), h.x, y + sub * 1.25);
    }
    ctx.globalAlpha = 1;
    return taken;
}

/* ---------- popisky uzlov ---------- */

function drawNodeLabels(L, solid, hl, invK, reserved) {
    // LOD: na mape a v oblasti nesú význam popisky hubov; jednotlivé uzly sa
    // pomenujú až od úrovne oddelenia (alebo pod kurzorom / vo výbere).
    const levelLabels = L.level === 'dept' || L.level === 'node';
    const zoomFade = Math.min(1, Math.max(0, (S.cam.k - 0.42) / 0.22));
    const baseLabelAlpha = Math.min(1, S.opts.labelAlpha);
    if (baseLabelAlpha < 0.02) { S._labelShown = new Set(); return; }

    const candidates = [];
    for (const { n, ent, x, y } of solid) {
        const isHover = S.hover === n || S.selected === n;
        const inHl = !!(hl && hl.has(n.id));
        const allowed = isHover || (levelLabels && ent.dim >= 0.5 && zoomFade > 0) || (inHl && zoomFade > 0);
        if (!allowed) continue;
        const alpha = baseLabelAlpha * entAlpha(n, ent, hl) * (isHover ? 1 : zoomFade);
        if (alpha < 0.12) continue;
        candidates.push({ n, ent, x, y, isHover, alpha });
    }

    const shown = S._labelShown || (S._labelShown = new Set());
    candidates.sort((a, b) =>
        (b.isHover - a.isHover)
        || ((shown.has(b.n.id) ? 1 : 0) - (shown.has(a.n.id) ? 1 : 0))
        || (b.alpha - a.alpha)
        || ((S.degree.get(b.n.id) || 0) - (S.degree.get(a.n.id) || 0)));

    const fontSize = (12 * S.opts.labelSize) * invK;
    const taken = reserved ? reserved.slice() : [];
    const newShown = new Set();
    ctx.textAlign = 'center';
    ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';
    for (const { n, ent, x, y, isHover, alpha } of candidates) {
        const label = truncLabel(n.label);
        const w = ctx.measureText(label).width;
        const ly = y + drawRadius(n, ent, invK) * (S.hover === n ? 1.18 : 1) + 13 * invK;
        const rect = { x: x - w / 2, y: ly - fontSize, w, h: fontSize * 1.4 };
        const collides = taken.some((t) =>
            rect.x < t.x + t.w && t.x < rect.x + rect.w
            && rect.y < t.y + t.h && t.y < rect.y + rect.h);
        if (collides && !isHover) continue;
        taken.push(rect);
        newShown.add(n.id);

        if (isHover) {
            const px = 5 * invK, py = 3 * invK;
            ctx.globalAlpha = alpha * 0.82;
            ctx.fillStyle = T.paper;
            ctx.fillRect(rect.x - px, rect.y - py, rect.w + 2 * px, rect.h + 2 * py);
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = T.ink;
        ctx.fillText(label, x, ly);
    }
    S._labelShown = newShown;
    ctx.globalAlpha = 1;
}

// Skrátenie labelu LEN pri kreslení (hover-card a panel používajú n.label v plnej dĺžke)
export function truncLabel(s) {
    const chars = Array.from(String(s));
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : s;
}

// FÁZA CERTAINTY (F4, §4.6): mapovanie istoty → štýl prstenca (CVD-safe double-encoding).
export const CERT_RING = { overene: 'solid', hypoteza: 'dashed', pasca: 'pip' };

/* ---------- W2a: DUAL-CHANNEL TVARY ----------
   farba = oblasť (area.color), tvar = typ:
     memory  → plný disk
     skill   → donut (krúžok s dierou)
     project → disk s vonkajším prstencom
     core    → zlaté súosé kruhy
   Vďaka tomu farba prestala niesť dva významy naraz. Značku istoty kreslíme až
   od úrovne 'dept' (na mape by preťažila vnem) — opts.cert to zapína. */
export function drawShape(n, x, y, r, color, opts) {
    const k = S.cam.k;
    const invK = 1 / k;
    const a = ctx.globalAlpha;
    const type = n.type;

    if (type === 'core') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.46, 0, 7);
        ctx.fill();
        ctx.lineWidth = Math.max(1.1 * invK, r * 0.10);
        ctx.strokeStyle = color;
        ctx.globalAlpha = a * 0.85;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.76, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.10, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
        return;
    }

    if (type === 'skill') {
        // donut — anulus kreslený hrubým obrysom (žiadne compositing triky, diera
        // ostane naozaj priehľadná, takže sa nebije s papierom ani s hranami pod ňou)
        const rw = r * 0.56;
        ctx.lineWidth = Math.max(1.2 * invK, rw);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r - rw / 2), 0, 7);
        ctx.stroke();
    } else if (type === 'project') {
        // disk + vonkajší prstenec
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.66, 0, 7);
        ctx.fill();
        ctx.globalAlpha = a * 0.9;
        ctx.lineWidth = Math.max(1 * invK, r * 0.14);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.08, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    } else {
        // memory (a neznámy typ) — plný disk
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
    }

    if (!opts || !opts.cert) return;

    const cc = certColors();
    if (n.origin === 'brain') {
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1 * invK;
        ctx.strokeStyle = cc.borderStrong;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.6 * invK, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }

    const mode = S.certRings ? CERT_RING[n.certainty] : null;
    if (!mode) return;
    const rr = r + 4.2 * invK;
    const col = cc[n.certainty];
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    ctx.lineWidth = 1.6 * invK;
    ctx.strokeStyle = col;
    if (mode === 'dashed') ctx.setLineDash([3 * invK, 2.4 * invK]);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, 7);
    ctx.stroke();
    if (mode === 'pip') {
        ctx.setLineDash([]);
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y - rr, 2 * invK, 0, 7);
        ctx.fill();
    }
    ctx.restore();
}

/* ---------- slučka ---------- */

export let lastFrame = now();
export let framePending = false;
export function frame() {
    framePending = false;
    // W2a: mimo Grafu slučka zaparkuje bez kreslenia (nulové CPU).
    if (!graphActive()) return;
    const nowMs = now();
    const dt = Math.min((nowMs - lastFrame) / 1000, 0.1);
    lastFrame = nowMs;

    // zmena S.focus zvonku (strom štruktúry / Esc / breadcrumb) → dorovnaj úroveň
    syncNavFromFocus();

    S._clock += dt;
    S._anim = animLevel();
    S._lifeTier = lifeTier();
    S._life = S._lifeTier >= 2 ? 0 : lifeLevel();
    S.cursor.a += ((S.cursor.on ? 1 : 0) - S.cursor.a) * Math.min(1, dt * 10);
    if (S.cursor.a < 0.005) S.cursor.a = 0;
    maybeSynapse();

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
        }
    }

    for (let i = S._flows.length - 1; i >= 0; i--) {
        const f = S._flows[i];
        if (f.wait > 0) { f.wait -= dt; continue; }
        f.t += dt * f.speed;
        if (f.t >= 1) {
            if (f.to) f.to.flash = Math.min(1, (f.to.flash || 0) + 0.28 * f.dim);
            S._flows.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
        }
    }
    const cap = flowCap();
    if (S._flows.length > cap) S._flows.splice(0, S._flows.length - cap);

    // W2a: tweenovaná kamera pri zanorení (ease-in-out cubic, ~600 ms)
    if (S._camTween) {
        const c = S._camTween;
        c.t = Math.min(1, c.t + dt / c.dur);
        const e = easeInOut(c.t);
        S.cam.x = c.from.x + (c.to.x - c.from.x) * e;
        S.cam.y = c.from.y + (c.to.y - c.from.y) * e;
        S.cam.k = c.from.k + (c.to.k - c.from.k) * e;
        if (c.t >= 1) S._camTween = null;
    }

    // morph pozícií medzi úrovňami (rovnaký časovač ako kamera → jeden plynulý pohyb)
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

    const dimTarget = isAwake() ? 1 : 0.5;
    const dimActive = Math.abs(dimTarget - S.dim) > 0.001;
    const ambientLife = S._life > 0; // pokoj = dýchajúce jadro + veľmi pomalý prach
    const responsive = !!S._morph || !!S._camTween || S.replay.playing || S._interacting
        || S.pulses.length > 0 || S._flows.length > 0 || S._settleFrames > 0 || dimActive;
    const active = responsive || ambientLife;

    if (S._settleFrames > 0) S._settleFrames--;

    let doDraw = responsive || S._dirty;
    if (!doDraw && ambientLife && (nowMs - S._lastAmbient) >= AMBIENT_MS) doDraw = true;

    if (doDraw) {
        const _t0 = performance.now();
        draw();
        S._drawMs += (Math.min(60, performance.now() - _t0) - S._drawMs) * 0.1;
        S._dirty = false;
        if (!responsive) S._lastAmbient = nowMs;
        updateStateUi();
    }

    if (active) scheduleFrame();
}

export function scheduleFrame() {
    // W2a: mimo obrazovky Graf sa plátno nekreslí vôbec — žiadny rAF (nulové CPU).
    if (!graphActive()) return;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}

export const SETTLE_FRAMES = 45;
export const AMBIENT_MS = 32;

export function requestDraw() {
    S._dirty = true;
    if (!framePending) { lastFrame = now(); scheduleFrame(); }
}

// Zaostrenie na uzol = zanorenie na úroveň 'node' (Cmd-K, hľadanie, toasty, panely).
export function focusNode(n) {
    if (!n) return;
    go({ level: 'node', node: n.id });
}

export function zoomBy(factor) {
    const before = screenToWorld(S.w / 2, S.h / 2);
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
    const after = screenToWorld(S.w / 2, S.h / 2);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    S._camTween = null;
    requestDraw();
}

/* ---------- fit ---------- */

// Bbox, ktorý má kamera obsiahnuť — nakreslené uzly a huby aktuálnej úrovne.
// Pri aktívnych filtroch sa zmenší na to, čo reálne zostalo viditeľné.
export function fitBBox(L) {
    const loc = localSet();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cnt = 0;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cnt++;
    };
    for (const [id, e] of L.pos) {
        const n = S.byId.get(id);
        if (!n || !visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        add(e.x, e.y);
    }
    // hub sa počíta so svojím polomerom + miestom na dvojriadkový popisok pod ním,
    // inak by hub na okraji scény vyliezol pod hlavičku alebo mu popisok odrezalo
    for (const h of L.hubs) {
        add(h.x - h.rw, h.y - h.rw);
        add(h.x + h.rw, h.y + h.rw + (h.dim >= 0.5 ? 46 : 0));
    }
    if (cnt < 2) return L.bbox;
    return { minX, minY, maxX, maxY };
}

// Kamera, ktorá bbox vloží do využiteľnej plochy viewportu (mimo railu a hlavičky).
// Rovnaké okraje ako targetBox() v layout.js → fit sadne na obe osi naraz a scéna
// vyplní ≥ 70 % šírky viewportu na každej úrovni.
export function fitCam(bbox) {
    const ins = viewInsets();
    const uw = Math.max(160, S.w - ins.left - ins.right);
    const uh = Math.max(160, S.h - ins.top - ins.bottom);
    const bw = Math.max(bbox.maxX - bbox.minX, 1);
    const bh = Math.max(bbox.maxY - bbox.minY, 1);
    const k = Math.min(3.2, Math.max(0.14, Math.min(uw / bw, uh / bh)));
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    return { x: ins.left + uw / 2 - S.w / 2 - cx * k, y: ins.top + uh / 2 - S.h / 2 - cy * k, k };
}

// Legacy signatúra fitView(pad) — pad sa ignoruje, okraje riadi viewInsets().
export function fitView() {
    const L = ensureLayout();
    const c = fitCam(fitBBox(L));
    S._camTween = null;
    S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
    draw();
}

export function setupVisibilityRepaint() {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); requestDraw(); }
    });
}
