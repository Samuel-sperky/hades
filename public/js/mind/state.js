export const CORE_COLOR = '#b88a3a';
export const AREA_RADIUS = 640;

// FÁZA HRANY: základné stlmenie hrán (~40 %) — uzly a popisky vyniknú nad sieťou.
export const EDGE_DIM = 0.6;
export const DEPT_RADIUS = 170;
export const canvas = document.getElementById('mind');
export const ctx = canvas.getContext('2d');
export const S = {
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

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const OPT_DEFAULTS = {
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
export const FORCE_DEFAULTS = { charge: null, linkDistance: null, linkStrength: null, gravity: null };
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
