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
function setCanvasTheme(_name) {
  _cache = null;
}
function invalidateCanvasColors() {
  _cache = null;
}
export {
  T,
  invalidateCanvasColors,
  setCanvasTheme
};
