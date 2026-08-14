// Témy — kontrakt pre canvas literály (idú cez T.*)
// nodeFloor/edgeFloor: spodná hranica tlmenia (hover × focus), gridAlpha: sila mriežky
// GRAF B: meshA0/meshA1 = alfa najslabšej/najsilnejšej hrany v jemnej sieti,
// ringA = alfa prstenca kontextového prachu, markA = alfa vodoznaku oblasti,
// hotA = alfa incidentnej hrany pri hoveri (jediná hrana, ktorá musí sama držať
// WCAG 3:1 — svetlá téma potrebuje viac, jej akcent je tmavý na svetlom papieri),
// muteL = cieľová OKLab svetlosť utlmenej palety. Všetky štyri sú kalibrované
// meraním (scratchpad/gbcontrast.js číta tieto hodnoty živé z plátna).
//
// VLNA VZDUCH: ringRest = alfa POKOJOVÉHO prstenca uzla s tvarom. Predtým sa
// tvarové uzly kreslili na alfe 1,0, a keďže od vlny A je na mape KAŽDÝ uzol
// tvarový (zanorenie je filter, nie výmena scény), bolo plátno 1065 plne sýtych
// obrysov — presne to, čo používateľ opakovane hlásil ako „nie je priehľadné".
// Pokojový prstenec je textúra (informáciu nesie tvar oblaku, nie jeden obrys);
// nositeľ informácie — pod kurzorom, vo výbere, s popiskom, jadro, hub — ide na
// alfu 1,0 a hrubší obrys, takže WCAG 1.4.11 platí presne tam, kde má.
//
// Hodnoty NIE SÚ estetické, sú dorátané z merania (scratchpad/aircontrast.js číta
// pixely prstencov pri devicePixelRatio 1, teda v najhoršom prípade antialiasingu):
// pri ringRest 0,84 mal medián pokojového prstenca 3,85:1 (tmavá) / 3,74:1 (svetlá),
// čo je hlboko NAD prahom 3:1 — utlmená paleta je oveľa silnejšia než jej vlastná
// podlaha MUTE_FLOOR, pretože muteL cieli na 0,60 / 0,525, nie na podlahu. Táto
// rezerva sa tu vymieňa za vzduch: 0,74 / 0,66 posadí medián pokojového prstenca
// tesne NAD 3:1. Témy majú iné číslo, lebo miešanie k svetlému papieru padá inak
// než k tmavému — rovnaká hodnota by dala rôzny výsledok, nie rovnaký dojem.
export const THEMES = {
    light: {
        paper: '#f8f4f7', ink: '#101d1b', inkSoft: '#2d3a38', muted: '#566964',
        labelHalo: 'rgba(248,244,247,0.92)', edge: '45,58,56', gridColor: '3,121,126',
        accent: '3,121,126', outline: 'rgba(16,29,27,0.35)',
        gridAlpha: 0.028, nodeFloor: 0.30, edgeFloor: 0.20,
        meshA0: 0.070, meshA1: 0.210, ringA: 0.86, ringRest: 0.76,
        muteL: 0.525, markA: 0.50, hotA: 0.80, dark: false,
    },
    dark: {
        paper: '#0e1413', ink: '#eaf3f1', inkSoft: '#c3d1ce', muted: '#8a9b98',
        labelHalo: 'rgba(14,20,19,0.92)', edge: '195,209,206', gridColor: '5,188,196',
        accent: '5,188,196', outline: 'rgba(234,243,241,0.30)',
        gridAlpha: 0.045, nodeFloor: 0.35, edgeFloor: 0.25,
        meshA0: 0.075, meshA1: 0.225, ringA: 0.82, ringRest: 0.74,
        muteL: 0.600, markA: 0.42, hotA: 0.66, dark: true,
    },
};
export let T = THEMES.dark;
// Cache utlmených farieb (kľúč = téma + zdrojový hex). Deklarovaná tu, lebo ju
// invalidateCertColors() čistí — a to je jediná cesta k prepnutiu témy.
const _mutedCache = new Map();
// Tmavá je default — štartovú tému číta main.js cez initialTheme().
export function initialTheme(){ return localStorage.getItem('hades.theme') || 'dark'; }
export function setTheme(name){ T = THEMES[name] || THEMES.dark; document.documentElement.dataset.theme = (name === 'light' ? 'light' : 'dark'); localStorage.setItem('hades.theme', name); invalidateCertColors(); }
// Farby istoty z --cert-* + --border-strong (theme-aware) — čítané raz cez getComputedStyle
// a cache-nuté; setTheme cache invaliduje, aby prstence sadli na light/dark paletu.
export let _certColorCache = null;
export function certColors() {
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
export function invalidateCertColors() { _certColorCache = null; _mutedCache.clear(); }

/* ---------- GRAF B: UTLMENÁ PALETA (OKLCh) ----------
   Farby oblastí prichádzajú z API sýte (#03797e, #b88a3a, …) a util.darkAreaColor
   ich na tmavej téme ešte rozžiari. V hustej sieti 1000+ uzlov taká sýtosť prekričí
   štruktúru — oko číta škvrny farby, nie sieť.

   Odsýtenie robíme v OKLCh, nie v HSL: OKLab má percepčne rovnomernú svetlosť, takže
   zrezaním chromy farba ztíchne, ALE nezmení sa jej vnímaná svetlosť ani tón. V HSL
   by to isté zrezanie spravilo z gold špinavo hnedú a z teal sivú (HSL „saturation"
   mieša svetlosť do tónu).

   Tri parametre:
     MUTE_C   — koľko chromy zostane (hue je prítomné, len tichšie),
     MUTE_CMAX— strop chromy: gold má v origináli C = 0,111, teal 0,088; bez stropu
                by gold aj po zrezaní kričal viac než ostatné a paleta by bola nevyvážená,
     T.muteL  — jednotná cieľová svetlosť pre VŠETKY oblasti. Toto je to podstatné:
                keď majú všetky farby rovnaké L, oko ich číta ako jednu tichú vrstvu
                a rozlišuje ich len tónom (presne referenčný obrázok). Na tmavej téme
                L = 0,60 (farba je svetlejšia než papier), na svetlej L = 0,545 (tmavšia).

   Podlaha kontrastu je súčasť funkcie, nie kozmetika: ak by cieľové L nedalo voči
   papieru aspoň MUTE_FLOOR : 1, L sa posúva OD papiera, kým podmienka nesadne.
   Grafický prvok tak nikdy nespadne pod WCAG 1.4.11 (3:1) — utlmenie sa kalibruje,
   nie zmäkčuje. */
export const MUTE_C = 0.55;
export const MUTE_CMAX = 0.062;
export const MUTE_FLOOR = 3.15;

const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const l2s = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const cl01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function hex2rgb(h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgb2hex(r, g, b) {
    const t = (v) => Math.round(cl01(v) * 255).toString(16).padStart(2, '0');
    return '#' + t(r) + t(g) + t(b);
}
function rgb2oklab(r, g, b) {
    const R = s2l(r), G = s2l(g), B = s2l(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    ];
}
function oklab2rgb(L, a, bb) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * bb) ** 3;
    return [
        l2s(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        l2s(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        l2s(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    ];
}
// WCAG relatívna luminancia (0..1) zo sRGB v rozsahu 0..1
export function wcagLum(r, g, b) {
    return 0.2126 * s2l(cl01(r)) + 0.7152 * s2l(cl01(g)) + 0.0722 * s2l(cl01(b));
}
export function wcagRatio(l1, l2) {
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
export function paperLum() {
    const p = hex2rgb(T.paper) || [0, 0, 0];
    return wcagLum(p[0], p[1], p[2]);
}

// Utlmená verzia farby oblasti pre aktuálnu tému (memoizované; setTheme cache čistí).
export function mutedColor(hex) {
    const key = (T.dark ? 'd|' : 'l|') + hex;
    const hit = _mutedCache.get(key);
    if (hit) return hit;
    const rgb = hex2rgb(hex);
    if (!rgb) return hex;
    const [, A0, B0] = rgb2oklab(rgb[0], rgb[1], rgb[2]);
    const C = Math.min(Math.hypot(A0, B0) * MUTE_C, MUTE_CMAX);
    const h = Math.atan2(B0, A0);
    const ca = Math.cos(h) * C, cb = Math.sin(h) * C;
    const pl = paperLum();
    let L = T.muteL;
    let out = oklab2rgb(L, ca, cb);
    // dorovnanie na kontrastnú podlahu — od papiera (svetlejšie na tmavej, tmavšie na svetlej)
    for (let i = 0; i < 40 && wcagRatio(wcagLum(out[0], out[1], out[2]), pl) < MUTE_FLOOR; i++) {
        L += T.dark ? 0.012 : -0.012;
        if (L > 1.02 || L < 0.02) break;
        out = oklab2rgb(L, ca, cb);
    }
    const res = rgb2hex(out[0], out[1], out[2]);
    _mutedCache.set(key, res);
    return res;
}
