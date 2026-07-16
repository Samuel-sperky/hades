/* Hades — živá neurónová sieť vedomia */
(() => {
'use strict';

const CORE_COLOR = '#b88a3a';
const AREA_RADIUS = 460;

// Témy — kontrakt pre budúci dark mode (canvas literály idú cez T.*)
const THEMES = {
    light: { paper:'#f8f4f7', ink:'#101d1b', inkSoft:'#2d3a38', muted:'#566964', labelHalo:'rgba(248,244,247,0.92)', edge:'45,58,56', gridColor:'3,121,126', outline:'rgba(16,29,27,0.35)' },
    dark:  { paper:'#0e1413', ink:'#eaf3f1', inkSoft:'#c3d1ce', muted:'#8a9b98', labelHalo:'rgba(14,20,19,0.92)', edge:'195,209,206', gridColor:'5,188,196', outline:'rgba(234,243,241,0.30)' },
};
let T = THEMES.light;
function setTheme(name){ T = THEMES[name] || THEMES.light; document.documentElement.dataset.theme = (name === 'dark' ? 'dark' : 'light'); localStorage.setItem('hades.theme', name); }

// Farby uzlov (identita) — zladene s CSS --node-* tokenmi (Aura paleta)
const NODE_COLORS = {
    core: '#b88a3a',
    skill: '#03797e',
    memory: '#2f6d8f',
    project: '#c2761c',
};
const DEPT_RADIUS = 140;

const canvas = document.getElementById('mind');
const ctx = canvas.getContext('2d');

const S = {
    name: 'Hades',
    nodes: [],
    edges: [],
    areas: new Map(),
    departments: new Map(),
    byId: new Map(),
    sim: null,
    cam: { x: 0, y: 0, k: 0.85 },
    dpr: 1, w: 0, h: 0,
    pulses: [],
    stars: [],
    hover: null,
    selected: null,
    focus: { areaId: null, departmentId: null },
    _hlFor: null,
    _hlSet: null,
    awakeUntil: 0,
    awakeMinutes: 5,
    dim: 1,
    activations: [],
    replay: { on: false, t: 1, playing: false, tMin: 0, tMax: 0 },
    sound: localStorage.getItem('hades.sound') !== 'off',
    audio: null,
    view: localStorage.getItem('hades.view') || 'map',
};

const VIEW_LAYER_COLORS = {
    memory: '#2f6d8f',
    skill: '#03797e',
    core: '#b88a3a',
    project: '#c2761c',
};

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const OPT_DEFAULTS = {
    panelAlpha: 0.92,
    bg: 1,
    edgeAlpha: 1,
    glow: 1,
    labelAlpha: 1,
    nodeScale: 1,
    labelSize: 1,
};

S.opts = Object.assign({}, OPT_DEFAULTS, JSON.parse(localStorage.getItem('hades.opts') || '{}'));

function setOpt(key, value) {
    S.opts[key] = value;
    localStorage.setItem('hades.opts', JSON.stringify(S.opts));
    applyOpts();
}

function syncSlider(inp) {
    const min = parseFloat(inp.min || 0);
    const max = parseFloat(inp.max || 100);
    const val = parseFloat(inp.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
    inp.style.setProperty('--pct', pct + '%');
}

function applyOpts() {
    document.documentElement.style.setProperty('--panel-alpha', S.opts.panelAlpha);
    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        const v = S.opts[inp.dataset.opt];
        if (v !== undefined && parseFloat(inp.value) !== v) inp.value = v;
        syncSlider(inp);
    });
}

/* ---------- pomocníci ---------- */

const now = () => Date.now();
const rad = (deg) => (deg * Math.PI) / 180;
const ts = (iso) => (iso ? new Date(iso).getTime() : 0);

function nodeColor(n) {
    if (S.view === 'layers') {
        return VIEW_LAYER_COLORS[n.type] || '#566964';
    }
    if (n.type === 'core') return CORE_COLOR;
    const area = S.areas.get(n.area_id);
    return area ? area.color : '#566964';
}

// Focus mód (priečinky): zaostrenie na oblasť / oddelenie
function setFocus(areaId, departmentId) { S.focus = { areaId: areaId || null, departmentId: departmentId || null }; }

function focusPass(n) {
    if (!S.focus.areaId) return true;
    if (n.type === 'core') return true;
    if (n.area_id !== S.focus.areaId) return false;
    if (S.focus.departmentId && n.department_id !== S.focus.departmentId) return false;
    return true;
}

// Zvýraznená množina pri hover/select — cache podľa kotvového uzla
function highlightSet() {
    const anchor = S.hover || S.selected;
    if (!anchor) { S._hlFor = null; S._hlSet = null; return null; }
    if (S._hlFor !== anchor) {
        const set = new Set([anchor.id]);
        for (const m of neighborsOf(anchor)) set.add(m.id);
        S._hlFor = anchor;
        S._hlSet = set;
    }
    return S._hlSet;
}

function nodeAlphaMul(n, hl) {
    let mul = 1;
    if (hl && !hl.has(n.id)) mul *= 0.18;
    if (!focusPass(n)) mul *= 0.15;
    return mul;
}

function edgeAlphaMul(e, hl, anchor) {
    let mul = 1;
    if (hl && !(anchor && (e.source.id === anchor.id || e.target.id === anchor.id))) mul *= 0.18;
    if (!(focusPass(e.source) && focusPass(e.target))) mul *= 0.15;
    return mul;
}

const LAYER_X = [-560, -280, 0, 280, 560];
const LAYER_SPACING = (nodes) => Math.max(48, Math.min(95, 1100 / Math.max(nodes.length, 1)));
const LAYER_META = [
    { title: 'Vstup', sub: 'Spomienky' },
    { title: 'Skrytá', sub: 'Skills' },
    { title: 'Jadro', sub: 'Osobnosť' },
    { title: 'Skrytá', sub: 'Skills' },
    { title: 'Výstup', sub: 'Projekty' },
];

function layerColumns() {
    const mem = [], skillA = [], core = [], skillB = [], proj = [];
    const skills = S.nodes
        .filter((n) => n.type === 'skill')
        .sort((a, b) => a.label.localeCompare(b.label));
    skills.forEach((n, i) => (i % 2 === 0 ? skillA : skillB).push(n));
    for (const n of S.nodes) {
        if (n.type === 'memory') mem.push(n);
        else if (n.type === 'core') core.push(n);
        else if (n.type === 'project') proj.push(n);
    }
    return [mem, skillA, core, skillB, proj];
}

function drawLayerScaffold(layers) {
    let maxHalf = 0;
    layers.forEach((nodes) => {
        maxHalf = Math.max(maxHalf, (nodes.length - 1) / 2 * LAYER_SPACING(nodes));
    });
    const headerY = -maxHalf - 66;
    const invK = 1 / S.cam.k;

    ctx.textAlign = 'center';
    for (let i = 0; i < LAYER_X.length; i++) {
        ctx.globalAlpha = 0.6 * S.dim;
        ctx.fillStyle = T.inkSoft;
        ctx.font = '600 ' + (12.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].title.toUpperCase(), LAYER_X[i], headerY);

        ctx.globalAlpha = 0.5 * S.dim;
        ctx.fillStyle = T.muted;
        ctx.font = (10.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].sub, LAYER_X[i], headerY + 18 * invK);
    }
    ctx.globalAlpha = 1;
}

function nodeRadius(n) {
    const base = n.type === 'core'
        ? (n.label === S.name ? 24 : 14)
        : Math.min(16, 7 + 2.9 * Math.log2(1 + (n.strength || 1)));

    return base * (S.opts ? S.opts.nodeScale : 1);
}

function areaAnchor(area) {
    return {
        x: Math.cos(rad(area.angle)) * AREA_RADIUS,
        y: Math.sin(rad(area.angle)) * AREA_RADIUS,
    };
}

function deptAnchor(dept) {
    const area = S.areas.get(dept.area_id);
    if (!area) return { x: 0, y: 0 };
    const siblings = [...S.departments.values()].filter(d => d.area_id === dept.area_id);
    const i = siblings.findIndex(d => d.id === dept.id);
    const spread = rad(area.angle) + (i - (siblings.length - 1) / 2) * 0.55;
    const a = areaAnchor(area);
    return { x: a.x + Math.cos(spread) * DEPT_RADIUS, y: a.y + Math.sin(spread) * DEPT_RADIUS };
}

function anchorOf(n) {
    if (n.type === 'core') {
        if (n.label === S.name) return { x: 0, y: 0 };
        const cores = S.nodes.filter(m => m.type === 'core' && m.label !== S.name);
        const i = cores.findIndex(m => m.id === n.id);
        const a = rad((360 / Math.max(cores.length, 1)) * i - 90);
        return { x: Math.cos(a) * 85, y: Math.sin(a) * 85 };
    }
    if (n.department_id && S.departments.has(n.department_id)) {
        return deptAnchor(S.departments.get(n.department_id));
    }
    if (n.area_id && S.areas.has(n.area_id)) return areaAnchor(S.areas.get(n.area_id));
    return { x: 0, y: 0 };
}

function markAwake() {
    S.awakeUntil = now() + S.awakeMinutes * 60000;
}

function isAwake() {
    return now() < S.awakeUntil;
}

/* ---------- zvuk ---------- */

function audioCtx() {
    if (!S.audio) {
        S.audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (S.audio.state === 'suspended') S.audio.resume();
    return S.audio;
}

function blip(freq, dur = 0.35, vol = 0.05) {
    if (!S.sound) return;
    try {
        const ac = audioCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ac.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ac.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur + 0.05);
    } catch (e) { /* zvuk nie je kritický */ }
}

/* ---------- pulzy ---------- */

function spawnPulse(fromNode, toNode, opts = {}) {
    if (!fromNode || !toNode || S.replay.on) return;
    S.pulses.push({
        from: fromNode, to: toNode,
        t: 0,
        speed: opts.speed || 0.9 + Math.random() * 0.5,
        color: opts.color || nodeColor(toNode),
        dim: opts.dim || 1,
    });
}

function neighborsOf(node) {
    const out = [];
    for (const e of S.edges) {
        if (e.source.id === node.id) out.push(e.target);
        else if (e.target.id === node.id) out.push(e.source);
    }
    return out;
}

function dream() {
    if (REDUCED_MOTION || document.hidden || S.replay.on || !S.edges.length) return;
    const e = S.edges[Math.floor(Math.random() * S.edges.length)];
    const flip = Math.random() < 0.5;
    const from = flip ? e.source : e.target;
    let to = flip ? e.target : e.source;
    spawnPulse(from, to, { dim: isAwake() ? 0.6 : 0.3, speed: 0.5 });
    if (Math.random() < 0.4) {
        const next = neighborsOf(to).filter(n => n !== from);
        if (next.length) {
            const n2 = next[Math.floor(Math.random() * next.length)];
            setTimeout(() => spawnPulse(to, n2, { dim: isAwake() ? 0.5 : 0.25, speed: 0.5 }), 900);
        }
    }
}

/* ---------- simulácia ---------- */

function applyViewPins() {
    if (S.view === 'layers') {
        layerColumns().forEach((nodes, li) => {
            const spacing = LAYER_SPACING(nodes);
            nodes.forEach((n, i) => {
                n.fx = LAYER_X[li];
                n.fy = (i - (nodes.length - 1) / 2) * spacing;
            });
        });
        return;
    }

    for (const n of S.nodes) { n.fx = null; n.fy = null; }
    const h = S.nodes.find((n) => n.type === 'core' && n.label === S.name);
    if (h) { h.fx = 0; h.fy = 0; }
}

function buildSim() {
    if (S.sim) S.sim.stop();

    for (const n of S.nodes) {
        if (n.x === undefined) {
            const a = anchorOf(n);
            n.x = a.x + (Math.random() - 0.5) * 60;
            n.y = a.y + (Math.random() - 0.5) * 60;
        }
    }

    applyViewPins();

    const net = S.view === 'net';

    S.sim = d3.forceSimulation(S.nodes)
        .force('x', d3.forceX(d => net ? 0 : anchorOf(d).x)
            .strength(d => net ? 0.03 : (d.type === 'core' ? 0.25 : 0.055)))
        .force('y', d3.forceY(d => net ? 0 : anchorOf(d).y)
            .strength(d => net ? 0.03 : (d.type === 'core' ? 0.25 : 0.055)))
        .force('charge', d3.forceManyBody().strength(net ? -120 : -42).distanceMax(net ? 520 : 320))
        .force('collide', d3.forceCollide(d => nodeRadius(d) + 7))
        .force('link', d3.forceLink(S.edges)
            .id(d => d.id)
            .distance(net ? 95 : 72)
            .strength(e => Math.min(0.09, 0.025 * (e.weight || 1))))
        .alpha(0.9)
        .alphaDecay(0.015)
        .alphaTarget(0.012)
        .alphaMin(0.001);
}

function setView(view) {
    S.view = view;
    localStorage.setItem('hades.view', view);
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    buildSim();
    kickSim(0.6);
}

function kickSim(alpha = 0.35) {
    if (S.sim) S.sim.alpha(Math.max(S.sim.alpha(), alpha));
}

/* ---------- render ---------- */

function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    canvas.width = S.w * S.dpr;
    canvas.height = S.h * S.dpr;
    canvas.style.width = S.w + 'px';
    canvas.style.height = S.h + 'px';
}

// Časticový systém odstránený — žiadna hmla na papieri. No-op kvôli existujúcim volaniam.
function makeStars() {
    S.stars = [];
}

function visibleInReplay(n) {
    if (!S.replay.on) return true;
    const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    return n.type === 'core' || ts(n.created_at) <= cutoff;
}

function draw() {
    const targetDim = isAwake() ? 1 : 0.5;
    S.dim += (targetDim - S.dim) * 0.02;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    const hl = highlightSet();
    const hlAnchor = S.hover || S.selected;

    const layersView = S.view === 'layers';
    const bgLevel = layersView ? 0 : S.opts.bg;
    if (bgLevel > 0.01) {
        const invK = 1 / S.cam.k;

        // jemna technicka mriezka (world-space, hyba sa so sietou) — jedine pozadie
        const _step = 240, _ext = 1400;
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + T.gridColor + ',' + (0.05 * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = -_ext; gx <= _ext; gx += _step) { ctx.moveTo(gx, -_ext); ctx.lineTo(gx, _ext); }
        for (let gy = -_ext; gy <= _ext; gy += _step) { ctx.moveTo(-_ext, gy); ctx.lineTo(_ext, gy); }
        ctx.stroke();
    }

    if (S.view === 'map') for (const area of S.areas.values()) {
        const a = areaAnchor(area);
        ctx.globalAlpha = 0.28 * S.dim;
        ctx.fillStyle = T.muted;
        ctx.font = '600 13px "Geist Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(area.name.toUpperCase(), a.x, a.y - 230);
        ctx.globalAlpha = 1;
    }

    if (layersView) {
        // Cisty neuronovy wireframe: plne prepojena sieť medzi susednymi vrstvami
        const layers = layerColumns();
        const invK = 1 / S.cam.k;
        ctx.lineWidth = 0.5 * invK;
        for (let li = 0; li < layers.length - 1; li++) {
            for (const a of layers[li]) {
                if (!visibleInReplay(a)) continue;
                for (const b of layers[li + 1]) {
                    if (!visibleInReplay(b)) continue;
                    ctx.strokeStyle = 'rgba(' + T.edge + ',0.10)';
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.stroke();
                }
            }
        }
        drawLayerScaffold(layers);
    } else {
        for (const e of S.edges) {
            if (!visibleInReplay(e.source) || !visibleInReplay(e.target)) continue;
            // atramentovo-šedé hrany, bez S.dim hmly; podlaha 0.12, potom highlight/focus tlmenie
            let alpha = Math.min(0.5, 0.22 + 0.08 * Math.log2(1 + (e.weight || 1))) * S.opts.edgeAlpha;
            alpha = Math.max(0.12, alpha) * edgeAlphaMul(e, hl, hlAnchor);
            ctx.strokeStyle = 'rgba(' + T.edge + ',' + alpha + ')';
            ctx.lineWidth = Math.min(1.6, 0.45 + 0.25 * Math.log2(1 + (e.weight || 1))) / S.cam.k;
            ctx.beginPath();
            ctx.moveTo(e.source.x, e.source.y);
            ctx.lineTo(e.target.x, e.target.y);
            ctx.stroke();
        }
    }

    ctx.globalCompositeOperation = 'source-over';

    for (const p of S.pulses) {
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (layersView) {
        ctx.globalCompositeOperation = 'source-over';
        const invK = 1 / S.cam.k;
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            const r = Math.max(6, nodeRadius(n)) * 0.9;
            const color = nodeColor(n);
            const flash = n.flash || 0;
            const mul = nodeAlphaMul(n, hl);

            // jadro (bez aury — žiadna hmla)
            ctx.globalAlpha = Math.min(1, (0.82 + flash * 0.5)) * mul;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 0.72, 0, 7);
            ctx.fill();

            // prsteň (wireframe)
            ctx.globalAlpha = Math.min(1, (0.95 + flash)) * mul;
            ctx.lineWidth = 1.5 * invK;
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 7);
            ctx.stroke();

            if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
        }
        ctx.globalAlpha = 1;
    } else for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        const r = nodeRadius(n);
        const color = nodeColor(n);
        const mul = nodeAlphaMul(n, hl);

        // plne nepriehľadný uzol (žiadne halo) — tlmí sa len highlight/focus násobičom
        ctx.globalAlpha = 1 * mul;
        ctx.fillStyle = color;
        drawShape(n, r);

        // ink obrys — silu ovláda slider 'glow' (Obrysy uzlov)
        ctx.globalAlpha = Math.min(1, S.opts.glow) * mul;
        ctx.lineWidth = Math.max(1, 0.9 / S.cam.k);
        ctx.strokeStyle = T.outline;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 7);
        ctx.stroke();

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }

    ctx.globalCompositeOperation = 'source-over';

    const showLabels = S.cam.k > 0.5 && S.opts.labelAlpha > 0.02;
    const candidates = [];
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        const isHover = S.hover === n || S.selected === n;
        if (!showLabels && !isHover) continue;
        candidates.push({ n, isHover });
    }
    candidates.sort((a, b) => (b.isHover - a.isHover) || ((b.n.strength || 0) - (a.n.strength || 0)));

    const fontSize = (12 * S.opts.labelSize) / S.cam.k;
    const taken = [];
    ctx.textAlign = 'center';
    for (const { n, isHover } of candidates) {
        ctx.font = (isHover ? '600 ' : '') + fontSize + 'px "Geist", system-ui, sans-serif';
        const w = ctx.measureText(n.label).width;
        const y = n.y + nodeRadius(n) + 15 / S.cam.k;
        const rect = { x: n.x - w / 2, y: y - fontSize, w, h: fontSize * 1.4 };

        const collides = taken.some((t) =>
            rect.x < t.x + t.w && t.x < rect.x + rect.w
            && rect.y < t.y + t.h && t.y < rect.y + rect.h);
        if (collides && !isHover) continue;
        taken.push(rect);

        // vždy plne čitateľné — žiadny zoom fade, len highlight/focus tlmenie
        ctx.globalAlpha = Math.min(1, S.opts.labelAlpha) * nodeAlphaMul(n, hl);
        ctx.lineWidth = Math.max(2.5, fontSize * 0.28);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = T.labelHalo;
        ctx.strokeText(n.label, n.x, y);
        ctx.fillStyle = T.ink;
        ctx.fillText(n.label, n.x, y);
    }
    ctx.globalAlpha = 1;
}

// Jednotny seriozny tvar: vsetky uzly su ciste kruhy.
// Jadro dostane jemny sustredny prstenec ako "hub" marker (bez hviezd).
function drawShape(n, r) {
    const { x, y } = n;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();

    if (n.type === 'core') {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.4;
        ctx.lineWidth = Math.max(1, 1.1 / S.cam.k);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.55, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }
}

let lastFrame = now();
let framePending = false;
function frame() {
    framePending = false;
    const dt = Math.min((now() - lastFrame) / 1000, 0.1);
    lastFrame = now();

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
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

    draw();
    updateStateUi();
    scheduleFrame();
}

function scheduleFrame() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}

/* ---------- stav (bdie / spí) ---------- */

let lastStateUi = '';
function updateStateUi() {
    const awake = isAwake();
    const key = awake ? 'awake' : 'asleep';
    if (key === lastStateUi) return;
    lastStateUi = key;
    const brand = document.getElementById('brand-core');
    brand.classList.toggle('awake', awake);
    brand.classList.toggle('asleep', !awake);
    brand.title = awake ? 'Hades — bdie' : 'Hades — spí';
}

/* ---------- interakcia ---------- */

function screenToWorld(px, py) {
    return {
        x: (px - S.w / 2 - S.cam.x) / S.cam.k,
        y: (py - S.h / 2 - S.cam.y) / S.cam.k,
    };
}

function pick(px, py) {
    const w = screenToWorld(px, py);
    let best = null, bestD = Infinity;
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < nodeRadius(n) + 8 / S.cam.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
}

function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;

    canvas.addEventListener('mousedown', (e) => {
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        canvas.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
            S.cam.x += dx; S.cam.y += dy;
            lx = e.clientX; ly = e.clientY;
        } else {
            S.hover = pick(e.clientX, e.clientY);
            canvas.style.cursor = S.hover ? 'pointer' : 'grab';
            updateHoverCard(e);
        }
    });

    window.addEventListener('mouseup', (e) => {
        canvas.classList.remove('dragging');
        if (dragging && !moved) {
            const n = pick(e.clientX, e.clientY);
            if (n) selectNode(n);
            else closeNodePanel();
        }
        dragging = false;
    });

    // Dvojklik pri kotve oblasti (do 260 world-jednotiek) prepína focus mód
    canvas.addEventListener('dblclick', (e) => {
        const w = screenToWorld(e.clientX, e.clientY);
        let best = null, bestD = 260;
        for (const area of S.areas.values()) {
            const a = areaAnchor(area);
            const d = Math.hypot(a.x - w.x, a.y - w.y);
            if (d < bestD) { best = area; bestD = d; }
        }
        if (best) setFocus(S.focus.areaId === best.id ? null : best.id, null);
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = Math.pow(1.0015, -e.deltaY);
        const before = screenToWorld(e.clientX, e.clientY);
        S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
        const after = screenToWorld(e.clientX, e.clientY);
        S.cam.x += (after.x - before.x) * S.cam.k;
        S.cam.y += (after.y - before.y) * S.cam.k;
    }, { passive: false });

}

function updateHoverCard(e) {
    const card = $('hover-card');
    const n = S.hover;

    if (!n) {
        card.classList.remove('show');
        return;
    }

    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
    const area = S.areas.get(n.area_id);
    const dept = S.departments.get(n.department_id);
    const meta = [typeNames[n.type], area && area.name, dept && dept.name, 'sila ' + Math.round(n.strength || 1)]
        .filter(Boolean)
        .map((v) => esc(String(v)))
        .join(' · ');

    card.innerHTML = '<div class="t">' + esc(n.label) + '</div><div class="m">' + meta + '</div>';
    card.classList.remove('hidden');
    card.classList.add('show');

    const pad = 14;
    const r = card.getBoundingClientRect();
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    card.style.left = x + 'px';
    card.style.top = y + 'px';
}

/* ---------- panely ---------- */

const $ = (id) => document.getElementById(id);

async function selectNode(n) {
    S.selected = n;
    $('node-panel').classList.remove('hidden');
    $('node-form').classList.add('hidden');
    $('node-view').classList.remove('hidden');
    $('node-type-label').textContent = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' }[n.type] || n.type;
    const nc = NODE_COLORS[n.type] || '#2f6d8f';
    $('node-swatch').style.background = nc;
    $('node-panel').style.setProperty('--node-c', nc);
    $('node-label').textContent = n.label;
    $('node-desc').textContent = n.description || '';
    $('node-meta').textContent = 'sila ' + (n.strength || 1).toFixed(0);
    $('node-neighbors').innerHTML = '';
    $('node-history').innerHTML = '';

    try {
        const res = await fetch('/api/nodes/' + n.id);
        const data = await res.json();
        const meta = [];
        if (data.node.area_name) meta.push(data.node.area_name);
        if (data.node.department_name) meta.push(data.node.department_name);
        meta.push('sila ' + data.node.strength.toFixed(0));
        $('node-meta').textContent = meta.join(' · ');

        $('node-neighbors').innerHTML = data.neighbors.map(
            (m) => '<button type="button" class="chip" data-id="' + m.id + '">' + esc(m.label) + '</button>'
        ).join('') || '<span class="hist">žiadne</span>';

        $('node-neighbors').querySelectorAll('.chip').forEach((chip) => {
            chip.onclick = () => {
                const target = S.byId.get(+chip.dataset.id);
                if (target) { selectNode(target); focusNode(target); }
            };
        });

        $('node-history').innerHTML = data.activations.map((a) => {
            const kinds = { learn: 'naučené', activate: 'aktivované', merge: 'posilnené', recall: 'spomenuté', seed: 'zasiate' };
            return '<div class="hist">' + (kinds[a.kind] || a.kind) + ' · ' + new Date(a.created_at).toLocaleString('sk') + '</div>';
        }).join('') || '<div class="hist">žiadna</div>';
    } catch (e) { /* offline detail nevadí */ }
}

function focusNode(n) {
    S.cam.x = -n.x * S.cam.k;
    S.cam.y = -n.y * S.cam.k;
}

function zoomBy(factor) {
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
}

const TYPE_GLYPHS = {
    core: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4" fill="#b88a3a"/><circle cx="7" cy="7" r="6" fill="none" stroke="#b88a3a" stroke-opacity=".5" stroke-width="1"/></svg>',
    skill: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#03797e"/></svg>',
    memory: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#2f6d8f"/></svg>',
    project: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#c2761c"/></svg>',
};

function buildLegend() {
    const typeNames = { core: 'Jadro', skill: 'Skill', memory: 'Spomienka', project: 'Projekt' };

    $('legend-types').innerHTML = Object.keys(typeNames).map(
        (t) => '<div class="legend-row">' + TYPE_GLYPHS[t] + '<span>' + typeNames[t] + '</span></div>'
    ).join('');

    $('legend-areas').innerHTML = [...S.areas.values()].map(
        (a) => '<div class="legend-row"><span class="swatch" style="background:' + a.color
            + ';box-shadow:0 0 6px ' + a.color + '"></span><span>' + esc(a.name) + '</span></div>'
    ).join('');
}

function closeNodePanel() {
    S.selected = null;
    $('node-panel').classList.add('hidden');
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refreshStats() {
    const res = await fetch('/api/mind/stats');
    const st = await res.json();

    const card = (label, value, sub) =>
        '<div class="metric"><div class="metric-val">' + value + '</div>'
        + '<div class="metric-label">' + label + '</div>'
        + (sub ? '<div class="metric-sub">' + sub + '</div>' : '') + '</div>';

    const w = st.week || {};
    $('stats-cards').innerHTML =
        card('uzlov', st.totals.nodes, '+' + (w.new_nodes || 0) + ' tento týždeň')
        + card('skillov', st.totals.skills || 0, '')
        + card('záznamov', st.totals.sessions || 0, '+' + (w.new_sessions || 0) + ' tento týždeň')
        + card('spojení', st.totals.edges, '');

    $('stats-recent').innerHTML = (st.recent_records || []).map((r) =>
        '<button type="button" class="mini-record" data-id="' + r.id + '">'
        + '<span class="ms" aria-hidden="true">article</span>'
        + '<span class="mr-title">' + esc(r.label) + '</span>'
        + '<span class="mr-time">' + timeAgo(r.created_at) + '</span></button>'
    ).join('') || '<div class="hist">zatiaľ nič</div>';

    $('stats-recent').querySelectorAll('.mini-record').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (n) { S.cam.k = Math.max(S.cam.k, 1); focusNode(n); selectNode(n); }
        };
    });

    $('stats-areas').innerHTML = [...S.areas.values()].map((a) =>
        '<div class="stat-row"><span><span class="swatch" style="background:' + a.color + '"></span>'
        + esc(a.name) + '</span><span class="val">' + (st.by_area[a.id] || 0) + '</span></div>'
    ).join('');

    $('stats-top').innerHTML = st.top_nodes.map(
        (n) => row(esc(n.label), n.strength.toFixed(0))
    ).join('') || '<div class="hist">zatiaľ nič</div>';

    const gc = $('growth-chart');
    const dpr = window.devicePixelRatio || 1;
    if (gc.clientWidth > 0) {
        gc.width = gc.clientWidth * dpr;
        gc.height = 60 * dpr;
    }
    const gctx = gc.getContext('2d');
    gctx.clearRect(0, 0, gc.width, gc.height);
    if (st.growth.length) {
        const max = Math.max(...st.growth.map((g) => g.count));
        const bw = gc.width / Math.max(st.growth.length, 10);
        st.growth.forEach((g, i) => {
            const h = (g.count / max) * (gc.height - 6 * dpr);
            gctx.fillStyle = '#03797e';
            gctx.globalAlpha = 0.9;
            gctx.fillRect(i * bw + dpr, gc.height - h, Math.max(bw - 2 * dpr, 2), h);
        });
    }

    function row(k, v) {
        return '<div class="stat-row"><span>' + k + '</span><span class="val">' + v + '</span></div>';
    }
}

/* ---------- časová os ---------- */

function updateTimelineLabel() {
    const label = $('tl-label');
    if (!S.replay.on || S.replay.t >= 1) {
        label.textContent = 'teraz';
        return;
    }
    const t = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    label.textContent = new Date(t).toLocaleDateString('sk', { day: 'numeric', month: 'short', year: 'numeric' });
}

function stopReplay() {
    S.replay.playing = false;
    S.replay.on = false;
    S.replay.t = 1;
    $('tl-range').value = 1000;
    syncSlider($('tl-range'));
    $('tl-play').textContent = 'play_arrow';
    updateTimelineLabel();
}

function setupTimeline() {
    const range = $('tl-range');

    syncSlider(range);
    range.addEventListener('input', () => {
        syncSlider(range);
        S.replay.t = +range.value / 1000;
        S.replay.on = S.replay.t < 1;
        S.replay.playing = false;
        $('tl-play').textContent = 'play_arrow';
        updateTimelineLabel();
    });

    $('tl-play').addEventListener('click', () => {
        if (S.replay.playing) { stopReplay(); return; }
        S.replay.on = true;
        S.replay.playing = true;
        S.replay.t = 0;
        $('tl-play').textContent = 'pause';
    });
}

function computeReplayBounds() {
    const times = S.nodes.filter((n) => n.type !== 'core').map((n) => ts(n.created_at)).filter(Boolean);
    S.replay.tMin = times.length ? Math.min(...times) - 3600000 : now() - 86400000;
    S.replay.tMax = now();
}

/* ---------- websocket ---------- */

function connectWs(ws) {
    const pusher = new Pusher(ws.key, {
        wsHost: ws.host,
        wsPort: ws.port,
        forceTLS: false,
        enabledTransports: ['ws'],
        cluster: 'mt1',
        disableStats: true,
    });

    pusher.subscribe('mind').bind('pulse', (msg) => handlePulse(msg.type, msg.data || {}));
}

function hadesNode() {
    return S.nodes.find((n) => n.type === 'core' && n.label === S.name) || S.nodes[0];
}

function handlePulse(type, data) {
    markAwake();

    if (type === 'node.created' && data.node) {
        if (S.byId.has(data.node.id)) return;
        const n = { ...data.node };
        const a = anchorOf(n);
        n.x = a.x + (Math.random() - 0.5) * 40;
        n.y = a.y + (Math.random() - 0.5) * 40;
        n.flash = 1;
        S.nodes.push(n);
        S.byId.set(n.id, n);
        buildSim();
        kickSim(0.5);
        spawnPulse(hadesNode(), n, { speed: 1.4 });
        blip(520);
        showToast('Naučil som sa: ' + n.label, n.id);
    }

    if (type === 'node.activated') {
        const n = S.byId.get(data.node_id);
        if (!n) return;
        n.strength = data.strength;
        n.flash = 1;
        const from = neighborsOf(n)[0] || hadesNode();
        spawnPulse(from, n, { speed: 1.6 });
        kickSim(0.12);
        blip(440);
    }

    if (type === 'node.updated' && data.node) {
        const n = S.byId.get(data.node.id);
        if (n) Object.assign(n, data.node);
    }

    if (type === 'node.deleted') {
        const n = S.byId.get(data.node_id);
        if (!n) return;
        S.nodes = S.nodes.filter((m) => m.id !== n.id);
        S.edges = S.edges.filter((e) => e.source.id !== n.id && e.target.id !== n.id);
        S.byId.delete(n.id);
        if (S.selected === n) closeNodePanel();
        buildSim();
    }

    if (type === 'edge.created' && data.edge) {
        const src = S.byId.get(data.edge.source_id);
        const tgt = S.byId.get(data.edge.target_id);
        if (!src || !tgt) return;
        if (S.edges.some((e) => e.id === data.edge.id)) return;
        S.edges.push({ ...data.edge, source: src, target: tgt });
        buildSim();
        kickSim(0.2);
        spawnPulse(src, tgt, { speed: 1.2 });
        blip(660, 0.25, 0.035);
    }

    if (type === 'edge.strengthened') {
        const e = S.edges.find((x) => x.id === data.edge_id);
        if (e) {
            e.weight = data.weight;
            spawnPulse(e.source, e.target, { speed: 1.5 });
        }
    }

    if (type === 'department.created' && data.department) {
        S.departments.set(data.department.id, data.department);
        buildSim();
    }

    if (type === 'recall' && Array.isArray(data.node_ids)) {
        data.node_ids.forEach((id, i) => {
            const n = S.byId.get(id);
            if (n) setTimeout(() => { spawnPulse(hadesNode(), n, { speed: 1.8, dim: 0.8 }); }, i * 120);
        });
        blip(392, 0.5, 0.03);
        setTimeout(() => blip(523, 0.5, 0.03), 150);
    }

    if (type === 'chat') {
        const h = hadesNode();
        if (h) h.flash = 1;
    }

    if (dockOpen === 'stats') refreshStats();
}

/* ---------- chat ---------- */

const chatHistory = [];

function addMsg(cls, text) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const div = document.createElement('div');
    div.className = 'msg ' + cls;
    if (cls.indexOf('thinking') !== -1) {
        div.innerHTML = '<span class="dot">·</span><span class="dot">·</span><span class="dot">·</span>';
    } else {
        div.textContent = text;
    }
    log.appendChild(div);
    log.scrollTop = 1e9;
    return div;
}

function collapsePrompt() {
    $('prompt').classList.remove('open');
    $('chat-log').classList.add('hidden');
    $('prompt-input').blur();
}

function setupPrompt() {
    const bar = $('prompt');
    const input = $('prompt-input');
    const form = $('prompt-form');

    const syncSend = () => form.classList.toggle('has-text', input.value.trim().length > 0);
    input.addEventListener('input', syncSend);
    syncSend();

    const open = () => {
        bar.classList.add('open');
        if ($('chat-log').children.length) $('chat-log').classList.remove('hidden');
    };

    input.addEventListener('focus', open);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        syncSend();
        open();

        if (text.startsWith('/')) {
            handleCommand(text);
            return;
        }

        addMsg('me', text);
        chatHistory.push({ role: 'user', content: text });
        const thinking = addMsg('hades thinking', '…');

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, history: chatHistory.slice(-12, -1) }),
            });
            const data = await res.json();
            thinking.remove();
            const reply = data.reply || data.message || 'Hades mlčí.';
            addMsg('hades', reply);
            chatHistory.push({ role: 'assistant', content: reply });
        } catch (err) {
            thinking.remove();
            addMsg('sys sys--error', 'Spojenie s vedomím zlyhalo.');
        }
    });
}

function handleCommand(text) {
    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() || '').toLowerCase();
    const arg = parts.join(' ');
    const sys = (m) => addMsg('sys', m);

    switch (cmd) {
        case 'nahlad': case 'view': {
            const map = { mapa: 'map', siet: 'net', 'sieť': 'net', vrstvy: 'layers' };
            const v = map[arg.toLowerCase()];
            if (v) { setView(v); sys('Náhľad prepnutý: ' + arg); }
            else sys('Použi: /nahlad mapa | siet | vrstvy');
            break;
        }
        case 'najdi': case 'find':
            openDock('search');
            $('search-input').value = arg;
            renderSearch(arg);
            sys(arg ? 'Hľadám: ' + arg : 'Otvoril som vyhľadávanie.');
            break;
        case 'zoom':
            if (arg === 'in') zoomBy(1.3);
            else if (arg === 'out') zoomBy(1 / 1.3);
            else S.cam = { x: 0, y: 0, k: 0.85 };
            sys('Zoom upravený.');
            break;
        case 'legenda': openDock('legend'); sys('Legenda otvorená.'); break;
        case 'statistiky': case 'stats': openDock('stats'); sys('Štatistiky otvorené.'); break;
        case 'os': case 'replay': $('btn-timeline').click(); sys('Časová os prepnutá.'); break;
        case 'pomoc': case 'help': toggleHelp(true); break;
        default:
            sys('Neznámy príkaz. Skús /nahlad, /najdi, /zoom, /legenda, /statistiky, /os, /pomoc');
    }
}

/* ---------- toasty, pomocnik, hinty ---------- */

function showToast(text, nodeId) {
    const wrap = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    const parts = String(text).split(/:\s(.+)/);
    el.innerHTML = parts.length > 1
        ? '<span class="ms" aria-hidden="true">hub</span><span>' + esc(parts[0]) + ': <strong>' + esc(parts[1]) + '</strong></span>'
        : '<span class="ms" aria-hidden="true">hub</span><span>' + esc(text) + '</span>';

    const leave = (node) => {
        node.classList.add('leaving');
        setTimeout(() => node.remove(), REDUCED_MOTION ? 0 : 200);
    };
    const arm = () => { el._t = setTimeout(() => leave(el), REDUCED_MOTION ? 0 : 5200); };

    el.onclick = () => {
        const n = nodeId ? S.byId.get(nodeId) : null;
        if (n) {
            S.cam.k = Math.max(S.cam.k, 1);
            focusNode(n);
            selectNode(n);
        }
        leave(el);
    };
    el.addEventListener('mouseenter', () => clearTimeout(el._t));
    el.addEventListener('mouseleave', () => { el._t = setTimeout(() => leave(el), REDUCED_MOTION ? 0 : 2500); });

    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
    arm();
}

const SHORTCUTS = [
    ['1 / 2 / 3', 'Náhľad: Mapa / Sieť / Vrstvy'],
    ['F', 'Vyhľadávanie'],
    ['S', 'Prehľad'],
    ['D', 'Denník záznamov'],
    ['L', 'Legenda'],
    ['T', 'Časová os'],
    ['C', 'Chat s Hadesom'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
    ['Esc', 'Zavrieť panely'],
];

let helpReturnFocus = null;

function toggleHelp(show) {
    const el = $('help-overlay');
    const target = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !target);
    if (target && !$('help-body').children.length) {
        $('help-body').innerHTML = SHORTCUTS.map(([k, d]) => {
            const caps = k.split(/\s*\/\s*/).map((x) => '<kbd>' + x + '</kbd>').join('<span class="sep">/</span>');
            return '<div class="key-row"><span class="label">' + d + '</span><span>' + caps + '</span></div>';
        }).join('');
    }
    if (target) {
        helpReturnFocus = document.activeElement;
        $('help-close').focus();
    } else if (helpReturnFocus) {
        helpReturnFocus.focus();
        helpReturnFocus = null;
    }
}

function setupShortcuts() {
    $('help-close').onclick = () => toggleHelp(false);
    $('help-overlay').addEventListener('click', (e) => {
        if (e.target === $('help-overlay')) toggleHelp(false);
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.body.classList.remove('ambient');
            toggleHelp(false);
            closeDock();
            closeNodePanel();
            collapsePrompt();
            setFocus(null, null);
            return;
        }

        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA/.test(tag)) return;

        switch (e.key) {
            case '1': setView('map'); break;
            case '2': setView('net'); break;
            case '3': setView('layers'); break;
            case 'f': case 'F': e.preventDefault(); openDock('search'); break;
            case 's': case 'S': openDock('stats'); break;
            case 'd': case 'D': openDock('journal'); break;
            case 'l': case 'L': openDock('legend'); break;
            case 't': case 'T': $('btn-timeline').click(); break;
            case 'c': case 'C':
                e.preventDefault();
                $('prompt').classList.add('open');
                $('prompt-input').focus();
                break;
            case '+': case '=': zoomBy(1.3); break;
            case '-': zoomBy(1 / 1.3); break;
            case '0': S.cam = { x: 0, y: 0, k: 0.85 }; break;
            case '?': toggleHelp(); break;
        }
    });
}

const HINTS = [
    { pos: { left: '88px', top: '120px' }, text: 'V ľavom paneli je vyhľadávanie, štatistiky, legenda a časová os. Úplne dole nájdeš nastavenia zobrazenia.' },
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Tu prepínaš náhľady siete — Mapa, Sieť a Vrstvy. Fungujú aj klávesy 1, 2, 3.' },
    { pos: { left: '50%', bottom: '84px', transform: 'translateX(-50%)' }, text: 'Sem napíš otázku pre Hadesa. Príkazy začínajú lomkou — skús /pomoc.' },
];

function setupHints() {
    if (localStorage.getItem('hades.hints') === 'done') return;
    const el = $('hint');
    let i = 0;

    const finish = () => {
        el.classList.add('hidden');
        localStorage.setItem('hades.hints', 'done');
    };

    const show = () => {
        if (i >= HINTS.length) { finish(); return; }
        const h = HINTS[i];
        $('hint-text').textContent = h.text;
        const step = $('hint-step');
        if (step) step.textContent = (i + 1) + ' / ' + HINTS.length;
        $('hint-next').textContent = i === HINTS.length - 1 ? 'Hotovo' : 'Ďalej';
        el.style.left = ''; el.style.top = ''; el.style.bottom = ''; el.style.transform = '';
        Object.assign(el.style, h.pos);
        el.classList.remove('hidden');
    };

    $('hint-next').onclick = () => { i++; show(); };
    const skip = $('hint-skip');
    if (skip) skip.onclick = finish;
    show();
}

/* ---------- ovládanie ---------- */

const DOCK_SECTIONS = {
    search: { title: 'Vyhľadávanie', btn: 'btn-search' },
    stats: { title: 'Prehľad', btn: 'btn-stats' },
    journal: { title: 'Denník záznamov', btn: 'btn-journal' },
    legend: { title: 'Legenda', btn: 'btn-legend' },
    settings: { title: 'Zobrazenie', btn: 'btn-settings' },
};

let dockOpen = null;

function openDock(name) {
    if (dockOpen === name) { closeDock(); return; }
    dockOpen = name;
    $('dock').classList.remove('hidden');
    $('dock-title').textContent = DOCK_SECTIONS[name].title;

    for (const key of Object.keys(DOCK_SECTIONS)) {
        $('sec-' + key).classList.toggle('hidden', key !== name);
        $(DOCK_SECTIONS[key].btn).classList.toggle('active', key === name);
    }

    if (name === 'stats') refreshStats();
    if (name === 'journal') renderJournal();
    if (name === 'search') {
        renderSearch($('search-input').value);
        setTimeout(() => $('search-input').focus(), 60);
    }
}

function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    if (d < 604800) return Math.round(d / 86400) + ' d';
    return new Date(iso).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}

async function renderJournal() {
    const list = $('journal-list');
    list.innerHTML = '<div class="hist">Načítavam…</div>';
    try {
        const data = await (await fetch('/api/journal')).json();
        if (!data.records.length) {
            list.innerHTML = '<div class="empty-state"><span class="ms" aria-hidden="true">history_edu</span>'
                + '<div class="title">Zatiaľ žiadne záznamy</div>'
                + '<div class="hint">Mozog si sám zapíše každú Claude Code session.</div></div>';
            return;
        }
        list.innerHTML = data.records.map((r) => {
            const isDigest = r.source === 'digest';
            const badges = [];
            if (r.project) badges.push('<span class="tag">' + esc(r.project) + '</span>');
            if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
            if (r.commits && r.commits.length) badges.push('<span class="tag muted">' + r.commits.length + ' commit</span>');
            return '<button type="button" class="record" data-id="' + r.id + '">'
                + '<div class="record-head"><span class="ms rec-ico" aria-hidden="true">' + (isDigest ? 'calendar_month' : 'article') + '</span>'
                + '<span class="record-title">' + esc(r.label) + '</span>'
                + '<span class="record-time">' + timeAgo(r.created_at) + '</span></div>'
                + (badges.length ? '<div class="record-tags">' + badges.join('') + '</div>' : '')
                + '</button>';
        }).join('');

        list.querySelectorAll('.record').forEach((el) => {
            el.onclick = () => {
                const n = S.byId.get(+el.dataset.id);
                if (n) { S.cam.k = Math.max(S.cam.k, 1); focusNode(n); selectNode(n); }
            };
        });
    } catch (e) {
        list.innerHTML = '<div class="hist">Denník sa nepodarilo načítať.</div>';
    }
}

function closeDock() {
    dockOpen = null;
    $('dock').classList.add('hidden');
    for (const key of Object.keys(DOCK_SECTIONS)) {
        $(DOCK_SECTIONS[key].btn).classList.remove('active');
    }
}

function renderSearch(q) {
    const query = (q || '').trim().toLowerCase();
    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };

    const matches = !query ? [] : S.nodes
        .filter((n) => (n.label + ' ' + (n.description || '')).toLowerCase().includes(query))
        .sort((a, b) => (b.strength || 0) - (a.strength || 0))
        .slice(0, 8);

    $('search-results').innerHTML = matches.map((n) =>
        '<button type="button" class="search-item" data-id="' + n.id + '"><span>' + esc(n.label)
        + '</span><span class="sub">' + typeNames[n.type] + '</span></button>'
    ).join('') || (query ? '<div class="hist">Žiadny uzol nezodpovedá hľadaniu.</div>' : '');

    $('search-results').querySelectorAll('.search-item').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (!n) return;
            S.cam.k = Math.max(S.cam.k, 1.1);
            focusNode(n);
            selectNode(n);
        };
    });
}

function setupControls() {
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.onclick = () => setView(b.dataset.view);
    });

    $('btn-search').onclick = () => openDock('search');
    $('btn-stats').onclick = () => openDock('stats');
    $('btn-journal').onclick = () => openDock('journal');
    $('btn-legend').onclick = () => openDock('legend');
    $('btn-settings').onclick = () => openDock('settings');
    $('dock-close').onclick = closeDock;

    $('search-input').oninput = () => renderSearch($('search-input').value);

    $('btn-timeline').onclick = () => {
        const shown = !$('timeline').classList.toggle('hidden');
        $('btn-timeline').classList.toggle('active', shown);
        if (!shown) stopReplay();
    };

    $('zoom-in').onclick = () => zoomBy(1.3);
    $('zoom-out').onclick = () => zoomBy(1 / 1.3);
    $('zoom-reset').onclick = () => { S.cam = { x: 0, y: 0, k: 0.85 }; };
    $('brand-core').onclick = () => { S.cam = { x: 0, y: 0, k: 0.85 }; };

    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        inp.oninput = () => { syncSlider(inp); setOpt(inp.dataset.opt, parseFloat(inp.value)); };
    });

    $('opts-reset').onclick = () => {
        S.opts = Object.assign({}, OPT_DEFAULTS);
        localStorage.setItem('hades.opts', JSON.stringify(S.opts));
        makeStars();
        applyOpts();
    };

    const soundBtn = $('btn-sound');
    soundBtn.textContent = S.sound ? 'volume_up' : 'volume_off';
    soundBtn.onclick = () => {
        S.sound = !S.sound;
        localStorage.setItem('hades.sound', S.sound ? 'on' : 'off');
        soundBtn.textContent = S.sound ? 'volume_up' : 'volume_off';
        if (S.sound) blip(523);
    };

    $('btn-ambient').onclick = () => {
        document.body.classList.add('ambient');
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    };

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) document.body.classList.remove('ambient');
    });

    $('node-close').onclick = closeNodePanel;

    $('node-edit').onclick = () => {
        if (!S.selected) return;
        $('edit-label').value = S.selected.label;
        $('edit-desc').value = S.selected.description || '';
        $('node-view').classList.add('hidden');
        $('node-form').classList.remove('hidden');
    };

    $('edit-cancel').onclick = () => {
        $('node-form').classList.add('hidden');
        $('node-view').classList.remove('hidden');
    };

    $('edit-save').onclick = async () => {
        if (!S.selected) return;
        const res = await fetch('/api/nodes/' + S.selected.id, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label: $('edit-label').value.trim(),
                description: $('edit-desc').value.trim() || null,
            }),
        });
        if (res.ok) {
            const data = await res.json();
            Object.assign(S.selected, data.node);
            selectNode(S.selected);
        }
    };

    $('node-delete').onclick = async () => {
        if (!S.selected) return;
        if (!confirm('Naozaj zmazať „' + S.selected.label + '" z vedomia?')) return;
        const res = await fetch('/api/nodes/' + S.selected.id, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.message || 'Nepodarilo sa zmazať.');
        }
    };
}

/* ---------- štart ---------- */

async function init() {
    setTheme(localStorage.getItem('hades.theme') || 'light');
    resize();
    makeStars();
    window.addEventListener('resize', resize);

    const res = await fetch('/api/mind');
    const data = await res.json();

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
    applyOpts();
    setView(S.view);
    setupTimeline();
    setupPrompt();
    setupHints();
    connectWs(data.ws);

    setInterval(dream, 9000 + Math.random() * 6000);
    setInterval(computeReplayBounds, 60000);

    window.HADES = { S, draw, frame, setTheme, setFocus };

    scheduleFrame();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); scheduleFrame(); }
    });
}

init();

})();
