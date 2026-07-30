// resources/js/core/format.js
var rad = (deg) => deg * Math.PI / 180;

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
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
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
var AREA_RADIUS = 640;
var DEPT_RADIUS = 170;

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
  const a = areaAnchor(area);
  return { x: a.x + Math.cos(spread) * DEPT_RADIUS, y: a.y + Math.sin(spread) * DEPT_RADIUS };
}
function anchorOf(n) {
  if (n.type === "core") {
    if (isHub(n)) return { x: 0, y: 0 };
    const cores = S.nodes.filter((m) => m.type === "core" && !isHub(m));
    const i = cores.findIndex((m) => m.id === n.id);
    const a = rad(360 / Math.max(cores.length, 1) * i - 90);
    return { x: Math.cos(a) * 85, y: Math.sin(a) * 85 };
  }
  if (n.department_id && S.departments.has(n.department_id)) {
    return deptAnchor(S.departments.get(n.department_id));
  }
  if (n.area_id && S.areas.has(n.area_id)) return areaAnchor(S.areas.get(n.area_id));
  return { x: 0, y: 0 };
}
export {
  anchorOf,
  areaAnchor
};
