// resources/js/core/motion.js
var REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// resources/js/core/state/graph.js
var graph = {
  name: "Hades",
  nodes: [],
  edges: [],
  areas: /* @__PURE__ */ new Map(),
  departments: /* @__PURE__ */ new Map(),
  byId: /* @__PURE__ */ new Map(),
  sim: null,
  cam: { x: 0, y: 0, k: 0.85 },
  dpr: 1,
  w: 0,
  h: 0,
  pulses: [],
  hover: null,
  selected: null,
  focus: { areaId: null, departmentId: null },
  _hlFor: null,
  _hlSet: null,
  local: null,
  // { rootId, depth } — lokálny graf (Obsidian local graph)
  _localFor: null,
  _localSet: null,
  degree: /* @__PURE__ */ new Map(),
  // nodeId → počet hrán, prepočet v buildSim
  connectFrom: null,
  // id zdrojového uzla pri ručnom prepájaní (connect mode)
  awakeUntil: 0,
  awakeMinutes: 5,
  dim: 1,
  activations: [],
  replay: { on: false, t: 1, playing: false, tMin: 0, tMax: 0 },
  _layerCache: null,
  // poradie stĺpcov pre náhľad Vrstvy
  _lpFor: null,
  // memoizácia layerPathSet
  _lpNodes: null,
  _lpEdges: null
};

// resources/js/core/screens.js
var SCREENS = [
  "dnes",
  "dennik",
  "graf",
  "kniznica",
  "chat",
  "eshop",
  "rozhodnutia",
  "kontrola",
  "smernica"
];
var DEFAULT_SCREEN = "dnes";
function normalizeScreen(name) {
  return SCREENS.includes(name) ? name : DEFAULT_SCREEN;
}

// resources/js/core/store.js
var NS = "aura.";
var LEGACY_MAP = {
  "hades.theme": "aura.theme",
  "hades.view": "aura.view",
  "hades.screen": "aura.screen",
  "hades.sound": "aura.sound",
  "hades.opts": "aura.opts",
  "hades.forces": "aura.forces",
  "hades.filter": "aura.filter",
  "hades.relfilter": "aura.relfilter",
  "hades.minWeight2": "aura.minWeight",
  "hades.skeleton": "aura.skeleton",
  "hades.certRings": "aura.certRings",
  "hades.graphScope": "aura.graphScope",
  "hades.pack": "aura.pack",
  "hades.chat": "aura.chat",
  "hades.chatContext": "aura.chatContext",
  "hades.hints2": "aura.hints",
  "hades.journal.lastSeen": "aura.journal.lastSeen"
};
var LEGACY_OF = {};
for (const [from, to] of Object.entries(LEGACY_MAP)) LEGACY_OF[to] = from;
function readRaw(key) {
  const full = NS + key;
  try {
    const v = localStorage.getItem(full);
    if (v !== null) return v;
    const legacy = LEGACY_OF[full];
    return legacy ? localStorage.getItem(legacy) : null;
  } catch (e) {
    return null;
  }
}
var store = {
  /** JSON value; corrupted payload falls back instead of throwing. */
  get(key, fallback) {
    const v = readRaw(key);
    if (v === null) return fallback;
    try {
      return JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
    } catch (e) {
    }
  },
  del(key) {
    try {
      localStorage.removeItem(NS + key);
    } catch (e) {
    }
  },
  /** Raw string, no JSON parse (theme, screen, view, flags…). */
  raw(key, fallback = null) {
    const v = readRaw(key);
    return v === null ? fallback : v;
  },
  setRaw(key, value) {
    try {
      localStorage.setItem(NS + key, String(value));
    } catch (e) {
    }
  },
  /** Copies Hades preferences to the aura.* namespace. Idempotent, runs once.
      Old keys are intentionally kept as a rollback safety net. */
  migrateLegacy() {
    try {
      if (localStorage.getItem(NS + "__migrated")) return 0;
      let moved = 0;
      for (const [from, to] of Object.entries(LEGACY_MAP)) {
        if (localStorage.getItem(to) !== null) continue;
        const v = localStorage.getItem(from);
        if (v === null) continue;
        try {
          localStorage.setItem(to, v);
          moved++;
        } catch (e) {
        }
      }
      localStorage.setItem(NS + "__migrated", String(Date.now()));
      if (moved) console.info("[aura] migrated " + moved + " legacy preferences");
      return moved;
    } catch (e) {
      return 0;
    }
  }
};

// resources/js/core/state/ui.js
var OPT_DEFAULTS = {
  panelAlpha: 0.92,
  bg: 1,
  edgeAlpha: 1,
  glow: 1,
  labelAlpha: 1,
  nodeScale: 1,
  labelSize: 1,
  sizeByDegree: false,
  edgeSoftHover: true,
  // FÁZA HRANY: v pokoji sú hrany jemné, rozsvietia sa pri hover/fokuse uzla
  anim: 0.5,
  // FÁZA ANIMÁCIE: intenzita udalostných animácií (toky, zrod, morph; 0 = vyp)
  life: 0.5
  // FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie, drift, synapsie; 0 = pokoj)
};
var FORCE_DEFAULTS = { charge: null, linkDistance: null, linkStrength: null, gravity: null };
function jsonOr(key, fallback) {
  try {
    return JSON.parse(store.raw(key) || fallback);
  } catch (e) {
    return JSON.parse(fallback);
  }
}
var ui = {
  sound: store.raw("sound") !== "off",
  audio: null,
  view: store.raw("view") || "map",
  // FÁZA SHELL: aktívna obrazovka. Zoznam je v core/screens.js (rozhranie #16).
  // Plátno (rAF) beží len na 'graf'.
  screen: normalizeScreen(store.raw("screen")),
  opts: Object.assign({}, OPT_DEFAULTS, jsonOr("opts", "{}")),
  forces: Object.assign({}, FORCE_DEFAULTS, jsonOr("forces", "{}")),
  // FÁZA OBRAZOVKY: balík uzlov na export do Claude Code — Map(id → label). Persist 'aura.pack'.
  pack: /* @__PURE__ */ new Map()
};
try {
  const p = JSON.parse(store.raw("pack") || "[]");
  if (Array.isArray(p)) for (const it of p) {
    if (it && it.id != null) ui.pack.set(+it.id, it.label || "#" + it.id);
  }
} catch (e) {
}

// resources/js/core/state/filters.js
var filters = {
  // Filtre siete (Obsidian filters) — množiny SKRYTÝCH typov / zdrojov / oblastí.
  // tags je POZITÍVNY filter (F4): množina VYBRANÝCH značiek — prázdna = bez filtra,
  // inak sa zobrazia len uzly nesúce aspoň jednu vybranú značku (jadro vždy prejde).
  filter: { types: /* @__PURE__ */ new Set(), sources: /* @__PURE__ */ new Set(), areas: /* @__PURE__ */ new Set(), tags: /* @__PURE__ */ new Set(), relations: /* @__PURE__ */ new Set() },
  // FÁZA HRANY: default 1.0 (skryje similarity 0.5 + jednorazové co_activation 0.6).
  minWeight: (() => {
    const v = store.raw("minWeight");
    return v == null ? 1 : parseFloat(v) || 0;
  })(),
  // FÁZA HRANY: režim kostry — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
  skeleton: store.raw("skeleton") === "1",
  // FÁZA CERTAINTY (F4, §4.6): značky istoty na canvase (prstenec + dash encoding). Default ON.
  certRings: store.raw("certRings") !== "0",
  // FÁZA OBRAZOVKY: rozsah grafu — 'live' (jadro + projekty + spomienky + aktívne skilly)
  // alebo 'all' (celá sieť vrátane knižnice). Default 'live'.
  graphScope: store.raw("graphScope") === "all" ? "all" : "live"
};
try {
  const f = JSON.parse(store.raw("filter") || "{}");
  for (const k of ["types", "sources", "areas", "tags"]) {
    if (Array.isArray(f[k])) filters.filter[k] = new Set(f[k]);
  }
} catch (e) {
}
try {
  const rf = JSON.parse(store.raw("relfilter") || "[]");
  if (Array.isArray(rf)) filters.filter.relations = new Set(rf);
} catch (e) {
}

// resources/js/core/state/chat.js
var chat = {
  // E3: uzly priložené do kontextu chatu (perzistentné naprieč reloadmi)
  chatContext: /* @__PURE__ */ new Set()
};
try {
  const cc = JSON.parse(store.raw("chatContext") || "[]");
  if (Array.isArray(cc)) cc.forEach((id) => chat.chatContext.add(+id));
} catch (e) {
}

// resources/js/core/state/perf.js
var perf = {
  // FÁZA ANIMÁCIE: stav animačnej vrstvy
  _flows: [],
  // putujúce svetlobody po hranách (event-driven): { from,to,e,t,speed,tone,dim,wait }
  _morph: null,
  // prechod náhľadov: { from:Map, to:Map, t, dur }
  _clock: 0,
  // monotónny animačný čas (s) — fáza pre dýchanie / sínusovky (mrzne pri skrytom tabe)
  _anim: 0,
  // efektívna intenzita animácií tento frame (animLevel(), vrátane ambient boostu)
  _interacting: false,
  // drag/pan prebieha → dýchanie sa pozastaví
  _labelShown: null,
  // FÁZA DE-CLUTTER: id uzlov s viditeľným popiskom minulý frame (stabilita)
  // FÁZA ANIMÁCIE (Living): ambientný „život" — spojitá jemná slučka na Grafe.
  _life: 0,
  // efektívna intenzita ambientného života tento frame (lifeLevel(), 0 = pokoj)
  _lifeTier: 0,
  // auto-strop: 0 = plný, 1 = redukovaný (bez driftu), 2 = len event-driven
  _drawMs: 4,
  // EMA nákladu draw() (ms) — podklad pre auto-strop (nižší = viac hlavy)
  _lastAmbient: 0,
  // čas posledného ambientného framu (ms) — cap ~30 FPS pre život
  _nextSynapse: 3,
  // _clock, kedy vyšle ďalšiu spontánnu synapsiu („myseľ premýšľa")
  cursor: { sx: 0, sy: 0, on: false, a: 0 },
  // kurzor pre gravitáciu/parallax (screen + aktivácia 0..1)
  _vp: null,
  // svetové hranice viewportu minulý frame — cieľ pre spontánne synapsie
  // FÁZA RENDER PIPELINE: dirty-flag rAF slučka — v pokoji 0 prekreslení (tichý CPU).
  _dirty: true,
  // jednorazová požiadavka na prekreslenie (hover, kamera, dáta, filter)
  _settleFrames: 0
  // dobeh po animácii (flash/zrod dohasne, potom sa slučka zastaví)
};

// resources/js/core/state/index.js
var S = {};
function project(slice) {
  for (const key of Object.keys(slice)) {
    if (Object.prototype.hasOwnProperty.call(S, key)) {
      throw new Error("state slice key collision: " + key);
    }
    Object.defineProperty(S, key, {
      get: () => slice[key],
      set: (v) => {
        slice[key] = v;
      },
      enumerable: true,
      configurable: true
    });
  }
}
project(graph);
project(ui);
project(filters);
project(chat);
project(perf);

// resources/js/graph/render/zoom.js
var K_DETAIL = 0.5;
var K_LABEL_FADE_FROM = 0.42;
var K_LABEL_FADE_TO = 0.64;
var K_FIT_MIN = 0.6;
function labelFade(k) {
  return Math.min(1, Math.max(0, (k - K_LABEL_FADE_FROM) / (K_LABEL_FADE_TO - K_LABEL_FADE_FROM)));
}
function applyReadableZoom() {
  const k0 = S.cam.k;
  if (!(k0 > 0) || k0 >= K_FIT_MIN) return false;
  const s = K_FIT_MIN / k0;
  S.cam.k = K_FIT_MIN;
  S.cam.x *= s;
  S.cam.y *= s;
  return true;
}

// resources/js/graph/animation.js
function animLevel() {
  if (REDUCED_MOTION) return 0;
  const base = S.opts && S.opts.anim != null ? S.opts.anim : 0.5;
  if (base <= 0) return 0;
  return base * (document.body.classList.contains("ambient") ? 1.6 : 1);
}
function lifeLevel() {
  if (REDUCED_MOTION) return 0;
  let base = S.opts && S.opts.life != null ? S.opts.life : 0.5;
  const amb = document.body.classList.contains("ambient");
  if (amb) base = Math.max(base, 0.6);
  if (base <= 0) return 0;
  return base * (amb ? 1.8 : 1);
}
function lifeTier() {
  const ms = S._drawMs;
  if (ms > 33) return 2;
  if (ms > 22) return 1;
  return 0;
}
var easeOut = (p) => 1 - Math.pow(1 - Math.max(0, Math.min(1, p)), 3);
var easeInOut = (p) => {
  p = Math.max(0, Math.min(1, p));
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
};
function birthScale(n) {
  if (n._born == null || S._anim <= 0 || REDUCED_MOTION) return 1;
  const age = S._clock - n._born;
  if (age >= 0.5) return 1;
  return easeOut(age / 0.5);
}
function breatheFactor(n) {
  if (S._life <= 0 || S._interacting || S.cam.k < K_DETAIL) return 1;
  const core = n.type === "core";
  if (!core && (S._lifeTier >= 1 || n === S.hover)) return 1;
  if (core && n === S.hover) return 1;
  const life = Math.min(1.4, S._life);
  const amp = (core ? 0.05 : 0.025) * life;
  const period = core ? 5.5 : 6 + n.id % 5 * 0.5;
  return 1 + amp * Math.sin(S._clock * (2 * Math.PI / period) + n.id * 1.3);
}

// resources/js/core/format.js
var now = () => Date.now();
var rad = (deg) => deg * Math.PI / 180;
var ts = (iso) => iso ? new Date(iso).getTime() : 0;
function truncLabel(s) {
  const chars = Array.from(String(s));
  return chars.length > 24 ? chars.slice(0, 23).join("").trimEnd() + "\u2026" : s;
}

// resources/js/graph/canvas-colors.js
var FALLBACK = {
  light: { bgRgb: "248,244,247", text: "#101d1b", textSoft: "#2d3a38", muted: "#566964", accentRgb: "3,121,126" },
  dark: { bgRgb: "14,20,19", text: "#eaf3f1", textSoft: "#c3d1ce", muted: "#8a9b98", accentRgb: "5,188,196" }
};
var NUM_FALLBACK = {
  light: { gridAlpha: 0.05, nodeFloor: 0.3, edgeFloor: 0.2, haloAlpha: 0.92, outlineAlpha: 0.35 },
  dark: { gridAlpha: 0.09, nodeFloor: 0.35, edgeFloor: 0.25, haloAlpha: 0.92, outlineAlpha: 0.3 }
};
var KEYS = [
  "dark",
  "paper",
  "ink",
  "inkSoft",
  "muted",
  "labelHalo",
  "edge",
  "gridColor",
  "accent",
  "outline",
  "gridAlpha",
  "nodeFloor",
  "edgeFloor"
];
function toTriplet(value, fallback) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return fallback;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c2) => c2 + c2) : hex[1];
    const n = parseInt(h, 16);
    return (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255);
  }
  const nums = raw.replace(/^rgba?\(/i, "").replace(/\)$/, "").split(/[,\s/]+/).map((p) => parseFloat(p)).filter((p) => Number.isFinite(p));
  if (nums.length < 3) return fallback;
  return nums.slice(0, 3).map((p) => Math.round(p)).join(",");
}
function tripletToHex(triplet) {
  const [r, g, b] = triplet.split(",").map((p) => Math.max(0, Math.min(255, parseInt(p, 10) || 0)));
  const hx = (v) => v.toString(16).padStart(2, "0");
  return "#" + hx(r) + hx(g) + hx(b);
}
var _cache = null;
function readTheme() {
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const fb = dark ? FALLBACK.dark : FALLBACK.light;
  const nfb = dark ? NUM_FALLBACK.dark : NUM_FALLBACK.light;
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(document.documentElement) : null;
  const raw = (name) => cs ? (cs.getPropertyValue(name) || "").trim() : "";
  const num = (name, fallback) => {
    const v = parseFloat(raw(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const bg = toTriplet(raw("--bg-rgb"), fb.bgRgb);
  const ink = toTriplet(raw("--text"), fb.text);
  const inkSoft = toTriplet(raw("--text-secondary"), fb.textSoft);
  const muted = toTriplet(raw("--muted"), fb.muted);
  const accent = toTriplet(raw("--accent-rgb"), fb.accentRgb);
  const haloAlpha = num("--canvas-halo-alpha", nfb.haloAlpha);
  const outlineAlpha = num("--canvas-outline-alpha", nfb.outlineAlpha);
  return {
    dark,
    paper: tripletToHex(bg),
    ink: tripletToHex(ink),
    inkSoft: tripletToHex(inkSoft),
    muted: tripletToHex(muted),
    labelHalo: "rgba(" + bg + "," + haloAlpha + ")",
    edge: inkSoft,
    // rgb triplet — skladá sa do rgb()/rgba() v renderi
    gridColor: accent,
    // rgb triplet
    accent,
    // rgb triplet
    outline: "rgba(" + ink + "," + outlineAlpha + ")",
    gridAlpha: num("--canvas-grid-alpha", nfb.gridAlpha),
    nodeFloor: num("--canvas-node-floor", nfb.nodeFloor),
    edgeFloor: num("--canvas-edge-floor", nfb.edgeFloor)
  };
}
var T = {};
for (const key of KEYS) {
  Object.defineProperty(T, key, {
    get: () => (_cache || (_cache = readTheme()))[key],
    enumerable: true
  });
}

// resources/js/graph/colors.js
var CORE_COLOR = "#b88a3a";
var AREA_RADIUS = 640;
var DEPT_RADIUS = 170;
var EDGE_DIM = 0.6;
var _darkColorCache = /* @__PURE__ */ new Map();
function darkAreaColor(hex) {
  const cached = _darkColorCache.get(hex);
  if (cached) return cached;
  const m2 = /^#?([0-9a-f]{6})$/i.exec(String(hex));
  if (!m2) return hex;
  const num = parseInt(m2[1], 16);
  const r = (num >> 16 & 255) / 255, g = (num >> 8 & 255) / 255, b = (num & 255) / 255;
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
  const hue2rgb = (p2, q2, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p2 + (q2 - p2) * 6 * t;
    if (t < 1 / 2) return q2;
    if (t < 2 / 3) return p2 + (q2 - p2) * (2 / 3 - t) * 6;
    return p2;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toHex = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, "0");
  const out = "#" + toHex(h + 1 / 3) + toHex(h) + toHex(h - 1 / 3);
  _darkColorCache.set(hex, out);
  return out;
}
function nodeColor(n) {
  let hex;
  if (n.type === "core") hex = CORE_COLOR;
  else {
    const area = S.areas.get(n.area_id);
    hex = area ? area.color : "#2f6d8f";
  }
  return T.dark ? darkAreaColor(hex) : hex;
}

// resources/js/graph/geometry.js
var _hubFor = null;
var _hub = null;
function hubNode() {
  if (_hubFor && _hubFor.nodes === S.nodes && _hubFor.name === S.name && _hub && S.byId.get(_hub.id) === _hub) return _hub;
  let match = null, lowest = null;
  for (const n of S.nodes) {
    if (n.type !== "core") continue;
    if (n.label === S.name) {
      match = n;
      break;
    }
    if (!lowest || n.id < lowest.id) lowest = n;
  }
  _hub = match || lowest;
  _hubFor = { nodes: S.nodes, name: S.name };
  return _hub;
}
function isHub(n) {
  if (!n || n.type !== "core") return false;
  return n === hubNode();
}
function nodeRadius(n) {
  let base;
  if (n.type === "core") {
    base = isHub(n) ? 24 : 14;
  } else {
    const deg = S.degree.get(n.id) || 0;
    base = Math.min(15, 5.5 + 2.4 * Math.log2(1 + deg));
  }
  return base * (S.opts ? S.opts.nodeScale : 1);
}

// resources/js/graph/anchors.js
function areaAnchor(area) {
  return {
    x: Math.cos(rad(area.angle)) * AREA_RADIUS,
    y: Math.sin(rad(area.angle)) * AREA_RADIUS
  };
}
function deptAnchor(dept) {
  const area = S.areas.get(dept.area_id);
  if (!area) return { x: 0, y: 0 };
  const siblings = [...S.departments.values()].filter((d) => d.area_id === dept.area_id);
  const i = siblings.findIndex((d) => d.id === dept.id);
  const spread = rad(area.angle) + (i - (siblings.length - 1) / 2) * 0.55;
  const a2 = areaAnchor(area);
  return { x: a2.x + Math.cos(spread) * DEPT_RADIUS, y: a2.y + Math.sin(spread) * DEPT_RADIUS };
}
function anchorOf(n) {
  if (n.type === "core") {
    if (isHub(n)) return { x: 0, y: 0 };
    const cores = S.nodes.filter((m2) => m2.type === "core" && !isHub(m2));
    const i = cores.findIndex((m2) => m2.id === n.id);
    const a2 = rad(360 / Math.max(cores.length, 1) * i - 90);
    return { x: Math.cos(a2) * 85, y: Math.sin(a2) * 85 };
  }
  if (n.department_id && S.departments.has(n.department_id)) {
    return deptAnchor(S.departments.get(n.department_id));
  }
  if (n.area_id && S.areas.has(n.area_id)) return areaAnchor(S.areas.get(n.area_id));
  return { x: 0, y: 0 };
}

// resources/js/graph/canvas-el.js
var canvas = document.getElementById("mind");
var ctx = canvas.getContext("2d");

// resources/js/core/dom.js
var $ = (id) => document.getElementById(id);

// resources/js/graph/awake.js
function isAwake() {
  return now() < S.awakeUntil;
}

// resources/js/graph/layers.js
var LAYER_X = [-560, -280, 0, 280, 560];
var LAYER_META = [
  { title: "Vstup", sub: "Spomienky" },
  { title: "Skryt\xE1", sub: "Skills \u2192 spomienky" },
  { title: "Jadro", sub: "Osobnos\u0165" },
  { title: "Skryt\xE1", sub: "Skills \u2192 projekty" },
  { title: "V\xFDstup", sub: "Projekty" }
];
function layerIndexOf(n) {
  switch (n.layer_role) {
    case "input":
      return 0;
    case "hidden_in":
      return 1;
    case "core":
      return 2;
    case "hidden_out":
      return 3;
    case "output":
      return 4;
  }
  if (n.type === "memory") return 0;
  if (n.type === "core") return 2;
  if (n.type === "project") return 4;
  if (n.type === "skill") return 99;
  return -1;
}
function areaKey(n) {
  return n.area_id == null ? -1 : n.area_id;
}
function cmpInitial(a2, b) {
  const ka = areaKey(a2), kb = areaKey(b);
  if (ka !== kb) return ka - kb;
  const la = (a2.label || "").toLowerCase(), lb = (b.label || "").toLowerCase();
  if (la !== lb) return la < lb ? -1 : 1;
  return a2.id - b.id;
}
function computeLayerColumns() {
  const nbr = /* @__PURE__ */ new Map();
  for (const n of S.nodes) nbr.set(n.id, []);
  for (const e of S.edges) {
    const s = e.source, t = e.target;
    if (!s || !t || !nbr.has(s.id) || !nbr.has(t.id)) continue;
    nbr.get(s.id).push(t);
    nbr.get(t.id).push(s);
  }
  const cols = [[], [], [], [], []];
  const colOf = /* @__PURE__ */ new Map();
  for (const n of S.nodes) {
    let li = layerIndexOf(n);
    if (li === 99) {
      let left = 0, right = 0;
      for (const m2 of nbr.get(n.id)) {
        if (m2.type === "memory") left++;
        else if (m2.type === "core" || m2.type === "project") right++;
      }
      li = right > left ? 3 : left > right ? 1 : n.id % 2 ? 3 : 1;
    } else if (li < 0) {
      li = 2;
    }
    cols[li].push(n);
    colOf.set(n.id, li);
  }
  const pos = /* @__PURE__ */ new Map();
  for (const arr of cols) {
    arr.sort(cmpInitial);
    arr.forEach((n, i) => pos.set(n.id, i));
  }
  for (let iter = 0; iter < 4; iter++) {
    const forward = iter % 2 === 0;
    for (let s = 0; s < cols.length; s++) {
      const li = forward ? s : cols.length - 1 - s;
      const arr = cols[li];
      if (arr.length < 2) continue;
      const bary = /* @__PURE__ */ new Map();
      for (const n of arr) {
        let sum = 0, cnt = 0;
        for (const m2 of nbr.get(n.id)) {
          if (colOf.get(m2.id) === li) continue;
          sum += pos.get(m2.id);
          cnt++;
        }
        bary.set(n.id, cnt ? sum / cnt : pos.get(n.id));
      }
      const aSum = /* @__PURE__ */ new Map(), aCnt = /* @__PURE__ */ new Map();
      for (const n of arr) {
        const k = areaKey(n);
        aSum.set(k, (aSum.get(k) || 0) + bary.get(n.id));
        aCnt.set(k, (aCnt.get(k) || 0) + 1);
      }
      const aRank = /* @__PURE__ */ new Map();
      [...aSum.keys()].sort((x3, y3) => aSum.get(x3) / aCnt.get(x3) - aSum.get(y3) / aCnt.get(y3) || x3 - y3).forEach((k, i) => aRank.set(k, i));
      arr.sort((a2, b) => {
        const ra = aRank.get(areaKey(a2)), rb = aRank.get(areaKey(b));
        if (ra !== rb) return ra - rb;
        const da = bary.get(a2.id), db = bary.get(b.id);
        if (da !== db) return da - db;
        return a2.id - b.id;
      });
      arr.forEach((n, i) => pos.set(n.id, i));
    }
  }
  return cols;
}
var SUB_SPLIT_AT = 22;
var SUB_MAX = 4;
var SUB_OFFSET = 62;
function layerLayout() {
  const sig = S.nodes.length + "|" + S.edges.length;
  if (S._layerCache && S._layerCache.sig === sig) return S._layerCache;
  const cols = computeLayerColumns();
  const posOf = /* @__PURE__ */ new Map();
  const guides = [];
  const bands = [];
  let maxHalf = 0, minX = Infinity, maxX = -Infinity;
  for (let li = 0; li < cols.length; li++) {
    const arr = cols[li];
    const len = arr.length;
    if (!len) continue;
    const subCount = Math.min(SUB_MAX, Math.max(1, Math.ceil(len / SUB_SPLIT_AT)));
    const perSub = Math.ceil(len / subCount);
    const spacing = Math.max(48, Math.min(95, 1100 / Math.max(perSub, 1)));
    for (let s = 0; s < subCount; s++) {
      const start = s * perSub;
      const end = Math.min(len, start + perSub);
      const subLen = end - start;
      if (subLen <= 0) continue;
      const x3 = LAYER_X[li] + (s - (subCount - 1) / 2) * SUB_OFFSET;
      const half = (subLen - 1) / 2 * spacing;
      if (half > maxHalf) maxHalf = half;
      if (x3 < minX) minX = x3;
      if (x3 > maxX) maxX = x3;
      guides.push({ x: x3, half });
      for (let k = start; k < end; k++) {
        const y3 = (k - start - (subLen - 1) / 2) * spacing;
        posOf.set(arr[k].id, { x: x3, y: y3, li });
      }
      let i = start;
      while (i < end) {
        const aid = arr[i].area_id;
        let j = i;
        while (j + 1 < end && arr[j + 1].area_id === aid) j++;
        const area = aid != null ? S.areas.get(aid) : null;
        if (area && area.color && arr[i].type !== "core") {
          const y0 = (i - start - (subLen - 1) / 2) * spacing;
          const y1 = (j - start - (subLen - 1) / 2) * spacing;
          bands.push({ x: x3, y0, y1, color: area.color, single: j === i, spacing });
        }
        i = j + 1;
      }
    }
  }
  if (minX === Infinity) {
    minX = LAYER_X[0];
    maxX = LAYER_X[LAYER_X.length - 1];
  }
  const layout = { sig, cols, posOf, guides, bands, maxHalf, minX, maxX };
  S._layerCache = layout;
  return layout;
}

// resources/js/graph/pulses.js
function flowCap() {
  return Math.max(0, Math.round(20 * Math.min(1.2, Math.max(S._anim, S._life))));
}
function synapseCount() {
  let c2 = 0;
  for (const f of S._flows) if (f.spont) c2++;
  return c2;
}
function pickSynapseEdge() {
  if (!S.edges.length) return null;
  const loc = localSet();
  const vp = S._vp;
  let fallback = null;
  for (let tries = 0; tries < 14; tries++) {
    const e = S.edges[Math.random() * S.edges.length | 0];
    if (!e || !e.source || !e.target) continue;
    if ((e.weight || 1) < S.minWeight) continue;
    if (edgeCategoryHidden(e)) continue;
    if (!loc && !edgeSkeletal(e)) continue;
    if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
    if (!(visibleInReplay(e.source) && visibleInReplay(e.target))) continue;
    fallback = e;
    if (!vp) return e;
    const a2 = e.source, b = e.target;
    const inView = !(Math.max(a2.x, b.x) < vp.x0 || Math.min(a2.x, b.x) > vp.x1 || Math.max(a2.y, b.y) < vp.y0 || Math.min(a2.y, b.y) > vp.y1);
    if (inView) return e;
  }
  return fallback;
}
function maybeSynapse() {
  if (S._life <= 0 || S._lifeTier >= 2 || REDUCED_MOTION || document.hidden || S.replay.on) return;
  if (S._clock < S._nextSynapse) return;
  const life = Math.min(1.6, S._life);
  S._nextSynapse = S._clock + (2 + Math.random() * 3) / Math.max(0.2, life);
  const cap = S._lifeTier === 1 ? 1 : document.body.classList.contains("ambient") ? 3 : 2;
  if (synapseCount() >= cap) return;
  const e = pickSynapseEdge();
  if (!e) return;
  const fwd = Math.random() < 0.5;
  S._flows.push({
    from: fwd ? e.source : e.target,
    to: fwd ? e.target : e.source,
    e,
    t: 0,
    speed: 0.5 + Math.random() * 0.35,
    tone: Math.random() < 0.5 ? "accent" : "ink",
    dim: 0.7,
    wait: 0,
    spont: true
  });
  requestDraw();
}

// node_modules/d3-quadtree/src/add.js
function add_default(d) {
  const x3 = +this._x.call(null, d), y3 = +this._y.call(null, d);
  return add(this.cover(x3, y3), x3, y3, d);
}
function add(tree, x3, y3, d) {
  if (isNaN(x3) || isNaN(y3)) return tree;
  var parent, node = tree._root, leaf = { data: d }, x0 = tree._x0, y0 = tree._y0, x1 = tree._x1, y1 = tree._y1, xm, ym, xp, yp, right, bottom, i, j;
  if (!node) return tree._root = leaf, tree;
  while (node.length) {
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (parent = node, !(node = node[i = bottom << 1 | right])) return parent[i] = leaf, tree;
  }
  xp = +tree._x.call(null, node.data);
  yp = +tree._y.call(null, node.data);
  if (x3 === xp && y3 === yp) return leaf.next = node, parent ? parent[i] = leaf : tree._root = leaf, tree;
  do {
    parent = parent ? parent[i] = new Array(4) : tree._root = new Array(4);
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
  } while ((i = bottom << 1 | right) === (j = (yp >= ym) << 1 | xp >= xm));
  return parent[j] = node, parent[i] = leaf, tree;
}
function addAll(data) {
  var d, i, n = data.length, x3, y3, xz = new Array(n), yz = new Array(n), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (i = 0; i < n; ++i) {
    if (isNaN(x3 = +this._x.call(null, d = data[i])) || isNaN(y3 = +this._y.call(null, d))) continue;
    xz[i] = x3;
    yz[i] = y3;
    if (x3 < x0) x0 = x3;
    if (x3 > x1) x1 = x3;
    if (y3 < y0) y0 = y3;
    if (y3 > y1) y1 = y3;
  }
  if (x0 > x1 || y0 > y1) return this;
  this.cover(x0, y0).cover(x1, y1);
  for (i = 0; i < n; ++i) {
    add(this, xz[i], yz[i], data[i]);
  }
  return this;
}

// node_modules/d3-quadtree/src/cover.js
function cover_default(x3, y3) {
  if (isNaN(x3 = +x3) || isNaN(y3 = +y3)) return this;
  var x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1;
  if (isNaN(x0)) {
    x1 = (x0 = Math.floor(x3)) + 1;
    y1 = (y0 = Math.floor(y3)) + 1;
  } else {
    var z = x1 - x0 || 1, node = this._root, parent, i;
    while (x0 > x3 || x3 >= x1 || y0 > y3 || y3 >= y1) {
      i = (y3 < y0) << 1 | x3 < x0;
      parent = new Array(4), parent[i] = node, node = parent, z *= 2;
      switch (i) {
        case 0:
          x1 = x0 + z, y1 = y0 + z;
          break;
        case 1:
          x0 = x1 - z, y1 = y0 + z;
          break;
        case 2:
          x1 = x0 + z, y0 = y1 - z;
          break;
        case 3:
          x0 = x1 - z, y0 = y1 - z;
          break;
      }
    }
    if (this._root && this._root.length) this._root = node;
  }
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  return this;
}

// node_modules/d3-quadtree/src/data.js
function data_default() {
  var data = [];
  this.visit(function(node) {
    if (!node.length) do
      data.push(node.data);
    while (node = node.next);
  });
  return data;
}

// node_modules/d3-quadtree/src/extent.js
function extent_default(_) {
  return arguments.length ? this.cover(+_[0][0], +_[0][1]).cover(+_[1][0], +_[1][1]) : isNaN(this._x0) ? void 0 : [[this._x0, this._y0], [this._x1, this._y1]];
}

// node_modules/d3-quadtree/src/quad.js
function quad_default(node, x0, y0, x1, y1) {
  this.node = node;
  this.x0 = x0;
  this.y0 = y0;
  this.x1 = x1;
  this.y1 = y1;
}

// node_modules/d3-quadtree/src/find.js
function find_default(x3, y3, radius) {
  var data, x0 = this._x0, y0 = this._y0, x1, y1, x22, y22, x32 = this._x1, y32 = this._y1, quads = [], node = this._root, q, i;
  if (node) quads.push(new quad_default(node, x0, y0, x32, y32));
  if (radius == null) radius = Infinity;
  else {
    x0 = x3 - radius, y0 = y3 - radius;
    x32 = x3 + radius, y32 = y3 + radius;
    radius *= radius;
  }
  while (q = quads.pop()) {
    if (!(node = q.node) || (x1 = q.x0) > x32 || (y1 = q.y0) > y32 || (x22 = q.x1) < x0 || (y22 = q.y1) < y0) continue;
    if (node.length) {
      var xm = (x1 + x22) / 2, ym = (y1 + y22) / 2;
      quads.push(
        new quad_default(node[3], xm, ym, x22, y22),
        new quad_default(node[2], x1, ym, xm, y22),
        new quad_default(node[1], xm, y1, x22, ym),
        new quad_default(node[0], x1, y1, xm, ym)
      );
      if (i = (y3 >= ym) << 1 | x3 >= xm) {
        q = quads[quads.length - 1];
        quads[quads.length - 1] = quads[quads.length - 1 - i];
        quads[quads.length - 1 - i] = q;
      }
    } else {
      var dx = x3 - +this._x.call(null, node.data), dy = y3 - +this._y.call(null, node.data), d2 = dx * dx + dy * dy;
      if (d2 < radius) {
        var d = Math.sqrt(radius = d2);
        x0 = x3 - d, y0 = y3 - d;
        x32 = x3 + d, y32 = y3 + d;
        data = node.data;
      }
    }
  }
  return data;
}

// node_modules/d3-quadtree/src/remove.js
function remove_default(d) {
  if (isNaN(x3 = +this._x.call(null, d)) || isNaN(y3 = +this._y.call(null, d))) return this;
  var parent, node = this._root, retainer, previous, next, x0 = this._x0, y0 = this._y0, x1 = this._x1, y1 = this._y1, x3, y3, xm, ym, right, bottom, i, j;
  if (!node) return this;
  if (node.length) while (true) {
    if (right = x3 >= (xm = (x0 + x1) / 2)) x0 = xm;
    else x1 = xm;
    if (bottom = y3 >= (ym = (y0 + y1) / 2)) y0 = ym;
    else y1 = ym;
    if (!(parent = node, node = node[i = bottom << 1 | right])) return this;
    if (!node.length) break;
    if (parent[i + 1 & 3] || parent[i + 2 & 3] || parent[i + 3 & 3]) retainer = parent, j = i;
  }
  while (node.data !== d) if (!(previous = node, node = node.next)) return this;
  if (next = node.next) delete node.next;
  if (previous) return next ? previous.next = next : delete previous.next, this;
  if (!parent) return this._root = next, this;
  next ? parent[i] = next : delete parent[i];
  if ((node = parent[0] || parent[1] || parent[2] || parent[3]) && node === (parent[3] || parent[2] || parent[1] || parent[0]) && !node.length) {
    if (retainer) retainer[j] = node;
    else this._root = node;
  }
  return this;
}
function removeAll(data) {
  for (var i = 0, n = data.length; i < n; ++i) this.remove(data[i]);
  return this;
}

// node_modules/d3-quadtree/src/root.js
function root_default() {
  return this._root;
}

// node_modules/d3-quadtree/src/size.js
function size_default() {
  var size = 0;
  this.visit(function(node) {
    if (!node.length) do
      ++size;
    while (node = node.next);
  });
  return size;
}

// node_modules/d3-quadtree/src/visit.js
function visit_default(callback) {
  var quads = [], q, node = this._root, child, x0, y0, x1, y1;
  if (node) quads.push(new quad_default(node, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    if (!callback(node = q.node, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1) && node.length) {
      var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
    }
  }
  return this;
}

// node_modules/d3-quadtree/src/visitAfter.js
function visitAfter_default(callback) {
  var quads = [], next = [], q;
  if (this._root) quads.push(new quad_default(this._root, this._x0, this._y0, this._x1, this._y1));
  while (q = quads.pop()) {
    var node = q.node;
    if (node.length) {
      var child, x0 = q.x0, y0 = q.y0, x1 = q.x1, y1 = q.y1, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
      if (child = node[0]) quads.push(new quad_default(child, x0, y0, xm, ym));
      if (child = node[1]) quads.push(new quad_default(child, xm, y0, x1, ym));
      if (child = node[2]) quads.push(new quad_default(child, x0, ym, xm, y1));
      if (child = node[3]) quads.push(new quad_default(child, xm, ym, x1, y1));
    }
    next.push(q);
  }
  while (q = next.pop()) {
    callback(q.node, q.x0, q.y0, q.x1, q.y1);
  }
  return this;
}

// node_modules/d3-quadtree/src/x.js
function defaultX(d) {
  return d[0];
}
function x_default(_) {
  return arguments.length ? (this._x = _, this) : this._x;
}

// node_modules/d3-quadtree/src/y.js
function defaultY(d) {
  return d[1];
}
function y_default(_) {
  return arguments.length ? (this._y = _, this) : this._y;
}

// node_modules/d3-quadtree/src/quadtree.js
function quadtree(nodes, x3, y3) {
  var tree = new Quadtree(x3 == null ? defaultX : x3, y3 == null ? defaultY : y3, NaN, NaN, NaN, NaN);
  return nodes == null ? tree : tree.addAll(nodes);
}
function Quadtree(x3, y3, x0, y0, x1, y1) {
  this._x = x3;
  this._y = y3;
  this._x0 = x0;
  this._y0 = y0;
  this._x1 = x1;
  this._y1 = y1;
  this._root = void 0;
}
function leaf_copy(leaf) {
  var copy = { data: leaf.data }, next = copy;
  while (leaf = leaf.next) next = next.next = { data: leaf.data };
  return copy;
}
var treeProto = quadtree.prototype = Quadtree.prototype;
treeProto.copy = function() {
  var copy = new Quadtree(this._x, this._y, this._x0, this._y0, this._x1, this._y1), node = this._root, nodes, child;
  if (!node) return copy;
  if (!node.length) return copy._root = leaf_copy(node), copy;
  nodes = [{ source: node, target: copy._root = new Array(4) }];
  while (node = nodes.pop()) {
    for (var i = 0; i < 4; ++i) {
      if (child = node.source[i]) {
        if (child.length) nodes.push({ source: child, target: node.target[i] = new Array(4) });
        else node.target[i] = leaf_copy(child);
      }
    }
  }
  return copy;
};
treeProto.add = add_default;
treeProto.addAll = addAll;
treeProto.cover = cover_default;
treeProto.data = data_default;
treeProto.extent = extent_default;
treeProto.find = find_default;
treeProto.remove = remove_default;
treeProto.removeAll = removeAll;
treeProto.root = root_default;
treeProto.size = size_default;
treeProto.visit = visit_default;
treeProto.visitAfter = visitAfter_default;
treeProto.x = x_default;
treeProto.y = y_default;

// node_modules/d3-force/src/constant.js
function constant_default(x3) {
  return function() {
    return x3;
  };
}

// node_modules/d3-force/src/jiggle.js
function jiggle_default(random) {
  return (random() - 0.5) * 1e-6;
}

// node_modules/d3-force/src/collide.js
function x(d) {
  return d.x + d.vx;
}
function y(d) {
  return d.y + d.vy;
}
function collide_default(radius) {
  var nodes, radii, random, strength = 1, iterations = 1;
  if (typeof radius !== "function") radius = constant_default(radius == null ? 1 : +radius);
  function force() {
    var i, n = nodes.length, tree, node, xi, yi, ri, ri2;
    for (var k = 0; k < iterations; ++k) {
      tree = quadtree(nodes, x, y).visitAfter(prepare);
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        ri = radii[node.index], ri2 = ri * ri;
        xi = node.x + node.vx;
        yi = node.y + node.vy;
        tree.visit(apply);
      }
    }
    function apply(quad, x0, y0, x1, y1) {
      var data = quad.data, rj = quad.r, r = ri + rj;
      if (data) {
        if (data.index > node.index) {
          var x3 = xi - data.x - data.vx, y3 = yi - data.y - data.vy, l = x3 * x3 + y3 * y3;
          if (l < r * r) {
            if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
            if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
            l = (r - (l = Math.sqrt(l))) / l * strength;
            node.vx += (x3 *= l) * (r = (rj *= rj) / (ri2 + rj));
            node.vy += (y3 *= l) * r;
            data.vx -= x3 * (r = 1 - r);
            data.vy -= y3 * r;
          }
        }
        return;
      }
      return x0 > xi + r || x1 < xi - r || y0 > yi + r || y1 < yi - r;
    }
  }
  function prepare(quad) {
    if (quad.data) return quad.r = radii[quad.data.index];
    for (var i = quad.r = 0; i < 4; ++i) {
      if (quad[i] && quad[i].r > quad.r) {
        quad.r = quad[i].r;
      }
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, node;
    radii = new Array(n);
    for (i = 0; i < n; ++i) node = nodes[i], radii[node.index] = +radius(node, i, nodes);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = +_, force) : strength;
  };
  force.radius = function(_) {
    return arguments.length ? (radius = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : radius;
  };
  return force;
}

// node_modules/d3-force/src/link.js
function index(d) {
  return d.index;
}
function find(nodeById, nodeId) {
  var node = nodeById.get(nodeId);
  if (!node) throw new Error("node not found: " + nodeId);
  return node;
}
function link_default(links) {
  var id = index, strength = defaultStrength, strengths, distance = constant_default(30), distances, nodes, count, bias, random, iterations = 1;
  if (links == null) links = [];
  function defaultStrength(link) {
    return 1 / Math.min(count[link.source.index], count[link.target.index]);
  }
  function force(alpha) {
    for (var k = 0, n = links.length; k < iterations; ++k) {
      for (var i = 0, link, source, target, x3, y3, l, b; i < n; ++i) {
        link = links[i], source = link.source, target = link.target;
        x3 = target.x + target.vx - source.x - source.vx || jiggle_default(random);
        y3 = target.y + target.vy - source.y - source.vy || jiggle_default(random);
        l = Math.sqrt(x3 * x3 + y3 * y3);
        l = (l - distances[i]) / l * alpha * strengths[i];
        x3 *= l, y3 *= l;
        target.vx -= x3 * (b = bias[i]);
        target.vy -= y3 * b;
        source.vx += x3 * (b = 1 - b);
        source.vy += y3 * b;
      }
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, m2 = links.length, nodeById = new Map(nodes.map((d, i2) => [id(d, i2, nodes), d])), link;
    for (i = 0, count = new Array(n); i < m2; ++i) {
      link = links[i], link.index = i;
      if (typeof link.source !== "object") link.source = find(nodeById, link.source);
      if (typeof link.target !== "object") link.target = find(nodeById, link.target);
      count[link.source.index] = (count[link.source.index] || 0) + 1;
      count[link.target.index] = (count[link.target.index] || 0) + 1;
    }
    for (i = 0, bias = new Array(m2); i < m2; ++i) {
      link = links[i], bias[i] = count[link.source.index] / (count[link.source.index] + count[link.target.index]);
    }
    strengths = new Array(m2), initializeStrength();
    distances = new Array(m2), initializeDistance();
  }
  function initializeStrength() {
    if (!nodes) return;
    for (var i = 0, n = links.length; i < n; ++i) {
      strengths[i] = +strength(links[i], i, links);
    }
  }
  function initializeDistance() {
    if (!nodes) return;
    for (var i = 0, n = links.length; i < n; ++i) {
      distances[i] = +distance(links[i], i, links);
    }
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.links = function(_) {
    return arguments.length ? (links = _, initialize(), force) : links;
  };
  force.id = function(_) {
    return arguments.length ? (id = _, force) : id;
  };
  force.iterations = function(_) {
    return arguments.length ? (iterations = +_, force) : iterations;
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initializeStrength(), force) : strength;
  };
  force.distance = function(_) {
    return arguments.length ? (distance = typeof _ === "function" ? _ : constant_default(+_), initializeDistance(), force) : distance;
  };
  return force;
}

// node_modules/d3-dispatch/src/dispatch.js
var noop = { value: () => {
} };
function dispatch() {
  for (var i = 0, n = arguments.length, _ = {}, t; i < n; ++i) {
    if (!(t = arguments[i] + "") || t in _ || /[\s.]/.test(t)) throw new Error("illegal type: " + t);
    _[t] = [];
  }
  return new Dispatch(_);
}
function Dispatch(_) {
  this._ = _;
}
function parseTypenames(typenames, types) {
  return typenames.trim().split(/^|\s+/).map(function(t) {
    var name = "", i = t.indexOf(".");
    if (i >= 0) name = t.slice(i + 1), t = t.slice(0, i);
    if (t && !types.hasOwnProperty(t)) throw new Error("unknown type: " + t);
    return { type: t, name };
  });
}
Dispatch.prototype = dispatch.prototype = {
  constructor: Dispatch,
  on: function(typename, callback) {
    var _ = this._, T2 = parseTypenames(typename + "", _), t, i = -1, n = T2.length;
    if (arguments.length < 2) {
      while (++i < n) if ((t = (typename = T2[i]).type) && (t = get(_[t], typename.name))) return t;
      return;
    }
    if (callback != null && typeof callback !== "function") throw new Error("invalid callback: " + callback);
    while (++i < n) {
      if (t = (typename = T2[i]).type) _[t] = set(_[t], typename.name, callback);
      else if (callback == null) for (t in _) _[t] = set(_[t], typename.name, null);
    }
    return this;
  },
  copy: function() {
    var copy = {}, _ = this._;
    for (var t in _) copy[t] = _[t].slice();
    return new Dispatch(copy);
  },
  call: function(type, that) {
    if ((n = arguments.length - 2) > 0) for (var args = new Array(n), i = 0, n, t; i < n; ++i) args[i] = arguments[i + 2];
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  },
  apply: function(type, that, args) {
    if (!this._.hasOwnProperty(type)) throw new Error("unknown type: " + type);
    for (var t = this._[type], i = 0, n = t.length; i < n; ++i) t[i].value.apply(that, args);
  }
};
function get(type, name) {
  for (var i = 0, n = type.length, c2; i < n; ++i) {
    if ((c2 = type[i]).name === name) {
      return c2.value;
    }
  }
}
function set(type, name, callback) {
  for (var i = 0, n = type.length; i < n; ++i) {
    if (type[i].name === name) {
      type[i] = noop, type = type.slice(0, i).concat(type.slice(i + 1));
      break;
    }
  }
  if (callback != null) type.push({ name, value: callback });
  return type;
}
var dispatch_default = dispatch;

// node_modules/d3-timer/src/timer.js
var frame = 0;
var timeout = 0;
var interval = 0;
var pokeDelay = 1e3;
var taskHead;
var taskTail;
var clockLast = 0;
var clockNow = 0;
var clockSkew = 0;
var clock = typeof performance === "object" && performance.now ? performance : Date;
var setFrame = typeof window === "object" && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function(f) {
  setTimeout(f, 17);
};
function now2() {
  return clockNow || (setFrame(clearNow), clockNow = clock.now() + clockSkew);
}
function clearNow() {
  clockNow = 0;
}
function Timer() {
  this._call = this._time = this._next = null;
}
Timer.prototype = timer.prototype = {
  constructor: Timer,
  restart: function(callback, delay, time) {
    if (typeof callback !== "function") throw new TypeError("callback is not a function");
    time = (time == null ? now2() : +time) + (delay == null ? 0 : +delay);
    if (!this._next && taskTail !== this) {
      if (taskTail) taskTail._next = this;
      else taskHead = this;
      taskTail = this;
    }
    this._call = callback;
    this._time = time;
    sleep();
  },
  stop: function() {
    if (this._call) {
      this._call = null;
      this._time = Infinity;
      sleep();
    }
  }
};
function timer(callback, delay, time) {
  var t = new Timer();
  t.restart(callback, delay, time);
  return t;
}
function timerFlush() {
  now2();
  ++frame;
  var t = taskHead, e;
  while (t) {
    if ((e = clockNow - t._time) >= 0) t._call.call(void 0, e);
    t = t._next;
  }
  --frame;
}
function wake() {
  clockNow = (clockLast = clock.now()) + clockSkew;
  frame = timeout = 0;
  try {
    timerFlush();
  } finally {
    frame = 0;
    nap();
    clockNow = 0;
  }
}
function poke() {
  var now3 = clock.now(), delay = now3 - clockLast;
  if (delay > pokeDelay) clockSkew -= delay, clockLast = now3;
}
function nap() {
  var t0, t1 = taskHead, t2, time = Infinity;
  while (t1) {
    if (t1._call) {
      if (time > t1._time) time = t1._time;
      t0 = t1, t1 = t1._next;
    } else {
      t2 = t1._next, t1._next = null;
      t1 = t0 ? t0._next = t2 : taskHead = t2;
    }
  }
  taskTail = t0;
  sleep(time);
}
function sleep(time) {
  if (frame) return;
  if (timeout) timeout = clearTimeout(timeout);
  var delay = time - clockNow;
  if (delay > 24) {
    if (time < Infinity) timeout = setTimeout(wake, time - clock.now() - clockSkew);
    if (interval) interval = clearInterval(interval);
  } else {
    if (!interval) clockLast = clock.now(), interval = setInterval(poke, pokeDelay);
    frame = 1, setFrame(wake);
  }
}

// node_modules/d3-force/src/lcg.js
var a = 1664525;
var c = 1013904223;
var m = 4294967296;
function lcg_default() {
  let s = 1;
  return () => (s = (a * s + c) % m) / m;
}

// node_modules/d3-force/src/simulation.js
function x2(d) {
  return d.x;
}
function y2(d) {
  return d.y;
}
var initialRadius = 10;
var initialAngle = Math.PI * (3 - Math.sqrt(5));
function simulation_default(nodes) {
  var simulation, alpha = 1, alphaMin = 1e-3, alphaDecay = 1 - Math.pow(alphaMin, 1 / 300), alphaTarget = 0, velocityDecay = 0.6, forces = /* @__PURE__ */ new Map(), stepper = timer(step), event = dispatch_default("tick", "end"), random = lcg_default();
  if (nodes == null) nodes = [];
  function step() {
    tick();
    event.call("tick", simulation);
    if (alpha < alphaMin) {
      stepper.stop();
      event.call("end", simulation);
    }
  }
  function tick(iterations) {
    var i, n = nodes.length, node;
    if (iterations === void 0) iterations = 1;
    for (var k = 0; k < iterations; ++k) {
      alpha += (alphaTarget - alpha) * alphaDecay;
      forces.forEach(function(force) {
        force(alpha);
      });
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        if (node.fx == null) node.x += node.vx *= velocityDecay;
        else node.x = node.fx, node.vx = 0;
        if (node.fy == null) node.y += node.vy *= velocityDecay;
        else node.y = node.fy, node.vy = 0;
      }
    }
    return simulation;
  }
  function initializeNodes() {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.index = i;
      if (node.fx != null) node.x = node.fx;
      if (node.fy != null) node.y = node.fy;
      if (isNaN(node.x) || isNaN(node.y)) {
        var radius = initialRadius * Math.sqrt(0.5 + i), angle = i * initialAngle;
        node.x = radius * Math.cos(angle);
        node.y = radius * Math.sin(angle);
      }
      if (isNaN(node.vx) || isNaN(node.vy)) {
        node.vx = node.vy = 0;
      }
    }
  }
  function initializeForce(force) {
    if (force.initialize) force.initialize(nodes, random);
    return force;
  }
  initializeNodes();
  return simulation = {
    tick,
    restart: function() {
      return stepper.restart(step), simulation;
    },
    stop: function() {
      return stepper.stop(), simulation;
    },
    nodes: function(_) {
      return arguments.length ? (nodes = _, initializeNodes(), forces.forEach(initializeForce), simulation) : nodes;
    },
    alpha: function(_) {
      return arguments.length ? (alpha = +_, simulation) : alpha;
    },
    alphaMin: function(_) {
      return arguments.length ? (alphaMin = +_, simulation) : alphaMin;
    },
    alphaDecay: function(_) {
      return arguments.length ? (alphaDecay = +_, simulation) : +alphaDecay;
    },
    alphaTarget: function(_) {
      return arguments.length ? (alphaTarget = +_, simulation) : alphaTarget;
    },
    velocityDecay: function(_) {
      return arguments.length ? (velocityDecay = 1 - _, simulation) : 1 - velocityDecay;
    },
    randomSource: function(_) {
      return arguments.length ? (random = _, forces.forEach(initializeForce), simulation) : random;
    },
    force: function(name, _) {
      return arguments.length > 1 ? (_ == null ? forces.delete(name) : forces.set(name, initializeForce(_)), simulation) : forces.get(name);
    },
    find: function(x3, y3, radius) {
      var i = 0, n = nodes.length, dx, dy, d2, node, closest;
      if (radius == null) radius = Infinity;
      else radius *= radius;
      for (i = 0; i < n; ++i) {
        node = nodes[i];
        dx = x3 - node.x;
        dy = y3 - node.y;
        d2 = dx * dx + dy * dy;
        if (d2 < radius) closest = node, radius = d2;
      }
      return closest;
    },
    on: function(name, _) {
      return arguments.length > 1 ? (event.on(name, _), simulation) : event.on(name);
    }
  };
}

// node_modules/d3-force/src/manyBody.js
function manyBody_default() {
  var nodes, node, random, alpha, strength = constant_default(-30), strengths, distanceMin2 = 1, distanceMax2 = Infinity, theta2 = 0.81;
  function force(_) {
    var i, n = nodes.length, tree = quadtree(nodes, x2, y2).visitAfter(accumulate);
    for (alpha = _, i = 0; i < n; ++i) node = nodes[i], tree.visit(apply);
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length, node2;
    strengths = new Array(n);
    for (i = 0; i < n; ++i) node2 = nodes[i], strengths[node2.index] = +strength(node2, i, nodes);
  }
  function accumulate(quad) {
    var strength2 = 0, q, c2, weight = 0, x3, y3, i;
    if (quad.length) {
      for (x3 = y3 = i = 0; i < 4; ++i) {
        if ((q = quad[i]) && (c2 = Math.abs(q.value))) {
          strength2 += q.value, weight += c2, x3 += c2 * q.x, y3 += c2 * q.y;
        }
      }
      quad.x = x3 / weight;
      quad.y = y3 / weight;
    } else {
      q = quad;
      q.x = q.data.x;
      q.y = q.data.y;
      do
        strength2 += strengths[q.data.index];
      while (q = q.next);
    }
    quad.value = strength2;
  }
  function apply(quad, x1, _, x22) {
    if (!quad.value) return true;
    var x3 = quad.x - node.x, y3 = quad.y - node.y, w = x22 - x1, l = x3 * x3 + y3 * y3;
    if (w * w / theta2 < l) {
      if (l < distanceMax2) {
        if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
        if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
        if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
        node.vx += x3 * quad.value * alpha / l;
        node.vy += y3 * quad.value * alpha / l;
      }
      return true;
    } else if (quad.length || l >= distanceMax2) return;
    if (quad.data !== node || quad.next) {
      if (x3 === 0) x3 = jiggle_default(random), l += x3 * x3;
      if (y3 === 0) y3 = jiggle_default(random), l += y3 * y3;
      if (l < distanceMin2) l = Math.sqrt(distanceMin2 * l);
    }
    do
      if (quad.data !== node) {
        w = strengths[quad.data.index] * alpha / l;
        node.vx += x3 * w;
        node.vy += y3 * w;
      }
    while (quad = quad.next);
  }
  force.initialize = function(_nodes, _random) {
    nodes = _nodes;
    random = _random;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : strength;
  };
  force.distanceMin = function(_) {
    return arguments.length ? (distanceMin2 = _ * _, force) : Math.sqrt(distanceMin2);
  };
  force.distanceMax = function(_) {
    return arguments.length ? (distanceMax2 = _ * _, force) : Math.sqrt(distanceMax2);
  };
  force.theta = function(_) {
    return arguments.length ? (theta2 = _ * _, force) : Math.sqrt(theta2);
  };
  return force;
}

// node_modules/d3-force/src/x.js
function x_default2(x3) {
  var strength = constant_default(0.1), nodes, strengths, xz;
  if (typeof x3 !== "function") x3 = constant_default(x3 == null ? 0 : +x3);
  function force(alpha) {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.vx += (xz[i] - node.x) * strengths[i] * alpha;
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length;
    strengths = new Array(n);
    xz = new Array(n);
    for (i = 0; i < n; ++i) {
      strengths[i] = isNaN(xz[i] = +x3(nodes[i], i, nodes)) ? 0 : +strength(nodes[i], i, nodes);
    }
  }
  force.initialize = function(_) {
    nodes = _;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : strength;
  };
  force.x = function(_) {
    return arguments.length ? (x3 = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : x3;
  };
  return force;
}

// node_modules/d3-force/src/y.js
function y_default2(y3) {
  var strength = constant_default(0.1), nodes, strengths, yz;
  if (typeof y3 !== "function") y3 = constant_default(y3 == null ? 0 : +y3);
  function force(alpha) {
    for (var i = 0, n = nodes.length, node; i < n; ++i) {
      node = nodes[i], node.vy += (yz[i] - node.y) * strengths[i] * alpha;
    }
  }
  function initialize() {
    if (!nodes) return;
    var i, n = nodes.length;
    strengths = new Array(n);
    yz = new Array(n);
    for (i = 0; i < n; ++i) {
      strengths[i] = isNaN(yz[i] = +y3(nodes[i], i, nodes)) ? 0 : +strength(nodes[i], i, nodes);
    }
  }
  force.initialize = function(_) {
    nodes = _;
    initialize();
  };
  force.strength = function(_) {
    return arguments.length ? (strength = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : strength;
  };
  force.y = function(_) {
    return arguments.length ? (y3 = typeof _ === "function" ? _ : constant_default(+_), initialize(), force) : y3;
  };
  return force;
}

// resources/js/graph/sim.js
function forceDefault(key) {
  const net = S.view === "net";
  return {
    charge: net ? -120 : -42,
    linkDistance: net ? 95 : 72,
    linkStrength: 1,
    gravity: 1
  }[key];
}
function applyViewPins() {
  if (S.view === "layers") {
    const lay = layerLayout();
    for (const n of S.nodes) {
      const p = lay.posOf.get(n.id);
      if (p) {
        n.fx = p.x;
        n.fy = p.y;
        n._li = p.li;
      } else {
        n.fx = null;
        n.fy = null;
        n._li = null;
      }
    }
    return;
  }
  for (const n of S.nodes) {
    n.fx = null;
    n.fy = null;
  }
  const h = hubNode();
  if (h) {
    h.fx = 0;
    h.fy = 0;
  }
}
function buildSim() {
  if (S.sim) S.sim.stop();
  S._layerCache = null;
  S.degree = /* @__PURE__ */ new Map();
  for (const e of S.edges) {
    S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
    S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
  }
  for (const n of S.nodes) {
    if (n.x === void 0) {
      const a2 = anchorOf(n);
      n.x = a2.x + (Math.random() - 0.5) * 60;
      n.y = a2.y + (Math.random() - 0.5) * 60;
    }
  }
  applyViewPins();
  const net = S.view === "net";
  const F = S.forces || {};
  const grav = F.gravity != null ? F.gravity : 1;
  const linkMul = F.linkStrength != null ? F.linkStrength : 1;
  S.sim = simulation_default(S.nodes).velocityDecay(0.3).force("x", x_default2((d) => net ? 0 : anchorOf(d).x).strength((d) => (net ? 0.03 : d.type === "core" ? 0.25 : 0.055) * grav)).force("y", y_default2((d) => net ? 0 : anchorOf(d).y).strength((d) => (net ? 0.03 : d.type === "core" ? 0.25 : 0.055) * grav)).force("charge", manyBody_default().strength(F.charge != null ? F.charge : net ? -120 : -42).distanceMax(net ? 520 : 320)).force("collide", collide_default((d) => nodeRadius(d) + 7)).force("link", link_default(S.edges).id((d) => d.id).distance(F.linkDistance != null ? F.linkDistance : net ? 95 : 72).strength((e) => Math.min(0.09, 0.025 * (e.weight || 1)) * linkMul)).alpha(0.9).alphaDecay(0.015).alphaTarget(0).alphaMin(1e-3);
  if (S.view === "layers") S.sim.stop();
  requestDraw();
}
function kickSim(alpha = 0.35) {
  if (S.view === "layers") {
    requestDraw();
    return;
  }
  if (S.sim) S.sim.alpha(Math.max(S.sim.alpha(), alpha)).restart();
  requestDraw();
}

// resources/js/markdown.js
var HOLD = String.fromCharCode(0);

// resources/js/shell/settings.js
function syncSlider(inp) {
  const min = parseFloat(inp.min || 0);
  const max = parseFloat(inp.max || 100);
  const val = parseFloat(inp.value);
  const pct = max > min ? (val - min) / (max - min) * 100 : 100;
  inp.style.setProperty("--pct", pct + "%");
  const wrap = inp.closest("label.slider");
  const out = wrap && wrap.querySelector("output");
  if (out) {
    const opt = inp.dataset.opt;
    const force = inp.dataset.force;
    if (force) {
      out.textContent = force === "linkStrength" || force === "gravity" ? "\xD7" + val.toFixed(1) : String(Math.round(val));
    } else {
      out.textContent = opt === "nodeScale" || opt === "labelSize" ? "\xD7" + val.toFixed(2) : Math.round(val * 100) + " %";
    }
  }
}
function syncForceSliders() {
  document.querySelectorAll("input[data-force]").forEach((inp) => {
    const k = inp.dataset.force;
    const v = S.forces[k] != null ? S.forces[k] : forceDefault(k);
    inp.value = v;
    syncSlider(inp);
  });
}

// resources/js/shell/status-chip.js
var lastStateUi = "";
function updateStateUi() {
  const awake = isAwake();
  const key = awake ? "awake" : "asleep";
  if (key === lastStateUi) return;
  lastStateUi = key;
  const brand = document.getElementById("brand-core");
  brand.classList.toggle("awake", awake);
  brand.classList.toggle("asleep", !awake);
  brand.title = awake ? "Hades \u2014 bdie" : "Hades \u2014 sp\xED";
  const chip = document.getElementById("status-chip");
  if (chip) {
    chip.classList.toggle("awake", awake);
    const txt = chip.querySelector(".txt");
    if (txt) txt.textContent = awake ? "bdie" : "sp\xED";
  }
}

// resources/js/graph/render/frame.js
var lastFrame = now();
var framePending = false;
var readableFitPending = true;
function frame2() {
  framePending = false;
  if (S.screen !== "graf") return;
  if (readableFitPending && S.nodes.length) {
    readableFitPending = false;
    if (applyReadableZoom()) S._dirty = true;
  }
  const nowMs = now();
  const dt = Math.min((nowMs - lastFrame) / 1e3, 0.1);
  lastFrame = nowMs;
  S._clock += dt;
  S._anim = animLevel();
  S._lifeTier = lifeTier();
  S._life = S._lifeTier >= 2 ? 0 : lifeLevel();
  S.cursor.a += ((S.cursor.on ? 1 : 0) - S.cursor.a) * Math.min(1, dt * 10);
  if (S.cursor.a < 5e-3) S.cursor.a = 0;
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
    if (f.wait > 0) {
      f.wait -= dt;
      continue;
    }
    f.t += dt * f.speed;
    if (f.t >= 1) {
      if (f.to) f.to.flash = Math.min(1, (f.to.flash || 0) + 0.28 * f.dim);
      S._flows.splice(i, 1);
      S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
    }
  }
  const cap = flowCap();
  if (S._flows.length > cap) S._flows.splice(0, S._flows.length - cap);
  if (S._morph) {
    const m2 = S._morph;
    m2.t = Math.min(1, m2.t + dt / m2.dur);
    const e = easeInOut(m2.t);
    for (const n of S.nodes) {
      const a2 = m2.from.get(n.id), b = m2.to.get(n.id);
      if (a2 && b) {
        n.x = a2.x + (b.x - a2.x) * e;
        n.y = a2.y + (b.y - a2.y) * e;
      }
    }
    if (m2.t >= 1) {
      for (const n of S.nodes) {
        const b = m2.to.get(n.id);
        if (b) {
          n.x = b.x;
          n.y = b.y;
        }
      }
      S._morph = null;
      if (S.sim && S.view !== "layers") S.sim.alpha(0.05).restart();
      requestDraw();
    }
  }
  if (S.replay.playing) {
    S.replay.t = Math.min(1, S.replay.t + dt / 22);
    const tlr = document.getElementById("tl-range");
    tlr.value = Math.round(S.replay.t * 1e3);
    syncSlider(tlr);
    updateTimelineLabel();
    if (S.replay.t >= 1) stopReplay();
  }
  const simActive = S.sim && S.view !== "layers" && S.sim.alpha() > S.sim.alphaMin();
  const dimTarget = isAwake() ? 1 : 0.5;
  const dimActive = Math.abs(dimTarget - S.dim) > 1e-3;
  const ambientLife = S._life > 0;
  const responsive = simActive || !!S._morph || S.replay.playing || S._interacting || S.pulses.length > 0 || S._flows.length > 0 || S._settleFrames > 0 || dimActive;
  const active = responsive || ambientLife;
  if (S._settleFrames > 0) S._settleFrames--;
  let doDraw = responsive || S._dirty;
  if (!doDraw && ambientLife && nowMs - S._lastAmbient >= AMBIENT_MS) doDraw = true;
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
function scheduleFrame() {
  if (S.screen !== "graf") return;
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(frame2);
}
var SETTLE_FRAMES = 45;
var AMBIENT_MS = 32;
function requestDraw() {
  S._dirty = true;
  if (!framePending) {
    lastFrame = now();
    scheduleFrame();
  }
}

// resources/js/graph/timeline.js
function visibleInReplay(n) {
  if (!S.replay.on) return true;
  const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
  return n.type === "core" || ts(n.created_at) <= cutoff;
}
function updateTimelineLabel() {
  const label = $("tl-label");
  if (!label) return;
  if (!S.replay.on || S.replay.t >= 1) {
    label.textContent = "teraz";
    return;
  }
  const t = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
  label.textContent = new Date(t).toLocaleDateString("sk", { day: "numeric", month: "short", year: "numeric" });
}
function stopReplay() {
  S.replay.playing = false;
  S.replay.on = false;
  S.replay.t = 1;
  const range = $("tl-range");
  if (range) {
    range.value = 1e3;
    syncSlider(range);
  }
  setPlayIcon(false);
  updateTimelineLabel();
}
function setPlayIcon(playing) {
  const btn = $("tl-play");
  if (!btn) return;
  btn.textContent = playing ? "pause" : "play_arrow";
  btn.setAttribute("aria-label", playing ? "Zastavi\u0165 prehr\xE1vanie rastu siete" : "Prehra\u0165 rast siete");
  btn.setAttribute("aria-pressed", playing ? "true" : "false");
}

// resources/js/graph/render/edges.js
function nodeAlphaMul(n, hl, pathNodes) {
  let mul = 1;
  if (hl && !hl.has(n.id) && !(pathNodes && pathNodes.has(n.id))) mul *= 0.18;
  if (!focusPass(n)) mul *= 0.15;
  return Math.max(T.nodeFloor, mul);
}
function edgeAlphaMul(e, hl, anchor, pathSet) {
  let mul = 1;
  const onPath = anchor && (e.source.id === anchor.id || e.target.id === anchor.id) || pathSet && pathSet.has(e);
  if (hl && !onPath) mul *= 0.18;
  if (!(focusPass(e.source) && focusPass(e.target))) mul *= 0.15;
  return Math.max(T.edgeFloor, mul);
}
function edgeCategory(e) {
  if (e.relation === "part_of") return "part_of";
  if (e.relation === "uses") return "uses";
  if (e.kind === "co_activation") return "co_activation";
  if (e.kind === "similarity") return "similarity";
  return "core";
}
function edgeCategoryHidden(e) {
  const cat = edgeCategory(e);
  if (S.filter.relations.has(cat)) return true;
  if (S.skeleton && cat !== "core" && cat !== "part_of") return true;
  return false;
}
function edgeSkeletal(e) {
  const cat = edgeCategory(e);
  if (cat === "core" || cat === "part_of") return true;
  return (e.weight || 1) > 1;
}
var EMPTY_DASH = [];
function edgeDashed(e) {
  if (e.relation === "part_of") return false;
  if (e.relation === "uses") return true;
  return e.kind === "co_activation" || e.kind === "similarity";
}
function edgeKindDim(e) {
  if (e.relation === "part_of" || e.relation === "uses") return 1;
  if (e.kind === "co_activation") return 0.6;
  if (e.kind === "similarity") return 0.4;
  return 1;
}
function traceEdge(p, e, layersView) {
  p.moveTo(e.source.x, e.source.y);
  if (!layersView) {
    p.lineTo(e.target.x, e.target.y);
    return;
  }
  const sameLayer = e.source._li != null && e.source._li === e.target._li;
  const span = e.source._li != null && e.target._li != null ? Math.abs(e.source._li - e.target._li) : 0;
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
function drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, layersView, edgeInView) {
  const invK = 1 / S.cam.k;
  const dash = [1.5 * invK, 3 * invK];
  const bgWidth = 0.7 * invK;
  const buckets = /* @__PURE__ */ new Map();
  const fg = [];
  const showAllBg = !!loc;
  for (const e of S.edges) {
    if ((e.weight || 1) < S.minWeight) continue;
    if (edgeCategoryHidden(e)) continue;
    if (!visibleInReplay(e.source) || !visibleInReplay(e.target)) continue;
    if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
    if (!edgeInView(e.source, e.target)) continue;
    const dashed = edgeDashed(e);
    let alpha = Math.min(0.5, 0.22 + 0.08 * Math.log2(1 + (e.weight || 1))) * S.opts.edgeAlpha;
    alpha = Math.max(0.12, alpha) * edgeAlphaMul(e, hl, hlAnchor, pathEdges) * EDGE_DIM * edgeKindDim(e);
    const onPath = !!(pathEdges && pathEdges.has(e));
    const incident = !!(hlAnchor && (e.source.id === hlAnchor.id || e.target.id === hlAnchor.id));
    if (onPath || incident) {
      const fa = onPath ? Math.min(0.85, alpha * 2.2) : Math.min(0.75, alpha * 1.25);
      const fw = (onPath ? Math.min(2.1, 0.7 + 0.3 * Math.log2(1 + (e.weight || 1))) : Math.min(1.6, 0.45 + 0.25 * Math.log2(1 + (e.weight || 1)))) * invK;
      fg.push({ e, alpha: fa, width: fw, dashed, onPath });
      continue;
    }
    if (!showAllBg && !edgeSkeletal(e)) continue;
    if (softHoverActive) alpha *= 0.5;
    if (alpha < 0.03) continue;
    const q = Math.max(1, Math.round(alpha / 0.05));
    const key = (dashed ? 1e3 : 0) + q;
    let b = buckets.get(key);
    if (!b) {
      b = { dashed, alpha: q * 0.05, path: new Path2D() };
      buckets.set(key, b);
    }
    traceEdge(b.path, e, layersView);
  }
  ctx.lineWidth = bgWidth;
  for (const b of buckets.values()) {
    ctx.setLineDash(b.dashed ? dash : EMPTY_DASH);
    ctx.strokeStyle = "rgb(" + T.edge + ")";
    ctx.globalAlpha = b.alpha;
    ctx.stroke(b.path);
  }
  ctx.globalAlpha = 1;
  for (const f of fg) {
    ctx.setLineDash(f.dashed ? dash : EMPTY_DASH);
    ctx.lineWidth = f.width;
    ctx.strokeStyle = (f.onPath ? "rgba(" + T.accent + "," : "rgba(" + T.edge + ",") + f.alpha + ")";
    ctx.beginPath();
    traceEdge(ctx, f.e, layersView);
    ctx.stroke();
  }
  ctx.setLineDash(EMPTY_DASH);
  ctx.globalAlpha = 1;
}

// resources/js/graph/render/layers-draw.js
function softRect(x3, y3, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x3, y3, w, h, r);
    ctx.fill();
  } else ctx.fillRect(x3, y3, w, h);
}
function drawLayerBands(lay) {
  const invK = 1 / S.cam.k;
  ctx.globalAlpha = 0.5 * S.dim;
  ctx.strokeStyle = "rgba(" + T.edge + ",0.06)";
  ctx.lineWidth = 1 * invK;
  for (const g of lay.guides) {
    ctx.beginPath();
    ctx.moveTo(g.x, -g.half - 26 * invK);
    ctx.lineTo(g.x, g.half + 26 * invK);
    ctx.stroke();
  }
  const bandW = 34 * invK;
  for (const b of lay.bands) {
    const pad = b.spacing * 0.42;
    ctx.globalAlpha = 0.07 * S.dim;
    ctx.fillStyle = b.color;
    softRect(
      b.x - bandW / 2,
      b.y0 - pad - (b.single ? 2 * invK : 0),
      bandW,
      b.y1 - b.y0 + pad * 2 + (b.single ? 4 * invK : 0),
      9 * invK
    );
  }
  ctx.globalAlpha = 1;
}
function drawLayerScaffold(lay) {
  const headerY = -lay.maxHalf - 66;
  const invK = 1 / S.cam.k;
  ctx.textAlign = "center";
  for (let i = 0; i < LAYER_X.length; i++) {
    const count = lay.cols[i] ? lay.cols[i].length : 0;
    ctx.globalAlpha = 0.6 * S.dim;
    ctx.fillStyle = T.inkSoft;
    ctx.font = "600 " + 12.5 * invK + 'px "Geist Mono", ui-monospace, monospace';
    ctx.fillText(LAYER_META[i].title.toUpperCase() + " \xB7 " + count, LAYER_X[i], headerY);
    ctx.globalAlpha = 0.5 * S.dim;
    ctx.fillStyle = T.muted;
    ctx.font = 10.5 * invK + 'px "Geist Mono", ui-monospace, monospace';
    ctx.fillText(LAYER_META[i].sub, LAYER_X[i], headerY + 18 * invK);
  }
  ctx.globalAlpha = 1;
}

// resources/js/graph/render/cert-colors.js
var CERT_RING = { overene: "solid", hypoteza: "dashed", pasca: "pip" };
var _certColorCache = null;
function certColors() {
  if (_certColorCache) return _certColorCache;
  const cs = getComputedStyle(document.documentElement);
  const get2 = (v, fb) => (cs.getPropertyValue(v) || "").trim() || fb;
  _certColorCache = {
    overene: get2("--cert-overene", "#1f7a4d"),
    hypoteza: get2("--cert-hypoteza", "#8f5a12"),
    pasca: get2("--cert-pasca", "#c0392f"),
    borderStrong: get2("--border-strong", "#d9ced6")
  };
  return _certColorCache;
}

// resources/js/graph/render/shapes.js
function drawShape(n, x3, y3, r, color, simple) {
  const k = S.cam.k;
  if (simple) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x3, y3, r, 0, 7);
    ctx.fill();
    return;
  }
  const a2 = ctx.globalAlpha;
  if (n.type === "core") {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x3, y3, r, 0, 7);
    ctx.fill();
    ctx.globalAlpha = a2 * 0.4;
    ctx.lineWidth = Math.max(1, 1.1 / k);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x3, y3, r * 1.55, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = a2;
    return;
  }
  ctx.fillStyle = T.paper;
  ctx.beginPath();
  ctx.arc(x3, y3, r, 0, 7);
  ctx.fill();
  const lw = n.type === "skill" ? 2.4 / k : 1.6 / k;
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x3, y3, Math.max(0.5, r - lw * 0.5), 0, 7);
  ctx.stroke();
  if (n.type === "project") {
    ctx.globalAlpha = a2 * 0.5;
    ctx.lineWidth = 1.1 / k;
    ctx.beginPath();
    ctx.arc(x3, y3, r + 3.5 / k, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = a2;
  }
  if (k > 0.8) {
    const cc = certColors();
    if (n.origin === "brain") {
      ctx.globalAlpha = a2 * 0.45;
      ctx.lineWidth = 1 / k;
      ctx.strokeStyle = cc.borderStrong;
      ctx.beginPath();
      ctx.arc(x3, y3, Math.max(0.5, r - lw - 1.2 / k), 0, 7);
      ctx.stroke();
      ctx.globalAlpha = a2;
    }
    const mode = S.certRings ? CERT_RING[n.certainty] : null;
    if (mode) {
      const rr = r + 3.2 / k;
      const col = cc[n.certainty];
      ctx.save();
      ctx.globalAlpha = a2 * 0.8;
      ctx.lineWidth = 1.6 / k;
      ctx.strokeStyle = col;
      if (mode === "dashed") ctx.setLineDash([3 / k, 2.4 / k]);
      ctx.beginPath();
      ctx.arc(x3, y3, rr, 0, 7);
      ctx.stroke();
      if (mode === "pip") {
        ctx.setLineDash([]);
        ctx.globalAlpha = a2;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x3, y3 - rr, 1.9 / k, 0, 7);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}

// resources/js/graph/render/draw.js
function draw() {
  const targetDim = isAwake() ? 1 : 0.5;
  S.dim += (targetDim - S.dim) * 0.02;
  if (Math.abs(targetDim - S.dim) < 1e-3) S.dim = targetDim;
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  ctx.fillStyle = T.paper;
  ctx.fillRect(0, 0, S.w, S.h);
  ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
  ctx.scale(S.cam.k, S.cam.k);
  const _vTL = screenToWorld(0, 0);
  const _vBR = screenToWorld(S.w, S.h);
  const VM = 140 / S.cam.k;
  const vpX0 = _vTL.x - VM, vpY0 = _vTL.y - VM, vpX1 = _vBR.x + VM, vpY1 = _vBR.y + VM;
  const inView = (x3, y3) => x3 >= vpX0 && x3 <= vpX1 && y3 >= vpY0 && y3 <= vpY1;
  const edgeInView = (a2, b) => !(Math.max(a2.x, b.x) < vpX0 || Math.min(a2.x, b.x) > vpX1 || Math.max(a2.y, b.y) < vpY0 || Math.min(a2.y, b.y) > vpY1);
  S._vp = { x0: vpX0, y0: vpY0, x1: vpX1, y1: vpY1 };
  const cursorWorld = S._life > 0 && S.cursor.a > 0.01 ? screenToWorld(S.cursor.sx, S.cursor.sy) : null;
  const hl = highlightSet();
  const hlAnchor = S.hover || S.selected;
  const loc = localSet();
  const layersView = S.view === "layers";
  const pathEdges = layersView ? layerPathSet(hlAnchor) : null;
  const pathNodes = layersView ? S._lpNodes : null;
  const softHoverActive = S.opts.edgeSoftHover && !hlAnchor && !S.focus.areaId && !loc;
  const bgLevel = layersView ? 0 : S.opts.bg;
  if (bgLevel > 0.01) {
    const invK = 1 / S.cam.k;
    const _step = 240;
    const _tl = screenToWorld(0, 0);
    const _br = screenToWorld(S.w, S.h);
    ctx.lineWidth = 0.5 * invK;
    ctx.strokeStyle = "rgba(" + T.gridColor + "," + T.gridAlpha * S.dim * bgLevel + ")";
    ctx.beginPath();
    for (let gx = Math.floor(_tl.x / _step) * _step; gx <= _br.x; gx += _step) {
      ctx.moveTo(gx, _tl.y);
      ctx.lineTo(gx, _br.y);
    }
    for (let gy = Math.floor(_tl.y / _step) * _step; gy <= _br.y; gy += _step) {
      ctx.moveTo(_tl.x, gy);
      ctx.lineTo(_br.x, gy);
    }
    ctx.stroke();
  }
  if (S.view === "map") {
    const areaBox = /* @__PURE__ */ new Map();
    for (const n of S.nodes) {
      if (n.type === "core" || !n.area_id || !visibleInReplay(n)) continue;
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
    ctx.font = "600 " + 12.5 / S.cam.k + 'px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = "center";
    for (const area of S.areas.values()) {
      const b = areaBox.get(area.id);
      if (!loc && S.filter.areas.has(area.id)) continue;
      if (!b && (loc || filterActive())) continue;
      const a2 = areaAnchor(area);
      ctx.fillText(area.name.toUpperCase(), b ? (b.minX + b.maxX) / 2 : a2.x, (b ? b.minY : a2.y) - 36);
    }
    ctx.globalAlpha = 1;
  }
  if (layersView) {
    const lay = layerLayout();
    drawLayerBands(lay);
    drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, true, edgeInView);
    drawLayerScaffold(lay);
  } else {
    drawEdges(loc, hl, hlAnchor, null, softHoverActive, false, edgeInView);
  }
  ctx.globalCompositeOperation = "source-over";
  for (const p of S.pulses) {
    if (!(nodeVisible(p.from, loc) && nodeVisible(p.to, loc))) continue;
    const x3 = p.from.x + (p.to.x - p.from.x) * p.t;
    const y3 = p.from.y + (p.to.y - p.from.y) * p.t;
    ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(x3, y3, 8, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const _flowI = Math.max(S._anim, S._life);
  if (_flowI > 0 && S._flows.length) {
    const fr = 3 / S.cam.k;
    for (const f of S._flows) {
      if (f.wait > 0) continue;
      if (!(nodeVisible(f.from, loc) && nodeVisible(f.to, loc))) continue;
      const x3 = f.from.x + (f.to.x - f.from.x) * f.t;
      const y3 = f.from.y + (f.to.y - f.from.y) * f.t;
      const a2 = Math.min(0.7, 0.6 * f.dim * Math.min(1.2, _flowI)) * Math.sin(Math.PI * Math.min(f.t, 1));
      if (a2 < 0.02) continue;
      ctx.globalAlpha = a2;
      ctx.fillStyle = f.tone === "ink" ? "rgb(" + T.edge + ")" : f.tone === "accent" ? "rgb(" + T.accent + ")" : f.tone;
      ctx.beginPath();
      ctx.arc(x3, y3, fr, 0, 7);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  ctx.globalCompositeOperation = "source-over";
  const simpleNodes = S.cam.k < K_DETAIL;
  for (const n of S.nodes) {
    if (!visibleInReplay(n)) continue;
    if (!nodeVisible(n, loc)) continue;
    if (!inView(n.x, n.y)) continue;
    let r = layersView ? Math.max(6, nodeRadius(n)) * 0.9 : nodeRadius(n);
    if (S.hover === n) r *= 1.15;
    r *= breatheFactor(n) * birthScale(n);
    if (!layersView && n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
    const color = nodeColor(n);
    const flash = layersView ? n.flash || 0 : 0;
    const mul = nodeAlphaMul(n, hl, pathNodes);
    let ox = 0, oy = 0, gGlow = 0;
    if (S._life > 0 && !simpleNodes && !layersView) {
      const lf = Math.min(1.4, S._life);
      if (S._lifeTier === 0 && n.type !== "core") {
        ox += Math.sin(S._clock * 0.6 + n.id * 1.7) * lf;
        oy += Math.cos(S._clock * 0.5 + n.id * 2.3) * lf;
      }
      if (cursorWorld && S._lifeTier <= 1) {
        const dx = cursorWorld.x - n.x, dy = cursorWorld.y - n.y;
        const dd = Math.hypot(dx, dy);
        const R = 140 / S.cam.k;
        if (dd < R && dd > 1e-3) {
          const ff = 1 - dd / R;
          const pull = ff * ff * (6 / S.cam.k) * S.cursor.a * (S._lifeTier === 1 ? 0.5 : 1);
          ox += dx / dd * pull;
          oy += dy / dd * pull;
          gGlow = ff * S.cursor.a;
        }
      }
    }
    n._ox = ox;
    n._oy = oy;
    const px = n.x + ox, py = n.y + oy;
    ctx.globalAlpha = Math.min(1, layersView ? 0.9 + flash * 0.5 : 1) * mul;
    drawShape(n, px, py, r, color, simpleNodes);
    if (simpleNodes) {
      if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
      continue;
    }
    const glowA = Math.max((n.flash || 0) * (0.55 + 0.45 * Math.sin(S._clock * 6 + n.id)), gGlow * 0.6);
    if (glowA > 0.03) {
      ctx.globalAlpha = Math.min(0.55, glowA) * mul;
      ctx.lineWidth = 1.4 / S.cam.k;
      ctx.strokeStyle = "rgb(" + T.accent + ")";
      ctx.beginPath();
      ctx.arc(px, py, r + 3 / S.cam.k, 0, 7);
      ctx.stroke();
    }
    if (n._born != null) {
      const age = S._clock - n._born;
      if (age < 0.6 && S._anim > 0 && !REDUCED_MOTION) {
        const p = age / 0.6;
        ctx.globalAlpha = (1 - p) * 0.6 * mul;
        ctx.lineWidth = 1.4 / S.cam.k;
        ctx.strokeStyle = "rgb(" + T.accent + ")";
        ctx.beginPath();
        ctx.arc(px, py, r + (3 + p * 14) / S.cam.k, 0, 7);
        ctx.stroke();
      } else if (age >= 0.6) {
        n._born = null;
      }
    }
    if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const zoomFade = labelFade(S.cam.k);
  const showLabels = zoomFade > 0 && S.opts.labelAlpha > 0.02;
  const baseLabelAlpha = Math.min(1, S.opts.labelAlpha);
  const candidates = [];
  for (const n of S.nodes) {
    if (!visibleInReplay(n)) continue;
    if (!nodeVisible(n, loc)) continue;
    if (!inView(n.x, n.y)) continue;
    const isHover = S.hover === n || S.selected === n;
    const inHl = !!(hl && hl.has(n.id)) || !!(pathNodes && pathNodes.has(n.id));
    if (!showLabels && !isHover && !inHl) continue;
    const alpha = baseLabelAlpha * nodeAlphaMul(n, hl, pathNodes) * (isHover || inHl ? 1 : zoomFade);
    if (alpha < 0.12) continue;
    candidates.push({ n, isHover, alpha });
  }
  const shown = S._labelShown || (S._labelShown = /* @__PURE__ */ new Set());
  candidates.sort((a2, b) => b.isHover - a2.isHover || (shown.has(b.n.id) ? 1 : 0) - (shown.has(a2.n.id) ? 1 : 0) || b.alpha - a2.alpha || (S.degree.get(b.n.id) || 0) - (S.degree.get(a2.n.id) || 0));
  const fontSize = 12 * S.opts.labelSize / S.cam.k;
  const taken = [];
  const newShown = /* @__PURE__ */ new Set();
  ctx.textAlign = "center";
  ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';
  for (const { n, isHover, alpha } of candidates) {
    const label = truncLabel(n.label);
    const w = ctx.measureText(label).width;
    const nx = n.x + (n._ox || 0), ny = n.y + (n._oy || 0);
    const y3 = ny + nodeRadius(n) * (S.hover === n ? 1.15 : 1) + 13 / S.cam.k;
    const rect = { x: nx - w / 2, y: y3 - fontSize, w, h: fontSize * 1.4 };
    const collides = taken.some((t) => rect.x < t.x + t.w && t.x < rect.x + rect.w && rect.y < t.y + t.h && t.y < rect.y + rect.h);
    if (collides && !isHover) continue;
    taken.push(rect);
    newShown.add(n.id);
    if (isHover) {
      const px = 5 / S.cam.k, py = 3 / S.cam.k;
      ctx.globalAlpha = alpha * 0.82;
      ctx.fillStyle = T.paper;
      ctx.fillRect(rect.x - px, rect.y - py, rect.w + 2 * px, rect.h + 2 * py);
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = T.ink;
    ctx.fillText(label, nx, y3);
  }
  S._labelShown = newShown;
  ctx.globalAlpha = 1;
}

// resources/js/graph/neighbors.js
function neighborsOf(node) {
  const out = [];
  for (const e of S.edges) {
    if (e.source.id === node.id) out.push(e.target);
    else if (e.target.id === node.id) out.push(e.source);
  }
  return out;
}

// resources/js/graph/focus.js
function focusPass(n) {
  if (!S.focus.areaId) return true;
  if (n.type === "core") return true;
  if (n.area_id !== S.focus.areaId) return false;
  if (S.focus.departmentId && n.department_id !== S.focus.departmentId) return false;
  return true;
}
function highlightSet() {
  const anchor = S.hover || S.selected;
  if (!anchor) {
    S._hlFor = null;
    S._hlSet = null;
    return null;
  }
  if (S._hlFor !== anchor) {
    const set2 = /* @__PURE__ */ new Set([anchor.id]);
    for (const m2 of neighborsOf(anchor)) set2.add(m2.id);
    S._hlFor = anchor;
    S._hlSet = set2;
  }
  return S._hlSet;
}
function layerPathSet(anchor) {
  if (!anchor || anchor._li == null) {
    S._lpFor = null;
    S._lpEdges = null;
    S._lpNodes = null;
    return null;
  }
  if (S._lpFor === anchor && S._lpEdges) return S._lpEdges;
  const a0 = anchor._li;
  const edges = /* @__PURE__ */ new Set();
  const nodes = /* @__PURE__ */ new Set([anchor.id]);
  for (const e of S.edges) {
    if (e.source.id === anchor.id) {
      edges.add(e);
      nodes.add(e.target.id);
    } else if (e.target.id === anchor.id) {
      edges.add(e);
      nodes.add(e.source.id);
    }
  }
  const hop1 = new Set(nodes);
  for (const e of S.edges) {
    const s = e.source, t = e.target;
    if (s._li == null || t._li == null) continue;
    let via = null, far = null;
    if (hop1.has(s.id) && s.id !== anchor.id && !hop1.has(t.id)) {
      via = s;
      far = t;
    } else if (hop1.has(t.id) && t.id !== anchor.id && !hop1.has(s.id)) {
      via = t;
      far = s;
    }
    if (!via) continue;
    if (Math.abs(far._li - a0) > Math.abs(via._li - a0)) {
      edges.add(e);
      nodes.add(far.id);
    }
  }
  S._lpFor = anchor;
  S._lpEdges = edges;
  S._lpNodes = nodes;
  return edges;
}

// resources/js/graph/local.js
function localSet() {
  if (!S.local) return null;
  const key = S.local.rootId + ":" + S.local.depth + ":" + S.edges.length;
  if (S._localFor !== key) {
    const adj = /* @__PURE__ */ new Map();
    const push = (a2, b) => {
      const l = adj.get(a2);
      if (l) l.push(b);
      else adj.set(a2, [b]);
    };
    for (const e of S.edges) {
      push(e.source_id, e.target_id);
      push(e.target_id, e.source_id);
    }
    const set2 = /* @__PURE__ */ new Set([S.local.rootId]);
    let frontier = [S.local.rootId];
    for (let d = 0; d < S.local.depth && frontier.length; d++) {
      const next = [];
      for (const id of frontier) {
        for (const m2 of adj.get(id) || []) {
          if (!set2.has(m2)) {
            set2.add(m2);
            next.push(m2);
          }
        }
      }
      frontier = next;
    }
    S._localFor = key;
    S._localSet = set2;
  }
  return S._localSet;
}

// resources/js/graph/filters.js
function filterActive() {
  return S.filter.types.size > 0 || S.filter.sources.size > 0 || S.filter.areas.size > 0 || S.filter.tags.size > 0;
}
function sourceBucket(n) {
  if (n.source === "session") return "session";
  if (n.source === "skill") return "skill";
  if (n.source === "digest" || n.source === "archive") return "digest";
  if (!n.source) return "manual";
  return null;
}
function filterPass(n) {
  if (n.type === "core") return true;
  if (S.filter.types.has(n.type)) return false;
  const b = sourceBucket(n);
  if (b && S.filter.sources.has(b)) return false;
  if (n.area_id && S.filter.areas.has(n.area_id)) return false;
  if (S.filter.tags.size > 0) {
    const tags = n.tags;
    if (!Array.isArray(tags) || !tags.some((t) => S.filter.tags.has(t))) return false;
  }
  return true;
}
function nodeVisible(n, loc) {
  if (loc) return loc.has(n.id);
  return filterPass(n);
}

// resources/js/graph/camera.js
function screenToWorld(px, py) {
  return {
    x: (px - S.w / 2 - S.cam.x) / S.cam.k,
    y: (py - S.h / 2 - S.cam.y) / S.cam.k
  };
}
function fitView(pad = 90) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add2 = (x3, y3) => {
    if (x3 < minX) minX = x3;
    if (x3 > maxX) maxX = x3;
    if (y3 < minY) minY = y3;
    if (y3 > maxY) maxY = y3;
  };
  const loc = localSet();
  if (S.view === "layers") {
    const lay = layerLayout();
    add2(lay.minX, -lay.maxHalf - 66);
    add2(lay.maxX, lay.maxHalf);
    for (const n of S.nodes) {
      if (!visibleInReplay(n)) continue;
      if (!nodeVisible(n, loc)) continue;
      add2(n.fx != null ? n.fx : n.x, n.fy != null ? n.fy : n.y);
    }
  } else {
    for (const n of S.nodes) {
      if (!visibleInReplay(n)) continue;
      if (!nodeVisible(n, loc)) continue;
      add2(n.x, n.y);
    }
  }
  if (minX > maxX) {
    S.cam = { x: 0, y: 0, k: 0.85 };
    draw();
    return;
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  S.cam.k = Math.min(1.6, Math.max(0.14, Math.min((S.w - 2 * pad) / bw, (S.h - 2 * pad) / bh)));
  S.cam.x = -((minX + maxX) / 2) * S.cam.k;
  S.cam.y = -((minY + maxY) / 2) * S.cam.k;
  draw();
}

// resources/js/graph/view.js
function setView(view) {
  const prev = S.view;
  const animate = prev !== view && S.nodes.length > 0 && !REDUCED_MOTION && animLevel() > 0;
  const from = animate ? new Map(S.nodes.map((n) => [n.id, { x: n.x, y: n.y }])) : null;
  S.view = view;
  store.setRaw("view", view);
  document.querySelectorAll("#view-switch button").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
  });
  buildSim();
  kickSim(0.6);
  if (S.sim && view !== "layers") S.sim.tick(30);
  syncForceSliders();
  if (!animate) {
    fitView();
    if (applyReadableZoom()) draw();
    return;
  }
  const to = new Map(S.nodes.map((n) => [n.id, {
    x: n.fx != null ? n.fx : n.x,
    y: n.fy != null ? n.fy : n.y
  }]));
  for (const n of S.nodes) {
    const b = to.get(n.id);
    if (b) {
      n.x = b.x;
      n.y = b.y;
    }
  }
  fitView();
  applyReadableZoom();
  S.sim.stop();
  for (const n of S.nodes) {
    const f = from.get(n.id);
    if (f) {
      n.x = f.x;
      n.y = f.y;
    }
  }
  S._morph = { from, to, t: 0, dur: 0.6 };
  draw();
}
export {
  setView
};
