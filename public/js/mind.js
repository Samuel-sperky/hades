/* Hades — živá neurónová sieť vedomia */
(() => {
'use strict';

const AREA_RADIUS = 460;

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
    awakeUntil: 0,
    awakeMinutes: 5,
    dim: 1,
    activations: [],
    view: localStorage.getItem('hades.view') || 'map',
};

/* ---------- téma (svetlá / tmavá) ---------- */

// Canvas farby čítané z CSS tokenov, aby sa plátno prefarbilo spolu s chrome.
const THEME = {};

function loadTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fb) => (cs.getPropertyValue(name).trim() || fb);

    THEME.bg = v('--canvas-bg', '#f8f4f7');
    THEME.edgeRgb = v('--canvas-edge-rgb', '3,121,126').replace(/\s+/g, '');
    THEME.strokeRgb = v('--canvas-node-stroke', '16,29,27').replace(/\s+/g, '');
    THEME.strokeAlpha = v('--canvas-node-stroke-alpha', '0.22');
    THEME.haloRgb = v('--canvas-label-halo', '248,244,247').replace(/\s+/g, '');
    THEME.text = v('--text', '#101d1b');
    THEME.muted = v('--muted', '#566964');
    THEME.plexusA = v('--canvas-plexus-a', '120,170,168').split(',').map(Number);
    THEME.plexusB = v('--canvas-plexus-b', '3,121,126').split(',').map(Number);

    NODE_COLORS.core = v('--node-core', '#b88a3a');
    NODE_COLORS.skill = v('--node-skill', '#03797e');
    NODE_COLORS.memory = v('--node-memory', '#2f6d8f');
    NODE_COLORS.project = v('--node-project', '#c2761c');
    Object.assign(VIEW_LAYER_COLORS, NODE_COLORS);
}

function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('hades.theme', theme);
    const btn = document.getElementById('btn-theme');
    if (btn) btn.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
    loadTheme();
}

function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}

function initTheme() {
    const stored = localStorage.getItem('hades.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored || (prefersDark ? 'dark' : 'light'));
}

const VIEW_LAYER_COLORS = {
    memory: '#2f6d8f',
    skill: '#03797e',
    core: '#b88a3a',
    project: '#c2761c',
};

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const OPT_DEFAULTS = {
    panelAlpha: 0.86,
    bg: 1,
    edgeAlpha: 1,
    glow: 1,
    labelAlpha: 1,
    nodeScale: 1,
    labelSize: 1,
    density: 1,
};

S.opts = Object.assign({}, OPT_DEFAULTS, JSON.parse(localStorage.getItem('hades.opts') || '{}'));

function setOpt(key, value) {
    S.opts[key] = value;
    localStorage.setItem('hades.opts', JSON.stringify(S.opts));
    if (key === 'density') makeStars();
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
    if (n.type === 'core') return NODE_COLORS.core;
    const area = S.areas.get(n.area_id);
    return area ? area.color : (THEME.muted || '#566964');
}

// Gradient plexus pozadia: fialova (vlavo) -> smaragdova (vpravo), ako referencny vizual
// Tlmena technicka paleta: bridlicova indigo (vlavo) -> teal (vpravo)
function plexusColor(x) {
    const t = Math.max(0, Math.min(1, (x + 1300) / 2600));
    const a = THEME.plexusA || [120, 170, 168];
    const b = THEME.plexusB || [3, 121, 126];
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return r + ',' + g + ',' + bl;
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
        ctx.fillStyle = '#2d3a38';
        ctx.font = '600 ' + (12.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].title.toUpperCase(), LAYER_X[i], headerY);

        ctx.globalAlpha = 0.5 * S.dim;
        ctx.fillStyle = '#566964';
        ctx.font = (10.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].sub, LAYER_X[i], headerY + 18 * invK);
    }
    ctx.globalAlpha = 1;
}

function nodeRadius(n) {
    const base = n.type === 'core'
        ? (n.label === S.name ? 20 : 11)
        : 5.5 + 2.6 * Math.log2(1 + (n.strength || 1));

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

/* ---------- pulzy ---------- */

function spawnPulse(fromNode, toNode, opts = {}) {
    if (!fromNode || !toNode) return;
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
    if (REDUCED_MOTION || document.hidden || !S.edges.length) return;
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

    // Radiálne ukotvenie k oblasti platí v oboch pohľadoch (Mapa aj Sieť);
    // Sieť má len voľnejšiu gravitáciu a silnejšie odpudzovanie pre vzdušný web.
    S.sim = d3.forceSimulation(S.nodes)
        .force('x', d3.forceX(d => anchorOf(d).x)
            .strength(d => d.type === 'core' ? 0.25 : (net ? 0.04 : 0.055)))
        .force('y', d3.forceY(d => anchorOf(d).y)
            .strength(d => d.type === 'core' ? 0.25 : (net ? 0.04 : 0.055)))
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

// Cistice pozadia: technicke gulicky s hlbkou (parallax) a jemnym driftom
function makeStars() {
    S.stars = [];
    const count = Math.round(140 * (S.opts ? S.opts.density : 1));
    for (let i = 0; i < count; i++) {
        const z = 0.35 + Math.random() * 0.65;
        S.stars.push({
            x: (Math.random() - 0.5) * 2600,
            y: (Math.random() - 0.5) * 2600,
            z,
            dir: Math.random() * Math.PI * 2,
            speed: (0.25 + Math.random() * 0.5) * z,
            curve: (Math.random() - 0.5) * 0.05,
            phase: Math.random() * Math.PI * 2,
            twinkle: 0.25 + Math.random() * 0.35,
            r: 0.8 + z * 0.7,
        });
    }
}

function passesFilter(n) {
    const f = S.filter;
    if (!f) return true;
    if (f.types.size && !f.types.has(n.type)) return false;
    if (n.type !== 'core' && f.areas && f.areas.size && n.area_id && !f.areas.has(n.area_id)) return false;
    if (n.source && f.sources && f.sources.size < f.allSources && !f.sources.has(n.source)) return false;
    if ((n.strength || 0) < f.minStrength) return false;
    if (f.days > 0) {
        const cutoff = now() - f.days * 86400000;
        const last = Math.max(ts(n.last_activated_at), ts(n.created_at));
        if (last && last < cutoff) return false;
    }
    return true;
}

function visibleInReplay(n) {
    return passesFilter(n);
}

function draw() {
    const targetDim = isAwake() ? 1 : 0.5;
    S.dim += (targetDim - S.dim) * 0.02;

    // pokojný dych (pomalá sínusoida) + adaptívna žiara (živšie keď je bdelé)
    const breath = REDUCED_MOTION ? 0.5 : (Math.sin(now() * 0.0011) * 0.5 + 0.5);
    const awakeBoost = isAwake() ? 1 : 0.62;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = THEME.bg || '#f8f4f7';
    ctx.fillRect(0, 0, S.w, S.h);

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    const layersView = S.view === 'layers';
    const bgLevel = layersView ? 0 : S.opts.bg;
    if (bgLevel > 0.01) {
        const plexusDist = 210;
        const invK = 1 / S.cam.k;

        // jemna technicka mriezka (world-space, hyba sa so sietou)
        const _step = 240, _ext = 1400;
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + THEME.edgeRgb + ',' + (0.035 * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = -_ext; gx <= _ext; gx += _step) { ctx.moveTo(gx, -_ext); ctx.lineTo(gx, _ext); }
        for (let gy = -_ext; gy <= _ext; gy += _step) { ctx.moveTo(-_ext, gy); ctx.lineTo(_ext, gy); }
        ctx.stroke();

        // linky: jemne teal hairlines na papieri
        ctx.lineWidth = 0.6 * invK;
        for (let i = 0; i < S.stars.length; i++) {
            const a = S.stars[i];
            for (let j = i + 1; j < S.stars.length; j++) {
                const b = S.stars[j];
                const dx = a.x - b.x, dy = a.y - b.y;
                const d2 = dx * dx + dy * dy;
                if (d2 > plexusDist * plexusDist) continue;
                const depth = Math.min(a.z, b.z);
                const alpha = Math.min(0.10,
                    (1 - Math.sqrt(d2) / plexusDist) * 0.07 * depth * S.dim * bgLevel);
                ctx.strokeStyle = 'rgba(' + plexusColor((a.x + b.x) / 2) + ',' + alpha + ')';
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }

        // gulicky: cisty solidny bod + jemny teal "node" prstenec
        for (const s of S.stars) {
            const col = plexusColor(s.x);
            const rr = s.r * s.z * invK;
            const base = Math.min(0.18, s.z * 0.5 * S.dim * bgLevel);

            ctx.globalAlpha = base;
            ctx.fillStyle = 'rgba(' + col + ',1)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, rr, 0, 7);
            ctx.fill();

            ctx.globalAlpha = base * 0.5;
            ctx.lineWidth = 0.5 * invK;
            ctx.strokeStyle = 'rgba(' + THEME.edgeRgb + ',1)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, rr * 2.2, 0, 7);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    if (S.view === 'map') for (const area of S.areas.values()) {
        const a = areaAnchor(area);
        // utlmená ambientná aura oblasti — takmer monochromatický pokoj (Q2)
        ctx.globalAlpha = 0.035 * S.dim;
        const g = ctx.createRadialGradient(a.x, a.y, 20, a.x, a.y, 260);
        g.addColorStop(0, area.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 260, 0, 7);
        ctx.fill();
        ctx.globalAlpha = 0.2 * S.dim;
        ctx.fillStyle = THEME.muted || '#566964';
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
                    ctx.strokeStyle = 'rgba(' + THEME.edgeRgb + ',' + (0.12 * S.dim * S.opts.edgeAlpha) + ')';
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
            const alpha = Math.min(0.30,
                Math.min(0.24, 0.12 + 0.06 * Math.log2(1 + (e.weight || 1))) * S.dim * S.opts.edgeAlpha);
            ctx.strokeStyle = 'rgba(' + THEME.edgeRgb + ',' + alpha + ')';
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
        const g = ctx.createRadialGradient(x, y, 0, x, y, 10);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.8 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 7);
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

            // jemna aura
            ctx.globalAlpha = Math.min(0.4, (0.12 + flash * 0.5) * S.dim * S.opts.glow);
            const g = ctx.createRadialGradient(n.x, n.y, r * 0.6, n.x, n.y, r * 2.4);
            g.addColorStop(0, color);
            g.addColorStop(1, 'transparent');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 2.4, 0, 7);
            ctx.fill();

            // jadro
            ctx.globalAlpha = Math.min(1, (0.82 + flash * 0.5) * S.dim);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 0.72, 0, 7);
            ctx.fill();

            // prsteň (wireframe)
            ctx.globalAlpha = Math.min(1, (0.95 + flash) * S.dim);
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
        const flash = n.flash || 0;
        const isCore = n.type === 'core';
        const glow = S.dim * S.opts.glow * awakeBoost;
        // obradné jadro dýcha; ostatné uzly majú pokojnú stálu auru
        const halo = r * (isCore ? (3 + breath * 0.9 + flash * 2) : (2.4 + flash * 2));

        ctx.globalAlpha = Math.min(isCore ? 0.62 : 0.55,
            ((isCore ? 0.24 : 0.18) + flash * 0.4) * glow);
        const g = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, halo);
        g.addColorStop(0, color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.x, n.y, halo, 0, 7);
        ctx.fill();

        // obradné sústredné prstence okolo jadra (dýchajúca zlatá „koruna")
        if (isCore) {
            for (let ri = 1; ri <= 2; ri++) {
                ctx.globalAlpha = Math.min(0.45, (0.2 + flash * 0.3) * glow) / ri;
                ctx.lineWidth = (1.1 / ri) / S.cam.k;
                ctx.strokeStyle = color;
                ctx.beginPath();
                ctx.arc(n.x, n.y, r * (1.5 + ri * 0.6) + breath * 2, 0, 7);
                ctx.stroke();
            }
        }

        ctx.globalAlpha = (0.95 + flash) * S.dim;
        ctx.fillStyle = color;
        drawShape(n, r);

        // ink hairline obrys pre cistu "gem" definiciu na papieri
        ctx.globalAlpha = Math.min(0.9, (0.5 + flash) * S.dim);
        ctx.lineWidth = Math.max(1, 0.8 / S.cam.k);
        ctx.strokeStyle = 'rgba(' + THEME.strokeRgb + ',' + THEME.strokeAlpha + ')';
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, 7);
        ctx.stroke();

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }

    ctx.globalCompositeOperation = 'source-over';

    // Popisky sa zobrazujú len pri hover/označení uzla — najčistejšie plátno.
    const showLabels = false;
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

        ctx.globalAlpha = Math.min(1,
            (isHover ? 0.98 : Math.min(0.72, (S.cam.k - 0.5) * 1.6)) * S.dim * S.opts.labelAlpha);
        ctx.lineWidth = Math.max(2.5, fontSize * 0.28);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(' + THEME.haloRgb + ', 0.9)';
        ctx.strokeText(n.label, n.x, y);
        ctx.fillStyle = THEME.text || '#101d1b';
        ctx.fillText(n.label, n.x, y);
    }
    ctx.globalAlpha = 1;
}

function drawShape(n, r) {
    const { x, y } = n;
    ctx.beginPath();
    if (n.type === 'core') {
        const spikes = 6;
        for (let i = 0; i < spikes * 2; i++) {
            const rr = i % 2 === 0 ? r : r * 0.55;
            const a = (Math.PI * i) / spikes - Math.PI / 2;
            ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        ctx.closePath();
    } else if (n.type === 'memory') {
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
    } else if (n.type === 'project') {
        for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 6;
            ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r);
        }
        ctx.closePath();
    } else {
        ctx.arc(x, y, r, 0, 7);
    }
    ctx.fill();
}

let lastFrame = now();
let framePending = false;
function frame() {
    framePending = false;
    const dt = Math.min((now() - lastFrame) / 1000, 0.1);
    lastFrame = now();

    if (!REDUCED_MOTION) for (const st of S.stars) {
        st.dir += st.curve * dt;
        st.x += Math.cos(st.dir) * st.speed * dt;
        st.y += Math.sin(st.dir) * st.speed * dt;
        st.phase += st.twinkle * dt;
        if (st.x > 1300) st.x -= 2600; else if (st.x < -1300) st.x += 2600;
        if (st.y > 1300) st.y -= 2600; else if (st.y < -1300) st.y += 2600;
    }

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
        }
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
        if (data.node.source) meta.push('z: ' + data.node.source);
        $('node-meta').textContent = meta.join(' · ');

        const fileBtn = $('node-file');
        const path = data.node.file_path;
        if (path) {
            $('node-file-path').textContent = path;
            fileBtn.classList.remove('hidden');
            fileBtn.onclick = () => {
                navigator.clipboard?.writeText(path);
                showToast('Cesta skopírovaná: ' + path);
            };
        } else {
            fileBtn.classList.add('hidden');
        }

        renderNodeDashboard(data);

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
    core: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 0l1.6 4.2L13 3l-2.6 3.5L13 11l-4.4-1.2L7 14l-1.6-4.2L1 11l2.6-4.5L1 3l4.4 1.2z" fill="#b88a3a"/></svg>',
    skill: '<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="#03797e"/></svg>',
    memory: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1l6 6-6 6-6-6z" fill="#2f6d8f"/></svg>',
    project: '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M10.5 1l3 6-3 6h-7l-3-6 3-6z" fill="#c2761c" transform="rotate(90 7 7)"/></svg>',
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

/* ---------- filtre ---------- */

function buildFilterControls() {
    const typeNames = { core: 'Jadro', skill: 'Skill', memory: 'Spomienka', project: 'Projekt' };

    $('filter-types').innerHTML = Object.keys(typeNames).map((t) =>
        '<button type="button" data-type="' + t + '">' + typeNames[t] + '</button>'
    ).join('');

    $('filter-areas').innerHTML = [...S.areas.values()].map((a) =>
        '<button type="button" data-area="' + a.id + '"><span class="swatch" style="background:'
        + a.color + '"></span>' + esc(a.name) + '</button>'
    ).join('');

    // Pôvod (source) — dynamicky z uzlov; sekcia sa ukáže len ak nejaký existuje
    const sources = [...new Set(S.nodes.map((n) => n.source).filter(Boolean))].sort();
    S.filter.allSources = sources.length;
    S.filter.sources = new Set(sources);
    $('filter-sources-wrap').classList.toggle('hidden', sources.length === 0);
    $('filter-sources').innerHTML = sources.map((s) =>
        '<button type="button" data-source="' + esc(s) + '">' + esc(s) + '</button>'
    ).join('');

    $('filter-types').querySelectorAll('button').forEach((b) => {
        b.onclick = () => { toggleSet(S.filter.types, b.dataset.type); refreshFilterUi(); };
    });
    $('filter-areas').querySelectorAll('button').forEach((b) => {
        b.onclick = () => { toggleSet(S.filter.areas, +b.dataset.area); refreshFilterUi(); };
    });
    $('filter-sources').querySelectorAll('button').forEach((b) => {
        b.onclick = () => { toggleSet(S.filter.sources, b.dataset.source); refreshFilterUi(); };
    });
    $('filter-time').querySelectorAll('button').forEach((b) => {
        b.onclick = () => { S.filter.days = +b.dataset.days; refreshFilterUi(); };
    });

    const strength = $('filter-strength');
    syncSlider(strength);
    strength.oninput = () => { syncSlider(strength); S.filter.minStrength = +strength.value; refreshFilterUi(); };

    $('filter-reset').onclick = () => {
        S.filter.types = new Set(['core', 'skill', 'memory', 'project']);
        S.filter.areas = new Set([...S.areas.keys()]);
        S.filter.sources = new Set(sources);
        S.filter.minStrength = 0;
        S.filter.days = 0;
        strength.value = 0;
        syncSlider(strength);
        refreshFilterUi();
    };

    refreshFilterUi();
}

function toggleSet(set, value) {
    if (set.has(value)) set.delete(value); else set.add(value);
}

function filterActive() {
    const f = S.filter;
    return f.types.size < 4 || f.areas.size < S.areas.size || f.minStrength > 0 || f.days > 0
        || (f.allSources && f.sources.size < f.allSources);
}

function refreshFilterUi() {
    const f = S.filter;
    $('filter-types').querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', f.types.has(b.dataset.type));
    });
    $('filter-areas').querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', f.areas.has(+b.dataset.area));
    });
    $('filter-sources').querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', f.sources.has(b.dataset.source));
    });
    $('filter-time').querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', f.days === +b.dataset.days);
    });
    $('btn-filter').classList.toggle('filter-on', filterActive());
}

function closeNodePanel() {
    S.selected = null;
    $('node-panel').classList.add('hidden');
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderNodeDashboard(data) {
    const n = data.node;
    const act = data.activity || [];
    const sumAct = act.reduce((a, s) => a + (s.count || 0), 0);
    const created = n.created_at
        ? new Date(n.created_at).toLocaleDateString('sk', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—';

    const cell = (val, label) => '<div class="nstat"><span class="nstat-v">' + val
        + '</span><span class="nstat-k">' + label + '</span></div>';

    $('node-stats').innerHTML =
        cell((n.strength || 1).toFixed(0), 'sila')
        + cell(data.neighbors.length, 'spojenia')
        + cell(sumAct, 'akt./30d')
        + cell(created, 'vzniklo');

    const wrap = $('node-activity-wrap');
    if (act.length) {
        wrap.classList.remove('hidden');
        drawBars($('node-activity'), act.map((s) => s.count), 40);
    } else {
        wrap.classList.add('hidden');
    }
}

function drawBars(cv, values, hCss) {
    const dpr = window.devicePixelRatio || 1;
    if (cv.clientWidth > 0) { cv.width = cv.clientWidth * dpr; cv.height = hCss * dpr; }
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    if (!values.length) return;
    const max = Math.max(...values, 1);
    const bw = cv.width / Math.max(values.length, 10);
    const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#03797e';
    c.fillStyle = col;
    c.globalAlpha = 0.85;
    values.forEach((v, i) => {
        const h = (v / max) * (cv.height - 6 * dpr);
        c.fillRect(i * bw + dpr, cv.height - h, Math.max(bw - 2 * dpr, 2), h);
    });
}

async function refreshSummary() {
    try {
        const st = await (await fetch('/api/mind/summary')).json();
        const cell = (val, label) => '<div class="nstat"><span class="nstat-v">' + val
            + '</span><span class="nstat-k">' + label + '</span></div>';

        let html = '<div class="node-stats">'
            + cell(st.today.learned, 'dnes nové')
            + cell(st.today.activations, 'dnes akcie')
            + cell(st.week.learned, 'týždeň nové')
            + '</div>';

        if (st.recent.length) {
            html += '<div class="summary-recent">' + st.recent.map((n) =>
                '<button type="button" class="summary-item" data-id="' + n.id + '">'
                + '<span class="swatch" style="background:' + (colorForArea(n.area) || 'var(--muted)') + '"></span>'
                + esc(n.label) + '</button>'
            ).join('') + '</div>';
        } else {
            html += '<div class="hist">tento týždeň zatiaľ nič nové</div>';
        }

        $('stats-summary').innerHTML = html;
        $('stats-summary').querySelectorAll('.summary-item').forEach((b) => {
            b.onclick = () => {
                const t = S.byId.get(+b.dataset.id);
                if (t) { selectNode(t); focusNode(t); }
            };
        });
    } catch (e) { /* súhrn nie je kritický */ }
}

function colorForArea(name) {
    for (const a of S.areas.values()) if (a.name === name) return a.color;
    return null;
}

async function refreshStats() {
    refreshSummary();

    const res = await fetch('/api/mind/stats');
    const st = await res.json();

    $('stats-totals').innerHTML =
        row('uzly', st.totals.nodes) + row('spojenia', st.totals.edges) + row('aktivácie', st.totals.activations);

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

/* ---------- živá heatmapa aktivity (oblasť × čas) ---------- */

const HEAT_WEEKS = 12;

async function buildHeatmap() {
    const grid = $('heat-grid');
    grid.innerHTML = '<div class="hist">načítavam…</div>';

    let activations = [];
    try {
        const since = new Date(now() - HEAT_WEEKS * 7 * 86400000).toISOString();
        const res = await fetch('/api/activations?since=' + encodeURIComponent(since) + '&limit=10000');
        activations = (await res.json()).activations || [];
    } catch (e) {
        grid.innerHTML = '<div class="hist">aktivitu sa nepodarilo načítať</div>';
        return;
    }

    // node_id → area_id
    const areaOf = new Map();
    for (const n of S.nodes) areaOf.set(n.id, n.area_id);

    const areas = [...S.areas.values()];
    // matica [areaIndex][week] = počet
    const weekStart = startOfWeek(now()) - (HEAT_WEEKS - 1) * 7 * 86400000;
    const matrix = areas.map(() => new Array(HEAT_WEEKS).fill(0));

    for (const a of activations) {
        const areaId = areaOf.get(a.node_id);
        if (areaId == null) continue;
        const ai = areas.findIndex((ar) => ar.id === areaId);
        if (ai < 0) continue;
        const wk = Math.floor((ts(a.created_at) - weekStart) / (7 * 86400000));
        if (wk >= 0 && wk < HEAT_WEEKS) matrix[ai][wk]++;
    }

    const max = Math.max(1, ...matrix.flat());

    let html = '';
    areas.forEach((area, ai) => {
        html += '<div class="heat-row"><span class="heat-label" title="' + esc(area.name) + '">'
            + esc(area.name) + '</span><span class="heat-cells">';
        for (let w = 0; w < HEAT_WEEKS; w++) {
            const v = matrix[ai][w];
            const alpha = v ? (0.14 + 0.86 * (v / max)) : 0;
            const bg = v ? 'color-mix(in srgb, ' + area.color + ' ' + Math.round(alpha * 100) + '%, transparent)' : 'var(--surface-2)';
            html += '<span class="heat-cell" style="background:' + bg + '" title="' + v + ' akcií"></span>';
        }
        html += '</span></div>';
    });

    grid.innerHTML = html;

    const from = new Date(weekStart).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
    $('heat-range').textContent = 'posledných ' + HEAT_WEEKS + ' týž. · od ' + from;
}

function startOfWeek(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const day = (d.getDay() + 6) % 7; // pondelok = 0
    d.setDate(d.getDate() - day);
    return d.getTime();
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
    }

    if (dockOpen === 'stats') refreshStats();
}

/* ---------- toasty, pomocnik, hinty ---------- */

function showToast(text, nodeId) {
    const wrap = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast';
    const parts = String(text).split(/:\s(.+)/);
    el.innerHTML = parts.length > 1
        ? '<span class="ms" aria-hidden="true">auto_awesome</span><span>' + esc(parts[0]) + ': <strong>' + esc(parts[1]) + '</strong></span>'
        : '<span class="ms" aria-hidden="true">auto_awesome</span><span>' + esc(text) + '</span>';

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
    ['⌘K / Ctrl+K', 'Príkazová paleta'],
    ['1 / 2 / 3', 'Náhľad: Mapa / Sieť / Vrstvy'],
    ['F', 'Vyhľadávanie'],
    ['G', 'Filtre'],
    ['S', 'Štatistiky'],
    ['L', 'Legenda'],
    ['N', 'Návrhy (medzery, duplicity, spiace)'],
    ['T', 'Heatmapa aktivity'],
    ['D', 'Svetlá / tmavá téma'],
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
            return;
        }

        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA/.test(tag)) return;

        switch (e.key) {
            case '1': setView('map'); break;
            case '2': setView('net'); break;
            case '3': setView('layers'); break;
            case 'f': case 'F': e.preventDefault(); openDock('search'); break;
            case 'g': case 'G': openDock('filter'); break;
            case 's': case 'S': openDock('stats'); break;
            case 'l': case 'L': openDock('legend'); break;
            case 'n': case 'N': openDock('suggest'); break;
            case 't': case 'T': $('btn-timeline').click(); break;
            case 'd': case 'D': toggleTheme(); break;
            case 'k': case 'K': e.preventDefault(); openCmdk(); break;
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
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Príkazová paleta je pod ⌘K / Ctrl+K — rýchly skok na uzol alebo príkaz. Vedomie sa učí samo cez Claude Code (MCP), netreba API kľúč.' },
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
    filter: { title: 'Filtre', btn: 'btn-filter' },
    stats: { title: 'Štatistiky', btn: 'btn-stats' },
    legend: { title: 'Legenda', btn: 'btn-legend' },
    suggest: { title: 'Návrhy', btn: 'btn-suggest' },
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
    if (name === 'suggest') renderSuggestions();
    if (name === 'search') {
        renderSearch($('search-input').value);
        setTimeout(() => $('search-input').focus(), 60);
    }
}

async function renderSuggestions() {
    let s;
    try {
        s = await (await fetch('/api/mind/suggestions')).json();
    } catch (e) {
        return;
    }

    const jump = (id) => { const n = S.byId.get(+id); if (n) { selectNode(n); focusNode(n); } };

    $('suggest-gaps').innerHTML = (s.gaps || []).map((g) =>
        '<div class="stat-row"><span>' + esc(g.name) + '</span><span class="val">' + g.nodes + '</span></div>'
    ).join('') || '<div class="hist">—</div>';

    $('suggest-sleeping').innerHTML = (s.sleeping || []).map((n) =>
        '<button type="button" class="search-item" data-id="' + n.id + '"><span>' + esc(n.label)
        + '</span><span class="sub">' + (n.last_activated_at ? new Date(n.last_activated_at).toLocaleDateString('sk') : '') + '</span></button>'
    ).join('') || '<div class="hist">žiadne spiace uzly</div>';

    $('suggest-duplicates').innerHTML = (s.duplicates || []).map((d) =>
        '<div class="dup-row"><button type="button" class="chip" data-id="' + d.a.id + '">' + esc(d.a.label)
        + '</button><span class="dup-sim">' + d.similarity + '%</span><button type="button" class="chip" data-id="' + d.b.id + '">' + esc(d.b.label) + '</button></div>'
    ).join('') || '<div class="hist">žiadne zjavné duplicity</div>';

    $('sec-suggest').querySelectorAll('[data-id]').forEach((el) => {
        el.onclick = () => jump(el.dataset.id);
    });
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
    $('btn-filter').onclick = () => openDock('filter');
    $('btn-stats').onclick = () => openDock('stats');
    $('btn-legend').onclick = () => openDock('legend');
    $('btn-suggest').onclick = () => openDock('suggest');
    $('btn-settings').onclick = () => openDock('settings');
    $('dock-close').onclick = closeDock;

    $('search-input').oninput = () => renderSearch($('search-input').value);

    $('btn-timeline').onclick = () => {
        const shown = !$('timeline').classList.toggle('hidden');
        $('btn-timeline').classList.toggle('active', shown);
        if (shown) buildHeatmap();
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

    const themeBtn = $('btn-theme');
    if (themeBtn) themeBtn.onclick = toggleTheme;

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

/* ---------- príkazová paleta (Cmd/Ctrl+K) ---------- */

let cmdkSel = 0;
let cmdkItems = [];

function cmdkCommands() {
    return [
        { icon: 'map', label: 'Zobraziť: Mapa', run: () => setView('map') },
        { icon: 'hub', label: 'Zobraziť: Sieť', run: () => setView('net') },
        { icon: 'layers', label: 'Zobraziť: Vrstvy', run: () => setView('layers') },
        { icon: 'search', label: 'Otvoriť: Vyhľadávanie', run: () => openDock('search') },
        { icon: 'filter_alt', label: 'Otvoriť: Filtre', run: () => openDock('filter') },
        { icon: 'monitoring', label: 'Otvoriť: Štatistiky', run: () => openDock('stats') },
        { icon: 'category', label: 'Otvoriť: Legenda', run: () => openDock('legend') },
        { icon: 'tune', label: 'Otvoriť: Nastavenia', run: () => openDock('settings') },
        { icon: 'history', label: 'Prepnúť: Časová os', run: () => $('btn-timeline').click() },
        { icon: 'dark_mode', label: 'Prepnúť tému (svetlá/tmavá)', run: toggleTheme },
        { icon: 'center_focus_strong', label: 'Vycentrovať pohľad', run: () => { S.cam = { x: 0, y: 0, k: 0.85 }; } },
        { icon: 'fullscreen', label: 'Ambient režim', run: () => $('btn-ambient').click() },
    ];
}

function openCmdk() {
    $('cmdk').classList.remove('hidden');
    const inp = $('cmdk-input');
    inp.value = '';
    renderCmdk('');
    setTimeout(() => inp.focus(), 30);
}

function closeCmdk() {
    $('cmdk').classList.add('hidden');
}

function renderCmdk(q) {
    const query = (q || '').trim().toLowerCase();
    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };

    const cmds = cmdkCommands()
        .filter((c) => !query || c.label.toLowerCase().includes(query))
        .map((c) => ({ kind: 'cmd', icon: c.icon, label: c.label, sub: 'príkaz', run: c.run }));

    const nodes = (!query ? [] : S.nodes
        .filter((n) => (n.label + ' ' + (n.description || '')).toLowerCase().includes(query))
        .sort((a, b) => (b.strength || 0) - (a.strength || 0))
        .slice(0, 6))
        .map((n) => ({
            kind: 'node', icon: 'lens', label: n.label, sub: typeNames[n.type],
            run: () => { selectNode(n); focusNode(n); },
        }));

    cmdkItems = query ? [...nodes, ...cmds] : cmds;
    cmdkSel = 0;

    $('cmdk-results').innerHTML = cmdkItems.map((it, i) =>
        '<button type="button" class="cmdk-item' + (i === 0 ? ' sel' : '') + '" data-idx="' + i + '">'
        + '<span class="ms" aria-hidden="true">' + it.icon + '</span>'
        + '<span class="cmdk-label">' + esc(it.label) + '</span>'
        + '<span class="cmdk-sub">' + it.sub + '</span></button>'
    ).join('') || '<div class="hist">Nič nenájdené.</div>';

    $('cmdk-results').querySelectorAll('.cmdk-item').forEach((b) => {
        b.onclick = () => runCmdk(+b.dataset.idx);
    });
}

function moveCmdk(dir) {
    if (!cmdkItems.length) return;
    cmdkSel = (cmdkSel + dir + cmdkItems.length) % cmdkItems.length;
    $('cmdk-results').querySelectorAll('.cmdk-item').forEach((b, i) => {
        b.classList.toggle('sel', i === cmdkSel);
        if (i === cmdkSel) b.scrollIntoView({ block: 'nearest' });
    });
}

function runCmdk(idx) {
    const it = cmdkItems[idx];
    if (!it) return;
    closeCmdk();
    it.run();
}

function setupCmdk() {
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            $('cmdk').classList.contains('hidden') ? openCmdk() : closeCmdk();
            return;
        }
        if ($('cmdk').classList.contains('hidden')) return;
        if (e.key === 'Escape') { closeCmdk(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); moveCmdk(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveCmdk(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); runCmdk(cmdkSel); }
    });

    $('cmdk-input').addEventListener('input', () => renderCmdk($('cmdk-input').value));
    $('cmdk').addEventListener('click', (e) => { if (e.target === $('cmdk')) closeCmdk(); });
}

/* ---------- štart ---------- */

async function init() {
    initTheme();
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

    S.filter = {
        types: new Set(['core', 'skill', 'memory', 'project']),
        areas: new Set([...S.areas.keys()]),
        sources: new Set(),
        allSources: 0,
        minStrength: 0,
        days: 0,
    };

    S.nodes = data.nodes.map((n) => ({ ...n }));
    for (const n of S.nodes) S.byId.set(n.id, n);

    S.edges = data.edges
        .filter((e) => S.byId.has(e.source_id) && S.byId.has(e.target_id))
        .map((e) => ({ ...e, source: S.byId.get(e.source_id), target: S.byId.get(e.target_id) }));

    setupInput();
    setupControls();
    setupShortcuts();
    buildLegend();
    buildFilterControls();
    setupCmdk();
    applyOpts();
    setView(S.view);
    setupHints();
    connectWs(data.ws);

    // plynulé, jemné pulzy putujúce po hranách — „živá sieť", no pokojne
    setInterval(dream, 3200 + Math.random() * 2600);

    window.HADES = { S, draw, frame };

    scheduleFrame();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); scheduleFrame(); }
    });
}

init();

})();
