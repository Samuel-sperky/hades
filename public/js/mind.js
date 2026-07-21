/* Hades — živá neurónová sieť vedomia */
(() => {
'use strict';

const CORE_COLOR = '#b88a3a';
const AREA_RADIUS = 640;

// FÁZA HRANY: základné stlmenie hrán (~40 %) — uzly a popisky vyniknú nad sieťou.
const EDGE_DIM = 0.6;

// Témy — kontrakt pre canvas literály (idú cez T.*)
// nodeFloor/edgeFloor: spodná hranica tlmenia (hover × focus), gridAlpha: sila mriežky
const THEMES = {
    light: { paper:'#f8f4f7', ink:'#101d1b', inkSoft:'#2d3a38', muted:'#566964', labelHalo:'rgba(248,244,247,0.92)', edge:'45,58,56', gridColor:'3,121,126', accent:'3,121,126', outline:'rgba(16,29,27,0.35)', gridAlpha:0.05, nodeFloor:0.30, edgeFloor:0.20 },
    dark:  { paper:'#0e1413', ink:'#eaf3f1', inkSoft:'#c3d1ce', muted:'#8a9b98', labelHalo:'rgba(14,20,19,0.92)', edge:'195,209,206', gridColor:'5,188,196', accent:'5,188,196', outline:'rgba(234,243,241,0.30)', gridAlpha:0.09, nodeFloor:0.35, edgeFloor:0.25 },
};
let T = THEMES.light;
function setTheme(name){ T = THEMES[name] || THEMES.light; document.documentElement.dataset.theme = (name === 'dark' ? 'dark' : 'light'); localStorage.setItem('hades.theme', name); invalidateCertColors(); }

const DEPT_RADIUS = 170;

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
    local: null,          // { rootId, depth } — lokálny graf (Obsidian local graph)
    _localFor: null,
    _localSet: null,
    degree: new Map(),    // nodeId → počet hrán, prepočet v buildSim
    connectFrom: null,    // id zdrojového uzla pri ručnom prepájaní (connect mode)
    awakeUntil: 0,
    awakeMinutes: 5,
    dim: 1,
    activations: [],
    replay: { on: false, t: 1, playing: false, tMin: 0, tMax: 0 },
    sound: localStorage.getItem('hades.sound') !== 'off',
    audio: null,
    view: localStorage.getItem('hades.view') || 'map',
    // FÁZA SHELL: aktívna obrazovka (Dnes / Denník / Graf / Knižnica). Plátno (rAF) beží len na 'graf'.
    screen: (() => { const v = localStorage.getItem('hades.screen'); return ['dnes', 'dennik', 'graf', 'kniznica', 'rozhodnutia', 'kontrola', 'smernica'].includes(v) ? v : 'dnes'; })(),
    // FÁZA HRANY: default 1.0 (skryje similarity 0.5 + jednorazové co_activation 0.6).
    // Nový kľúč 'hades.minWeight2', aby sa nový default prejavil aj starým používateľom.
    minWeight: (() => { const v = localStorage.getItem('hades.minWeight2'); return v == null ? 1.0 : (parseFloat(v) || 0); })(),
    // FÁZA HRANY: režim kostry — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    skeleton: localStorage.getItem('hades.skeleton') === '1',
    // FÁZA ANIMÁCIE: stav animačnej vrstvy
    _flows: [],           // putujúce svetlobody po hranách (event-driven): { from,to,e,t,speed,tone,dim,wait }
    _morph: null,         // prechod náhľadov: { from:Map, to:Map, t, dur }
    _clock: 0,            // monotónny animačný čas (s) — fáza pre dýchanie / sínusovky (mrzne pri skrytom tabe)
    _anim: 0,             // efektívna intenzita animácií tento frame (animLevel(), vrátane ambient boostu)
    _interacting: false,  // drag/pan prebieha → dýchanie sa pozastaví
    _labelShown: null,    // FÁZA DE-CLUTTER: id uzlov s viditeľným popiskom minulý frame (stabilita)
    // FÁZA ANIMÁCIE (Living Hades): ambientný „život" — spojitá jemná slučka na Grafe.
    _life: 0,             // efektívna intenzita ambientného života tento frame (lifeLevel(), 0 = pokoj)
    _lifeTier: 0,         // auto-strop: 0 = plný, 1 = redukovaný (bez driftu), 2 = len event-driven
    _drawMs: 4,           // EMA nákladu draw() (ms) — podklad pre auto-strop (nižší = viac hlavy)
    _lastAmbient: 0,      // čas posledného ambientného framu (ms) — cap ~30 FPS pre život
    _nextSynapse: 3,      // _clock, kedy vyšle ďalšiu spontánnu synapsiu („myseľ premýšľa")
    cursor: { sx: 0, sy: 0, on: false, a: 0 }, // kurzor pre gravitáciu/parallax (screen + aktivácia 0..1)
    _vp: null,            // svetové hranice viewportu minulý frame — cieľ pre spontánne synapsie
    // FÁZA RENDER PIPELINE: dirty-flag rAF slučka — v pokoji 0 prekreslení (tichý CPU).
    _dirty: true,         // jednorazová požiadavka na prekreslenie (hover, kamera, dáta, filter)
    _settleFrames: 0,     // dobeh po animácii (flash/zrod dohasne, potom sa slučka zastaví)
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
    sizeByDegree: false,
    edgeSoftHover: true, // FÁZA HRANY: v pokoji sú hrany jemné, rozsvietia sa pri hover/fokuse uzla
    anim: 0.5,           // FÁZA ANIMÁCIE: intenzita udalostných animácií (toky, zrod, morph; 0 = vyp)
    life: 0.5,           // FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie, drift, synapsie; 0 = pokoj)
};

S.opts = Object.assign({}, OPT_DEFAULTS, JSON.parse(localStorage.getItem('hades.opts') || '{}'));

// Fyzika — null = predvolená hodnota náhľadu; slidery (F2) zapisujú čísla + localStorage
const FORCE_DEFAULTS = { charge: null, linkDistance: null, linkStrength: null, gravity: null };
S.forces = Object.assign({}, FORCE_DEFAULTS, JSON.parse(localStorage.getItem('hades.forces') || '{}'));

// Filtre siete (Obsidian filters) — množiny SKRYTÝCH typov / zdrojov / oblastí.
// tags je POZITÍVNY filter (F4): množina VYBRANÝCH značiek — prázdna = bez filtra,
// inak sa zobrazia len uzly nesúce aspoň jednu vybranú značku (jadro vždy prejde).
S.filter = { types: new Set(), sources: new Set(), areas: new Set(), tags: new Set() };
try {
    const f = JSON.parse(localStorage.getItem('hades.filter') || '{}');
    for (const k of ['types', 'sources', 'areas', 'tags']) {
        if (Array.isArray(f[k])) S.filter[k] = new Set(f[k]);
    }
} catch (e) { /* poškodený filter — čisté predvolené */ }

// FÁZA CERTAINTY (F4, §4.6): značky istoty na canvase (prstenec + dash encoding).
// Default ON, prepínateľné v Nastaveniach („Značky istoty"). Perzistuje 'hades.certRings'.
S.certRings = localStorage.getItem('hades.certRings') !== '0';

// FÁZA HRANY: filter kategórií vzťahov (part_of / uses / similarity / co_activation).
// manual + skill_mention (kategória 'core') je štruktúra a nefiltruje sa. Množina drží SKRYTÉ kategórie.
S.filter.relations = new Set();
try {
    const rf = JSON.parse(localStorage.getItem('hades.relfilter') || '[]');
    if (Array.isArray(rf)) S.filter.relations = new Set(rf);
} catch (e) { /* poškodený filter vzťahov — čisté predvolené */ }

function persistRelFilter() {
    localStorage.setItem('hades.relfilter', JSON.stringify([...S.filter.relations]));
}

// FÁZA OBRAZOVKY: rozsah grafu — 'live' (jadro + projekty + spomienky + aktívne skilly)
// alebo 'all' (celá sieť vrátane knižnice). Perzistuje 'hades.graphScope', default 'live'.
S.graphScope = localStorage.getItem('hades.graphScope') === 'all' ? 'all' : 'live';

// FÁZA OBRAZOVKY: balík uzlov na export do Claude Code — Map(id → label). Persist 'hades.pack'.
// Prvé miesto v appke, odkiaľ sa dá poznatok dostať von (POST /api/context/pack → schránka).
S.pack = new Map();
try {
    const p = JSON.parse(localStorage.getItem('hades.pack') || '[]');
    if (Array.isArray(p)) for (const it of p) { if (it && it.id != null) S.pack.set(+it.id, it.label || ('#' + it.id)); }
} catch (e) { /* poškodený balík — prázdny */ }

function persistPack() {
    localStorage.setItem('hades.pack', JSON.stringify([...S.pack].map(([id, label]) => ({ id, label }))));
}
function packHas(id) { return S.pack.has(+id); }
function togglePack(id, label) {
    id = +id;
    if (S.pack.has(id)) S.pack.delete(id); else S.pack.set(id, label || ('#' + id));
    persistPack();
    updatePackUi();
    return S.pack.has(id);
}
function addToPack(id, label) {
    id = +id;
    if (S.pack.has(id)) return false;
    S.pack.set(id, label || ('#' + id));
    persistPack();
    updatePackUi();
    return true;
}

// HTML pack-toggle tlačidla pre riadky zoznamov (Dnes / Denník / Knižnica).
// Konštantná ikona, aktívny stav farbí .in-pack (žiadny reflow pri prepnutí).
function packBtn(id, label) {
    const on = packHas(id);
    return '<button type="button" class="pack-btn ms' + (on ? ' in-pack' : '') + '"'
        + ' data-pack-id="' + esc(String(id)) + '" data-pack-label="' + esc(label || '') + '"'
        + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
        + ' title="' + (on ? 'V balíku — klikni pre odobratie' : 'Do balíka') + '">library_add</button>';
}

// Naviaž pack-toggle tlačidlá v podstrome (stopPropagation, aby klik neotvoril aj riadok).
function bindPackButtons(root) {
    root.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        b.onclick = (e) => {
            e.stopPropagation();
            e.preventDefault();
            const on = togglePack(b.dataset.packId, b.dataset.packLabel);
            showToast(on ? 'Pridané do balíka' : 'Odobraté z balíka');
        };
    });
}

// Zosúlaď celé pack UI so stavom S.pack — počet v hlavičke, všetky tlačidlá, detail, zásuvka.
function updatePackUi() {
    const n = S.pack.size;
    const trig = $('pack-trigger');
    if (trig) {
        trig.classList.toggle('hidden', n === 0);
        const c = $('pack-count');
        if (c) c.textContent = String(n);
    }
    document.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        const on = packHas(b.dataset.packId);
        b.classList.toggle('in-pack', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.title = on ? 'V balíku — klikni pre odobratie' : 'Do balíka';
    });
    const npk = $('node-pack');
    if (npk) {
        const on = S.selected ? packHas(S.selected.id) : false;
        npk.classList.toggle('in-pack', on);
        npk.setAttribute('aria-pressed', on ? 'true' : 'false');
        npk.title = on ? 'V balíku — klikni pre odobratie' : 'Do balíka';
    }
    if (packDrawerOpen()) renderPackList();
}

/* ---------- zásuvka balíka (export pre Claude Code) ---------- */

function packDrawerOpen() {
    const d = $('pack-drawer');
    return d ? !d.classList.contains('hidden') : false;
}
function openPackDrawer() { const d = $('pack-drawer'); if (d) { d.classList.remove('hidden'); renderPackList(); } }
function closePackDrawer() { const d = $('pack-drawer'); if (d) d.classList.add('hidden'); }

function renderPackList() {
    const list = $('pack-list');
    if (!list) return;
    if (!S.pack.size) { renderEmpty(list, 'inventory_2', 'Balík je prázdny'); return; }
    list.innerHTML = [...S.pack].map(([id, label]) =>
        '<div class="pack-row">'
        + '<span class="pack-row-label" title="' + esc(label) + '">' + esc(label) + '</span>'
        + '<button type="button" class="ghost ms pack-row-del" data-id="' + id
        + '" title="Odobrať" aria-label="Odobrať z balíka">close</button>'
        + '</div>'
    ).join('');
    list.querySelectorAll('.pack-row-del').forEach((b) => {
        b.onclick = () => { togglePack(b.dataset.id); };
    });
}

async function copyPack() {
    if (!S.pack.size) { showToast('Balík je prázdny'); return; }
    const ids = [...S.pack.keys()].slice(0, 50);
    try {
        const res = await fetch('/api/context/pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_ids: ids }),
        });
        if (!res.ok) { showToast('Kopírovanie zlyhalo'); return; }
        const data = await res.json();
        await navigator.clipboard.writeText(data.markdown || '');
        showToast('Skopírované pre Claude Code');
    } catch (e) {
        showToast('Kopírovanie zlyhalo');
    }
}

// Naviazanie všetkých pack ovládačov + prepínača rozsahu grafu. Volá sa raz z init().
function setupPack() {
    const trig = $('pack-trigger');
    if (trig) trig.onclick = openPackDrawer;
    const pc = $('pack-close');
    if (pc) pc.onclick = closePackDrawer;
    const copyBtn = $('pack-copy');
    if (copyBtn) copyBtn.onclick = () => busy(copyBtn, copyPack, 'Kopírujem…');
    const clearBtn = $('pack-clear');
    if (clearBtn) clearBtn.onclick = () => {
        S.pack.clear();
        persistPack();
        updatePackUi();
        showToast('Balík vyprázdnený');
    };

    // Detail uzla — Do balíka
    const npk = $('node-pack');
    if (npk) npk.onclick = () => {
        if (!S.selected) return;
        togglePack(S.selected.id, S.selected.label);
    };

    // Čítačka — Do balíka + Kopírovať cestu
    const mpk = $('md-pack');
    if (mpk) mpk.onclick = () => {
        if (mdNodeId == null) return;
        togglePack(mdNodeId, mdLabel);
        syncMdFoot();
    };
    const mcp = $('md-copypath');
    if (mcp) mcp.onclick = async () => {
        if (!mdPath) return;
        try { await navigator.clipboard.writeText(mdPath); showToast('Cesta skopírovaná'); }
        catch (e) { showToast('Kopírovanie zlyhalo'); }
    };

    // Prepínač rozsahu grafu — 'live' (default) vs 'all' (celá knižnica v grafe)
    const scopeBtn = $('scope-toggle');
    if (scopeBtn) {
        const sync = () => scopeBtn.setAttribute('aria-checked', S.graphScope === 'all' ? 'true' : 'false');
        sync();
        scopeBtn.onclick = () => {
            S.graphScope = S.graphScope === 'all' ? 'live' : 'all';
            localStorage.setItem('hades.graphScope', S.graphScope);
            sync();
            showToast(S.graphScope === 'all' ? 'Graf: celá knižnica' : 'Graf: len živé uzly');
            reloadGraph();
        };
    }

    updatePackUi();
}

function setOpt(key, value) {
    S.opts[key] = value;
    localStorage.setItem('hades.opts', JSON.stringify(S.opts));
    applyOpts();
    requestDraw(); // zmena nastavenia vzhľadu → prekresli (slučka mohla spať)
}

function syncSlider(inp) {
    const min = parseFloat(inp.min || 0);
    const max = parseFloat(inp.max || 100);
    const val = parseFloat(inp.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
    inp.style.setProperty('--pct', pct + '%');

    // číselný odpočet vedľa slidera — alfy ako percento, mierky ako násobok
    const wrap = inp.closest('label.slider');
    const out = wrap && wrap.querySelector('output');
    if (out) {
        const opt = inp.dataset.opt;
        const force = inp.dataset.force;
        if (force) {
            // sily: multiplikátory ako ×N.N, absolútne hodnoty (charge/distance) surové číslo
            out.textContent = (force === 'linkStrength' || force === 'gravity')
                ? '×' + val.toFixed(1)
                : String(Math.round(val));
        } else {
            out.textContent = (opt === 'nodeScale' || opt === 'labelSize')
                ? '×' + val.toFixed(2)
                : Math.round(val * 100) + ' %';
        }
    }
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

// Svetlejší/sytejší variant farby oblasti pre tmavý papier — hex→HSL→hex, cache
const _darkColorCache = new Map();
function darkAreaColor(hex) {
    const cached = _darkColorCache.get(hex);
    if (cached) return cached;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    const r = ((num >> 16) & 255) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    l = Math.max(l, 0.62);
    s = Math.min(s + 0.12, 0.9);
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0');
    const out = '#' + toHex(h + 1 / 3) + toHex(h) + toHex(h - 1 / 3);
    _darkColorCache.set(hex, out);
    return out;
}

// Farba = oblasť vo VŠETKÝCH náhľadoch; typ vyjadruje tvar (drawShape)
function nodeColor(n) {
    let hex;
    if (n.type === 'core') hex = CORE_COLOR;
    else {
        const area = S.areas.get(n.area_id);
        hex = area ? area.color : '#2f6d8f';
    }
    return T === THEMES.dark ? darkAreaColor(hex) : hex;
}

// Focus mód (priečinky): zaostrenie na oblasť / oddelenie
// Jediná cesta k zmene fokusu — synchronizuje breadcrumb, strom aj plátno.
function setFocus(areaId, departmentId) {
    S.focus = { areaId: areaId || null, departmentId: departmentId || null };
    renderBreadcrumb();
    markTreeActive();
    draw();
}

function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const area = S.focus.areaId ? S.areas.get(S.focus.areaId) : null;
    const dept = S.focus.departmentId ? S.departments.get(S.focus.departmentId) : null;

    if (!area) {
        bc.innerHTML = '<span class="crumb-idle">živé vedomie</span>';
        return;
    }

    let html = '<button type="button" class="crumb" data-bc="root">Hades</button><span class="sep">/</span>';
    if (dept) {
        html += '<button type="button" class="crumb" data-bc="area">' + esc(area.name) + '</button>'
            + '<span class="sep">/</span><span class="current">' + esc(dept.name) + '</span>';
    } else {
        html += '<span class="current">' + esc(area.name) + '</span>';
    }
    bc.innerHTML = html;

    bc.querySelectorAll('.crumb[data-bc]').forEach((b) => {
        b.onclick = () => setFocus(b.dataset.bc === 'area' ? area.id : null, null);
    });
}

function markTreeActive() {
    const tree = document.getElementById('structure-tree');
    if (!tree) return;
    tree.querySelectorAll('.tree-row').forEach((row) => {
        const aid = row.dataset.area ? +row.dataset.area : null;
        const did = row.dataset.dept ? +row.dataset.dept : null;
        const active = !!S.focus.areaId && aid === S.focus.areaId
            && (did ? did === S.focus.departmentId : !S.focus.departmentId);
        row.classList.toggle('active', active);
    });
}

function updateHeaderMetrics() {
    const el = document.getElementById('header-metrics');
    if (el) el.textContent = S.nodes.length + ' uzlov · ' + S.edges.length + ' spojení';
}

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

// Vrstvová cesta (len náhľad Vrstvy): 2-skokové rozšírenie okolo kotvy, ktoré sleduje
// tok VON cez vrstvy — vstup→skryté→jadro/výstup. Priame hrany kotvy + druhé hrany,
// ktoré sa od vrstvy kotvy vzďaľujú (napr. spomienka→skill→projekt). Slúži hlavnému
// účelu Vrstiev: vidieť, ako spomienka aktivuje skill a ten projekt. Cache na kotvu
// ako highlightSet; S._lpNodes = id uzlov na ceste (nech ostanú čitateľné, nie stlmené).
function layerPathSet(anchor) {
    if (!anchor || anchor._li == null) { S._lpFor = null; S._lpEdges = null; S._lpNodes = null; return null; }
    if (S._lpFor === anchor && S._lpEdges) return S._lpEdges;
    const a0 = anchor._li;
    const edges = new Set();
    const nodes = new Set([anchor.id]);
    // 1) priame hrany kotvy
    for (const e of S.edges) {
        if (e.source.id === anchor.id) { edges.add(e); nodes.add(e.target.id); }
        else if (e.target.id === anchor.id) { edges.add(e); nodes.add(e.source.id); }
    }
    // 2) druhý skok — pokračovanie toku VON od vrstvy kotvy (menej vizuálneho šumu než plné 2-hop).
    // hop1 zmrazí prvý okruh, aby sa cesta nerozliala do tretieho skoku počas pridávania.
    const hop1 = new Set(nodes);
    for (const e of S.edges) {
        const s = e.source, t = e.target;
        if (s._li == null || t._li == null) continue;
        let via = null, far = null;
        if (hop1.has(s.id) && s.id !== anchor.id && !hop1.has(t.id)) { via = s; far = t; }
        else if (hop1.has(t.id) && t.id !== anchor.id && !hop1.has(s.id)) { via = t; far = s; }
        if (!via) continue;
        if (Math.abs(far._li - a0) > Math.abs(via._li - a0)) { edges.add(e); nodes.add(far.id); }
    }
    S._lpFor = anchor;
    S._lpEdges = edges;
    S._lpNodes = nodes;
    return edges;
}

/* ---------- lokálny graf (Obsidian local graph) ---------- */

// BFS zo S.local.rootId po hĺbku — množina viditeľných uzlov, cache ako _hlSet
function localSet() {
    if (!S.local) return null;
    const key = S.local.rootId + ':' + S.local.depth + ':' + S.edges.length;
    if (S._localFor !== key) {
        const adj = new Map();
        const push = (a, b) => { const l = adj.get(a); if (l) l.push(b); else adj.set(a, [b]); };
        for (const e of S.edges) { push(e.source_id, e.target_id); push(e.target_id, e.source_id); }
        const set = new Set([S.local.rootId]);
        let frontier = [S.local.rootId];
        for (let d = 0; d < S.local.depth && frontier.length; d++) {
            const next = [];
            for (const id of frontier) {
                for (const m of (adj.get(id) || [])) {
                    if (!set.has(m)) { set.add(m); next.push(m); }
                }
            }
            frontier = next;
        }
        S._localFor = key;
        S._localSet = set;
    }
    return S._localSet;
}

function setLocal(rootId, depth) {
    if (!S.byId.has(rootId)) return;
    S.local = { rootId, depth: Math.min(3, Math.max(1, depth || 1)) };
    S._localFor = null;
    updateLocalChip();
    fitView();
}

function clearLocal() {
    if (!S.local) return;
    S.local = null;
    S._localFor = null;
    S._localSet = null;
    updateLocalChip();
    fitView();
}

// Plávajúci čip pod hlavičkou — indikátor režimu + prepínač hĺbky 1/2/3
let localChip = null;
function updateLocalChip() {
    if (!localChip) {
        localChip = document.createElement('div');
        localChip.id = 'local-chip';
        localChip.innerHTML = '<span class="lc-label"></span>'
            + '<span class="lc-depths">'
            + [1, 2, 3].map((d) =>
                '<button type="button" class="lc-depth" data-depth="' + d + '" aria-label="Hĺbka ' + d + '">' + d + '</button>'
            ).join('')
            + '</span>'
            + '<button type="button" class="lc-close" aria-label="Zavrieť lokálny graf">×</button>';
        document.body.appendChild(localChip);
        localChip.querySelectorAll('.lc-depth').forEach((b) => {
            b.onclick = () => { if (S.local) setLocal(S.local.rootId, +b.dataset.depth); };
        });
        localChip.querySelector('.lc-close').onclick = () => clearLocal();
    }
    if (!S.local) { localChip.classList.add('hidden'); return; }
    localChip.classList.remove('hidden');
    localChip.querySelector('.lc-label').textContent = 'Lokálny graf · hĺbka ' + S.local.depth;
    localChip.querySelectorAll('.lc-depth').forEach((b) =>
        b.classList.toggle('active', +b.dataset.depth === S.local.depth));
}

/* ---------- filtre siete (typy / zdroje / oblasti) ---------- */

function filterActive() {
    return S.filter.types.size > 0 || S.filter.sources.size > 0
        || S.filter.areas.size > 0 || S.filter.tags.size > 0;
}

// Zdrojový kôš uzla pre filter: session / skill (playbook) / digest+archive / ručné
function sourceBucket(n) {
    if (n.source === 'session') return 'session';
    if (n.source === 'skill') return 'skill';
    if (n.source === 'digest' || n.source === 'archive') return 'digest';
    if (!n.source) return 'manual';
    return null;
}

// Jadro sa nikdy nefiltruje; skryté typy/zdroje/oblasti uzol vyradia z kreslenia
function filterPass(n) {
    if (n.type === 'core') return true;
    if (S.filter.types.has(n.type)) return false;
    const b = sourceBucket(n);
    if (b && S.filter.sources.has(b)) return false;
    if (n.area_id && S.filter.areas.has(n.area_id)) return false;
    // pozitívny filter značiek: aktívny len keď je niečo vybrané; uzol musí niesť
    // aspoň jednu vybranú značku (uzly bez značiek pri aktívnom filtri vypadnú)
    if (S.filter.tags.size > 0) {
        const tags = n.tags;
        if (!Array.isArray(tags) || !tags.some((t) => S.filter.tags.has(t))) return false;
    }
    return true;
}

// Jediná brána viditeľnosti: aktívny lokálny graf vyhráva (BFS už množinu obmedzil)
function nodeVisible(n, loc) {
    if (loc) return loc.has(n.id);
    return filterPass(n);
}

function persistFilter() {
    localStorage.setItem('hades.filter', JSON.stringify({
        types: [...S.filter.types],
        sources: [...S.filter.sources],
        areas: [...S.filter.areas],
        tags: [...S.filter.tags],
    }));
}

/* ---------- sily (Obsidian forces) — efektívne predvolené podľa náhľadu ---------- */

function forceDefault(key) {
    const net = S.view === 'net';
    return {
        charge: net ? -120 : -42,
        linkDistance: net ? 95 : 72,
        linkStrength: 1,
        gravity: 1,
    }[key];
}

// Slidery síl ukazujú override, alebo efektívnu predvolenú hodnotu aktuálneho náhľadu
function syncForceSliders() {
    document.querySelectorAll('input[data-force]').forEach((inp) => {
        const k = inp.dataset.force;
        const v = S.forces[k] != null ? S.forces[k] : forceDefault(k);
        inp.value = v;
        syncSlider(inp);
    });
}

// pathNodes (voliteľné, len Vrstvy): uzly na vrstvovej ceste sa netlmia ako cudzie
function nodeAlphaMul(n, hl, pathNodes) {
    let mul = 1;
    if (hl && !hl.has(n.id) && !(pathNodes && pathNodes.has(n.id))) mul *= 0.18;
    if (!focusPass(n)) mul *= 0.15;
    // podlaha na SÚČINE (hover × focus) — tlmené uzly ostávajú čitateľné
    return Math.max(T.nodeFloor, mul);
}

// pathSet (voliteľné, len Vrstvy): hrany vrstvovej cesty sa berú ako priame (netlmené)
function edgeAlphaMul(e, hl, anchor, pathSet) {
    let mul = 1;
    const onPath = (anchor && (e.source.id === anchor.id || e.target.id === anchor.id))
        || (pathSet && pathSet.has(e));
    if (hl && !onPath) mul *= 0.18;
    if (!(focusPass(e.source) && focusPass(e.target))) mul *= 0.15;
    return Math.max(T.edgeFloor, mul);
}

// FÁZA HRANY: kategória hrany — relation má prednosť pred kind.
// manual + skill_mention (bez relation) = štruktúra → 'core' (vždy viditeľné, kostra).
function edgeCategory(e) {
    if (e.relation === 'part_of') return 'part_of';
    if (e.relation === 'uses') return 'uses';
    if (e.kind === 'co_activation') return 'co_activation';
    if (e.kind === 'similarity') return 'similarity';
    return 'core';
}

// FÁZA HRANY: skrytá hrana? Filter kategórií vzťahov + režim kostry (len 'core' + 'part_of').
function edgeCategoryHidden(e) {
    const cat = edgeCategory(e);
    if (S.filter.relations.has(cat)) return true;
    if (S.skeleton && cat !== 'core' && cat !== 'part_of') return true;
    return false;
}

// FÁZA DE-CLUTTER: kostrová hrana? V pokoji sa kreslí len kostra — štruktúra (manual +
// skill_mention = 'core'), part_of a hrany posilnené opakovaním (váha > 1). Slabé auto
// spojenia (uses / co_activation / similarity s váhou 1 = 82 % hairballu) sa v pozadí skryjú;
// vynoria sa až ako incidentné hrany uzla pod kurzorom (fg vetva v drawEdges).
function edgeSkeletal(e) {
    const cat = edgeCategory(e);
    if (cat === 'core' || cat === 'part_of') return true;
    return (e.weight || 1) > 1;
}

// FÁZA RENDER PIPELINE: jednotný štýl čiar — max 2 vzory (plná / jemná bodkovaná).
// Zdieľaný prázdny dash, aby setLineDash([]) neaozeroval nové pole pri každom volaní.
const EMPTY_DASH = [];
// dashed = vzťah 'uses' alebo kind co_activation / similarity; part_of a štruktúra sú plné.
function edgeDashed(e) {
    if (e.relation === 'part_of') return false;
    if (e.relation === 'uses') return true;
    return e.kind === 'co_activation' || e.kind === 'similarity';
}
// Útlm podľa druhu hrany (automatický šum je tlmenejší) — dash rieši edgeDashed, farba je vždy T.edge.
// Zjednotené s pôvodným applyEdgeKind: co_activation ×0.6, similarity ~×0.4 (pôvodne 0.8 mul × 0.5 dim).
function edgeKindDim(e) {
    if (e.relation === 'part_of' || e.relation === 'uses') return 1;
    if (e.kind === 'co_activation') return 0.6;
    if (e.kind === 'similarity') return 0.4;
    return 1;
}

// Geometria hrany zapísaná do cesty p (Path2D pri dávke, alebo ctx pri jednotlivom kreslení).
// Mapa/sieť = priamka; Vrstvy = oblúky (vnútrovrstvové von od osi, ≥2 vrstvy sa vyhnú stredu).
function traceEdge(p, e, layersView) {
    p.moveTo(e.source.x, e.source.y);
    if (!layersView) { p.lineTo(e.target.x, e.target.y); return; }
    const sameLayer = e.source._li != null && e.source._li === e.target._li;
    const span = (e.source._li != null && e.target._li != null)
        ? Math.abs(e.source._li - e.target._li) : 0;
    if (sameLayer) {
        const axis = LAYER_X[e.source._li];
        const dir = axis >= 0 ? 1 : -1;
        const reach = 44 + Math.abs((e.source.fx || 0) - (e.target.fx || 0)) * 0.5;
        p.quadraticCurveTo(axis + dir * reach, (e.source.y + e.target.y) / 2, e.target.x, e.target.y);
    } else if (span >= 2) {
        const midX = (e.source.x + e.target.x) / 2;
        const midY = (e.source.y + e.target.y) / 2;
        const bow = (midY >= 0 ? 1 : -1) * Math.min(70, span * 22);
        p.quadraticCurveTo(midX, midY + bow, e.target.x, e.target.y);
    } else {
        p.lineTo(e.target.x, e.target.y);
    }
}

// FÁZA RENDER PIPELINE: dávkové kreslenie hrán. Pozadie sa zoskupí do vedierok podľa
// (dashed × kvantovaná alfa) a nakreslí jedným Path2D + jedným stroke na vedierko — namiesto
// beginPath+stroke na každú hranu a setLineDash raz na hranu. Zvýraznené hrany (incidentné
// s kotvou / na vrstvovej ceste) sa kreslia jednotlivo navrchu s presnou alfou a šírkou.
function drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, layersView, edgeInView) {
    const invK = 1 / S.cam.k;
    const dash = [1.5 * invK, 3 * invK];
    const bgWidth = 0.7 * invK; // reprezentatívna šírka pozadia (väčšina váh = 1)
    const buckets = new Map();
    const fg = [];
    // FÁZA DE-CLUTTER: v lokálnom grafe ukáž celé okolie; inak v pozadí len kostru.
    const showAllBg = !!loc;

    for (const e of S.edges) {
        if ((e.weight || 1) < S.minWeight) continue;      // A7: filter slabých spojení
        if (edgeCategoryHidden(e)) continue;               // FÁZA HRANY: filter vzťahov + kostra
        if (!visibleInReplay(e.source) || !visibleInReplay(e.target)) continue;
        if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
        if (!edgeInView(e.source, e.target)) continue;     // viewport culling

        const dashed = edgeDashed(e);
        let alpha = Math.min(0.5, 0.22 + 0.08 * Math.log2(1 + (e.weight || 1))) * S.opts.edgeAlpha;
        alpha = Math.max(0.12, alpha) * edgeAlphaMul(e, hl, hlAnchor, pathEdges) * EDGE_DIM * edgeKindDim(e);

        const onPath = !!(pathEdges && pathEdges.has(e));
        const incident = !!(hlAnchor && (e.source.id === hlAnchor.id || e.target.id === hlAnchor.id));

        if (onPath || incident) {
            // popredie: zvýraznené hrany kotvy/cesty, presná alfa aj šírka podľa váhy
            const fa = onPath ? Math.min(0.85, alpha * 2.2) : Math.min(0.75, alpha * 1.25);
            const fw = (onPath ? Math.min(2.1, 0.7 + 0.3 * Math.log2(1 + (e.weight || 1)))
                : Math.min(1.6, 0.45 + 0.25 * Math.log2(1 + (e.weight || 1)))) * invK;
            fg.push({ e, alpha: fa, width: fw, dashed, onPath });
            continue;
        }

        // FÁZA DE-CLUTTER: pozadie = len kostra (skryj hairball s váhou 1). Incidentné hrany
        // kotvy sem nedôjdu (skončili v fg vyššie), takže hover uzol stále ukáže VŠETKY svoje hrany.
        if (!showAllBg && !edgeSkeletal(e)) continue;
        if (softHoverActive) alpha *= 0.5; // v pokoji jemné — no kostra ostáva čitateľná (hairball je už skrytý)
        if (alpha < 0.03) continue;         // neviditeľné pozadie preskoč
        const q = Math.max(1, Math.round(alpha / 0.05)); // kvantuj alfu → málo vedierok
        const key = (dashed ? 1000 : 0) + q;
        let b = buckets.get(key);
        if (!b) { b = { dashed, alpha: q * 0.05, path: new Path2D() }; buckets.set(key, b); }
        traceEdge(b.path, e, layersView);
    }

    // pozadie po vedierkach — setLineDash a stroke max raz na vedierko
    ctx.lineWidth = bgWidth;
    for (const b of buckets.values()) {
        ctx.setLineDash(b.dashed ? dash : EMPTY_DASH);
        ctx.strokeStyle = 'rgb(' + T.edge + ')';
        ctx.globalAlpha = b.alpha;
        ctx.stroke(b.path);
    }
    ctx.globalAlpha = 1;

    // popredie navrchu — jednotlivo (počet ≈ stupeň kotvy, málo hrán)
    for (const f of fg) {
        ctx.setLineDash(f.dashed ? dash : EMPTY_DASH);
        ctx.lineWidth = f.width;
        ctx.strokeStyle = (f.onPath ? 'rgba(' + T.accent + ',' : 'rgba(' + T.edge + ',') + f.alpha + ')';
        ctx.beginPath();
        traceEdge(ctx, f.e, layersView);
        ctx.stroke();
    }
    ctx.setLineDash(EMPTY_DASH);
    ctx.globalAlpha = 1;
}

const LAYER_X = [-560, -280, 0, 280, 560];
const LAYER_META = [
    { title: 'Vstup', sub: 'Spomienky' },
    { title: 'Skrytá', sub: 'Skills → spomienky' },
    { title: 'Jadro', sub: 'Osobnosť' },
    { title: 'Skrytá', sub: 'Skills → projekty' },
    { title: 'Výstup', sub: 'Projekty' },
];

// Zaradenie uzla do stĺpca vrstvy. Prednosť má explicitné layer_role (ak backend
// pole doplní), inak fallback na type. Skills (99) sa ešte rozdelia podľa náklonu,
// neznámy typ (-1) padá do jadra. Graceful — žiadny uzol vo Vrstvách nezmizne.
function layerIndexOf(n) {
    switch (n.layer_role) {
        case 'input': return 0;
        case 'hidden_in': return 1;
        case 'core': return 2;
        case 'hidden_out': return 3;
        case 'output': return 4;
    }
    if (n.type === 'memory') return 0;
    if (n.type === 'core') return 2;
    if (n.type === 'project') return 4;
    if (n.type === 'skill') return 99; // rozdelí sa podľa náklonu väzieb
    return -1;                         // neznámy typ → jadro (fallback)
}

function areaKey(n) { return n.area_id == null ? -1 : n.area_id; }

// Počiatočné poradie v stĺpci: podľa oblasti (súvislé farebné pásy), potom label, id.
function cmpInitial(a, b) {
    const ka = areaKey(a), kb = areaKey(b);
    if (ka !== kb) return ka - kb;
    const la = (a.label || '').toLowerCase(), lb = (b.label || '').toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a.id - b.id;
}

// Deterministický layout stĺpcov Vrstvy s barycentrovým usporiadaním (menej kríženia)
// a zoskupením podľa oblasti. Výsledok sa cachuje (S._layerCache), prepočet len pri
// štrukturálnej zmene grafu (invalidácia v buildSim).
function computeLayerColumns() {
    // plná susednosť z reálnych hrán (objekty uzlov)
    const nbr = new Map();
    for (const n of S.nodes) nbr.set(n.id, []);
    for (const e of S.edges) {
        const s = e.source, t = e.target;
        if (!s || !t || !nbr.has(s.id) || !nbr.has(t.id)) continue;
        nbr.get(s.id).push(t);
        nbr.get(t.id).push(s);
    }

    // 1) priradenie stĺpca — skills podľa náklonu (spomienky = ľavá skrytá, jadro/projekty = pravá)
    const cols = [[], [], [], [], []];
    const colOf = new Map();
    for (const n of S.nodes) {
        let li = layerIndexOf(n);
        if (li === 99) {
            let left = 0, right = 0;
            for (const m of nbr.get(n.id)) {
                if (m.type === 'memory') left++;
                else if (m.type === 'core' || m.type === 'project') right++;
            }
            li = right > left ? 3 : (left > right ? 1 : (n.id % 2 ? 3 : 1));
        } else if (li < 0) {
            li = 2;
        }
        cols[li].push(n);
        colOf.set(n.id, li);
    }

    // 2) počiatočné poradie podľa oblasti
    const pos = new Map();
    for (const arr of cols) {
        arr.sort(cmpInitial);
        arr.forEach((n, i) => pos.set(n.id, i));
    }

    // 3) barycentrové sweepy (tam a späť) — poradie podľa mediánu susedov v susedných
    //    stĺpcoch; oblasť drží súvislé pásy, barycentrum triedi vnútri pásu aj poradie pásov
    for (let iter = 0; iter < 4; iter++) {
        const forward = iter % 2 === 0;
        for (let s = 0; s < cols.length; s++) {
            const li = forward ? s : cols.length - 1 - s;
            const arr = cols[li];
            if (arr.length < 2) continue;
            const bary = new Map();
            for (const n of arr) {
                let sum = 0, cnt = 0;
                for (const m of nbr.get(n.id)) {
                    if (colOf.get(m.id) === li) continue; // vnútrostĺpcové hrany nekrížia
                    sum += pos.get(m.id); cnt++;
                }
                bary.set(n.id, cnt ? sum / cnt : pos.get(n.id));
            }
            // poradie oblastí podľa ich priemerného barycentra (pásy zostanú súvislé)
            const aSum = new Map(), aCnt = new Map();
            for (const n of arr) {
                const k = areaKey(n);
                aSum.set(k, (aSum.get(k) || 0) + bary.get(n.id));
                aCnt.set(k, (aCnt.get(k) || 0) + 1);
            }
            const aRank = new Map();
            [...aSum.keys()]
                .sort((x, y) => (aSum.get(x) / aCnt.get(x)) - (aSum.get(y) / aCnt.get(y)) || x - y)
                .forEach((k, i) => aRank.set(k, i));
            arr.sort((a, b) => {
                const ra = aRank.get(areaKey(a)), rb = aRank.get(areaKey(b));
                if (ra !== rb) return ra - rb;
                const da = bary.get(a.id), db = bary.get(b.id);
                if (da !== db) return da - db;
                return a.id - b.id;
            });
            arr.forEach((n, i) => pos.set(n.id, i));
        }
    }

    return cols;
}

// Rozdelenie veľkej vrstvy do sub-stĺpcov: dlhý stĺpec (napr. ~70 skills) je inak
// ~3300 px vysoký a fitView kvôli nemu stlačí zoom pod prah labelov. Sub-stĺpce
// znížia výšku a udržia zoom v čitateľnom pásme. Max 3 sub-stĺpce vedľa LAYER_X.
const SUB_SPLIT_AT = 22; // stĺpec dlhší ako toto sa rozloží
const SUB_MAX = 4;       // najviac sub-stĺpcov na vrstvu (drží výšku pod prahom labelov)
const SUB_OFFSET = 62;   // vodorovný rozostup sub-stĺpcov (svetové jednotky)

// Plná geometria Vrstiev — poradie stĺpcov (barycentrum) + konkrétne pozície uzlov
// vrátane sub-stĺpcov, vodiace línie, farebné pásy oblastí a bbox pre fitView.
// Jediný zdroj pravdy: applyViewPins, drawLayerBands, drawLayerScaffold aj fitView
// čítajú z tohto výsledku, takže pin, pás aj rám vždy sedia. Cache invaliduje buildSim.
function layerLayout() {
    const sig = S.nodes.length + '|' + S.edges.length;
    if (S._layerCache && S._layerCache.sig === sig) return S._layerCache;
    const cols = computeLayerColumns();
    const posOf = new Map();
    const guides = [];
    const bands = [];
    let maxHalf = 0, minX = Infinity, maxX = -Infinity;

    for (let li = 0; li < cols.length; li++) {
        const arr = cols[li];
        const len = arr.length;
        if (!len) continue;
        const subCount = Math.min(SUB_MAX, Math.max(1, Math.ceil(len / SUB_SPLIT_AT)));
        const perSub = Math.ceil(len / subCount);
        // rozostup podľa najväčšieho sub-stĺpca — uzly sa neprekrývajú, výška ostane rozumná
        const spacing = Math.max(48, Math.min(95, 1100 / Math.max(perSub, 1)));

        for (let s = 0; s < subCount; s++) {
            const start = s * perSub;
            const end = Math.min(len, start + perSub);
            const subLen = end - start;
            if (subLen <= 0) continue;
            const x = LAYER_X[li] + (s - (subCount - 1) / 2) * SUB_OFFSET;
            const half = (subLen - 1) / 2 * spacing;
            if (half > maxHalf) maxHalf = half;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            guides.push({ x, half });

            // pozície uzlov (column-major → zachová barycentrové zvislé poradie)
            for (let k = start; k < end; k++) {
                const y = (k - start - (subLen - 1) / 2) * spacing;
                posOf.set(arr[k].id, { x, y, li });
            }

            // farebné pásy súvislých blokov rovnakej oblasti v tomto sub-stĺpci
            let i = start;
            while (i < end) {
                const aid = arr[i].area_id;
                let j = i;
                while (j + 1 < end && arr[j + 1].area_id === aid) j++;
                const area = aid != null ? S.areas.get(aid) : null;
                if (area && area.color && arr[i].type !== 'core') {
                    const y0 = (i - start - (subLen - 1) / 2) * spacing;
                    const y1 = (j - start - (subLen - 1) / 2) * spacing;
                    bands.push({ x, y0, y1, color: area.color, single: j === i, spacing });
                }
                i = j + 1;
            }
        }
    }

    if (minX === Infinity) { minX = LAYER_X[0]; maxX = LAYER_X[LAYER_X.length - 1]; }
    const layout = { sig, cols, posOf, guides, bands, maxHalf, minX, maxX };
    S._layerCache = layout;
    return layout;
}

function softRect(x, y, w, h, r) {
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); }
    else ctx.fillRect(x, y, w, h);
}

// Pozadie Vrstiev: vodiace línie sub-stĺpcov + jemné farebné pásy oblastí za uzlami.
// Kreslí sa PRED hranami, nech pásy neprekrývajú spojenia. Číta hotovú geometriu
// z layerLayout (guides/bands v svetových jednotkách), takže pás sedí presne za blokom.
function drawLayerBands(lay) {
    const invK = 1 / S.cam.k;

    // vodiace vertikálne línie sub-stĺpcov (jemná Aura ink)
    ctx.globalAlpha = 0.5 * S.dim;
    ctx.strokeStyle = 'rgba(' + T.edge + ',0.06)';
    ctx.lineWidth = 1 * invK;
    for (const g of lay.guides) {
        ctx.beginPath();
        ctx.moveTo(g.x, -g.half - 26 * invK);
        ctx.lineTo(g.x, g.half + 26 * invK);
        ctx.stroke();
    }

    // farebné pásy súvislých blokov rovnakej oblasti (jadro bez pásu)
    const bandW = 34 * invK;
    for (const b of lay.bands) {
        const pad = b.spacing * 0.42;
        ctx.globalAlpha = 0.07 * S.dim;
        ctx.fillStyle = b.color;
        softRect(b.x - bandW / 2, b.y0 - pad - (b.single ? 2 * invK : 0),
            bandW, (b.y1 - b.y0) + pad * 2 + (b.single ? 4 * invK : 0), 9 * invK);
    }
    ctx.globalAlpha = 1;
}

function drawLayerScaffold(lay) {
    const headerY = -lay.maxHalf - 66;
    const invK = 1 / S.cam.k;

    ctx.textAlign = 'center';
    for (let i = 0; i < LAYER_X.length; i++) {
        const count = lay.cols[i] ? lay.cols[i].length : 0;
        ctx.globalAlpha = 0.6 * S.dim;
        ctx.fillStyle = T.inkSoft;
        ctx.font = '600 ' + (12.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].title.toUpperCase() + ' · ' + count, LAYER_X[i], headerY);

        ctx.globalAlpha = 0.5 * S.dim;
        ctx.fillStyle = T.muted;
        ctx.font = (10.5 * invK) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.fillText(LAYER_META[i].sub, LAYER_X[i], headerY + 18 * invK);
    }
    ctx.globalAlpha = 1;
}

function nodeRadius(n) {
    let base;
    if (n.type === 'core') {
        base = n.label === S.name ? 24 : 14;
    } else {
        // FÁZA DE-CLUTTER: veľkosť = stupeň uzla (počet spojení), nie mŕtva strength.
        // Striezla škála: huby mierne väčšie, okrajové malé. S.degree sa počíta v buildSim.
        const deg = S.degree.get(n.id) || 0;
        base = Math.min(15, 5.5 + 2.4 * Math.log2(1 + deg));
    }
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

function neighborsOf(node) {
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
function animLevel() {
    if (REDUCED_MOTION) return 0;
    const base = S.opts && S.opts.anim != null ? S.opts.anim : 0.5;
    if (base <= 0) return 0;
    return base * (document.body.classList.contains('ambient') ? 1.6 : 1);
}

// FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie / drift / synapsie / gravitácia).
// REDUCED_MOTION → 0 (žiadny ambient, len event pulzy). Ambient režim vždy žije (floor 0.6) a zosilní
// ×1.8. Slider 'Život' (0..1) je nezávislý od 'Animácie' a na 0 vráti dirty-only pokoj.
function lifeLevel() {
    if (REDUCED_MOTION) return 0;
    let base = S.opts && S.opts.life != null ? S.opts.life : 0.5;
    const amb = document.body.classList.contains('ambient');
    if (amb) base = Math.max(base, 0.6); // ambient režim ožije aj so stiahnutým Životom
    if (base <= 0) return 0;
    return base * (amb ? 1.8 : 1);
}

// Auto-strop: tier z EMA nákladu draw() (S._drawMs). Plynulé, EMA tlmí flikanie na hranici.
// 0 = plný ambient, 1 = redukovaný (drift von, dýcha len jadro, menej synapsií), 2 = len event-driven.
function lifeTier() {
    const ms = S._drawMs;
    if (ms > 33) return 2; // ~<30 FPS ekvivalent renderu → vypni ambient
    if (ms > 22) return 1; // ~<45 FPS → redukuj
    return 0;
}

// Ease-out (cubic) — zrod uzla; ease-in-out — morph náhľadov.
const easeOut = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
const easeInOut = (p) => { p = Math.max(0, Math.min(1, p)); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };

// Strop súbežných tokov (klesá s anim=0). FÁZA DE-CLUTTER: bez FPS auto-stropu — po
// optimalizácii pipeline netreba throttlovať, slučka aj tak v pokoji spí.
function flowCap() {
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
function maybeSynapse() {
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
function emitFlows(node, opts = {}) {
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
function birthScale(n) {
    if (n._born == null || S._anim <= 0 || REDUCED_MOTION) return 1;
    const age = S._clock - n._born;
    if (age >= 0.5) return 1; // prstenec (do 0.6 s) dobehne a _born vyčistí až sám
    return easeOut(age / 0.5);
}

// FÁZA ANIMÁCIE (Living): idle dýchanie — jemná sínusová modulácia polomeru viditeľných uzlov
// (~±2–3 %, jadro výraznejšie ±5 %), fázovo rozhodené podľa id, pomalé (5–8 s). Škáluje Život.
// Auto-strop tier 1: dýcha len jadro. Zamrzne pri drag/pan, pri oddialení (k<0.5) a keď Život=0.
// Konkrétny uzol pod kurzorom nedýcha (hover ho drží pevný pre presné čítanie).
function breatheFactor(n) {
    if (S._life <= 0 || S._interacting || S.cam.k < 0.5) return 1;
    const core = n.type === 'core';
    if (!core && (S._lifeTier >= 1 || n === S.hover)) return 1;
    if (core && n === S.hover) return 1;
    const life = Math.min(1.4, S._life);
    const amp = (core ? 0.05 : 0.025) * life;               // jadro dýcha výraznejšie
    const period = core ? 5.5 : 6 + (n.id % 5) * 0.5;       // 6–8 s podľa id
    return 1 + amp * Math.sin(S._clock * (2 * Math.PI / period) + n.id * 1.3);
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
    const h = S.nodes.find((n) => n.type === 'core' && n.label === S.name);
    if (h) { h.fx = 0; h.fy = 0; }
}

function buildSim() {
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

function setView(view) {
    const prev = S.view;
    // FÁZA ANIMÁCIE (Q12): morph len pri skutočnej zmene náhľadu; prvé načítanie a REDUCED_MOTION/anim=0 skáču
    const animate = prev !== view && S.nodes.length > 0 && !REDUCED_MOTION && animLevel() > 0;
    const from = animate ? new Map(S.nodes.map(n => [n.id, { x: n.x, y: n.y }])) : null;

    S.view = view;
    localStorage.setItem('hades.view', view);
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.classList.toggle('active', b.dataset.view === view);
    });
    buildSim();
    kickSim(0.6);
    // mapa/sieť: pár tikov, nech bbox sedí na usadených pozíciách; vrstvy sú deterministické (fx/fy)
    if (S.sim && view !== 'layers') S.sim.tick(30);
    syncForceSliders(); // efektívne predvolené sily sa menia s náhľadom

    if (!animate) { fitView(); return; }

    // cieľové pozície: layers sú pripnuté (fx/fy) a neťikajú sa, mapa/sieť sú usadené v n.x/n.y
    const to = new Map(S.nodes.map(n => [n.id, {
        x: n.fx != null ? n.fx : n.x,
        y: n.fy != null ? n.fy : n.y,
    }]));
    // dočasne posaď uzly na cieľ, nech fitView zaráta kameru na cieľový layout
    for (const n of S.nodes) { const b = to.get(n.id); if (b) { n.x = b.x; n.y = b.y; } }
    fitView(); // zaráta kameru na cieľ (a raz vykreslí cieľové pozície)
    S.sim.stop(); // počas morphu nesmie sim prepisovať pozície
    for (const n of S.nodes) { const f = from.get(n.id); if (f) { n.x = f.x; n.y = f.y; } }
    S._morph = { from, to, t: 0, dur: 0.6 };
    draw(); // prekresli na štartové pozície, nech nebliká cieľ pred prvým rAF framom
}

function kickSim(alpha = 0.35) {
    // FÁZA RENDER PIPELINE: sim sa teraz usadí a zastaví (alphaTarget 0), preto ho treba
    // reštartovať (.restart()). Vo Vrstvách je sim vždy zastavený (pevné fx/fy) — len prekresli.
    if (S.view === 'layers') { requestDraw(); return; }
    if (S.sim) S.sim.alpha(Math.max(S.sim.alpha(), alpha)).restart();
    requestDraw();
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
    // FÁZA RENDER PIPELINE: epsilon-snap útlmu — nech sa stav označí za ustálený a slučka usne
    if (Math.abs(targetDim - S.dim) < 0.001) S.dim = targetDim;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    // FÁZA RENDER PIPELINE: viewport culling — svetové hranice viditeľnej plochy + okraj.
    // Uzly, hrany aj popisky mimo tohto rámca sa vôbec nekreslia. Okraj pokryje polomer + popisky.
    const _vTL = screenToWorld(0, 0);
    const _vBR = screenToWorld(S.w, S.h);
    const VM = 140 / S.cam.k;
    const vpX0 = _vTL.x - VM, vpY0 = _vTL.y - VM, vpX1 = _vBR.x + VM, vpY1 = _vBR.y + VM;
    const inView = (x, y) => x >= vpX0 && x <= vpX1 && y >= vpY0 && y <= vpY1;
    // hrana v zábere? bbox koncov pretína viewport (nezahodí hranu prechádzajúcu cez plochu)
    const edgeInView = (a, b) => !(Math.max(a.x, b.x) < vpX0 || Math.min(a.x, b.x) > vpX1
        || Math.max(a.y, b.y) < vpY0 || Math.min(a.y, b.y) > vpY1);
    // FÁZA ANIMÁCIE (Living): zapamätaj svetové hranice viewportu pre cielenie spontánnych synapsií.
    S._vp = { x0: vpX0, y0: vpY0, x1: vpX1, y1: vpY1 };
    // kurzor v svetových súradniciach (raz za frame) — podklad pre gravitáciu/parallax uzlov
    const cursorWorld = (S._life > 0 && S.cursor.a > 0.01) ? screenToWorld(S.cursor.sx, S.cursor.sy) : null;

    const hl = highlightSet();
    const hlAnchor = S.hover || S.selected;
    // lokálny graf: členovia BFS množiny sa kreslia, ostatné sa úplne preskočia
    const loc = localSet();

    const layersView = S.view === 'layers';
    // vrstvová cesta cez layery (2-skoky VON) — len v náhľade Vrstvy; inde null (staré správanie)
    const pathEdges = layersView ? layerPathSet(hlAnchor) : null;
    const pathNodes = layersView ? S._lpNodes : null;
    // FÁZA HRANY: soft-hover — v pokoji (žiadny hover/fokus/local) sú hrany extra jemné (×0.35),
    // spojenia sa vynoria až keď je uzol pod kurzorom / vo fokuse.
    const softHoverActive = S.opts.edgeSoftHover && !hlAnchor && !S.focus.areaId && !loc;
    const bgLevel = layersView ? 0 : S.opts.bg;
    if (bgLevel > 0.01) {
        const invK = 1 / S.cam.k;

        // jemna technicka mriezka (world-space, hyba sa so sietou) — jedine pozadie
        // rozsah z viditelneho viewportu, start zarovnany na nasobok kroku
        const _step = 240;
        const _tl = screenToWorld(0, 0);
        const _br = screenToWorld(S.w, S.h);
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + T.gridColor + ',' + (T.gridAlpha * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = Math.floor(_tl.x / _step) * _step; gx <= _br.x; gx += _step) { ctx.moveTo(gx, _tl.y); ctx.lineTo(gx, _br.y); }
        for (let gy = Math.floor(_tl.y / _step) * _step; gy <= _br.y; gy += _step) { ctx.moveTo(_tl.x, gy); ctx.lineTo(_br.x, gy); }
        ctx.stroke();
    }

    if (S.view === 'map') {
        // bbox uzlov kazdej oblasti — label centrovany nad vrcholom klastra
        const areaBox = new Map();
        for (const n of S.nodes) {
            if (n.type === 'core' || !n.area_id || !visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            const b = areaBox.get(n.area_id);
            if (!b) areaBox.set(n.area_id, { minX: n.x, maxX: n.x, minY: n.y });
            else {
                if (n.x < b.minX) b.minX = n.x;
                if (n.x > b.maxX) b.maxX = n.x;
                if (n.y < b.minY) b.minY = n.y;
            }
        }
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = T.muted;
        ctx.font = '600 ' + (12.5 / S.cam.k) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        for (const area of S.areas.values()) {
            const b = areaBox.get(area.id);
            if (!loc && S.filter.areas.has(area.id)) continue; // skrytá oblasť — bez captionu
            if (!b && (loc || filterActive())) continue; // žiadne viditeľné uzly — bez labelu
            const a = areaAnchor(area);
            ctx.fillText(area.name.toUpperCase(), b ? (b.minX + b.maxX) / 2 : a.x, (b ? b.minY : a.y) - 36);
        }
        ctx.globalAlpha = 1;
    }

    if (layersView) {
        // (1) pozadie: vodiace línie sub-stĺpcov + farebné pásy oblastí (nahradilo O(n²) mriežku)
        const lay = layerLayout();
        drawLayerBands(lay);
        // (2) skutočné spojenia zo S.edges — dávkovo (rovnaké váhové štýlovanie ako mapa/sieť)
        drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, true, edgeInView);
        drawLayerScaffold(lay);
    } else {
        drawEdges(loc, hl, hlAnchor, null, softHoverActive, false, edgeInView);
    }

    ctx.globalCompositeOperation = 'source-over';

    for (const p of S.pulses) {
        if (!(nodeVisible(p.from, loc) && nodeVisible(p.to, loc))) continue;
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // FÁZA ANIMÁCIE: putujúce svetlobody po hranách (Q10) — malý bod, fade na koncoch.
    // Kreslené priamočiaro (aj v layers), jemné; alfa nesie anim intenzitu.
    const _flowI = Math.max(S._anim, S._life); // toky nesie buď udalostná animácia, alebo ambientný život
    if (_flowI > 0 && S._flows.length) {
        const fr = 3 / S.cam.k;
        for (const f of S._flows) {
            if (f.wait > 0) continue;
            if (!(nodeVisible(f.from, loc) && nodeVisible(f.to, loc))) continue;
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

    ctx.globalCompositeOperation = 'source-over';
    // FÁZA RENDER PIPELINE: pri oddialení (k<0.5) sú uzly jednoduché plné disky — bez ink obrysu,
    // heat/zrod prstenca a bez donut diery/prstenca v drawShape (detail je aj tak neviditeľný).
    const simpleNodes = S.cam.k < 0.5;
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        if (!inView(n.x, n.y)) continue; // viewport culling
        let r = layersView ? Math.max(6, nodeRadius(n)) * 0.9 : nodeRadius(n);
        if (S.hover === n) r *= 1.15; // hover zväčšenie (Obsidian)
        r *= breatheFactor(n) * birthScale(n); // FÁZA ANIMÁCIE: idle dýchanie + zrod uzla
        // FÁZA ANIMÁCIE: jemný pop pri dobehnutí pulzu/toku (v mape/sieti; layers rieši flash vlastnou alfou)
        if (!layersView && n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
        const color = nodeColor(n);
        const flash = layersView ? (n.flash || 0) : 0;
        const mul = nodeAlphaMul(n, hl, pathNodes);

        // FÁZA ANIMÁCIE (Living): vizuálny offset — drift („sieť pláva") + kurzorová gravitácia/parallax.
        // Len pri kreslení; pick()/hover čítajú n.x/n.y, takže presnosť výberu ostáva nedotknutá.
        // Pinned Vrstvy sa neposúvajú (deterministický layout). n._ox/_oy číta aj slučka popiskov.
        let ox = 0, oy = 0, gGlow = 0;
        if (S._life > 0 && !simpleNodes && !layersView) {
            const lf = Math.min(1.4, S._life);
            if (S._lifeTier === 0 && n.type !== 'core') {
                ox += Math.sin(S._clock * 0.6 + n.id * 1.7) * lf;   // ±~1 px mikro-drift (nekumulatívny)
                oy += Math.cos(S._clock * 0.5 + n.id * 2.3) * lf;
            }
            if (cursorWorld && S._lifeTier <= 1) {
                const dx = cursorWorld.x - n.x, dy = cursorWorld.y - n.y;
                const dd = Math.hypot(dx, dy);
                const R = 140 / S.cam.k;
                if (dd < R && dd > 0.001) {
                    const ff = 1 - dd / R;
                    const pull = ff * ff * (6 / S.cam.k) * S.cursor.a * (S._lifeTier === 1 ? 0.5 : 1);
                    ox += (dx / dd) * pull; oy += (dy / dd) * pull; // max ~6 px prihnutie ku kurzoru
                    gGlow = ff * S.cursor.a;                        // blízkosť kurzora uzol mierne rozsvieti
                }
            }
        }
        n._ox = ox; n._oy = oy;
        const px = n.x + ox, py = n.y + oy;

        // FÁZA DE-CLUTTER: bez teplotnej modulácie výplne (heat je konštanta 1, nenesie info).
        // Plná alfa, tlmí sa len highlight/focus násobičom; vo Vrstvách flash pridá jas.
        ctx.globalAlpha = Math.min(1, (layersView ? 0.9 + flash * 0.5 : 1)) * mul;
        drawShape(n, px, py, r, color, simpleNodes);

        if (simpleNodes) { if (n.flash) n.flash = Math.max(0, n.flash - 0.02); continue; } // lacný disk, žiadne prstence

        // FÁZA ANIMÁCIE (Living): ŽIARA — nedávno aktívne uzly (flash) jemne pulzujú teal, uzol pri
        // kurzore sa prisvieti. Beží aj pri REDUCED_MOTION (flash je statický event pulz, gGlow=0).
        const glowA = Math.max((n.flash || 0) * (0.55 + 0.45 * Math.sin(S._clock * 6 + n.id)), gGlow * 0.6);
        if (glowA > 0.03) {
            ctx.globalAlpha = Math.min(0.55, glowA) * mul;
            ctx.lineWidth = 1.4 / S.cam.k;
            ctx.strokeStyle = 'rgb(' + T.accent + ')';
            ctx.beginPath();
            ctx.arc(px, py, r + 3 / S.cam.k, 0, 7);
            ctx.stroke();
        }

        // FÁZA ANIMÁCIE (Q13): zrod uzla — krátky rozpínavý prstenec, ktorý dobehne a zmizne
        if (n._born != null) {
            const age = S._clock - n._born;
            if (age < 0.6 && S._anim > 0 && !REDUCED_MOTION) {
                const p = age / 0.6;
                ctx.globalAlpha = (1 - p) * 0.6 * mul;
                ctx.lineWidth = 1.4 / S.cam.k;
                ctx.strokeStyle = 'rgb(' + T.accent + ')';
                ctx.beginPath();
                ctx.arc(px, py, r + (3 + p * 14) / S.cam.k, 0, 7);
                ctx.stroke();
            } else if (age >= 0.6) {
                n._born = null; // zrod dobehol — vyčisti časovač
            }
        }

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';

    // zoom fade rampa (Obsidian): labely sa vynárajú medzi k 0.42 a 0.64;
    // hover/select kotva + jej susedia (highlightSet) ostávajú viditeľní vždy
    const zoomFade = Math.min(1, Math.max(0, (S.cam.k - 0.42) / 0.22));
    const showLabels = zoomFade > 0 && S.opts.labelAlpha > 0.02;
    const baseLabelAlpha = Math.min(1, S.opts.labelAlpha);
    const candidates = [];
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        if (!inView(n.x, n.y)) continue; // viewport culling — popisky mimo záberu preskoč
        const isHover = S.hover === n || S.selected === n;
        const inHl = !!(hl && hl.has(n.id)) || !!(pathNodes && pathNodes.has(n.id));
        if (!showLabels && !isHover && !inHl) continue;
        const alpha = baseLabelAlpha * nodeAlphaMul(n, hl, pathNodes) * (isHover || inHl ? 1 : zoomFade);
        // pod prahom čitateľnosti: nekresliť ani nerezervovať obdĺžnik
        if (alpha < 0.12) continue;
        candidates.push({ n, isHover, alpha });
    }
    // FÁZA DE-CLUTTER: stabilita popiskov — hover vždy prvý, potom už-zobrazené popisky (držia
    // si slot pri miernom pohybe, nebliká), potom čitateľnosť (alfa) a stupeň uzla. Mŕtva
    // strength nahradená degree. S._labelShown = množina id vykreslených minulý frame.
    const shown = S._labelShown || (S._labelShown = new Set());
    candidates.sort((a, b) =>
        (b.isHover - a.isHover)
        || ((shown.has(b.n.id) ? 1 : 0) - (shown.has(a.n.id) ? 1 : 0))
        || (b.alpha - a.alpha)
        || ((S.degree.get(b.n.id) || 0) - (S.degree.get(a.n.id) || 0)));

    const fontSize = (12 * S.opts.labelSize) / S.cam.k;
    const taken = [];
    const newShown = new Set();
    ctx.textAlign = 'center';
    // FÁZA RENDER PIPELINE: font raz pred slučkou (jedna váha/veľkosť) — hover sa odlíši
    // papierovým podkladom a plnou alfou, nie tučným rezom, takže font sa nemusí prepisovať.
    ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';
    for (const { n, isHover, alpha } of candidates) {
        const label = truncLabel(n.label);
        const w = ctx.measureText(label).width;
        // FÁZA ANIMÁCIE (Living): popisok sleduje vizuálny offset uzla (drift/gravitácia), nech nedrifuje od bodu
        const nx = n.x + (n._ox || 0), ny = n.y + (n._oy || 0);
        // label centrovaný POD uzlom — baseline r + 13/k, hover počíta so zväčšením
        const y = ny + nodeRadius(n) * (S.hover === n ? 1.15 : 1) + 13 / S.cam.k;
        const rect = { x: nx - w / 2, y: y - fontSize, w, h: fontSize * 1.4 };

        const collides = taken.some((t) =>
            rect.x < t.x + t.w && t.x < rect.x + rect.w
            && rect.y < t.y + t.h && t.y < rect.y + rect.h);
        if (collides && !isHover) continue;
        taken.push(rect);
        newShown.add(n.id);

        // FÁZA RENDER PIPELINE: žiadne strokeText halo (bolo ~44% času draw()). Bežné popisky
        // sa spoliehajú na de-clutter (drop-on-collision); hover/vybraný dostane jemný papierový podklad.
        if (isHover) {
            const px = 5 / S.cam.k, py = 3 / S.cam.k;
            ctx.globalAlpha = alpha * 0.82;
            ctx.fillStyle = T.paper;
            ctx.fillRect(rect.x - px, rect.y - py, rect.w + 2 * px, rect.h + 2 * py);
        }
        // alfa nesie zoom fade aj highlight/focus tlmenie
        ctx.globalAlpha = alpha;
        ctx.fillStyle = T.ink;
        ctx.fillText(label, nx, y);
    }
    S._labelShown = newShown; // FÁZA DE-CLUTTER: zapamätaj vykreslené popisky pre stabilitu
    ctx.globalAlpha = 1;
}

// Skrátenie labelu LEN pri kreslení (hover-card a panel používajú n.label v plnej dĺžke)
function truncLabel(s) {
    const chars = Array.from(String(s)); // mb-safe (surrogate pairs)
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : s;
}

// FÁZA CERTAINTY (F4, §4.6): mapovanie istoty → štýl prstenca (CVD-safe double-encoding).
// overené = plný prstenec, hypotéza = čiarkovaný, pasca = plný + výstražný pip.
// bez/null → žiadny prstenec. Hue istotu NEkóduje (kolízia s farbou oblasti/typu).
const CERT_RING = { overene: 'solid', hypoteza: 'dashed', pasca: 'pip' };

// Farby istoty z --cert-* + --border-strong (theme-aware) — čítané raz cez getComputedStyle
// a cache-nuté; setTheme cache invaliduje, aby prstence sadli na light/dark paletu.
let _certColorCache = null;
function certColors() {
    if (_certColorCache) return _certColorCache;
    const cs = getComputedStyle(document.documentElement);
    const get = (v, fb) => ((cs.getPropertyValue(v) || '').trim() || fb);
    _certColorCache = {
        overene: get('--cert-overene', '#1f7a4d'),
        hypoteza: get('--cert-hypoteza', '#8f5a12'),
        pasca: get('--cert-pasca', '#c0392f'),
        borderStrong: get('--border-strong', '#d9ced6'),
    };
    return _certColorCache;
}
function invalidateCertColors() { _certColorCache = null; }

// FÁZA DE-CLUTTER: uzol = biela/papierová výplň + farebný prstenec vo farbe oblasti (vzdušné,
// nie plná farebná placka). Jadro ostáva zlaté a výrazné (plná zlatá výplň + zlatý prstenec).
// Typ uzla sa rozlíši JEMNE cez hrúbku/štýl prstenca, NIE plnou farbou: spomienka tenký prstenec,
// skill hrubší (plný disk, žiadna donut diera), projekt prstenec + tiché vonkajšie echo.
function drawShape(n, x, y, r, color, simple) {
    const k = S.cam.k;

    if (simple) {
        // FÁZA RENDER PIPELINE: oddialené (k<0.5) — plný farebný disk (papierový prstenec by zanikol)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        return;
    }

    const a = ctx.globalAlpha;

    if (n.type === 'core') {
        // jadro ostáva výrazné — plná zlatá výplň + zlatý sústredný prstenec
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = a * 0.4;
        ctx.lineWidth = Math.max(1, 1.1 / k);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.55, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
        return;
    }

    // papierová výplň — telo uzla splynie s papierom, ostane čistý farebný prstenec
    ctx.fillStyle = T.paper;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();

    // farebný prstenec (obrys) — hrúbka podľa typu; kreslený dovnútra, nech r ostáva polomer uzla
    const lw = n.type === 'skill' ? 2.4 / k : 1.6 / k;
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r - lw * 0.5), 0, 7);
    ctx.stroke();

    if (n.type === 'project') {
        // tiché vonkajšie echo — odlíši projekt (bez plnej farby)
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1.1 / k;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 / k, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }

    // FÁZA CERTAINTY (F4, §4.6): značky istoty + brain-origin rim — LEN nad zoom prahom
    // k>0.8 (v hustom oddialenom grafe by pridávali šum). Subtílne, dvojkanálové, CVD-safe.
    if (k > 0.8) {
        const cc = certColors();

        // brain-origin uzly: jemný vnútorný rim (--border-strong) — ľudsky-písané „mozgy"
        // sa nenápadne odlíšia od session uzlov (nezávisí od prepínača istoty).
        if (n.origin === 'brain') {
            ctx.globalAlpha = a * 0.45;
            ctx.lineWidth = 1 / k;
            ctx.strokeStyle = cc.borderStrong;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, r - lw - 1.2 / k), 0, 7);
            ctx.stroke();
            ctx.globalAlpha = a;
        }

        // certainty prstenec za uzlom — prepínateľný („Značky istoty", default ON)
        const mode = S.certRings ? CERT_RING[n.certainty] : null;
        if (mode) {
            const rr = r + 3.2 / k;
            const col = cc[n.certainty];
            ctx.save();
            ctx.globalAlpha = a * 0.8;
            ctx.lineWidth = 1.6 / k;
            ctx.strokeStyle = col;
            if (mode === 'dashed') ctx.setLineDash([3 / k, 2.4 / k]);
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, 7);
            ctx.stroke();
            if (mode === 'pip') {
                // výstražný pip navrchu prstenca — druhý (tvarový) kanál pre pascu
                ctx.setLineDash([]);
                ctx.globalAlpha = a;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(x, y - rr, 1.9 / k, 0, 7);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}

let lastFrame = now();
let framePending = false;
function frame() {
    framePending = false;
    // FÁZA SHELL: ak sme medzitým opustili Graf, slučka zaparkuje bez kreslenia.
    if (S.screen !== 'graf') return;
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

function scheduleFrame() {
    // FÁZA SHELL: mimo obrazovky Graf sa plátno nekreslí vôbec — slučka zaparkuje (tichý CPU).
    // setScreen('graf') ju znovu naštartuje.
    if (S.screen !== 'graf') return;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}

// FÁZA RENDER PIPELINE: koľko frameov po dobehnutí animácie ešte kresliť, nech flash/zrod dohasne.
// flash klesá o 0.02/frame (0.5 → 0 ≈ 25 frameov); 45 dáva rezervu aj pre zrodový prstenec (0.6 s).
const SETTLE_FRAMES = 45;

// FÁZA ANIMÁCIE (Living): interval čistého ambientného framu (~30 FPS). Responzívne stavy
// (interakcia, sim, pulzy/toky, morph) idú plnou frekvenciou; ambientný život sa throttluje sem.
const AMBIENT_MS = 32;

// Jednorazová požiadavka na prekreslenie (hover, kamera, výber, dáta, filter, téma).
// Nastaví dirty a zobudí uspatú rAF slučku (reset lastFrame, nech prvý dt nevyskočí).
function requestDraw() {
    S._dirty = true;
    if (!framePending) { lastFrame = now(); scheduleFrame(); }
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

    // stavový čip v hlavičke (bdie / spí)
    const chip = document.getElementById('status-chip');
    if (chip) {
        chip.classList.toggle('awake', awake);
        const txt = chip.querySelector('.txt');
        if (txt) txt.textContent = awake ? 'bdie' : 'spí';
    }
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
    const loc = localSet();
    let best = null, bestD = Infinity;
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        const d = Math.hypot(n.x - w.x, n.y - w.y);
        if (d < nodeRadius(n) + 8 / S.cam.k && d < bestD) { best = n; bestD = d; }
    }
    return best;
}

function setupInput() {
    let dragging = false, moved = false, lx = 0, ly = 0;
    let dragNode = null; // Obsidian-style grab & fling — ťahanie uzla v mape/sieti

    let lastHoverId = null; // FÁZA ANIMÁCIE: hover na NOVÝ uzol spustí tok po jeho hranách

    canvas.addEventListener('mousedown', (e) => {
        dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
        S._interacting = true; // pauza idle dýchania počas drag/pan
        dragNode = null;
        canvas.style.cursor = ''; // inline kurzor by prebil .grabbing/.dragging z CSS
        if (S.view !== 'layers' && !S.connectFrom) { // pri prepájaní je klik čistý výber cieľa
            const n = pick(e.clientX, e.clientY);
            if (n) {
                dragNode = n;
                n.fx = n.x; n.fy = n.y;
                if (S.sim) S.sim.alphaTarget(0.3).restart();
            }
        }
        canvas.classList.add(dragNode ? 'grabbing' : 'dragging');
        requestDraw(); // začiatok interakcie → zobuď slučku
    });

    // FÁZA ANIMÁCIE (Living): kurzor pre gravitáciu/parallax uzlov. Aktívny len keď NIE je drag/pan
    // (počas ťahania sa gravitácia uvoľní). mouseleave nižšie ju uvoľní pri odchode z plátna.
    canvas.addEventListener('mouseleave', () => { S.cursor.on = false; });

    window.addEventListener('mousemove', (e) => {
        S.cursor.sx = e.clientX; S.cursor.sy = e.clientY;
        S.cursor.on = !dragging;
        if (dragging) {
            const dx = e.clientX - lx, dy = e.clientY - ly;
            if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            if (dragNode) {
                const w = screenToWorld(e.clientX, e.clientY);
                dragNode.fx = w.x;
                dragNode.fy = w.y;
            } else {
                S.cam.x += dx; S.cam.y += dy;
            }
            lx = e.clientX; ly = e.clientY;
            requestDraw(); // kamera/ťahaný uzol sa pohli → prekresli
        } else {
            const prevHover = S.hover;
            S.hover = pick(e.clientX, e.clientY);
            // FÁZA ANIMÁCIE (Q10): tok len pri prechode na nový uzol, nie na každý pohyb myšou
            const hid = S.hover ? S.hover.id : null;
            if (hid !== lastHoverId) {
                if (S.hover) emitFlows(S.hover, { tone: 'accent', dim: 0.7, speed: 1.0 });
                lastHoverId = hid;
            }
            if (S.hover !== prevHover) requestDraw(); // zmena hoveru → prekresli zvýraznenie
            // nad uzlom 'grab' (mapa/sieť — dá sa ťahať), vrstvy len klik → pointer
            canvas.style.cursor = S.connectFrom
                ? 'crosshair'
                : (S.hover ? (S.view === 'layers' ? 'pointer' : 'grab') : '');
            updateHoverCard(e);
        }
    });

    window.addEventListener('mouseup', (e) => {
        S._interacting = false; // koniec drag/pan → idle dýchanie sa môže vrátiť
        canvas.classList.remove('dragging');
        canvas.classList.remove('grabbing');
        if (dragNode) {
            // FÁZA RENDER PIPELINE: po pustení uzla sa vráť na alphaTarget 0 — sim dobehne a zastane
            if (S.sim) S.sim.alphaTarget(0);
            if (dragNode.type === 'core' && dragNode.label === S.name) {
                dragNode.fx = 0; dragNode.fy = 0; // hlavné jadro ostáva prišpendlené v strede
            } else {
                // uvoľnenie: sieť — uzol si nechá rýchlosť (fling); mapa — kotvy ho pritiahnu domov
                dragNode.fx = null; dragNode.fy = null;
            }
            dragNode = null;
        }
        if (dragging && !moved) {
            const n = pick(e.clientX, e.clientY);
            if (S.connectFrom) {
                // connect mode: klik na iný uzol prepája, klik do prázdna ruší
                if (n && n.id !== S.connectFrom) createEdge(S.connectFrom, n.id);
                else if (!n) cancelConnect();
            } else if (n) selectNode(n);
            else closeNodePanel();
        }
        dragging = false;
        requestDraw(); // koniec interakcie / zmena výberu → prekresli (a dobehni usadenie sim)
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
        requestDraw(); // zoom zmenil kameru → prekresli
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
    // aktívny lokálny graf sa preväzuje na novo zvolený uzol (Obsidian re-root)
    if (S.local && S.local.rootId !== n.id) setLocal(n.id, S.local.depth);
    closeCreateMode(); // výber uzla vždy vracia panel do detailného režimu
    S.selected = n;
    requestDraw(); // nový výber → prekresli zvýraznenie (slučka mohla spať)
    updatePackUi(); // node-pack tlačidlo odzrkadlí stav balíka pre tento uzol
    $('node-panel').classList.remove('hidden');
    $('node-form').classList.add('hidden');
    $('node-view').classList.remove('hidden');
    $('node-type-label').textContent = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' }[n.type] || n.type;
    const nc = nodeColor(n); // farba oblasti — typ hovorí tvar, nie farba
    $('node-swatch').style.background = nc;
    $('node-panel').style.setProperty('--node-c', nc);
    $('node-label').textContent = n.label;
    $('node-desc').textContent = n.description || '';
    $('node-meta').textContent = 'sila ' + (n.strength || 1).toFixed(0);
    renderNodeBadges(n); // F4: origin + cert + značky

    $('node-neighbors').innerHTML = '';
    $('node-history').innerHTML = '';
    $('node-record').innerHTML = '';
    $('node-suggestions').innerHTML = '';
    $('node-md').classList.add('hidden'); // dokument sa odhalí až po načítaní meta

    renderSuggestions(n); // A8: algoritmické návrhy prepojení (vlastný fetch)

    try {
        const res = await fetch('/api/nodes/' + n.id);
        const data = await res.json();
        renderNodeRecord(data.node);

        // C4: tlačidlo dokumentu len ak uzol má markdown zdroj (summary_path / path)
        const nm = data.node.meta || {};
        $('node-md').classList.toggle('hidden', !(nm.summary_path || nm.path));
        const meta = [];
        if (data.node.area_name) meta.push(data.node.area_name);
        if (data.node.department_name) meta.push(data.node.department_name);
        meta.push('sila ' + data.node.strength.toFixed(0));
        $('node-meta').textContent = meta.join(' · ');

        // riadok suseda: chip (navigácia) + × (zrušenie spojenia) — edge id z S.edges podľa páru
        $('node-neighbors').innerHTML = data.neighbors.map((m) => {
            const edge = S.edges.find((x) =>
                (x.source_id === n.id && x.target_id === m.id)
                || (x.source_id === m.id && x.target_id === n.id));
            return '<div class="nb-row">'
                + '<button type="button" class="chip" data-id="' + m.id + '">' + esc(m.label) + '</button>'
                + (edge
                    ? '<button type="button" class="ghost ms nb-del" data-edge="' + edge.id
                        + '" title="Zrušiť spojenie" aria-label="Zrušiť spojenie">close</button>'
                    : '')
                + '</div>';
        }).join('') || emptyHtml('hub', 'Bez spojení');

        $('node-neighbors').querySelectorAll('.chip').forEach((chip) => {
            chip.onclick = () => {
                const target = S.byId.get(+chip.dataset.id);
                if (target) { selectNode(target); focusNode(target); }
            };
        });

        $('node-neighbors').querySelectorAll('.nb-del').forEach((btn) => {
            btn.onclick = () => busy(btn, () => deleteEdge(+btn.dataset.edge));
        });

        $('node-history').innerHTML = data.activations.map((a) => {
            const kinds = { learn: 'naučené', activate: 'aktivované', merge: 'zlúčené', recall: 'spomenuté', seed: 'zasiate' };
            return '<div class="hist">' + (kinds[a.kind] || a.kind) + ' · ' + new Date(a.created_at).toLocaleString('sk') + '</div>';
        }).join('') || emptyHtml('history', 'Zatiaľ žiadna aktivita');
    } catch (e) { /* offline detail nevadí */ }
}

// A8: „Možno súvisí" — algoritmické návrhy prepojení pod susedmi
async function renderSuggestions(n) {
    const sec = $('node-suggestions-sec');
    const wrap = $('node-suggestions');
    if (!sec || !wrap) return;
    // jadro nikdy nedostáva návrhy — celá sekcia sa skryje
    if (n.type === 'core') { sec.classList.add('hidden'); return; }
    sec.classList.remove('hidden');

    let list = [];
    try {
        const res = await fetch('/api/nodes/' + n.id + '/suggestions');
        const data = await res.json();
        list = data.suggestions || [];
    } catch (e) { return; } // offline — sekcia ostáva prázdna, žiadny šum

    if (!S.selected || S.selected.id !== n.id) return; // medzitým iný výber

    if (!list.length) { renderEmpty(wrap, 'hub', 'Žiadne návrhy'); return; }

    wrap.innerHTML = list.map((s) => {
        const area = S.areas.get(s.area_id);
        const color = area ? area.color : 'var(--muted)';
        return '<div class="sug-row" data-id="' + s.id + '">'
            + '<span class="swatch" style="background:' + esc(color) + '" aria-hidden="true"></span>'
            + '<span class="sug-label">' + esc(s.label) + '</span>'
            + '<span class="sug-score">' + esc(Number(s.score).toFixed(2)) + '</span>'
            + '<button type="button" class="ghost ms sug-add" title="Prepojiť" aria-label="Prepojiť">add_link</button>'
            + '</div>';
    }).join('');

    wrap.querySelectorAll('.sug-add').forEach((btn) => {
        btn.onclick = () => {
            const row = btn.closest('.sug-row');
            busy(btn, () => linkSuggestion(n, +row.dataset.id, row));
        };
    });
}

// Prepojenie z návrhu — rovnaká konštrukcia hrany ako createEdge (connect mode)
async function linkSuggestion(source, targetId, row) {
    try {
        const res = await fetch('/api/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: source.id, target_id: targetId }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Prepojenie sa nepodarilo');
            return;
        }
        const data = await res.json();
        const e = data.edge;
        if (e) {
            const existing = S.edges.find((x) => x.id === e.id);
            if (existing) {
                existing.weight = e.weight;
                spawnPulse(existing.source, existing.target, { speed: 1.4 });
            } else {
                const src = S.byId.get(e.source_id);
                const tgt = S.byId.get(e.target_id);
                if (src && tgt) {
                    S.edges.push({ ...e, source: src, target: tgt });
                    S._localFor = null; // hrany sa zmenili — BFS cache neplatí
                    buildSim();
                    kickSim(0.3);
                    spawnPulse(src, tgt, { speed: 1.2 });
                }
            }
            updateHeaderMetrics();
        }
        row.remove();
        draw();
        showToast('Prepojené');
        if (S.selected && S.selected.id === source.id) selectNode(S.selected); // čerství susedia + návrhy
    } catch (err) {
        showToast('Prepojenie sa nepodarilo');
    }
}

// Detail záznamu (session / digest / archive) v paneli uzla — stavia sa z node.meta
const RECORD_SOURCES = ['session', 'digest', 'archive'];

function renderNodeRecord(node) {
    const wrap = $('node-record');
    wrap.innerHTML = '';
    const meta = node && node.meta;
    if (!meta || !RECORD_SOURCES.includes(node.source)) return;

    const clip = (s, max) => {
        s = String(s);
        return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
    };

    let html = '';

    if (Array.isArray(meta.prompts) && meta.prompts.length) {
        html += '<h3>Prompty</h3><ol class="rec-prompts">'
            + meta.prompts.map((p) => '<li>' + esc(clip(p, 140)) + '</li>').join('')
            + '</ol>';
    }

    if (Array.isArray(meta.files) && meta.files.length) {
        html += '<h3>Súbory</h3><div class="rec-files">'
            + meta.files.slice(0, 10).map((f) => {
                const s = String(f);
                const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
                const dir = i >= 0 ? s.slice(0, i + 1) : '';
                const base = i >= 0 ? s.slice(i + 1) : s;
                return '<span class="meta-chip" title="' + esc(s) + '">'
                    + (dir ? '<span class="dir">' + esc(dir) + '</span>' : '')
                    + '<strong>' + esc(base) + '</strong></span>';
            }).join('')
            + '</div>';
    }

    if (Array.isArray(meta.commits) && meta.commits.length) {
        html += '<h3>Commity</h3>'
            + meta.commits.map((c) => {
                const label = typeof c === 'string' ? c : (c && (c.message || c.hash)) || '';
                return '<div class="rec-commit"><span class="ms" aria-hidden="true">commit</span>'
                    + '<span>' + esc(clip(label, 160)) + '</span></div>';
            }).join('');
    }

    // meta.tools je objekt {name: count}; pole necháme ako fallback starších záznamov
    let toolChips = '';
    if (Array.isArray(meta.tools)) {
        toolChips = meta.tools.map((t) => '<span class="meta-chip">' + esc(t) + '</span>').join('');
    } else if (meta.tools && typeof meta.tools === 'object') {
        toolChips = Object.entries(meta.tools).map(([name, count]) =>
            '<span class="meta-chip"><strong>' + esc(name) + '</strong>&nbsp;×' + esc(String(count)) + '</span>'
        ).join('');
    }
    if (toolChips) {
        html += '<h3>Nástroje</h3><div class="rec-tools">' + toolChips + '</div>';
    }

    if (meta.final) {
        html += '<h3>Záver</h3><p class="rec-final">' + esc(clip(meta.final, 400)) + '</p>';
    }

    wrap.innerHTML = html;
}

function focusNode(n) {
    S.cam.x = -n.x * S.cam.k;
    S.cam.y = -n.y * S.cam.k;
    requestDraw(); // kamera sa presunula na uzol → prekresli
}

function zoomBy(factor) {
    // pivot okolo stredu obrazovky — rovnaká technika ako wheel handler
    const before = screenToWorld(S.w / 2, S.h / 2);
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
    const after = screenToWorld(S.w / 2, S.h / 2);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    requestDraw(); // zoom tlačidlom zmenil kameru → prekresli
}

// Fit view — kamera obsiahne všetky viditeľné uzly aktuálneho náhľadu
function fitView(pad = 90) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const loc = localSet();

    if (S.view === 'layers') {
        // deterministický layout — bbox sub-stĺpcov + hlavičky (vždy v zábere)
        const lay = layerLayout();
        add(lay.minX, -lay.maxHalf - 66);
        add(lay.maxX, lay.maxHalf);
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.fx != null ? n.fx : n.x, n.fy != null ? n.fy : n.y);
        }
    } else {
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.x, n.y);
        }
    }

    if (minX > maxX) { S.cam = { x: 0, y: 0, k: 0.85 }; draw(); return; }

    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    S.cam.k = Math.min(1.6, Math.max(0.14, Math.min((S.w - 2 * pad) / bw, (S.h - 2 * pad) / bh)));
    S.cam.x = -((minX + maxX) / 2) * S.cam.k;
    S.cam.y = -((minY + maxY) / 2) * S.cam.k;
    draw();
}

// Tvarové glyfy typov — neutrálny ink (var(--muted)); farba v legende patrí len oblastiam.
// Jadro je jediná výnimka: dvojitý zlatý prstenec (brand moment).
const TYPE_GLYPHS = {
    memory: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/></svg>',
    skill: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="var(--muted)"/><circle cx="8" cy="8" r="2.3" fill="var(--bg)"/></svg>',
    project: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" fill="var(--muted)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--muted)" stroke-opacity=".7" stroke-width="1.2"/></svg>',
    core: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="var(--gold)"/><circle cx="8" cy="8" r="6.8" fill="none" stroke="var(--gold)" stroke-opacity=".5" stroke-width="1.2"/></svg>',
};

function buildLegend() {
    const typeNames = { memory: 'Spomienka', skill: 'Skill', project: 'Projekt', core: 'Jadro' };

    $('legend-types').innerHTML = Object.keys(typeNames).map(
        (t) => '<div class="legend-row">' + TYPE_GLYPHS[t] + '<span>' + typeNames[t] + '</span></div>'
    ).join('');

    // oblasti sú klikateľné filtre — riadok prepína viditeľnosť oblasti na plátne
    $('legend-areas').innerHTML = [...S.areas.values()].map((a) => {
        const off = S.filter.areas.has(a.id);
        return '<button type="button" class="legend-row legend-area' + (off ? ' off' : '')
            + '" data-area="' + a.id + '" aria-pressed="' + (off ? 'false' : 'true')
            + '" title="Prepnúť viditeľnosť oblasti">'
            + '<span class="swatch" style="background:' + esc(a.color)
            + ';box-shadow:0 0 6px ' + esc(a.color) + '"></span>'
            + '<span class="la-name">' + esc(a.name) + '</span>'
            + '<span class="ms la-eye" aria-hidden="true">' + (off ? 'visibility_off' : 'visibility') + '</span>'
            + '</button>';
    }).join('');

    $('legend-areas').querySelectorAll('.legend-area').forEach((row) => {
        row.onclick = () => {
            const id = +row.dataset.area;
            const off = !S.filter.areas.has(id);
            if (off) S.filter.areas.add(id); else S.filter.areas.delete(id);
            row.classList.toggle('off', off);
            row.setAttribute('aria-pressed', off ? 'false' : 'true');
            row.querySelector('.la-eye').textContent = off ? 'visibility_off' : 'visibility';
            persistFilter();
            draw();
        };
    });

    const strengthEl = $('legend-strength');
    if (strengthEl) {
        strengthEl.innerHTML = '<div class="legend-row legend-strength">'
            + [6, 10, 14].map((d) =>
                '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="' + (d / 2) + '" fill="var(--muted)"/></svg>'
            ).join('')
            + '<span class="cap">slabšia → silnejšia</span></div>';
    }

    // A10 + FÁZA HRANY: druhy spojení — jedna ink farba, rozlíšenie štýlom čiary.
    // relation (part_of kostra, uses) má prednosť pred kind (aktivácia, podobnosť).
    const connEl = $('legend-connections');
    if (connEl) {
        const line = (dash, w) =>
            '<svg width="26" height="10" viewBox="0 0 26 10" aria-hidden="true">'
            + '<line x1="1" y1="5" x2="25" y2="5" stroke="var(--muted)" stroke-width="' + (w || 1.4) + '"'
            + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/></svg>';
        connEl.innerHTML =
            '<div class="legend-row">' + line('', 1) + '<span>Kostra · part_of</span></div>'
            + '<div class="legend-row">' + line('') + '<span>Ručné · silné</span></div>'
            + '<div class="legend-row">' + line('6 4') + '<span>Použitie · uses</span></div>'
            + '<div class="legend-row">' + line('5 3') + '<span>Spoločná aktivácia</span></div>'
            + '<div class="legend-row">' + line('1.5 3') + '<span>Podobnosť</span></div>';
    }
}

function closeNodePanel() {
    S.selected = null;
    createMode = false;
    $('edit-type-row').classList.add('hidden');
    $('node-panel').classList.add('hidden');
    requestDraw(); // zrušený výber → prekresli (zmizne zvýraznenie)
}

/* ---------- ručné prepájanie (connect mode) + správa hrán ---------- */

function cancelConnect() {
    S.connectFrom = null;
    canvas.classList.remove('linking');
}

async function createEdge(sourceId, targetId) {
    cancelConnect(); // režim končí prvým platným klikom — žiadne duplicitné POSTy
    try {
        const res = await fetch('/api/edges', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source_id: sourceId, target_id: targetId }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Prepojenie sa nepodarilo');
            return;
        }
        const data = await res.json();
        const e = data.edge;
        if (!e) return;
        const existing = S.edges.find((x) => x.id === e.id);
        if (existing) {
            // pár už existoval — backend zvýšil váhu (WS echo edge.strengthened je idempotentné)
            existing.weight = e.weight;
            spawnPulse(existing.source, existing.target, { speed: 1.4 });
            showToast('Spojenie posilnené');
        } else {
            const src = S.byId.get(e.source_id);
            const tgt = S.byId.get(e.target_id);
            if (src && tgt) {
                S.edges.push({ ...e, source: src, target: tgt });
                S._localFor = null; // hrany sa zmenili — BFS cache neplatí
                buildSim();
                kickSim(0.3);
                spawnPulse(src, tgt, { speed: 1.2 });
            }
            showToast('Prepojené');
        }
        updateHeaderMetrics();
        draw();
        if (S.selected) selectNode(S.selected); // čerstvý zoznam susedov v paneli
    } catch (err) {
        showToast('Prepojenie sa nepodarilo');
    }
}

async function deleteEdge(edgeId) {
    try {
        const res = await fetch('/api/edges/' + edgeId, { method: 'DELETE' });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Zrušenie sa nepodarilo');
            return;
        }
        // optimistické odstránenie — WS echo edge.deleted už hranu nenájde (no-op)
        const i = S.edges.findIndex((x) => x.id === edgeId);
        if (i !== -1) S.edges.splice(i, 1);
        S._localFor = null;
        buildSim();
        kickSim(0.2);
        updateHeaderMetrics();
        draw();
        showToast('Spojenie zrušené');
        if (S.selected) selectNode(S.selected);
    } catch (err) {
        showToast('Zrušenie sa nepodarilo');
    }
}

/* ---------- nový uzol (create mode v paneli uzla) ---------- */

let createMode = false;

function openCreateNode() {
    createMode = true;
    $('node-panel').classList.remove('hidden');
    $('node-view').classList.add('hidden');
    $('node-form').classList.remove('hidden');
    $('node-label').textContent = 'Nový uzol';
    $('node-panel').style.removeProperty('--node-c');
    $('edit-label').value = '';
    $('edit-desc').value = '';
    $('edit-type').value = 'memory';
    $('edit-type-row').classList.remove('hidden');
    fillMoveSelects({ area_id: null, department_id: null });
    setTimeout(() => $('edit-label').focus(), 60);
}

function closeCreateMode() {
    createMode = false;
    $('edit-type-row').classList.add('hidden');
}

async function createNode() {
    const label = $('edit-label').value.trim();
    if (!label) { showToast('Zadaj názov uzla'); return; }
    try {
        const res = await fetch('/api/nodes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                label,
                type: $('edit-type').value,
                description: $('edit-desc').value.trim() || null,
                area_id: $('edit-area').value ? +$('edit-area').value : null,
                department_id: $('edit-dept').value ? +$('edit-dept').value : null,
            }),
        });
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            showToast(d.message || 'Vytvorenie sa nepodarilo');
            return;
        }
        const data = await res.json();
        let n = S.byId.get(data.node.id); // WS echo node.created mohol byť rýchlejší
        if (!n) {
            n = { ...data.node };
            // spawn pri kotve zvolenej oblasti/oddelenia, inak pri strede
            const a = anchorOf(n);
            n.x = a.x + (Math.random() - 0.5) * 50;
            n.y = a.y + (Math.random() - 0.5) * 50;
            n.flash = 1;
            S.nodes.push(n);
            S.byId.set(n.id, n);
            buildSim();
            kickSim(0.4);
        }
        closeCreateMode();
        updateHeaderMetrics();
        draw();
        selectNode(n);
        showToast('Uzol vytvorený', n.id);
    } catch (err) {
        showToast('Vytvorenie sa nepodarilo');
    }
}

// Presun uzla — naplnenie selectov Oblasť / Oddelenie v edit forme
function fillMoveSelects(n) {
    const aSel = $('edit-area');
    aSel.innerHTML = '<option value="">— bez oblasti —</option>'
        + [...S.areas.values()].map((a) =>
            '<option value="' + a.id + '">' + esc(a.name) + '</option>'
        ).join('');
    aSel.value = n.area_id || '';
    fillDeptOptions(n.area_id || null, n.department_id || null);
}

function fillDeptOptions(areaId, deptId) {
    const dSel = $('edit-dept');
    const depts = areaId ? [...S.departments.values()].filter((d) => d.area_id === areaId) : [];
    dSel.innerHTML = '<option value="">— bez oddelenia —</option>'
        + depts.map((d) => '<option value="' + d.id + '">' + esc(d.name) + '</option>').join('');
    dSel.value = deptId || '';
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Async spätná väzba tlačidiel — disable + dočasný text počas behu
async function busy(btn, fn, busyText) {
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
}

// Jednotný prázdny stav — jedna šablóna pre všetky sekcie
function emptyHtml(icon, text) {
    return '<div class="empty"><span class="ms" aria-hidden="true">' + icon + '</span><p>' + esc(text) + '</p></div>';
}

function renderEmpty(container, icon, text) {
    container.innerHTML = emptyHtml(icon, text);
}

async function refreshStats() {
    let st;
    try {
        const res = await fetch('/api/mind/stats');
        st = await res.json();
    } catch (e) {
        renderEmpty($('stats-cards'), 'cloud_off', 'Nepodarilo sa načítať');
        return;
    }

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
    ).join('') || emptyHtml('receipt_long', 'Zatiaľ žiadne záznamy');

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
    ).join('') || emptyHtml('leaderboard', 'Zatiaľ žiadne uzly');

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
        requestDraw(); // scrub časovej osi → prekresli
    });

    $('tl-play').addEventListener('click', () => {
        if (S.replay.playing) { stopReplay(); requestDraw(); return; }
        if (REDUCED_MOTION) { stopReplay(); requestDraw(); return; } // bez animácie — rovno koncový stav
        S.replay.on = true;
        S.replay.playing = true;
        S.replay.t = 0;
        $('tl-play').textContent = 'pause';
        requestDraw(); // spusti prehrávanie → zobuď slučku (replay.playing drží slučku živú)
    });
}

function computeReplayBounds() {
    const times = S.nodes.filter((n) => n.type !== 'core').map((n) => ts(n.created_at)).filter(Boolean);
    S.replay.tMin = times.length ? Math.min(...times) - 3600000 : now() - 86400000;
    S.replay.tMax = now();
}

/* ---------- websocket ---------- */

let wsWasConnected = false;

function connectWs(ws) {
    // Same-origin WS keď je appka servovaná cez proxy/tunel (https, alebo iný port
    // než priamy 8080) — Caddy routuje /app/* na Reverb, takže pulzy chodia aj cez
    // ngrok. Priamy lokálny 127.0.0.1:8080 ostáva na ws.host/ws.port (localhost:8081).
    const tls = location.protocol === 'https:';
    const proxied = tls || (location.port && location.port !== '8080');
    const host = proxied ? location.hostname : ws.host;
    const port = proxied
        ? (location.port ? Number(location.port) : (tls ? 443 : 80))
        : ws.port;

    const pusher = new Pusher(ws.key, {
        wsHost: host,
        wsPort: port,
        wssPort: port,
        forceTLS: tls,
        enabledTransports: tls ? ['wss', 'ws'] : ['ws'],
        cluster: 'mt1',
        disableStats: true,
    });

    // po výpadku spojenia mohli pulzy vypadnúť — pri REconnecte dotiahni stav grafu
    pusher.connection.bind('state_change', (st) => {
        if (st.current !== 'connected') return;
        if (wsWasConnected && S.nodes.length) reloadGraph();
        wsWasConnected = true;
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
        n._born = S._clock; // FÁZA ANIMÁCIE (Q13): časovač zrodu — polomer 0→plný + prstenec
        S.nodes.push(n);
        S.byId.set(n.id, n);
        buildSim();
        kickSim(0.5);
        spawnPulse(hadesNode(), n, { speed: 1.4 });
        emitFlows(n, { tone: 'accent', speed: 1.1 }); // tok po nových hranách uzla
        blip(520);
        showToast('Naučil som sa: ' + n.label, n.id);
        if (n.source === 'session') {
            if (S.screen === 'dennik') { renderJournal(); markJournalSeen(); }
            else setJournalDot(true);
        }
    }

    if (type === 'node.activated') {
        const n = S.byId.get(data.node_id);
        if (!n) return;
        n.strength = data.strength;
        n.flash = 1;
        const from = neighborsOf(n)[0] || hadesNode();
        spawnPulse(from, n, { speed: 1.6 });
        emitFlows(n, { tone: 'accent' }); // FÁZA ANIMÁCIE (Q10): tok po incidentných hranách
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
        if (S.local && S.local.rootId === n.id) clearLocal();
        S._localFor = null; // hrany sa zmenili — BFS cache neplatí
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

    if (type === 'edge.deleted') {
        const i = S.edges.findIndex((e) => e.id === data.id);
        if (i !== -1) {
            S.edges.splice(i, 1);
            S._localFor = null;
            buildSim();
        }
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
        // FÁZA ANIMÁCIE (Q11): postupné rozliatie od nájdených uzlov k susedom — graph-walk vlna.
        // Pulz z jadra na uzol, po jeho dobehnutí sa z uzla rozbehnú toky k susedom (staggered).
        data.node_ids.forEach((id, i) => {
            const n = S.byId.get(id);
            if (!n) return;
            setTimeout(() => {
                spawnPulse(hadesNode(), n, { speed: 1.8, dim: 0.8 });
                emitFlows(n, { tone: 'accent', dim: 0.85, wait: 0.35 }); // vlna k susedom o skok ďalej
            }, i * 120);
        });
        blip(392, 0.5, 0.03);
        setTimeout(() => blip(523, 0.5, 0.03), 150);
    }

    if (type === 'chat') {
        const h = hadesNode();
        if (h) h.flash = 1;
    }

    if (dockOpen === 'stats') refreshStats();
    if (dockOpen === 'structure' && /^(node|department)\./.test(type)
        && !$('structure-tree').querySelector('.dept-actions')) renderStructure();
    updateHeaderMetrics();
    requestDraw(); // WS udalosť zmenila stav grafu → prekresli (pokrýva aj neanimované vetvy)
}

/* ---------- dokument uzla (markdown preview) ---------- */

// Malý čistý markdown → HTML renderer. Zdroj sa najprv escapuje (esc), formátovanie
// sa aplikuje až na escapovaný text — žiadny HTML injection nie je možný.
function mdToHtml(src) {
    src = String(src).replace(/\r\n?/g, '\n');

    // Frontmatter (--- ... ---) na začiatku → kompaktný tlmený meta riadok
    let front = '';
    const fm = src.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fm) {
        const items = fm[1].split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const i = l.indexOf(':');
            if (i === -1) return esc(l);
            return '<strong>' + esc(l.slice(0, i).trim()) + '</strong> ' + esc(l.slice(i + 1).trim());
        });
        front = '<div class="md-front">' + items.join('<span class="md-front-sep">·</span>') + '</div>';
        src = src.slice(fm[0].length);
    }

    const inline = (t) => t
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');

    const lines = esc(src).split('\n');
    let html = '';
    let listOpen = false;
    let paras = [];
    let i = 0;

    const flushPara = () => {
        if (paras.length) { html += '<p>' + inline(paras.join(' ')) + '</p>'; paras = []; }
    };
    const closeList = () => { if (listOpen) { html += '</ul>'; listOpen = false; } };

    while (i < lines.length) {
        const line = lines[i];

        const fence = line.match(/^\s*```/);
        if (fence) {
            flushPara(); closeList();
            const buf = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
            i++; // preskoč uzatváraciu ohradu
            html += '<pre class="md-code"><code>' + buf.join('\n') + '</code></pre>';
            continue;
        }

        if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
            flushPara(); closeList();
            html += '<hr class="md-hr">';
            i++; continue;
        }

        const h = line.match(/^\s*(#{1,3})\s+(.*)$/);
        if (h) {
            flushPara(); closeList();
            const lvl = h[1].length;
            html += '<h' + lvl + ' class="md-h">' + inline(h[2].trim()) + '</h' + lvl + '>';
            i++; continue;
        }

        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
            flushPara();
            if (!listOpen) { html += '<ul class="md-list">'; listOpen = true; }
            html += '<li>' + inline(li[1].trim()) + '</li>';
            i++; continue;
        }

        if (/^\s*$/.test(line)) {
            flushPara(); closeList();
            i++; continue;
        }

        closeList();
        paras.push(line.trim());
        i++;
    }
    flushPara(); closeList();
    return front + html;
}

let mdReturnFocus = null;
let mdNodeId = null;
let mdLabel = null;
let mdPath = null;

function closeMdOverlay() {
    $('md-overlay').classList.add('hidden');
    if (mdReturnFocus) { mdReturnFocus.focus(); mdReturnFocus = null; }
}

// Markdown čítačka (skill / summary). node = { id, label, path? }.
// Pätička ponúka Do balíka a Kopírovať cestu (ak je cesta známa).
async function openMdOverlay(node) {
    const overlay = $('md-overlay');
    mdNodeId = node.id;
    mdLabel = node.label || '';
    mdPath = node.path || null;
    $('md-title').textContent = mdLabel;
    $('md-body').innerHTML = emptyHtml('hourglass_empty', 'Načítavam…');
    syncMdFoot();
    mdReturnFocus = document.activeElement;
    overlay.classList.remove('hidden');
    $('md-close').focus();
    try {
        const res = await fetch('/api/nodes/' + node.id + '/markdown');
        const data = await res.json();
        if (mdNodeId !== node.id) return; // medzitým otvorený iný dokument
        $('md-body').innerHTML = mdToHtml(data.markdown || '');
    } catch (e) {
        if (mdNodeId === node.id) $('md-body').innerHTML = emptyHtml('cloud_off', 'Dokument sa nepodarilo načítať');
    }
}

// Stav pätičky čítačky — pack tlačidlo podľa balíka, cesta len ak je známa
function syncMdFoot() {
    const pk = $('md-pack');
    if (pk) {
        const on = mdNodeId != null && packHas(mdNodeId);
        pk.classList.toggle('in-pack', on);
        pk.textContent = on ? 'V balíku' : 'Do balíka';
    }
    const cp = $('md-copypath');
    if (cp) cp.classList.toggle('hidden', !mdPath);
}

/* ---------- chat ---------- */

const chatHistory = [];

// E3: uzly priložené do kontextu chatu (perzistentné naprieč reloadmi)
S.chatContext = new Set();
try {
    const cc = JSON.parse(localStorage.getItem('hades.chatContext') || '[]');
    if (Array.isArray(cc)) cc.forEach((id) => S.chatContext.add(+id));
} catch (e) { /* poškodený kontext — prázdny */ }

function persistChatContext() {
    localStorage.setItem('hades.chatContext', JSON.stringify([...S.chatContext]));
}

function addToChatContext(id) {
    S.chatContext.add(+id);
    persistChatContext();
    renderContextChips();
}

function removeFromChatContext(id) {
    S.chatContext.delete(+id);
    persistChatContext();
    renderContextChips();
}

// Čipy nad chatom — štítky uzlov v kontexte, × odoberá, „Vyčistiť" zmaže všetky.
// Mŕtve id (zmazané uzly) sa preskočia a zároveň vyčistia z úložiska.
function renderContextChips() {
    const row = $('chat-context');
    if (!row) return;
    const ids = [...S.chatContext].filter((id) => S.byId.has(id));
    if (ids.length !== S.chatContext.size) {
        S.chatContext = new Set(ids);
        persistChatContext();
    }
    if (!ids.length) { row.classList.add('hidden'); row.innerHTML = ''; return; }
    row.classList.remove('hidden');
    row.innerHTML = ids.map((id) => {
        const n = S.byId.get(id);
        return '<span class="ctx-chip" data-id="' + id + '">'
            + '<span class="ctx-label">' + esc(n.label) + '</span>'
            + '<button type="button" class="ctx-x ms" title="Odobrať z kontextu" aria-label="Odobrať z kontextu">close</button>'
            + '</span>';
    }).join('')
        + '<button type="button" class="ctx-clear" title="Vyčistiť kontext">Vyčistiť</button>';
    row.querySelectorAll('.ctx-x').forEach((btn) => {
        btn.onclick = () => removeFromChatContext(+btn.closest('.ctx-chip').dataset.id);
    });
    const clr = row.querySelector('.ctx-clear');
    if (clr) clr.onclick = () => { S.chatContext.clear(); persistChatContext(); renderContextChips(); };
}

// E2: potvrdzovacia karta „Zapamätať" v chate — vytvorí uzol po úprave a potvrdení
function renderSuggestCard(sug) {
    const log = $('chat-log');
    log.classList.remove('hidden');
    const card = document.createElement('div');
    card.className = 'suggest-card';
    const areaOpts = '<option value="">— bez oblasti —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    card.innerHTML =
        '<div class="sc-head"><span class="ms" aria-hidden="true">bookmark_add</span><span>Zapamätať:</span></div>'
        + '<input class="sc-label" maxlength="255" aria-label="Názov uzla">'
        + '<div class="sc-row">'
        +   '<select class="sc-type" aria-label="Typ">'
        +     '<option value="memory">Spomienka</option>'
        +     '<option value="skill">Skill</option>'
        +     '<option value="project">Projekt</option>'
        +   '</select>'
        +   '<select class="sc-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '</div>'
        + '<div class="sc-actions">'
        +   '<button type="button" class="primary sc-save">Uložiť</button>'
        +   '<button type="button" class="ghost sc-cancel">Zrušiť</button>'
        + '</div>';
    log.appendChild(card);
    card.querySelector('.sc-label').value = sug.label || '';
    const typeSel = card.querySelector('.sc-type');
    if (sug.type) typeSel.value = sug.type;
    log.scrollTop = 1e9;

    card.querySelector('.sc-cancel').onclick = () => card.remove();
    card.querySelector('.sc-save').onclick = (ev) => busy(ev.currentTarget, async () => {
        const label = card.querySelector('.sc-label').value.trim();
        if (!label) { showToast('Zadaj názov uzla'); return; }
        try {
            const res = await fetch('/api/nodes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label,
                    type: typeSel.value,
                    description: sug.description || null,
                    area_id: card.querySelector('.sc-area').value ? +card.querySelector('.sc-area').value : null,
                }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                showToast(d.message || 'Vytvorenie sa nepodarilo');
                return;
            }
            const data = await res.json();
            let n = S.byId.get(data.node.id); // WS echo node.created mohol byť rýchlejší
            if (!n) {
                n = { ...data.node };
                const a = anchorOf(n);
                n.x = a.x + (Math.random() - 0.5) * 50;
                n.y = a.y + (Math.random() - 0.5) * 50;
                n.flash = 1;
                S.nodes.push(n);
                S.byId.set(n.id, n);
                buildSim();
                kickSim(0.4);
            }
            updateHeaderMetrics();
            draw();
            card.remove();
            showToast('Uzol vytvorený', n.id);
            selectNode(n);
        } catch (err) {
            showToast('Vytvorenie sa nepodarilo');
        }
    }, 'Ukladám…');
}

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
    // Hadesove odpovede (aj thinking) dostanú avatar so zlatým prstencom
    let el = div;
    if (cls.indexOf('hades') !== -1) {
        el = document.createElement('div');
        el.className = 'msg-row';
        el.innerHTML = '<span class="avatar" aria-hidden="true">H</span>';
        el.appendChild(div);
    }
    log.appendChild(el);
    log.scrollTop = 1e9;
    return el;
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

    renderContextChips(); // E3: obnov priložené uzly z úložiska (byId je už naplnené)

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
            // E3: prilož len existujúce uzly (mŕtve id preskoč), backend capuje na 20
            const ctxIds = [...S.chatContext].filter((id) => S.byId.has(id)).slice(0, 20);
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    history: chatHistory.slice(-12, -1),
                    context_node_ids: ctxIds,
                }),
            });
            const data = await res.json();
            thinking.remove();
            const reply = data.reply || data.message || 'Hades mlčí.';
            addMsg('hades', reply);
            chatHistory.push({ role: 'assistant', content: reply });
            // E2: pri remember-intente backend vráti suggested_node → potvrdzovacia karta
            if (data && data.suggested_node) renderSuggestCard(data.suggested_node);
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
            closeCmdk();
            openCmdk();
            if (arg) { $('cmdk-input').value = arg; renderCmdk(arg); }
            sys(arg ? 'Hľadám: ' + arg : 'Otvoril som hľadanie.');
            break;
        case 'zoom':
            if (arg === 'in') zoomBy(1.3);
            else if (arg === 'out') zoomBy(1 / 1.3);
            else fitView();
            sys('Zoom upravený.');
            break;
        case 'legenda': openDock('legend'); sys('Legenda otvorená.'); break;
        case 'statistiky': case 'stats': openDock('stats'); sys('Štatistiky otvorené.'); break;
        case 'pomoc': case 'help': toggleHelp(true); break;
        default:
            sys('Neznámy príkaz. Skús /nahlad, /najdi, /zoom, /legenda, /statistiky, /pomoc');
    }
}

/* ---------- toasty, pomocnik, hinty ---------- */

function showToast(text, nodeId, variant) {
    const wrap = $('toasts');
    // button — prístupné z klávesnice, klik naviguje na uzol
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('role', 'status');
    el.className = 'toast' + (variant ? ' ' + variant : '');
    // variantná ikona (success/warn/error); default hub
    const icon = { success: 'check_circle', warn: 'warning', error: 'error' }[variant] || 'hub';
    const parts = String(text).split(/:\s(.+)/);
    el.innerHTML = parts.length > 1
        ? '<span class="ms" aria-hidden="true">' + icon + '</span><span>' + esc(parts[0]) + ': <strong>' + esc(parts[1]) + '</strong></span>'
        : '<span class="ms" aria-hidden="true">' + icon + '</span><span>' + esc(text) + '</span>';

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
    ['Ctrl K / F / /', 'Hľadať (paleta)'],
    ['1 / 2 / 3', 'Náhľad grafu: Mapa / Sieť / Vrstvy'],
    ['D', 'Denník'],
    ['R', 'Štruktúra'],
    ['S', 'Prehľad'],
    ['L', 'Legenda'],
    ['G', 'Lokálny graf zvoleného uzla'],
    ['N', 'Nový uzol'],
    ['+ / −', 'Zoom'],
    ['0', 'Vycentrovať'],
    ['?', 'Tento pomocník'],
    ['Esc', 'Zavrieť panely'],
];

const MOUSE_HINTS = [
    ['ťahanie', 'Posun plátna'],
    ['ťahanie uzla', 'Presun uzla (mapa / sieť)'],
    ['koliesko', 'Zoom'],
    ['klik na uzol', 'Detail'],
    ['dvojklik na oblasť', 'Zaostrenie oblasti'],
    ['Esc', 'Postupné zatváranie'],
];

let helpReturnFocus = null;

function toggleHelp(show) {
    const el = $('help-overlay');
    const target = show === undefined ? el.classList.contains('hidden') : show;
    el.classList.toggle('hidden', !target);
    if (target && !$('help-body').children.length) {
        const row = ([k, d]) => {
            const caps = k.split(/\s*\/\s*/).map((x) => '<kbd>' + x + '</kbd>').join('<span class="sep">/</span>');
            return '<div class="key-row"><span class="label">' + d + '</span><span>' + caps + '</span></div>';
        };
        $('help-body').innerHTML = SHORTCUTS.map(row).join('')
            + '<h3>Myš</h3>'
            + MOUSE_HINTS.map(row).join('');
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
        // FÁZA SHELL: Cmd/Ctrl+K → globálna paleta (hľadanie + navigácia), toggle
        if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            if (cmdkOpen()) closeCmdk(); else openCmdk();
            return;
        }

        if (e.key === 'Escape') {
            // kaskáda — jeden Esc zavrie vždy len najvrchnejšiu vrstvu
            if (cmdkOpen()) { closeCmdk(); return; }
            if (packDrawerOpen()) { closePackDrawer(); return; }
            if (S.connectFrom) { cancelConnect(); showToast('Prepájanie zrušené'); return; }
            if (S.screen === 'kontrola') {
                const armed = document.querySelector('#kontrola-body .act-skip.armed');
                if (armed) { disarmKontrolaBtn(armed); return; }
            }
            if (document.body.classList.contains('ambient')) {
                document.body.classList.remove('ambient');
                return;
            }
            if (!$('md-overlay').classList.contains('hidden')) { closeMdOverlay(); return; }
            if (!$('help-overlay').classList.contains('hidden')) { toggleHelp(false); return; }
            const deptRow = document.querySelector('#structure-tree .dept-actions');
            if (deptRow) { deptRow.remove(); return; }
            if (!$('node-panel').classList.contains('hidden')) { closeNodePanel(); return; }
            if (dockOpen) { closeDock(); return; }
            if ($('prompt').classList.contains('open') || !$('chat-log').classList.contains('hidden')) {
                collapsePrompt();
                return;
            }
            if (S.local) { clearLocal(); return; }
            if (S.focus.areaId) setFocus(null, null);
            return;
        }

        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (/INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable)) return;

        // Obrazovka Kontrola — klávesová fronta (skratky NEstrieľajú mimo nej)
        if (S.screen === 'kontrola' && kontrolaState.items.length) {
            const cur = kontrolaState.items[kontrolaState.idx];
            let handled = true;
            switch (e.key) {
                case 'j': case 'ArrowDown': kontrolaMove(1); break;
                case 'k': case 'ArrowUp': kontrolaMove(-1); break;
                case 'Enter': if (cur) openNodeFromAnywhere(kontrolaNodeRef(cur.id)); break;
                case 'v': case 'V': if (cur) kontrolaVerify(cur.id); break;
                case 'r': case 'R': if (cur) kontrolaResolve(cur.id); break;
                case 'Delete': case 'Backspace': if (cur) armKontrolaAction(kontrolaBtn(cur.id, 'skip'), cur.id, 'delete'); break;
                default: handled = false;
            }
            if (handled) { e.preventDefault(); return; }
        }

        // SK klávesnica: fyzické kódy číslic fungujú nezávisle od rozloženia
        switch (e.code) {
            case 'Digit1': setView('map'); return;
            case 'Digit2': setView('net'); return;
            case 'Digit3': setView('layers'); return;
            case 'Digit0': fitView(); return;
            case 'NumpadAdd': zoomBy(1.3); return;
            case 'NumpadSubtract': zoomBy(1 / 1.3); return;
        }

        switch (e.key) {
            case '1': setView('map'); break;
            case '2': setView('net'); break;
            case '3': setView('layers'); break;
            case '/': case 'f': case 'F': e.preventDefault(); openCmdk(); break;
            case 'r': case 'R': openDock('structure'); break;
            case 's': case 'S': openDock('stats'); break;
            case 'd': case 'D': setScreen('dennik'); break;
            case 'l': case 'L': openDock('legend'); break;
            case 'g': case 'G':
                // lokálny graf zvoleného uzla — toggle; hĺbka sa zachováva
                if (S.selected) {
                    if (S.local && S.local.rootId === S.selected.id) clearLocal();
                    else setLocal(S.selected.id, S.local ? S.local.depth : 1);
                }
                break;
            case 'n': case 'N': openCreateNode(); break;
            case 'c': case 'C':
                if (document.body.classList.contains('chat-on')) {
                    e.preventDefault();
                    $('prompt').classList.add('open');
                    $('prompt-input').focus();
                }
                break;
            case '+': case '=': zoomBy(1.3); break;
            case '-': zoomBy(1 / 1.3); break;
            case '0': fitView(); break;
            case '?': toggleHelp(); break;
        }
    });
}

const HINTS = [
    { pos: { left: '104px', top: '120px' }, text: 'Vľavo prepínaš obrazovky — Dnes, Denník, Graf a Knižnica. Hades sa otvorí na Dnes.' },
    { pos: { left: '50%', top: '76px', transform: 'translateX(-50%)' }, text: 'Hore vpravo je hľadanie (Ctrl K alebo /). Nájde uzly, playbooky aj obrazovky.' },
    { pos: { left: '50%', top: '40%', transform: 'translateX(-50%)' }, text: 'Na obrazovke Graf klik na uzol otvorí detail. Dvojklik na oblasť ju zaostrí — Esc zaostrenie zruší.' },
    { pos: { left: '104px', bottom: '24px' }, text: 'Dole vľavo nájdeš Nastavenia (tmavý režim, sieť, chat) a Pomocníka.' },
];

function setupHints() {
    if (localStorage.getItem('hades.hints2') === 'done') return;
    const el = $('hint');
    let i = 0;

    const finish = () => {
        el.classList.add('hidden');
        localStorage.setItem('hades.hints2', 'done');
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

/* ---------- FÁZA SHELL: obrazovky Dnes / Denník / Graf / Knižnica ---------- */

const SCREENS = ['dnes', 'dennik', 'graf', 'kniznica', 'rozhodnutia', 'kontrola', 'smernica'];
const SCREEN_LABELS = { dnes: 'Dnes', dennik: 'Denník', graf: 'Graf', kniznica: 'Knižnica', rozhodnutia: 'Rozhodnutia', kontrola: 'Kontrola', smernica: 'Smernica' };

function setScreen(name) {
    if (!SCREENS.includes(name)) name = 'dnes';
    const changed = S.screen !== name;
    S.screen = name;
    localStorage.setItem('hades.screen', name);
    document.body.dataset.screen = name;

    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.classList.toggle('active', b.dataset.screen === name);
    });
    document.querySelectorAll('#screens .screen').forEach((s) => {
        s.classList.toggle('active', s.id === 'screen-' + name);
    });

    renderScreenBreadcrumb(name);

    if (name === 'graf') {
        // plátno je hotové z kola 1 — len prebuď slučku (dirty + scheduleFrame)
        requestDraw();
        scheduleFrame();
    } else if (name === 'dnes') {
        renderToday();
    } else if (name === 'dennik') {
        renderJournal();
        markJournalSeen();
    } else if (name === 'kniznica') {
        renderLibrary();
    } else if (name === 'rozhodnutia') {
        renderDecisions();
    } else if (name === 'kontrola') {
        renderKontrola();
    } else if (name === 'smernica') {
        renderDirective();
    }
    if (changed && name !== 'graf') closeNodePanel();
}

function renderScreenBreadcrumb(name) {
    if (name === 'graf') { renderBreadcrumb(); return; }
    const bc = $('breadcrumb');
    if (bc) bc.innerHTML = '<span class="current">' + esc(SCREEN_LABELS[name]) + '</span>';
}

// Uzol otvorený z ktorejkoľvek obrazovky (Denník/Knižnica/Dnes/Cmd-K) → skoč na Graf a otvor detail.
// ref môže byť plný načítaný uzol, alebo odľahčený {id,label,type,area_id} z hľadania/knižnice.
// Graf beží v scope=live (nie všetky uzly sú na plátne) — ak uzol nie je načítaný, otvor aspoň
// jeho detail (selectNode si dotiahne /api/nodes/{id}), len bez kamerového zaostrenia.
function openNodeFromAnywhere(ref) {
    if (!ref || ref.id == null) return;
    const id = +ref.id;
    const loaded = S.byId.get(id);
    setScreen('graf');
    if (loaded) {
        S.cam.k = Math.max(S.cam.k, 1.1);
        focusNode(loaded);
        selectNode(loaded);
    } else {
        selectNode({
            id,
            label: ref.label || '',
            type: ref.type || 'skill',
            description: '',
            strength: ref.strength || 1,
            area_id: ref.area_id != null ? ref.area_id : null,
        });
    }
}

/* ---------- obrazovka Dnes (dashboard: /api/today + /api/dashboard) ---------- */

// Origin badge — brain (.md, zdroj pravdy) vs session (DB). §4.8 ikony menu_book/bolt.
function originBadge(origin) {
    const o = origin === 'brain' ? 'brain' : 'session';
    const icon = o === 'brain' ? 'menu_book' : 'bolt';
    return '<span class="origin" data-origin="' + o + '">'
        + '<span class="ms" aria-hidden="true">' + icon + '</span>' + o + '</span>';
}

// Shimmer skeleton počas načítania dashboardu (loading stav)
function todaySkeleton() {
    const bar = (w, h) => '<div class="shimmer" style="width:' + w + ';height:' + h + ';border-radius:var(--r-md);"></div>';
    return '<div style="display:flex;flex-direction:column;gap:var(--gutter);">'
        + bar('100%', '46px')
        + '<div class="kpi-grid">' + [0, 0, 0, 0].map(() => bar('100%', '58px')).join('') + '</div>'
        + '<div class="dash-grid">' + bar('100%', '160px') + bar('100%', '160px') + '</div>'
        + '</div>';
}

async function renderToday() {
    const body = $('dnes-body');
    if (!body) return;
    // Dashboard potrebuje viac miesta než 920px čítacia šírka ostatných obrazoviek.
    const screen = $('screen-dnes');
    if (screen) screen.style.maxWidth = '1120px';
    body.innerHTML = todaySkeleton();

    // /api/today je ľahký (sessions/records/projekty); ťažké agregáty sú v /api/dashboard (§4.1).
    const [todayRes, dashRes] = await Promise.allSettled([
        fetch('/api/today').then((r) => r.json()),
        fetch('/api/dashboard').then((r) => r.json()),
    ]);

    if (todayRes.status !== 'fulfilled') {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
        return;
    }
    const d = todayRes.value;
    const dash = dashRes.status === 'fulfilled' ? dashRes.value : null;
    const wb = d.week_added || {};

    // Veľké hľadacie pole — primárny prvok obrazovky (otvorí Cmd-K paletu)
    let h = '<button type="button" id="today-search" class="today-search">'
        + '<span class="ms" aria-hidden="true">search</span>'
        + '<span class="ts-text">Hľadaj vo vedomí — skilly, záznamy, projekty…</span>'
        + '<kbd>Ctrl K</kbd></button>';

    h += '<p class="today-line">Tento týždeň pribudlo <strong>' + esc(String(wb.nodes ?? 0))
        + '</strong> ' + plural(wb.nodes ?? 0, 'poznatok', 'poznatky', 'poznatkov')
        + ', <strong>' + esc(String(wb.sessions ?? 0)) + '</strong> '
        + plural(wb.sessions ?? 0, 'záznam', 'záznamy', 'záznamov') + '.</p>';

    // ---- Dashboard agregáty (KPI + charty + Sync) z /api/dashboard ----
    if (dash) h += dashboardHtml(dash);

    // ---- Naposledy / záznamy / projekty (z /api/today) ----
    const sessions = d.recent_sessions || [];
    if (sessions.length) {
        h += '<section class="today-sec"><h2>Naposledy si robil na…</h2><div class="today-grid">'
            + sessions.slice(0, 6).map((s) => todaySessionCard(s)).join('')
            + '</div></section>';
    }

    const records = d.recent_records || [];
    if (records.length) {
        h += '<section class="today-sec"><h2>Posledné záznamy</h2><div class="today-list">'
            + records.map((r) => todayRow('article', r.id, r.label, r.project, r.snippet, r.created_at)).join('')
            + '</div></section>';
    }

    const projects = d.top_projects || [];
    if (projects.length) {
        h += '<section class="today-sec"><h2>Aktívne projekty</h2><div class="today-chips">'
            + projects.map((p) => '<span class="today-chip">' + esc(p.project)
                + '<span class="n">' + (p.count || 0) + '</span></span>').join('')
            + '</div></section>';
    }

    body.innerHTML = h;

    // Charty + Sync wiring — kontajnery sú už v DOM po nastavení innerHTML.
    if (dash) renderDashboardBlocks(dash);

    const searchBtn = $('today-search');
    if (searchBtn) searchBtn.onclick = openCmdk;
    body.querySelectorAll('.today-item[data-id], .today-card-link[data-id]').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(body);
}

// Statický HTML dashboardu — KPI rad + grid kariet s prázdnymi kontajnermi pre charty (charts.js).
function dashboardHtml(dash) {
    const counts = dash.counts || {};
    const cert = dash.certainty || {};
    const num = (n) => esc(String(n ?? 0));

    const kpi = (val, label, suffix) =>
        '<div class="kpi-card"><div class="kpi-val">' + num(val)
        + (suffix ? '<span class="kpi-suffix">' + esc(suffix) + '</span>' : '')
        + '</div><div class="kpi-label">' + esc(label) + '</div></div>';

    let h = '<div class="kpi-grid">'
        + kpi(counts.nodes, 'uzlov')
        + kpi(counts.edges, 'spojení')
        + kpi(counts.brain, 'brain')
        + kpi(counts.session, 'session')
        + kpi(counts.decisions, 'rozhodnutí')
        + kpi(cert.needs_review, 'na overenie')
        + '</div>';

    h += '<div class="dash-grid">';

    // Heatmapa aktivity — cez 2 stĺpce; .heat sám skroluje horizontálne.
    h += '<div class="dash-card span-2"><div class="dash-head">'
        + '<span class="dash-title">Aktivita</span>'
        + '<span class="dash-note">' + num((dash.heatmap || {}).total) + ' za rok</span>'
        + '</div><div id="dash-heat"></div></div>';

    // Donut istoty + legenda
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Istota</span></div>'
        + '<div style="display:flex;flex-direction:column;gap:var(--sp-2);align-items:center;">'
        + '<div id="dash-donut"></div>'
        + certLegend(cert)
        + '</div></div>';

    // Kumulatívny rast siete
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Rast siete</span>'
        + '<span class="dash-note">kumulatívne</span></div>'
        + '<div id="dash-growth"></div></div>';

    // Bary per oblasť
    h += '<div class="dash-card"><div class="dash-head"><span class="dash-title">Podľa oblasti</span></div>'
        + perAreaHtml(dash.per_area || []) + '</div>';

    // Sync karta
    h += syncCardHtml(dash);

    h += '</div>';
    return h;
}

// Legenda istoty — swatch + názov + počet; farby berie CSS z data-cert.
function certLegend(cert) {
    const rows = [
        ['overene', 'overené', cert.overene],
        ['hypoteza', 'hypotéza', cert.hypoteza],
        ['pasca', 'pasca', cert.pasca],
        ['bez', 'bez značky', cert.bez],
    ];
    return '<div class="cert-legend">'
        + rows.map((r) =>
            '<div class="cl-row" data-cert="' + r[0] + '">'
            + '<span class="cl-sw"></span>'
            + '<span class="cl-name">' + esc(r[1]) + '</span>'
            + '<span class="cl-n">' + esc(String(r[2] ?? 0)) + '</span></div>').join('')
        + '</div>';
}

// Bary per oblasť — farba oblasti cez inline --lobe (dedí sa na dot aj fill).
function perAreaHtml(areas) {
    if (!areas.length) return emptyHtml('category', 'Žiadne oblasti');
    const max = Math.max.apply(null, areas.map((a) => +a.count || 0).concat([1]));
    return areas.map((a) => {
        const pct = Math.round(((+a.count || 0) / max) * 100);
        const color = a.color || 'var(--accent)';
        return '<div class="dbar" style="--lobe:' + esc(color) + ';">'
            + '<div class="dbar-head"><span class="db-dot"></span>'
            + '<span class="db-name">' + esc(a.name || a.slug || '') + '</span>'
            + '<span class="db-n">' + esc(String(a.count || 0)) + '</span></div>'
            + '<div class="dbar-track"><div class="dbar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('');
}

// Sync karta — stav (status-dot), štatistiky posledného behu, brain-write guard, „Sync teraz".
function syncCardHtml(dash) {
    const sync = dash.sync || {};
    const status = ['ok', 'partial', 'error', 'running'].includes(sync.status) ? sync.status : 'ok';
    const statusLabel = { ok: 'v poriadku', partial: 'čiastočne', error: 'chyba', running: 'prebieha' }[status];
    const guardOn = !!(dash.brain_write_enabled != null ? dash.brain_write_enabled : sync.brain_write_enabled);

    const rowStyle = 'display:flex;align-items:center;gap:var(--sp-1);';
    const bits = [
        ['+' + (sync.created ?? 0), 'nových'],
        ['~' + (sync.updated ?? 0), 'zmien'],
        ['−' + (sync.deleted ?? 0), 'zmazaných'],
        ['»' + (sync.skipped ?? 0), 'preskočených'],
    ];
    const stats = '<div style="display:flex;flex-wrap:wrap;gap:var(--sp-1) var(--sp-2);'
        + 'font-family:var(--mono);font-size:var(--fs-small);color:var(--muted);">'
        + bits.map((b) => '<span><strong style="color:var(--text-secondary);">' + esc(b[0]) + '</strong> '
            + esc(b[1]) + '</span>').join('') + '</div>';

    return '<div class="dash-card"><div class="dash-head">'
        + '<span class="dash-title">Synchronizácia</span>'
        + '<span class="dash-note">' + (sync.finished_at ? esc(timeAgo(sync.finished_at)) : '—') + '</span>'
        + '</div>'
        + '<div style="' + rowStyle + 'font-size:var(--fs-small);color:var(--text-secondary);">'
        + '<span class="status-dot" data-status="' + status + '"></span><span>' + esc(statusLabel) + '</span></div>'
        + (sync.message ? '<p style="font-size:var(--fs-small);color:var(--muted);margin:0;">' + esc(sync.message) + '</p>' : '')
        + stats
        + '<div style="' + rowStyle + 'font-family:var(--mono);font-size:var(--fs-caption);color:var(--muted);">'
        + '<span class="ms" aria-hidden="true" style="font-size:var(--icon-sm);">' + (guardOn ? 'lock_open' : 'lock') + '</span>'
        + 'Zápis do brain: <strong style="color:var(--text-secondary);">' + (guardOn ? 'zapnutý' : 'vypnutý') + '</strong></div>'
        + '<button type="button" id="sync-now" class="primary" style="align-self:flex-start;display:inline-flex;align-items:center;gap:6px;">'
        + '<span class="ms" aria-hidden="true">sync</span> Sync teraz</button>'
        + '</div>';
}

// Napojenie chartov (charts.js) a Sync tlačidla na existujúce DOM kontajnery.
function renderDashboardBlocks(dash) {
    if (!window.HadesCharts) return;

    const heat = $('dash-heat');
    if (heat) HadesCharts.heatmap(heat, dash.heatmap || {});

    const donutEl = $('dash-donut');
    if (donutEl) {
        const c = dash.certainty || {};
        HadesCharts.donut(donutEl, [
            { cert: 'overene', value: c.overene || 0 },
            { cert: 'hypoteza', value: c.hypoteza || 0 },
            { cert: 'pasca', value: c.pasca || 0 },
            { cert: 'bez', value: c.bez || 0 },
        ], { total: c.total || 0, centerLabel: 'uzlov' });
    }

    const growth = $('dash-growth');
    if (growth) HadesCharts.growthLine(growth, dash.growth || {});

    const syncBtn = $('sync-now');
    if (syncBtn) syncBtn.onclick = () => doSync(syncBtn);
}

// „Sync teraz" → POST /api/sync; 423 = lock (už beží). Po úspechu toast + refresh dashboardu.
async function doSync(btn) {
    await busy(btn, async () => {
        let res;
        try {
            res = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
        } catch (e) {
            showToast('Sync zlyhal', null, 'error');
            return;
        }
        if (res.status === 423) { showToast('Sync už prebieha', null, 'warn'); return; }
        let j = {};
        try { j = await res.json(); } catch (e) { /* prázdna odpoveď */ }
        if (!res.ok) { showToast(j.message || j.error || 'Sync zlyhal', null, 'error'); return; }
        const st = j.stats || j.sync || j.run || j;
        showToast('Sync hotový: +' + (st.created ?? 0) + ' / ~' + (st.updated ?? 0), null, 'success');
        renderToday();
    }, 'Sync…');
}

// SK plurál 1 / 2-4 / 5+ (a 0)
function plural(n, one, few, many) {
    n = Math.abs(+n) || 0;
    if (n === 1) return one;
    if (n >= 2 && n <= 4) return few;
    return many;
}

function todaySessionCard(s) {
    return '<div class="today-card-wrap">'
        + '<button type="button" class="today-card-link" data-id="' + s.id + '" data-label="' + esc(s.label || '') + '">'
        + '<span class="tcl-title">' + esc(s.label || '') + '</span>'
        + '<span class="tcl-meta">'
        + (s.project ? '<span class="tcl-proj">' + esc(s.project) + '</span>' : '')
        + (s.created_at ? '<span class="tcl-time">' + esc(timeAgo(s.created_at)) + '</span>' : '')
        + '</span></button>'
        + packBtn(s.id, s.label) + '</div>';
}

function todayRow(icon, id, label, project, snippet, iso) {
    return '<div class="li-wrap">'
        + '<button type="button" class="today-item" data-id="' + id + '" data-label="' + esc(label || '') + '">'
        + '<span class="ms ti-ico" aria-hidden="true">' + icon + '</span>'
        + '<span class="ti-text"><span class="ti-title">' + esc(label || '') + '</span>'
        + (snippet ? '<span class="ti-snip">' + esc(snippet) + '</span>' : '')
        + '</span>'
        + (project ? '<span class="ti-tag">' + esc(project) + '</span>' : '')
        + (iso ? '<span class="ti-time">' + esc(timeAgo(iso)) + '</span>' : '')
        + '</button>'
        + packBtn(id, label) + '</div>';
}

/* ---------- certainty badge (.cert) — zdieľaný helper (F3; F4 ho reuse-uje) ----
   §4.5/§4.8: data-cert="overene|hypoteza|pasca|bez|pending"; ikony
   verified/science/warning/radio_button_unchecked/pending. iconOnly = .cert--icon. */
const CERT_META = {
    overene: ['verified', 'Overené'],
    hypoteza: ['science', 'Hypotéza'],
    pasca: ['warning', 'Pasca'],
    pending: ['pending', 'Neštruktúrované'],
    bez: ['radio_button_unchecked', 'Bez istoty'],
};

function certBadge(cert, iconOnly) {
    const key = CERT_META[cert] ? cert : 'bez';
    const meta = CERT_META[key];
    return '<span class="cert' + (iconOnly ? ' cert--icon' : '') + '" data-cert="' + key + '"'
        + (iconOnly ? ' title="' + esc(meta[1]) + '"' : '') + '>'
        + '<span class="ms" aria-hidden="true">' + meta[0] + '</span>'
        + (iconOnly ? '' : esc(meta[1])) + '</span>';
}

// F4: badge riadok v detaile uzla — origin + cert + needs_review + značky (chipy).
// Injektovaný do #node-view za #node-type (blade patrí F1). n má polia z toApi().
function renderNodeBadges(n) {
    const view = $('node-view');
    if (!view) return;
    let row = $('node-badges');
    if (!row) {
        row = document.createElement('div');
        row.id = 'node-badges';
        row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0 2px;';
        const anchor = $('node-type');
        if (anchor) anchor.insertAdjacentElement('afterend', row);
        else view.insertBefore(row, view.firstChild);
    }
    const tags = Array.isArray(n.tags) ? n.tags : [];
    const chips = tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    row.innerHTML = originBadge(n.origin)
        + (n.certainty ? certBadge(n.certainty) : '')
        + (n.needs_review ? certBadge('pending', true) : '')
        + chips;
}

// Undo toast — variant success s tlačidlom „Späť" (armed-inline akcie: skip). Na
// rozdiel od showToast (button) je to div, aby sme mohli vnoriť undo tlačidlo.
function showUndoToast(text, onUndo) {
    const wrap = $('toasts');
    const el = document.createElement('div');
    el.className = 'toast success';
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ms" aria-hidden="true">check_circle</span><span>' + esc(text) + '</span>';
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.className = 'toast-undo chip';
    undo.textContent = 'Späť';
    el.appendChild(undo);

    const leave = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), REDUCED_MOTION ? 0 : 200); };
    let t = setTimeout(leave, REDUCED_MOTION ? 0 : 6000);
    undo.onclick = () => { clearTimeout(t); leave(); if (onUndo) onUndo(); };
    el.addEventListener('mouseenter', () => clearTimeout(t));
    el.addEventListener('mouseleave', () => { t = setTimeout(leave, REDUCED_MOTION ? 0 : 2500); });

    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.firstChild.remove();
}

/* ---------- obrazovka Rozhodnutia (/api/decisions) — časová os ----------
   Časová os rozhodnutí zoskupená po mesiacoch (.dtl*), filtre obdobie/oblasť
   (reuse .chip v .dtl-filter, filtrovanie klientsky nad jedným fetchom),
   detail/expand dôvodu klikom na kartu a manuálne pridanie → POST /api/decisions. */

const decisionsState = { all: [], year: null, areaId: null, adding: false };

async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    renderEmpty(body, 'hourglass_empty', 'Načítavam…');
    try {
        const d = await (await fetch('/api/decisions')).json();
        decisionsState.all = d.decisions || [];
        // filtre, ktoré prestali existovať, vynuluj
        renderDecisionsView();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

function decChip(label, active, attrs) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '" ' + attrs + '>' + esc(label) + '</button>';
}

function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    const all = decisionsState.all;

    const years = [...new Set(all.map((x) => (x.decided_on || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const areaIds = [...new Set(all.map((x) => x.area_id).filter((v) => v != null))];

    // Toolbar + manuálne pridanie
    let h = '<div class="dec-toolbar" style="display:flex;justify-content:flex-end;margin-bottom:var(--sp-2);">'
        + '<button type="button" id="dec-add-toggle" class="chip">'
        + '<span class="ms" aria-hidden="true">' + (decisionsState.adding ? 'close' : 'add') + '</span>'
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button></div>';
    if (decisionsState.adding) h += decAddFormHtml();

    // Filtre obdobie / oblasť
    if (years.length > 1) {
        h += '<div class="dtl-filter">'
            + decChip('Celé obdobie', decisionsState.year === null, 'data-year=""')
            + years.map((y) => decChip(y, decisionsState.year === y, 'data-year="' + y + '"')).join('')
            + '</div>';
    }
    if (areaIds.length > 1) {
        h += '<div class="dtl-filter">'
            + decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""')
            + areaIds.map((aid) => {
                const a = S.areas.get(aid);
                return decChip(a ? a.name : ('#' + aid), decisionsState.areaId === aid, 'data-area="' + aid + '"');
            }).join('')
            + '</div>';
    }

    const list = all.filter((x) => {
        if (decisionsState.year !== null && (x.decided_on || '').slice(0, 4) !== decisionsState.year) return false;
        if (decisionsState.areaId !== null && x.area_id !== decisionsState.areaId) return false;
        return true;
    });

    if (!list.length) {
        h += emptyHtml('gavel', all.length ? 'Žiadne rozhodnutia pre tento filter' : 'Zatiaľ žiadne rozhodnutia');
    } else {
        h += decisionsTimelineHtml(list);
    }

    body.innerHTML = h;
    wireDecisions(body);
}

function decAddFormHtml() {
    const areaOpts = '<option value="">— oblasť (voliteľné) —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    const today = new Date().toISOString().slice(0, 10);
    return '<div class="dec-add" style="display:flex;flex-direction:column;gap:var(--sp-1);'
        + 'background:var(--panel-solid);border:1px solid var(--border);border-radius:var(--r-md);'
        + 'padding:var(--sp-2);margin-bottom:var(--sp-2);">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div style="display:flex;gap:var(--sp-1);flex-wrap:wrap;align-items:center;">'
        + '<select id="dec-area" aria-label="Oblasť" style="flex:1;min-width:160px;">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum" style="flex:0 0 auto;">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}

function decisionsTimelineHtml(list) {
    const sorted = [...list].sort((a, b) => (b.decided_on || '').localeCompare(a.decided_on || ''));
    let out = '<div class="dtl">';
    let curMonth = '';
    for (const dec of sorted) {
        const ym = (dec.decided_on || '').slice(0, 7);
        if (ym !== curMonth) { curMonth = ym; out += '<div class="dtl-month">' + esc(monthLabel(ym)) + '</div>'; }
        out += decisionCardHtml(dec);
    }
    return out + '</div>';
}

function monthLabel(ym) {
    if (!ym) return 'Bez dátumu';
    const parts = ym.split('-');
    const dt = new Date(+parts[0], (+parts[1] || 1) - 1, 1);
    return dt.toLocaleDateString('sk', { month: 'long', year: 'numeric' });
}

function fmtDecDate(iso) {
    if (!iso) return '—';
    return new Date(iso + 'T00:00:00').toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}

function decisionCardHtml(dec) {
    const area = dec.area_id != null ? S.areas.get(dec.area_id) : null;
    const hasReason = !!(dec.reason && String(dec.reason).trim());
    return '<div class="dtl-item">'
        + '<span class="dtl-dot" data-origin="' + (dec.origin === 'brain' ? 'brain' : 'session') + '" aria-hidden="true"></span>'
        + '<button type="button" class="dtl-card" data-id="' + dec.id + '"'
        + (dec.node_id != null ? ' data-node="' + dec.node_id + '"' : '')
        + (hasReason ? ' data-reason="1"' : '') + '>'
        + '<div class="dtl-head"><span class="dtl-date">' + esc(fmtDecDate(dec.decided_on)) + '</span>'
        + '<span class="dtl-text">' + esc(dec.text) + '</span></div>'
        + (hasReason ? '<div class="dtl-reason hidden">' + esc(dec.reason) + '</div>' : '')
        + '<div class="dtl-meta">' + originBadge(dec.origin)
        + (area ? '<span class="tag">' + esc(area.name) + '</span>' : '')
        + (dec.node_id != null ? '<span class="tag muted">uzol #' + dec.node_id + '</span>' : '')
        + (hasReason ? '<span class="tag muted">dôvod ▾</span>' : '')
        + '</div></button></div>';
}

function wireDecisions(body) {
    const toggle = $('dec-add-toggle');
    if (toggle) toggle.onclick = () => { decisionsState.adding = !decisionsState.adding; renderDecisionsView(); if (decisionsState.adding) { const t = $('dec-text'); if (t) t.focus(); } };

    const saveBtn = $('dec-save');
    if (saveBtn) saveBtn.onclick = () => saveDecision(saveBtn);

    body.querySelectorAll('.dtl-filter [data-year]').forEach((c) => {
        c.onclick = () => { decisionsState.year = c.dataset.year || null; renderDecisionsView(); };
    });
    body.querySelectorAll('.dtl-filter [data-area]').forEach((c) => {
        c.onclick = () => { decisionsState.areaId = c.dataset.area ? +c.dataset.area : null; renderDecisionsView(); };
    });

    body.querySelectorAll('.dtl-card').forEach((card) => {
        card.onclick = () => {
            const reason = card.querySelector('.dtl-reason');
            if (card.dataset.reason && reason) {
                reason.classList.toggle('hidden');
            } else if (card.dataset.node) {
                openNodeFromAnywhere({ id: +card.dataset.node });
            }
        };
    });
}

async function saveDecision(btn) {
    const text = ($('dec-text').value || '').trim();
    if (!text) { showToast('Napíš text rozhodnutia'); $('dec-text').focus(); return; }
    const reason = ($('dec-reason').value || '').trim();
    const areaVal = $('dec-area').value;
    const dateVal = $('dec-date').value;
    const payload = { text };
    if (reason) payload.reason = reason;
    if (areaVal) payload.area = areaVal;
    if (dateVal) payload.decided_on = dateVal;

    await busy(btn, async () => {
        try {
            const res = await fetch('/api/decisions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || j.error || 'Uloženie zlyhalo', null, 'error');
                return;
            }
            decisionsState.adding = false;
            showToast('Rozhodnutie uložené', null, 'success');
            renderDecisions();
        } catch (e) {
            showToast('Uloženie zlyhalo', null, 'error');
        }
    }, 'Ukladám…');
}

/* ---------- obrazovka Kontrola (/api/review/queue) — verify/review fronta ----------
   Fronta needs_review uzlov (.queue*), klávesnica j/k/Enter/v/r/Delete (len na
   tejto obrazovke, viď setupShortcuts). Akcie: Overiť (verify), Vyriešiť
   (resolve-review), Preskočiť (lokálne, s undo). Rail badge cez setRailBadge. */

const kontrolaState = { items: [], idx: 0, total: 0 };

async function renderKontrola() {
    const body = $('kontrola-body');
    if (!body) return;
    renderEmpty(body, 'hourglass_empty', 'Načítavam…');
    try {
        const d = await (await fetch('/api/review/queue')).json();
        kontrolaState.items = d.queue || [];
        kontrolaState.total = d.total != null ? d.total : kontrolaState.items.length;
        kontrolaState.idx = 0;
        rerenderKontrola();
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

function rerenderKontrola() {
    const body = $('kontrola-body');
    if (!body) return;
    setRailBadge('kontrola', kontrolaState.total);
    const items = kontrolaState.items;
    if (!items.length) {
        renderEmpty(body, 'fact_check', 'Fronta na overenie je prázdna');
        return;
    }
    kontrolaState.idx = Math.max(0, Math.min(kontrolaState.idx, items.length - 1));
    body.innerHTML = '<div class="queue">'
        + items.map((n, i) => queueItemHtml(n, i)).join('')
        + '</div>' + kontrolaHintsHtml();
    wireKontrola(body);
}

function queueItemHtml(n, i) {
    const desc = n.description ? String(n.description).replace(/\s+/g, ' ').trim() : '';
    return '<div class="queue-item' + (i === kontrolaState.idx ? ' selected' : '') + '"'
        + ' data-id="' + n.id + '" data-idx="' + i + '" tabindex="-1">'
        + '<div class="queue-body">'
        + '<div class="queue-meta">'
        + '<span>' + esc(n.type || 'uzol') + '</span>'
        + originBadge(n.origin) + certBadge(n.certainty)
        + (n.created_at ? '<span>' + esc(timeAgo(n.created_at)) + '</span>' : '')
        + '</div>'
        + '<div class="queue-text"><strong>' + esc(n.label || '') + '</strong>'
        + (desc ? ' — ' + esc(desc) : '') + '</div>'
        + '</div>'
        + '<div class="queue-actions">'
        + '<button type="button" class="act-verify ms" data-act="verify" title="Overiť (v)" aria-label="Overiť">verified</button>'
        + '<button type="button" class="act-resolve ms" data-act="resolve" title="Vyriešiť (r)" aria-label="Vyriešiť">done_all</button>'
        + '<button type="button" class="act-skip ms" data-act="skip" title="Preskočiť" aria-label="Preskočiť">redo</button>'
        + '</div></div>';
}

function kontrolaHintsHtml() {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['v'], 'overiť')
        + kh(['r'], 'vyriešiť')
        + kh(['Del'], 'zmazať uzol')
        + '</div>';
}

function kontrolaNodeRef(id) {
    const n = kontrolaState.items.find((x) => x.id === id);
    return n ? { id: n.id, label: n.label, type: n.type, area_id: n.area_id } : { id };
}

function kontrolaBtn(id, act) {
    return document.querySelector('#kontrola-body .queue-item[data-id="' + id + '"] .act-' + act);
}

function wireKontrola(body) {
    body.querySelectorAll('.queue-item').forEach((item) => {
        const id = +item.dataset.id;
        const idx = +item.dataset.idx;
        item.addEventListener('mousedown', () => { kontrolaState.idx = idx; markKontrolaSelected(); });
        const bodyEl = item.querySelector('.queue-body');
        if (bodyEl) bodyEl.onclick = () => { kontrolaState.idx = idx; openNodeFromAnywhere(kontrolaNodeRef(id)); };
        const v = item.querySelector('.act-verify');
        if (v) v.onclick = (e) => { e.stopPropagation(); kontrolaVerify(id); };
        const r = item.querySelector('.act-resolve');
        if (r) r.onclick = (e) => { e.stopPropagation(); kontrolaResolve(id); };
        const s = item.querySelector('.act-skip');
        if (s) s.onclick = (e) => { e.stopPropagation(); armKontrolaAction(s, id, 'skip'); };
    });
}

function markKontrolaSelected() {
    const items = document.querySelectorAll('#kontrola-body .queue-item');
    items.forEach((el, i) => el.classList.toggle('selected', i === kontrolaState.idx));
    const cur = items[kontrolaState.idx];
    if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function kontrolaMove(delta) {
    if (!kontrolaState.items.length) return;
    const n = kontrolaState.items.length;
    kontrolaState.idx = (kontrolaState.idx + delta + n) % n;
    markKontrolaSelected();
}

// Odober položku z fronty; decBadge=true znižuje rail počítadlo (server-affecting).
function removeKontrolaItem(id, decBadge) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    kontrolaState.items.splice(i, 1);
    if (decBadge) kontrolaState.total = Math.max(0, kontrolaState.total - 1);
    if (kontrolaState.idx > i) kontrolaState.idx--;
    rerenderKontrola();
}

async function kontrolaVerify(id) {
    const btn = kontrolaBtn(id, 'verify') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/verify', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Overenie zlyhalo', null, 'error'); return; }
            removeKontrolaItem(id, true);
            const warns = j.warnings || [];
            showToast(warns.length ? ('Overené — ' + warns[0]) : 'Overené', null, 'success');
        } catch (e) { showToast('Overenie zlyhalo', null, 'error'); }
    }, '…');
}

async function kontrolaResolve(id) {
    const btn = kontrolaBtn(id, 'resolve') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/resolve-review', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Akcia zlyhala', null, 'error'); return; }
            removeKontrolaItem(id, true);
            showToast('Vyriešené', null, 'success');
        } catch (e) { showToast('Akcia zlyhala', null, 'error'); }
    }, '…');
}

// Armed-inline (žiadny natívny confirm): 1. akcia ozbrojí tlačidlo, 2. potvrdí.
// kind='skip' (lokálne preskočenie + undo) alebo 'delete' (DELETE uzla).
function disarmKontrolaBtn(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    btn.classList.add('ms');
    btn.textContent = 'redo';
    delete btn.dataset.armKind;
}

function armKontrolaAction(btn, id, kind) {
    if (!btn) return;
    if (btn.classList.contains('armed') && btn.dataset.armKind === kind) {
        disarmKontrolaBtn(btn);
        if (kind === 'delete') kontrolaDelete(id); else kontrolaSkip(id);
        return;
    }
    document.querySelectorAll('#kontrola-body .act-skip.armed').forEach(disarmKontrolaBtn);
    btn.classList.add('armed');
    btn.classList.remove('ms');
    btn.dataset.armKind = kind;
    btn.textContent = kind === 'delete' ? 'Zmazať uzol?' : 'Preskočiť?';
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmKontrolaBtn(btn); }, 3000);
}

function kontrolaSkip(id) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [removed] = kontrolaState.items.splice(i, 1);
    if (kontrolaState.idx > i || kontrolaState.idx >= kontrolaState.items.length) {
        kontrolaState.idx = Math.max(0, kontrolaState.idx - (kontrolaState.idx > i ? 1 : 0));
    }
    rerenderKontrola();
    // preskočenie je len lokálne (uzol ostáva v serverovej fronte) → total badge nemeníme
    showUndoToast('Preskočené', () => {
        kontrolaState.items.splice(Math.min(i, kontrolaState.items.length), 0, removed);
        kontrolaState.idx = i;
        rerenderKontrola();
    });
}

async function kontrolaDelete(id) {
    const node = kontrolaState.items.find((n) => n.id === id);
    try {
        const res = await fetch('/api/nodes/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
            return;
        }
        // dorovnaj aj graf, ak je uzol načítaný (rovnako ako node-panel delete)
        if (node && S.byId.has(id)) {
            S.nodes = S.nodes.filter((m) => m.id !== id);
            S.edges = S.edges.filter((e) => e.source.id !== id && e.target.id !== id);
            S.byId.delete(id);
            if (S.local && S.local.rootId === id) clearLocal();
        }
        removeKontrolaItem(id, true);
        showToast('Uzol zmazaný', null, 'success');
    } catch (e) {
        showToast('Nepodarilo sa zmazať', null, 'error');
    }
}

/* ---------- obrazovka Knižnica (/api/library) ---------- */

let libraryTimer = null;

// F4: meta riadok skillu v Knižnici — origin + cert (icon) + značky (chipy).
function libMeta(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const chips = tags.slice(0, 5).map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    const cert = s.certainty ? certBadge(s.certainty, true) : '';
    const parts = originBadge(s.origin) + cert + chips;
    return '<span class="lib-skill-meta" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:6px;">'
        + parts + '</span>';
}

async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    renderEmpty(body, 'hourglass_empty', 'Načítavam…');
    const q = ($('library-search').value || '').trim();
    try {
        const url = '/api/library' + (q ? ('?q=' + encodeURIComponent(q)) : '');
        const d = await (await fetch(url)).json();
        const areas = d.areas || [];
        if (!areas.length) {
            renderEmpty(body, 'menu_book', q ? 'Nič sa nenašlo' : 'Prázdna knižnica');
            return;
        }
        body.innerHTML = areas.map((a) =>
            '<section class="lib-area"><h2>'
            + '<span class="lib-dot" style="background:' + esc(a.color || 'var(--muted)') + '"></span>'
            + esc(a.name) + '<span class="lib-count">' + (a.skills ? a.skills.length : 0) + '</span></h2>'
            + '<div class="lib-skills">'
            + (a.skills || []).map((s) =>
                '<div class="li-wrap lib-wrap">'
                + '<button type="button" class="lib-skill" data-id="' + s.id + '" data-label="' + esc(s.label) + '"'
                + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
                + '<span class="lib-skill-label">' + esc(s.label) + '</span>'
                + (s.snippet ? '<span class="lib-skill-snip">' + esc(s.snippet) + '</span>' : '')
                + libMeta(s)
                + '</button>'
                + packBtn(s.id, s.label) + '</div>').join('')
            + '</div></section>'
        ).join('');
        body.querySelectorAll('.lib-skill[data-id]').forEach((el) => {
            el.onclick = () => openMdOverlay({ id: +el.dataset.id, label: el.dataset.label, path: el.dataset.path || null });
        });
        bindPackButtons(body);
    } catch (e) {
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

/* ---------- obrazovka Smernica (/api/directive/*) ----------
   Prompt builder: úloha → Hades poskladá KDE ČO NÁJDE (skilly, projekty,
   fakty, pravidlá). Návrh je editovateľný checklist; náhľad smernice sa
   prestavuje klientsky z vybraných položiek (aby unchecked ostalo unchecked).
   Uloženie zapíše directives/<slug>.md cez /api/directive/save. */

let directiveData = null;         // posledný /build výsledok { task, suggested }
const directiveSel = new Set();   // node_id zahrnuté v smernici (zaškrtnuté)
let directiveTemplates = null;    // cache šablón (/api/directive/templates)
let directiveMarkdown = '';       // aktuálny markdown náhľadu (na copy/save)
let directiveBuildSeq = 0;        // ochrana proti pretekaniu odpovedí

const DIR_SECTIONS = [
    { key: 'skills', title: 'Skilly', icon: 'bolt' },
    { key: 'projects', title: 'Projekty', icon: 'inventory_2' },
    { key: 'facts', title: 'Fakty', icon: 'psychology' },
    { key: 'rules', title: 'Pravidlá', icon: 'gavel' },
];

function renderDirective(prefillTask) {
    const body = $('directive-body');
    if (!body) return;
    body.innerHTML =
        '<div class="dir-templates" id="dir-templates"></div>'
        + '<div class="dir-input-row">'
        + '<input id="dir-task" class="dir-task" placeholder="Na čom pracuješ? Napíš úlohu…" autocomplete="off" aria-label="Úloha">'
        + '<button type="button" id="dir-build" class="primary">Poskladať</button>'
        + '</div>'
        + '<div class="dir-cols">'
        + '<div class="dir-suggest" id="dir-suggest"></div>'
        + '<div class="dir-preview-wrap">'
        + '<div class="dir-preview-head"><h2>Náhľad smernice</h2>'
        + '<div class="dir-actions">'
        + '<button type="button" id="dir-copy" class="ghost ms" title="Kopírovať smernicu" aria-label="Kopírovať smernicu">content_copy</button>'
        + '<button type="button" id="dir-save" class="ghost ms" title="Uložiť ako .md" aria-label="Uložiť ako .md">save</button>'
        + '</div></div>'
        + '<div class="dir-preview md-body" id="dir-preview"></div>'
        + '</div></div>'
        + '<section class="dir-saved-sec"><h2>Uložené smernice</h2><div class="dir-saved" id="dir-saved"></div></section>';

    const taskInput = $('dir-task');
    const buildBtn = $('dir-build');
    if (buildBtn) buildBtn.onclick = () => busy(buildBtn, () => runDirectiveBuild(taskInput ? taskInput.value : ''), 'Skladám…');
    if (taskInput) taskInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); runDirectiveBuild(taskInput.value); }
    });
    const copyBtn = $('dir-copy');
    if (copyBtn) copyBtn.onclick = copyDirective;
    const saveBtn = $('dir-save');
    if (saveBtn) saveBtn.onclick = saveDirective;

    loadDirectiveTemplates();
    loadDirectiveSaved();

    if (prefillTask != null && taskInput) taskInput.value = prefillTask;

    if (directiveData) {
        renderDirectiveSuggest();
        renderDirectivePreview();
    } else {
        renderEmpty($('dir-suggest'), 'assignment', 'Vyber šablónu alebo napíš úlohu');
        renderDirectivePreview();
    }

    if (prefillTask) runDirectiveBuild(prefillTask);
}

// Skok na obrazovku Smernica s predvyplneným dopytom (z Cmd-K akcie).
function gotoDirective(task) {
    setScreen('smernica');
    const inp = $('dir-task');
    if (inp) inp.value = task || '';
    if (task) runDirectiveBuild(task);
}

async function loadDirectiveTemplates() {
    const box = $('dir-templates');
    if (!box) return;
    try {
        if (!directiveTemplates) {
            const d = await (await fetch('/api/directive/templates')).json();
            directiveTemplates = d.templates || [];
        }
        box.innerHTML = directiveTemplates.map((t, i) =>
            '<button type="button" class="dir-tpl" data-i="' + i + '" title="' + esc(t.hint || '') + '">'
            + '<span class="ms" aria-hidden="true">bolt</span>' + esc(t.name) + '</button>'
        ).join('');
        box.querySelectorAll('.dir-tpl').forEach((b) => {
            b.onclick = () => {
                const t = directiveTemplates[+b.dataset.i];
                if (!t) return;
                const inp = $('dir-task');
                if (inp) inp.value = t.task || '';
                runDirectiveBuild(t.task || '');
            };
        });
    } catch (e) { box.innerHTML = ''; }
}

async function runDirectiveBuild(task) {
    task = (task || '').trim();
    const suggest = $('dir-suggest');
    if (task === '') { showToast('Napíš úlohu alebo vyber šablónu'); return; }
    if (suggest) renderEmpty(suggest, 'hourglass_empty', 'Skladám…');
    const seq = ++directiveBuildSeq;
    try {
        const res = await fetch('/api/directive/build', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task }),
        });
        const data = await res.json();
        if (seq !== directiveBuildSeq) return;
        directiveData = { task: data.task || task, suggested: data.suggested || {} };
        directiveSel.clear();
        for (const sec of DIR_SECTIONS) {
            for (const it of (directiveData.suggested[sec.key] || [])) directiveSel.add(+it.id);
        }
        renderDirectiveSuggest();
        renderDirectivePreview();
    } catch (e) {
        if (seq === directiveBuildSeq && suggest) renderEmpty(suggest, 'cloud_off', 'Nepodarilo sa poskladať');
    }
}

function renderDirectiveSuggest() {
    const wrap = $('dir-suggest');
    if (!wrap || !directiveData) return;
    const sug = directiveData.suggested || {};
    const total = DIR_SECTIONS.reduce((n, s) => n + ((sug[s.key] || []).length), 0);
    if (!total) { renderEmpty(wrap, 'search_off', 'Nič relevantné sa nenašlo'); return; }

    let h = '';
    for (const sec of DIR_SECTIONS) {
        const items = sug[sec.key] || [];
        if (!items.length) continue;
        h += '<div class="dir-group"><div class="dir-group-head">'
            + '<span class="ms" aria-hidden="true">' + sec.icon + '</span>' + esc(sec.title)
            + '<span class="dir-group-n">' + items.length + '</span></div>'
            + items.map((it) => dirItem(sec.key, it)).join('')
            + '</div>';
    }
    wrap.innerHTML = h;

    wrap.querySelectorAll('.dir-check input[type="checkbox"]').forEach((cb) => {
        cb.onchange = () => {
            const id = +cb.dataset.id;
            if (cb.checked) directiveSel.add(id); else directiveSel.delete(id);
            const lab = cb.closest('.dir-check');
            if (lab) lab.classList.toggle('off', !cb.checked);
            renderDirectivePreview();
        };
    });
}

function dirItem(key, it) {
    const id = +it.id;
    const on = directiveSel.has(id);
    let sub = '';
    if (key === 'skills' && it.path) sub = '<code class="dir-path">' + esc(it.path) + '</code>';
    else if (key === 'projects' && it.info) sub = '<span class="dir-sub">' + esc(it.info) + '</span>';
    else if (it.snippet) sub = '<span class="dir-sub">' + esc(it.snippet) + '</span>';

    let badge = '';
    if (key === 'skills') {
        badge = it.verified
            ? '<span class="dir-badge ok">overené</span>'
            : '<span class="dir-badge warn">neoverené</span>';
    }

    return '<label class="check dir-check' + (on ? '' : ' off') + '">'
        + '<input type="checkbox" data-id="' + id + '"' + (on ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span class="dir-item-text"><span class="dir-item-label">' + esc(it.label || '') + badge + '</span>'
        + sub + '</span></label>';
}

function renderDirectivePreview() {
    const pv = $('dir-preview');
    if (!pv) return;
    if (!directiveData) {
        directiveMarkdown = '';
        pv.innerHTML = emptyHtml('description', 'Napíš úlohu a poskladaj smernicu');
        return;
    }
    directiveMarkdown = buildDirectiveMarkdown();
    pv.innerHTML = mdToHtml(directiveMarkdown);
}

// Klientsky rebuild markdownu z vybraných položiek — zrkadlí DirectiveController::buildMarkdown.
function buildDirectiveMarkdown() {
    const task = (directiveData.task || '').trim();
    const taskLine = task !== '' ? task : 'Nešpecifikovaná úloha';
    const skills = dirSelected('skills');
    const projects = dirSelected('projects');
    const facts = dirSelected('facts');
    const rules = dirSelected('rules');
    const verified = skills.filter((s) => s.verified && s.path);

    const L = [];
    L.push('# Smernica: ' + taskLine, '');
    L.push('## Kontext');
    L.push(dirContextSentence(task, verified, projects), '');

    if (verified.length) {
        L.push('## Použi tieto skilly');
        for (const s of verified) L.push('- ' + s.label + ' — `' + s.path + '`');
        L.push('');
    }
    if (projects.length) {
        L.push('## Súvisiace projekty');
        for (const p of projects) {
            const info = String(p.info || '').trim();
            L.push('- ' + p.label + (info !== '' ? ': ' + info : ''));
        }
        L.push('');
    }
    if (facts.length) {
        L.push('## Kľúčové fakty');
        for (const f of facts) {
            const s = dirOneLine(f.snippet);
            L.push('- ' + f.label + (s !== '' ? ': ' + s : ''));
        }
        L.push('');
    }
    if (rules.length) {
        L.push('## Pravidlá a preferencie');
        for (const r of rules) {
            const s = dirOneLine(r.snippet);
            L.push('- ' + r.label + (s !== '' ? ': ' + s : ''));
        }
        L.push('');
    }

    const where = [];
    for (const s of verified) where.push('- ' + s.label + ' → `' + s.path + '`');
    for (const p of projects) {
        const info = String(p.info || '').trim();
        if (info !== '') where.push('- ' + p.label + ' → ' + info);
    }
    if (where.length) { L.push('## Kde nájdeš'); for (const w of where) L.push(w); L.push(''); }

    return L.join('\n').replace(/\n+$/, '') + '\n';
}

function dirSelected(key) {
    return (directiveData.suggested[key] || []).filter((it) => directiveSel.has(+it.id));
}

function dirContextSentence(task, verified, projects) {
    const subject = task !== '' ? '„' + task + '"' : 'túto úlohu';
    const parts = [];
    if (verified.length) parts.push(verified.length + '× skill');
    if (projects.length) parts.push(projects.length + '× projekt');
    const have = parts.length ? ' Zahŕňa ' + parts.join(' a ') + '.' : '';
    return 'Táto smernica hovorí, kde v Hadese nájdeš relevantné znalosti pre '
        + subject + '.' + have + ' Použi uvedené zdroje ako kontext skôr, než začneš.';
}

function dirOneLine(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > 160 ? t.slice(0, 160) + '…' : t;
}

async function copyDirective() {
    if (!directiveMarkdown) { showToast('Najprv poskladaj smernicu'); return; }
    try { await navigator.clipboard.writeText(directiveMarkdown); showToast('Smernica skopírovaná'); }
    catch (e) { showToast('Kopírovanie zlyhalo'); }
}

async function saveDirective() {
    if (!directiveMarkdown || !directiveData) { showToast('Najprv poskladaj smernicu'); return; }
    const name = (directiveData.task || '').trim() || 'smernica';
    try {
        const res = await fetch('/api/directive/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, markdown: directiveMarkdown }),
        });
        if (!res.ok) { showToast('Uloženie zlyhalo'); return; }
        const data = await res.json();
        showToast('Uložené: ' + (data.path || ''));
        loadDirectiveSaved();
    } catch (e) { showToast('Uloženie zlyhalo'); }
}

async function loadDirectiveSaved() {
    const box = $('dir-saved');
    if (!box) return;
    try {
        const d = await (await fetch('/api/directives')).json();
        const items = d.directives || [];
        if (!items.length) { renderEmpty(box, 'folder_open', 'Zatiaľ žiadne uložené smernice'); return; }
        box.innerHTML = items.map((it) =>
            '<button type="button" class="dir-saved-item" data-name="' + esc(it.name) + '">'
            + '<span class="ms" aria-hidden="true">description</span>'
            + '<span class="dsi-text"><span class="dsi-title">' + esc(it.title || it.name) + '</span>'
            + '<span class="dsi-path">' + esc(it.path) + '</span></span></button>'
        ).join('');
        box.querySelectorAll('.dir-saved-item').forEach((b) => {
            b.onclick = () => openSavedDirective(b.dataset.name);
        });
    } catch (e) { renderEmpty(box, 'cloud_off', 'Nepodarilo sa načítať'); }
}

async function openSavedDirective(name) {
    try {
        const d = await (await fetch('/api/directive/' + encodeURIComponent(name))).json();
        if (!d || !d.markdown) { showToast('Smernica sa nenašla'); return; }
        directiveMarkdown = d.markdown;
        const pv = $('dir-preview');
        if (pv) pv.innerHTML = mdToHtml(d.markdown);
        try { await navigator.clipboard.writeText(d.markdown); showToast('Smernica skopírovaná'); }
        catch (e) { showToast('Smernica otvorená'); }
    } catch (e) { showToast('Nepodarilo sa načítať'); }
}

/* ---------- Cmd-K paleta (zjednotené hľadanie + navigácia) ---------- */

const CMDK_NAV = [
    { screen: 'dnes', label: 'Dnes', icon: 'wb_sunny' },
    { screen: 'dennik', label: 'Denník', icon: 'receipt_long' },
    { screen: 'graf', label: 'Graf', icon: 'hub' },
    { screen: 'kniznica', label: 'Knižnica', icon: 'menu_book' },
    { screen: 'rozhodnutia', label: 'Rozhodnutia', icon: 'gavel' },
    { screen: 'kontrola', label: 'Kontrola', icon: 'fact_check' },
    { screen: 'smernica', label: 'Smernica', icon: 'assignment' },
];
let cmdkTimer = null, cmdkSeq = 0;

function openCmdk() {
    const overlay = $('cmdk');
    overlay.classList.remove('hidden');
    const input = $('cmdk-input');
    input.value = '';
    renderCmdk('');
    setTimeout(() => input.focus(), 30);
}
function closeCmdk() { $('cmdk').classList.add('hidden'); }
function cmdkOpen() { return !$('cmdk').classList.contains('hidden'); }

function setupCmdk() {
    $('cmdk-trigger').onclick = openCmdk;
    const overlay = $('cmdk');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCmdk(); });
    const input = $('cmdk-input');
    input.addEventListener('input', () => renderCmdk(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const first = overlay.querySelector('.cmdk-item');
            if (first) { e.preventDefault(); first.click(); }
        }
    });
}

function bindCmdkItems(root) {
    root.querySelectorAll('.cmdk-item[data-nav]').forEach((el) => {
        el.onclick = () => { closeCmdk(); setScreen(el.dataset.nav); };
    });
    root.querySelectorAll('.cmdk-item[data-id]').forEach((el) => {
        el.onclick = () => {
            closeCmdk();
            openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: el.dataset.type });
        };
    });
    root.querySelectorAll('.cmdk-item[data-pb]').forEach((el) => {
        el.onclick = () => {
            const holder = el.closest('#cmdk-remote');
            const books = (holder && holder._books) || [];
            const b = books[+el.dataset.pb];
            if (b && b.node_id != null) {
                closeCmdk();
                openNodeFromAnywhere({ id: b.node_id, label: b.title || b.path, type: 'skill' });
            }
        };
    });
    root.querySelectorAll('.cmdk-item[data-action="directive"]').forEach((el) => {
        el.onclick = () => {
            const q = ($('cmdk-input').value || '').trim();
            closeCmdk();
            gotoDirective(q);
        };
    });
}

const CMDK_TYPE_NAMES = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
const CMDK_TYPE_ICO = { core: 'brightness_7', skill: 'bolt', memory: 'psychology', project: 'inventory_2' };
const cmdkGroup = (t) => '<div class="cmdk-group">' + t + '</div>';

function renderCmdk(q) {
    const query = (q || '').trim();
    const ql = query.toLowerCase();
    const wrap = $('cmdk-results');

    const nav = CMDK_NAV.filter((n) => !ql || n.label.toLowerCase().includes(ql));
    let html = '';
    if (nav.length) {
        html += cmdkGroup('Prejsť na')
            + nav.map((n) => '<button type="button" class="cmdk-item" data-nav="' + n.screen + '">'
                + '<span class="ms" aria-hidden="true">' + n.icon + '</span>'
                + '<span class="cmdk-text"><span class="cmdk-title">' + esc(n.label) + '</span></span></button>').join('');
    }
    // Akcia: poskladať smernicu z aktuálneho dopytu (skočí na obrazovku Smernica)
    html += cmdkGroup('Akcia')
        + '<button type="button" class="cmdk-item" data-action="directive">'
        + '<span class="ms" aria-hidden="true">assignment</span>'
        + '<span class="cmdk-text"><span class="cmdk-title">Vytvor smernicu' + (query ? ': ' + esc(query) : '…') + '</span>'
        + '<span class="cmdk-sub">Poskladá kontext pre Claude Code</span></span></button>';
    html += '<div id="cmdk-remote"></div>';
    wrap.innerHTML = html;
    bindCmdkItems(wrap);

    // vzdialené hľadanie — jeden zdroj pravdy: SK-aware /api/search (uzly + playbooky).
    // Debounce 180 ms, od 2 znakov; nav ostáva okamžitá.
    clearTimeout(cmdkTimer);
    const seq = ++cmdkSeq;
    if (query.length < 2) return;
    const remote = $('cmdk-remote');
    if (remote) remote.innerHTML = '<div class="cmdk-hint-row">Hľadám…</div>';
    cmdkTimer = setTimeout(async () => {
        try {
            const data = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
            if (seq !== cmdkSeq) return;
            const box = $('cmdk-remote');
            if (!box) return;
            const nodes = data.nodes || [];
            const books = data.playbooks || [];
            let h = '';
            const pf = parseQueryFilter(query);
            const filtered = (pf.cert || pf.tag)
                ? nodes.filter((n) => certTagMatch(n, pf))
                : nodes;
            if (filtered.length) {
                h += cmdkGroup('Uzly')
                    + filtered.map((n) => '<button type="button" class="cmdk-item" data-id="' + n.id + '"'
                        + ' data-label="' + esc(n.label || '') + '" data-type="' + esc(n.type || 'skill') + '">'
                        + '<span class="ms" aria-hidden="true">' + (CMDK_TYPE_ICO[n.type] || 'circle') + '</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(n.label)
                        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '') + '</span>'
                        + '<span class="cmdk-sub">' + (n.snippet ? esc(n.snippet) : (CMDK_TYPE_NAMES[n.type] || esc(n.type || ''))) + '</span>'
                        + '</span></button>').join('');
            }
            if (books.length) {
                h += cmdkGroup('Playbooky')
                    + books.map((b, i) => '<button type="button" class="cmdk-item" data-pb="' + i + '">'
                        + '<span class="ms" aria-hidden="true">menu_book</span>'
                        + '<span class="cmdk-text"><span class="cmdk-title">' + esc(b.title || b.path || '') + '</span>'
                        + (b.snippet ? '<span class="cmdk-sub">' + esc(b.snippet) + '</span>' : '')
                        + '</span></button>').join('');
            }
            if (!filtered.length && !books.length) h = emptyHtml('search_off', 'Nič sa nenašlo');
            box.innerHTML = h;
            box._books = books;
            bindCmdkItems(box);
        } catch (e) { /* offline nevadí */ }
    }, 180);
}

/* ---------- ovládanie ---------- */

const DOCK_SECTIONS = {
    structure: { title: 'Štruktúra', btn: 'btn-structure' },
    stats: { title: 'Prehľad', btn: 'btn-stats' },
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

    if (name === 'structure') renderStructure();
    if (name === 'stats') refreshStats();
    if (name === 'settings') loadTagFilter(); // F4: obnov značky (mohli pribudnúť brain-syncom)
}

function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    if (d < 604800) return Math.round(d / 86400) + ' d';
    return new Date(iso).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}

// Rail badge — jeden generický indikátor na destinácii v ľavom rely.
// Boolean → teal bodka (.dot, neprečítané, napr. Denník); číslo → číselný pill
// (.count, napr. fronta Kontroly). Spätne kompatibilné so setJournalDot.
function setRailBadge(screen, count) {
    const btn = document.querySelector('#rail .dest[data-screen="' + screen + '"]');
    if (!btn) return;

    // Boolean režim — bodka neprečítaného
    if (count === true || count === false) {
        let dot = btn.querySelector('.dot');
        if (count && !dot) {
            dot = document.createElement('span');
            dot.className = 'dot';
            dot.setAttribute('aria-hidden', 'true');
            btn.appendChild(dot);
        }
        if (!count && dot) dot.remove();
        return;
    }

    // Číselný režim — pill (skryje sa cez CSS pri data-count="0")
    const n = Math.max(0, +count || 0);
    let pill = btn.querySelector('.count');
    if (n > 0 && !pill) {
        pill = document.createElement('span');
        pill.className = 'count';
        pill.setAttribute('aria-hidden', 'true');
        btn.appendChild(pill);
    }
    if (pill) {
        pill.dataset.count = String(n);
        pill.textContent = n > 99 ? '99+' : String(n);
    }
}

// Denník — neprečítané záznamy (teal bodka na destinácii Denník). Tenký wrapper.
function setJournalDot(show) {
    setRailBadge('dennik', !!show);
}

function markJournalSeen() {
    localStorage.setItem('hades.journal.lastSeen', new Date().toISOString());
    setJournalDot(false);
}

function checkJournalUnread() {
    fetch('/api/journal').then((r) => r.json()).then((d) => {
        let latest = 0;
        for (const r of d.records || []) latest = Math.max(latest, ts(r.created_at));
        const seen = ts(localStorage.getItem('hades.journal.lastSeen'));
        if (latest && latest > seen) setJournalDot(true);
    }).catch(() => { /* offline check nevadí */ });
}

// Denník — časová os zoskupená po dňoch, s filtrom podľa projektu
const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

let journalRecords = [];
let journalProject = null;

function dayLabel(iso) {
    const d = new Date(iso);
    const t = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(t) - midnight(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return d.getDate() + '. ' + SK_MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}

function timeHM(iso) {
    return new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

async function renderJournal() {
    const list = $('journal-list');
    renderEmpty(list, 'hourglass_empty', 'Načítavam…');
    try {
        const data = await (await fetch('/api/journal')).json();
        journalRecords = data.records || [];
        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        renderEmpty(list, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

function renderJournalFilter() {
    const wrap = $('journal-filter');
    const projects = [...new Set(journalRecords.map((r) => r.project).filter(Boolean))];
    if (journalProject && !projects.includes(journalProject)) journalProject = null;
    if (!projects.length) { wrap.innerHTML = ''; return; }

    wrap.innerHTML = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '" data-project="">Všetky</button>'
        + projects.map((p) =>
            '<button type="button" class="chip' + (journalProject === p ? ' active' : '') + '" data-project="' + esc(p) + '">' + esc(p) + '</button>'
        ).join('');

    wrap.querySelectorAll('.chip').forEach((chip) => {
        chip.onclick = () => {
            journalProject = chip.dataset.project || null;
            renderJournalFilter();
            renderJournalList();
        };
    });
}

function renderJournalList() {
    const list = $('journal-list');

    if (!journalRecords.length) {
        renderEmpty(list, 'receipt_long', 'Zatiaľ žiadne záznamy');
        return;
    }

    const records = journalProject
        ? journalRecords.filter((r) => r.project === journalProject)
        : journalRecords;

    if (!records.length) {
        renderEmpty(list, 'filter_alt_off', 'Žiadne záznamy pre tento projekt');
        return;
    }

    const sorted = [...records].sort((a, b) => ts(b.created_at) - ts(a.created_at));

    let html = '', lastDay = null;
    for (const r of sorted) {
        const day = dayLabel(r.created_at);
        if (day !== lastDay) {
            html += '<div class="day-head">' + esc(day) + '</div>';
            lastDay = day;
        }
        const isDigest = r.source === 'digest';
        const badges = [];
        if (r.project) badges.push('<span class="tag">' + esc(r.project) + '</span>');
        if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
        if (r.commits && r.commits.length) {
            const c = r.commits.length;
            const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
            badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
        }
        html += '<div class="li-wrap rec-wrap">'
            + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
            + '<div class="record-head"><span class="ms rec-ico" aria-hidden="true">' + (isDigest ? 'calendar_month' : 'article') + '</span>'
            + '<span class="record-title">' + esc(r.label) + '</span>'
            + '<span class="record-time">' + timeHM(r.created_at) + '</span></div>'
            + (badges.length ? '<div class="record-tags">' + badges.join('') + '</div>' : '')
            + '</button>'
            + packBtn(r.id, r.label) + '</div>';
    }
    list.innerHTML = html;

    list.querySelectorAll('.record').forEach((el) => {
        el.onclick = () => openNodeFromAnywhere({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
    });
    bindPackButtons(list);
}

/* ---------- štruktúra (oblasti a oddelenia) ---------- */

async function renderStructure() {
    const wrap = $('structure-tree');
    renderEmpty(wrap, 'hourglass_empty', 'Načítavam…');
    try {
        const data = await (await fetch('/api/structure')).json();
        const cnt = (v) => (v && typeof v === 'object') ? (v.node_count || v.count || 0) : (v || 0);

        let html = '';
        for (const a of data.areas || []) {
            html += '<div class="tree-row area" role="button" tabindex="0" data-area="' + a.id + '">'
                + '<span class="dot" style="background:' + esc(a.color || '#566964') + '"></span>'
                + '<span class="t-name">' + esc(a.name) + '</span>'
                + '<span class="count">' + (a.node_count || 0) + '</span></div>';
            for (const d of a.departments || []) {
                html += '<div class="tree-row dept" role="button" tabindex="0" data-area="' + a.id + '" data-dept="' + d.id + '">'
                    + '<span class="t-name">' + esc(d.name) + '</span>'
                    + '<span class="count">' + (d.node_count || 0) + '</span>'
                    + '<button type="button" class="ghost ms dept-more" data-more="' + d.id
                    + '" title="Možnosti oddelenia" aria-label="Možnosti oddelenia">more_horiz</button>'
                    + '</div>';
            }
        }
        const core = cnt(data.core);
        const unassigned = cnt(data.unassigned);
        if (core > 0) html += '<div class="tree-muted"><span>Jadro</span><span class="count">' + core + '</span></div>';
        if (unassigned > 0) html += '<div class="tree-muted"><span>Nezaradené</span><span class="count">' + unassigned + '</span></div>';

        wrap.innerHTML = html || emptyHtml('account_tree', 'Zatiaľ žiadna štruktúra');

        const rowActivate = (row, fn) => {
            row.onclick = (e) => { if (!e.target.closest('.dept-more')) fn(); };
            row.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); }
            };
        };

        wrap.querySelectorAll('.tree-row.area').forEach((row) => {
            const id = +row.dataset.area;
            rowActivate(row, () => {
                if (S.focus.areaId === id && !S.focus.departmentId) setFocus(null, null);
                else setFocus(id, null);
            });
        });

        wrap.querySelectorAll('.tree-row.dept').forEach((row) => {
            const aid = +row.dataset.area;
            const did = +row.dataset.dept;
            rowActivate(row, () => {
                if (S.focus.departmentId === did) setFocus(null, null);
                else setFocus(aid, did);
            });
        });

        wrap.querySelectorAll('.dept-more').forEach((btn) => {
            btn.onclick = (e) => { e.stopPropagation(); toggleDeptActions(+btn.dataset.more); };
        });

        markTreeActive();
    } catch (e) {
        renderEmpty(wrap, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

// Malý inline action riadok pod oddelením — žiadny modál
function toggleDeptActions(deptId) {
    const wrap = $('structure-tree');
    const existing = wrap.querySelector('.dept-actions');
    const wasOpen = existing && +existing.dataset.dept === deptId;
    if (existing) existing.remove();
    if (wasOpen) return;

    const row = wrap.querySelector('.tree-row.dept[data-dept="' + deptId + '"]');
    if (!row) return;

    const box = document.createElement('div');
    box.className = 'dept-actions';
    box.dataset.dept = deptId;
    box.innerHTML = '<button type="button" data-act="rename">Premenovať</button>'
        + '<button type="button" data-act="move">Presunúť do…</button>'
        + '<button type="button" data-act="delete">Zmazať</button>';
    row.after(box);

    box.querySelector('[data-act="rename"]').onclick = () => {
        const d = S.departments.get(deptId);
        box.innerHTML = '<input type="text" maxlength="255" aria-label="Nový názov oddelenia">';
        const inp = box.querySelector('input');
        inp.value = d ? d.name : '';
        inp.focus();
        inp.select();
        inp.onkeydown = (ev) => {
            if (ev.key === 'Escape') { ev.stopPropagation(); box.remove(); return; }
            if (ev.key !== 'Enter') return;
            const name = inp.value.trim();
            if (name) deptRequest(deptId, 'PUT', { name }, 'Oddelenie premenované');
        };
    };

    box.querySelector('[data-act="move"]').onclick = () => {
        const d = S.departments.get(deptId);
        box.innerHTML = '<select aria-label="Cieľová oblasť">'
            + [...S.areas.values()].map((a) =>
                '<option value="' + a.id + '"' + (d && d.area_id === a.id ? ' selected' : '') + '>' + esc(a.name) + '</option>'
            ).join('')
            + '</select>';
        const sel = box.querySelector('select');
        sel.focus();
        sel.onchange = () => deptRequest(deptId, 'PUT', { area_id: +sel.value }, 'Oddelenie presunuté');
    };

    // Zmazanie cez arm pattern: prvý klik ozbrojí (.danger + text), druhý do 3 s maže
    const del = box.querySelector('[data-act="delete"]');
    del.onclick = () => {
        if (!del.classList.contains('danger')) {
            del.classList.add('danger');
            del.textContent = 'Naozaj zmazať?';
            setTimeout(() => {
                if (del.isConnected) { del.classList.remove('danger'); del.textContent = 'Zmazať'; }
            }, 3000);
            return;
        }
        busy(del, () => deptRequest(deptId, 'DELETE', null, 'Oddelenie zmazané'), 'Mažem…');
    };
}

async function deptRequest(deptId, method, body, okMsg) {
    try {
        const res = await fetch('/api/departments/' + deptId, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            showToast(data.message || 'Akcia sa nepodarila');
            return;
        }
        if (S.focus.departmentId === deptId && method === 'DELETE') setFocus(S.focus.areaId, null);
        showToast(okMsg);
        await reloadGraph();
        if (dockOpen === 'structure') renderStructure();
    } catch (e) {
        showToast('Akcia sa nepodarila');
    }
}

// Znovunačítanie grafu bez straty pozícií existujúcich uzlov
let reloadSeq = 0;
async function reloadGraph() {
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

function closeDock() {
    dockOpen = null;
    $('dock').classList.add('hidden');
    for (const key of Object.keys(DOCK_SECTIONS)) {
        $(DOCK_SECTIONS[key].btn).classList.remove('active');
    }
}

let searchTimer = null;
let searchSeq = 0;

function renderSearch(q) {
    // F4: voliteľný cert:/tag: prefix — pf.text ide do fulltextu, cert/tag filtruje lokálne
    const pf = parseQueryFilter(q);
    const query = pf.text.toLowerCase();
    const hasCertTag = !!(pf.cert || pf.tag);
    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
    const wrap = $('search-results');

    // Lokálne uzly — okamžité výsledky bez čakania na server
    const matches = (!query && !hasCertTag) ? [] : S.nodes
        .filter((n) => !query || (n.label + ' ' + (n.description || '')).toLowerCase().includes(query))
        .filter((n) => certTagMatch(n, pf))
        .sort((a, b) => (b.strength || 0) - (a.strength || 0))
        .slice(0, 8);

    const local = matches.map((n) =>
        '<button type="button" class="search-item" data-id="' + n.id + '"><span>' + esc(n.label)
        + '</span><span class="sub">' + typeNames[n.type]
        + (n.certainty ? ' ' + certBadge(n.certainty, true) : '')
        + ' ' + originBadge(n.origin) + '</span></button>'
    ).join('');

    wrap.innerHTML = (local || ((query || hasCertTag) ? emptyHtml('search_off', 'Nič sa nenašlo') : ''))
        + '<div id="search-playbooks"></div>';

    wrap.querySelectorAll('.search-item').forEach((el) => {
        el.onclick = () => {
            const n = S.byId.get(+el.dataset.id);
            if (!n) return;
            S.cam.k = Math.max(S.cam.k, 1.1);
            focusNode(n);
            selectNode(n);
        };
    });

    // Fulltext (playbooky) — debounce 250 ms, od 2 znakov
    clearTimeout(searchTimer);
    const seq = ++searchSeq;
    if (query.length < 2) return;
    searchTimer = setTimeout(async () => {
        try {
            const data = await (await fetch('/api/search?q=' + encodeURIComponent(query))).json();
            if (seq !== searchSeq) return;
            const pb = $('search-playbooks');
            if (!pb) return;
            const books = data.playbooks || [];
            if (!books.length) return;
            const empty = wrap.querySelector('.empty');
            if (empty) empty.remove();
            pb.innerHTML = '<div class="result-divider">Playbooky</div>'
                + books.map((b, i) =>
                    '<button type="button" class="pb-item" data-i="' + i + '">'
                    + '<span class="ms" aria-hidden="true">menu_book</span>'
                    + '<span class="pb-text"><span class="pb-title">' + esc(b.title || b.path || '') + '</span>'
                    + (b.snippet ? '<span class="pb-snippet">' + esc(b.snippet) + '</span>' : '')
                    + '</span></button>'
                ).join('');
            pb.querySelectorAll('.pb-item').forEach((el) => {
                el.onclick = () => {
                    const b = books[+el.dataset.i];
                    const n = b && b.node_id ? S.byId.get(+b.node_id) : null;
                    if (!n) return;
                    S.cam.k = Math.max(S.cam.k, 1.1);
                    focusNode(n);
                    selectNode(n);
                };
            });
        } catch (e) { /* fulltext offline nevadí */ }
    }, 250);
}

/* ---------- údržba: duplicity ---------- */

async function findDuplicates() {
    const wrap = $('dup-list');
    renderEmpty(wrap, 'hourglass_empty', 'Načítavam…');
    const typeNames = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };
    try {
        const data = await (await fetch('/api/duplicates')).json();
        const pairs = data.pairs || [];
        if (!pairs.length) { renderEmpty(wrap, 'done_all', 'Žiadne duplicity'); return; }

        const nodeHtml = (n) => '<div class="dup-node"><span class="dup-label">' + esc(n.label) + '</span>'
            + '<span class="tag muted">' + (typeNames[n.type] || esc(n.type)) + '</span></div>';

        wrap.innerHTML = pairs.map((p, i) =>
            '<div class="dup-card" data-i="' + i + '">'
            + '<div class="dup-pair">' + nodeHtml(p.a) + nodeHtml(p.b) + '</div>'
            + '<div class="dup-side"><span class="dup-pct">' + Math.round(p.percent) + ' %</span>'
            + '<button type="button" class="primary dup-merge" aria-label="Zlúčiť ' + esc(p.a.label) + ' a ' + esc(p.b.label) + '">Zlúčiť</button></div>'
            + '</div>'
        ).join('');

        wrap.querySelectorAll('.dup-card').forEach((card) => {
            const btn = card.querySelector('.dup-merge');
            btn.onclick = () => busy(btn, async () => {
                const p = pairs[+card.dataset.i];
                // slabší uzol sa zlúči do silnejšieho; pri zhode a → b
                const [loser, winner] = (p.a.strength || 0) > (p.b.strength || 0) ? [p.b, p.a] : [p.a, p.b];
                try {
                    const res = await fetch('/api/nodes/' + loser.id + '/merge/' + winner.id, { method: 'POST' });
                    if (!res.ok) { showToast('Zlúčenie sa nepodarilo'); return; }
                } catch (e) {
                    showToast('Zlúčenie sa nepodarilo');
                    return;
                }
                card.remove();
                if (!wrap.querySelector('.dup-card')) renderEmpty(wrap, 'done_all', 'Žiadne duplicity');
                showToast('Zlúčené');
                await reloadGraph();
            }, 'Zlúčujem…');
        });
    } catch (e) {
        renderEmpty(wrap, 'cloud_off', 'Nepodarilo sa načítať');
    }
}

/* ---------- F4: prepínač Značky istoty + filter podľa značiek ----------
   Blade patrí F1, preto obidve UI injektujem z JS do existujúceho #sec-settings.
   Prepínač riadi S.certRings (canvas prstence); filter značiek plní S.filter.tags
   dynamickými checkboxami z /api/tags (pozitívny filter, perzistuje v hades.filter). */
function setupCertTagFilter() {
    const sec = $('sec-settings');
    if (!sec) return;

    // prepínač „Značky istoty" — za prepínačom „Len kostra"
    if (!$('certrings-toggle')) {
        const skRow = $('skeleton-toggle') ? $('skeleton-toggle').closest('.switch-row') : null;
        const row = document.createElement('div');
        row.className = 'switch-row';
        row.innerHTML = '<span id="certrings-label">Značky istoty</span>'
            + '<button id="certrings-toggle" class="switch" type="button" role="switch" aria-checked="'
            + (S.certRings ? 'true' : 'false') + '" aria-labelledby="certrings-label"></button>';
        if (skRow) skRow.insertAdjacentElement('afterend', row); else sec.appendChild(row);
        const btn = $('certrings-toggle');
        btn.onclick = () => {
            S.certRings = !S.certRings;
            localStorage.setItem('hades.certRings', S.certRings ? '1' : '0');
            btn.setAttribute('aria-checked', S.certRings ? 'true' : 'false');
            draw();
            showToast(S.certRings ? 'Značky istoty zapnuté' : 'Značky istoty vypnuté');
        };
    }

    // filter podľa značiek — kontajner pred prepínačom „Spojenia len pri hovere"
    if (!$('filter-tags')) {
        const cap = document.createElement('div');
        cap.className = 'check-cap';
        cap.id = 'filter-tags-cap';
        cap.textContent = 'Značky';
        const box = document.createElement('div');
        box.id = 'filter-tags';
        const shRow = $('softhover-toggle') ? $('softhover-toggle').closest('.switch-row') : null;
        if (shRow) { shRow.insertAdjacentElement('beforebegin', box); box.insertAdjacentElement('beforebegin', cap); }
        else { sec.appendChild(cap); sec.appendChild(box); }
    }
    loadTagFilter();
}

async function loadTagFilter() {
    const box = $('filter-tags');
    const cap = $('filter-tags-cap');
    if (!box) return;
    let tags = [];
    try {
        const d = await (await fetch('/api/tags')).json();
        tags = d.tags || [];
    } catch (e) { /* offline — bez značiek */ }

    if (!tags.length) {
        // žiadne značky → sekcia sa nezobrazí (žiadny prázdny caption)
        box.style.display = 'none';
        if (cap) cap.style.display = 'none';
        return;
    }
    box.style.display = '';
    if (cap) cap.style.display = '';

    box.innerHTML = tags.map((t) =>
        '<label class="check"><input type="checkbox" data-ftag="' + esc(t.name) + '"'
        + (S.filter.tags.has(t.name) ? ' checked' : '') + '>'
        + '<span class="box" aria-hidden="true"></span>'
        + '<span>' + esc(t.name) + (t.count != null ? ' <span class="tag-n">' + t.count + '</span>' : '') + '</span></label>'
    ).join('');

    box.querySelectorAll('input[data-ftag]').forEach((inp) => {
        inp.onchange = () => {
            const val = inp.dataset.ftag;
            if (inp.checked) S.filter.tags.add(val); else S.filter.tags.delete(val);
            persistFilter();
            draw();
        };
    });
}

// Voliteľný cert:/tag: prefix vo vyhľadávaní — „cert:overene", „tag:docker".
// Vráti { text, cert, tag }; cert 'bez'/'none' → null certainty.
function parseQueryFilter(q) {
    const out = { text: String(q || ''), cert: null, tag: null };
    out.text = out.text.replace(/\b(cert|tag):(\S+)/gi, (m, k, v) => {
        if (k.toLowerCase() === 'cert') out.cert = v.toLowerCase();
        else out.tag = v.toLowerCase();
        return '';
    }).trim();
    return out;
}

// Zhoda uzla na voliteľný cert:/tag: filter (client-side, nad S.nodes).
function certTagMatch(n, pf) {
    if (pf.cert) {
        const want = (pf.cert === 'bez' || pf.cert === 'none') ? null : pf.cert;
        if ((n.certainty || null) !== want) return false;
    }
    if (pf.tag) {
        const tags = Array.isArray(n.tags) ? n.tags : [];
        if (!tags.some((t) => String(t).toLowerCase().includes(pf.tag))) return false;
    }
    return true;
}

function setupControls() {
    document.querySelectorAll('#view-switch button').forEach((b) => {
        b.onclick = () => setView(b.dataset.view);
    });

    // FÁZA SHELL: hlavná navigácia — 4 pomenované obrazovky
    document.querySelectorAll('#rail .dest[data-screen]').forEach((b) => {
        b.onclick = () => setScreen(b.dataset.screen);
    });

    // graph-tools (v hlavičke, viditeľné len na Grafe) + systém (rail)
    $('btn-structure').onclick = () => openDock('structure');
    $('btn-stats').onclick = () => openDock('stats');
    $('btn-legend').onclick = () => openDock('legend');
    $('btn-help').onclick = () => toggleHelp(true);
    $('btn-settings').onclick = () => openDock('settings');
    $('dock-close').onclick = closeDock;

    // Knižnica — filter skillov (debounce)
    $('library-search').oninput = () => {
        clearTimeout(libraryTimer);
        libraryTimer = setTimeout(renderLibrary, 220);
    };

    $('zoom-in').onclick = () => zoomBy(1.3);
    $('zoom-out').onclick = () => zoomBy(1 / 1.3);
    $('zoom-reset').onclick = () => fitView();
    $('brand-core').onclick = () => fitView();

    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        inp.oninput = () => { syncSlider(inp); setOpt(inp.dataset.opt, parseFloat(inp.value)); };
    });

    // Filtre typov a zdrojov — checked = viditeľné; S.filter drží skryté hodnoty
    document.querySelectorAll('input[data-ftype], input[data-fsource]').forEach((inp) => {
        const key = inp.dataset.ftype ? 'types' : 'sources';
        const val = inp.dataset.ftype || inp.dataset.fsource;
        inp.checked = !S.filter[key].has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter[key].delete(val);
            else S.filter[key].add(val);
            persistFilter();
            draw();
        };
    });

    // F4: prepínač Značky istoty + dynamický filter podľa značiek (injektované do #sec-settings)
    setupCertTagFilter();

    // Filter kategórií vzťahov — checked = viditeľné; S.filter.relations drží skryté kategórie
    document.querySelectorAll('input[data-frel]').forEach((inp) => {
        const val = inp.dataset.frel;
        inp.checked = !S.filter.relations.has(val);
        inp.onchange = () => {
            if (inp.checked) S.filter.relations.delete(val);
            else S.filter.relations.add(val);
            persistRelFilter();
            draw();
        };
    });

    // Soft-hover — spojenia sú v pokoji jemné, rozsvietia sa pri hover/fokuse uzla
    const shBtn = $('softhover-toggle');
    const syncShBtn = () => shBtn.setAttribute('aria-checked', S.opts.edgeSoftHover ? 'true' : 'false');
    syncShBtn();
    shBtn.onclick = () => { setOpt('edgeSoftHover', !S.opts.edgeSoftHover); syncShBtn(); draw(); };

    // Kostra — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    const skBtn = $('skeleton-toggle');
    const syncSkBtn = () => skBtn.setAttribute('aria-checked', S.skeleton ? 'true' : 'false');
    syncSkBtn();
    skBtn.onclick = () => {
        S.skeleton = !S.skeleton;
        localStorage.setItem('hades.skeleton', S.skeleton ? '1' : '0');
        syncSkBtn();
        draw();
        showToast(S.skeleton ? 'Kostra zapnutá' : 'Kostra vypnutá');
    };

    // A7 + FÁZA HRANY: min. váha spojení — samostatný stav (nie data-opt), surová hodnota v odpočte
    const mw = $('minweight-slider');
    if (mw) {
        const syncMw = () => {
            mw.style.setProperty('--pct', (parseFloat(mw.value) / 5) * 100 + '%');
            const out = mw.closest('label.slider').querySelector('output');
            if (out) out.textContent = parseFloat(mw.value).toFixed(1);
        };
        mw.value = S.minWeight;
        syncMw();
        mw.oninput = () => {
            S.minWeight = parseFloat(mw.value);
            localStorage.setItem('hades.minWeight2', String(S.minWeight));
            syncMw();
            draw();
        };
    }

    // Slidery síl — okamžitý zápis do S.forces + rebuild simulácie
    document.querySelectorAll('input[data-force]').forEach((inp) => {
        inp.oninput = () => {
            syncSlider(inp);
            S.forces[inp.dataset.force] = parseFloat(inp.value);
            localStorage.setItem('hades.forces', JSON.stringify(S.forces));
            buildSim();
            kickSim(0.4);
            draw();
        };
    });

    $('forces-reset').onclick = () => {
        S.forces = Object.assign({}, FORCE_DEFAULTS);
        localStorage.removeItem('hades.forces');
        buildSim();
        kickSim(0.4);
        draw();
        syncForceSliders();
        showToast('Sily obnovené');
    };

    // Veľkosť podľa spojení (Obsidian size by degree) — rebuild kvôli collide polomerom
    const degBtn = $('sizedeg-toggle');
    const syncDegBtn = () => degBtn.setAttribute('aria-checked', S.opts.sizeByDegree ? 'true' : 'false');
    syncDegBtn();
    degBtn.onclick = () => {
        setOpt('sizeByDegree', !S.opts.sizeByDegree);
        syncDegBtn();
        buildSim();
        kickSim(0.3);
        draw();
    };

    $('opts-reset').onclick = () => {
        S.opts = Object.assign({}, OPT_DEFAULTS);
        localStorage.setItem('hades.opts', JSON.stringify(S.opts));
        makeStars();
        applyOpts();
        syncDegBtn(); // reset vráti aj sizeByDegree — prepínač a collide polomery dorovnať
        syncShBtn();  // reset vráti edgeSoftHover na TRUE — prepínač dorovnať
        buildSim();
        kickSim(0.3);
        draw();
        showToast('Predvolené obnovené');
    };

    // Tmavý režim — prepínač v nastaveniach, synchronizovaný s data-theme
    const themeBtn = $('theme-toggle');
    const syncThemeBtn = () => themeBtn.setAttribute('aria-checked',
        document.documentElement.dataset.theme === 'dark' ? 'true' : 'false');
    syncThemeBtn();
    themeBtn.onclick = () => {
        setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
        syncThemeBtn();
        draw();
    };

    // FÁZA SHELL: chat je schovaný (nefunguje bez API kľúča) — prepínač ho vráti
    const chatBtn = $('chat-toggle');
    const chatOn = localStorage.getItem('hades.chat') === '1';
    document.body.classList.toggle('chat-on', chatOn);
    chatBtn.setAttribute('aria-checked', chatOn ? 'true' : 'false');
    chatBtn.onclick = () => {
        const on = !document.body.classList.contains('chat-on');
        document.body.classList.toggle('chat-on', on);
        localStorage.setItem('hades.chat', on ? '1' : '0');
        chatBtn.setAttribute('aria-checked', on ? 'true' : 'false');
    };

    // Zvuk — prepínač v nastaveniach
    const soundBtn = $('btn-sound');
    soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
    soundBtn.onclick = () => {
        S.sound = !S.sound;
        localStorage.setItem('hades.sound', S.sound ? 'on' : 'off');
        soundBtn.setAttribute('aria-checked', S.sound ? 'true' : 'false');
        if (S.sound) blip(523);
    };

    $('btn-ambient').onclick = () => {
        document.body.classList.add('ambient');
        requestDraw(); // ambient režim → rozbehni nepretržitú slučku
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
        }
    };

    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement) document.body.classList.remove('ambient');
    });

    $('node-close').onclick = closeNodePanel;

    // C4: dokument uzla — overlay s vyrenderovaným markdownom
    $('node-md').onclick = () => { if (S.selected) openMdOverlay(S.selected); };
    $('md-close').onclick = closeMdOverlay;
    $('md-overlay').addEventListener('click', (e) => {
        if (e.target === $('md-overlay')) closeMdOverlay();
    });
    // Pätička čítačky (md-pack / md-copypath) sa naväzuje v setupPack().

    // Ručné prepájanie — klik na 'link' zapne connect mode, cieľ sa vyberá klikom na plátne
    $('node-connect').onclick = () => {
        if (!S.selected) return;
        S.connectFrom = S.selected.id;
        canvas.classList.add('linking');
        showToast('Klikni na cieľový uzol — Esc zruší');
    };

    $('btn-new-node').onclick = openCreateNode;

    $('node-edit').onclick = () => {
        if (!S.selected) return;
        closeCreateMode(); // edit mód — select typu patrí len vytváraniu
        $('edit-label').value = S.selected.label;
        $('edit-desc').value = S.selected.description || '';
        fillMoveSelects(S.selected);
        $('node-view').classList.add('hidden');
        $('node-form').classList.remove('hidden');
    };

    $('edit-area').onchange = () => fillDeptOptions(+$('edit-area').value || null, null);

    $('edit-cancel').onclick = () => {
        if (createMode) {
            closeCreateMode();
            if (S.selected) selectNode(S.selected); // návrat na detail predtým zvoleného uzla
            else closeNodePanel();
            return;
        }
        $('node-form').classList.add('hidden');
        $('node-view').classList.remove('hidden');
    };

    $('edit-save').onclick = () => busy($('edit-save'), async () => {
        if (createMode) { await createNode(); return; }
        if (!S.selected) return;
        try {
            const res = await fetch('/api/nodes/' + S.selected.id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    label: $('edit-label').value.trim(),
                    description: $('edit-desc').value.trim() || null,
                    area_id: $('edit-area').value ? +$('edit-area').value : null,
                    department_id: $('edit-dept').value ? +$('edit-dept').value : null,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                Object.assign(S.selected, data.node);
                selectNode(S.selected);
                await reloadGraph();
                if (dockOpen === 'structure') renderStructure();
                draw();
                showToast('Uložené');
            } else {
                showToast('Uloženie sa nepodarilo');
            }
        } catch (e) {
            showToast('Uloženie sa nepodarilo');
        }
    }, 'Ukladám…');

    // Mazanie uzla — arm pattern namiesto confirm(): prvý klik ozbrojí, druhý do 3 s maže
    const nodeDel = $('node-delete');
    const disarmNodeDelete = () => {
        clearTimeout(nodeDel._disarm);
        nodeDel.classList.remove('armed');
        nodeDel.classList.add('ms');
        nodeDel.textContent = 'delete';
    };
    $('node-close').addEventListener('click', disarmNodeDelete);
    nodeDel.onclick = async () => {
        if (!S.selected) return;
        if (!nodeDel.classList.contains('armed')) {
            nodeDel.classList.add('armed');
            nodeDel.classList.remove('ms');
            nodeDel.textContent = 'Naozaj zmazať?';
            nodeDel._disarm = setTimeout(() => { if (nodeDel.isConnected) disarmNodeDelete(); }, 3000);
            return;
        }
        clearTimeout(nodeDel._disarm);
        const node = S.selected;
        await busy(nodeDel, async () => {
            try {
                const res = await fetch('/api/nodes/' + node.id, { method: 'DELETE' });
                if (!res.ok) {
                    const data = await res.json().catch(() => ({}));
                    showToast(data.message || 'Nepodarilo sa zmazať');
                    return;
                }
                // lokálne odstránenie — pulse node.deleted je idempotentný, duplicitu toleruje
                S.nodes = S.nodes.filter((m) => m.id !== node.id);
                S.edges = S.edges.filter((e) => e.source.id !== node.id && e.target.id !== node.id);
                S.byId.delete(node.id);
                if (S.local && S.local.rootId === node.id) clearLocal();
                S._localFor = null;
                closeNodePanel();
                buildSim();
                kickSim(0.3);
                draw();
                showToast('Uzol zmazaný');
            } catch (e) {
                showToast('Nepodarilo sa zmazať');
            }
        }, 'Mažem…');
        disarmNodeDelete();
    };
}

/* ---------- štart ---------- */

// Chybový hero cez plátno — vedomie sa nepodarilo načítať
function renderInitError() {
    const el = document.createElement('div');
    el.className = 'empty empty-network';
    el.innerHTML = '<span class="ms" aria-hidden="true">cloud_off</span>'
        + '<h4 class="title">Vedomie sa nepodarilo prebudiť</h4>'
        + '<p class="hint">Server neodpovedá — skontroluj, či Hades beží.</p>'
        + '<button type="button" class="primary" id="retry-init">Skúsiť znova</button>';
    document.body.appendChild(el);
    el.querySelector('#retry-init').onclick = () => location.reload();
}

async function init() {
    setTheme(localStorage.getItem('hades.theme') || 'light');
    resize();
    makeStars();
    window.addEventListener('resize', () => { resize(); requestDraw(); }); // rozmer sa zmenil → prekresli

    let data;
    try {
        const res = await fetch('/api/mind?scope=' + S.graphScope);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        data = await res.json();
    } catch (e) {
        renderInitError();
        return;
    }

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
    updateHeaderMetrics();
    renderBreadcrumb();
    applyOpts();
    setView(S.view);
    // prvé načítanie: nechaj simuláciu usadiť (~150 tikov spolu so setView) a fitni znova
    if (S.sim && S.view !== 'layers') { S.sim.tick(120); fitView(); }
    setupCmdk();
    setupPack();
    setupPrompt();
    setupHints();
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

    window.HADES = { S, draw, frame, setTheme, setFocus, fitView, setLocal, clearLocal };

    scheduleFrame();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); requestDraw(); } // návrat na tab → istý repaint
    });
}

init();

})();
