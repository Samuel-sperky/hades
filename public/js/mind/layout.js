import { S } from './state.js';
import { rad } from './util.js';

/* ---------- VLNA „GRAF A": JEDEN VEĽKÝ ORGANICKÝ GRAF ----------

   Pozície uzlov už NIE sú deterministické — počíta ich d3 forceSimulation
   (sim.js, tiká sa ručne cez rAF pumpu). Determinizmus bol moja vlastná
   podmienka, ktorá zabila organický layout; používateľ ju nikdy nežiadal.

   layout.js má odvtedy dve úlohy:

   1) KOTVY A RÁM — kam ktorý uzol fyzika tlačí. V Sieti je to ťažisko oblasti
      na venci po elipse, ktorej pomer strán kopíruje využiteľnú plochu
      viewportu; vo Vrstvách vodorovný pás podľa layer_role. Rám scény je vždy
      odvodený z viewportu, nikdy zo zadrôtovaných svetových súradníc.

   2) PREZENTÁCIA — computeLayout() prebalí aktuálne n.x/n.y do toho, čo render
      kreslí: pos (kind/dim/mul/glow), huby oblastí a oddelení, areoly.

   Zanorenie (S.nav) NEMENÍ pozície. Je to LEN filter — fokusová skupina zostane
   plná, zvyšok grafu stmavne na prach — plus zameranie kamery. Scéna je jedna
   jediná a veľká; chodí sa po nej posunom a zoomom.

   Kvôli cyklickým importom (layout ↔ util ↔ sim ↔ render) sú všetky exporty
   hoistované `function` deklarácie, nie `const` arrow.
*/

export const SCENE_RY = 520;                       // polovýška referenčného rámu (svetové jednotky)
export const GOLD = Math.PI * (3 - Math.sqrt(5));  // zlatý uhol — rozsev pod-kotiev oddelení
export const AREA_RADIUS_FALLBACK = 640;           // fallback kotvy pred prvým layoutom (WS zrod)

/* ---------- ladenie fyziky ----------
   Jedno miesto na všetky konštanty simulácie. squashPow: gravitácia v Y je
   (ar^squashPow)-krát silnejšia než v X. V rovnováhe platí, že oblak má pomer
   strán ≈ sqrt(k_y/k_x), takže pri squashPow = 2 vyjde pomer strán oblaku ≈ ar
   — a fit potom vyplní viewport na oboch osiach naraz (kritérium ≥ 70 % šírky).
   Bez toho by sa oblak usadil do kruhu a na 16:9 by pokryl len ~55 % šírky. */
export const PHYS = {
    charge: -58, chargeMax: 470,
    linkDist: 46, linkPer: 0.028, linkCap: 0.10,
    grav: 0.030, coreGrav: 0.30,
    collidePad: 3.2, velocityDecay: 0.34,
    alphaDecay: 0.026, alphaMin: 0.004, alphaWarm: 0.32, alphaCold: 0.95,
    burst: 26,             // tichých tikov pred prvým framom (štart nie je chaos)
    squashPow: 2,
    // Vrstvy: y drží pás (plus tvrdý clamp v pumpe), x drží barycentrové poradie,
    // odpudzovanie je slabé — pás sa má čítať ako vrstva, nie ako guľa.
    layerSpacing: 26, layerGravX: 0.075, layerGravY: 0.55,
    layerCharge: -15, layerChargeMax: 130, layerLinkDist: 40, layerLinkStr: 0.02,
};

// Stmavenie kontextu, keď je zapnutý filter zanorenia. Musí zostať POD 0.5 —
// nad tou hranicou render/edges považujú uzol za plnohodnotný (kreslia mu hrany,
// popisky a značky istoty). Zároveň nie príliš nízko: zvyšok siete má stmavnúť,
// nie zmiznúť (0,24 × S.dim 0,5 v spánku dávalo neviditeľných 12 % alfy).
export const DIM_CTX = 0.34;
export const DIM_CORE_CTX = 0.42;

/* ---------- rám scény ---------- */

// Okraje, ktoré necháva layout voľné pre plávajúce UI (rail vľavo, hlavička hore).
// fitView() používa TIE ISTÉ okraje, takže pomer rámu je presne pomerom
// využiteľnej plochy → fit vyjde na oboch osiach naraz.
function cssPx(name, fallback) {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
}

export function viewInsets() {
    const edge = cssPx('--edge', 16);
    const sc = document.getElementById('screens');
    const scs = sc ? getComputedStyle(sc) : null;
    const left = scs && parseFloat(scs.left) ? parseFloat(scs.left) : edge + cssPx('--rail-w', 72) + edge;
    const top = scs && parseFloat(scs.top) ? parseFloat(scs.top) : edge + cssPx('--header-h', 44) + cssPx('--sp-1', 8);
    return { left, right: edge, top, bottom: edge + cssPx('--sp-4', 32) };
}

// Šírka, ktorú si otvorený bočný panel rezervuje, a základný okraj.
export function panelReserve() { return cssPx('--panel-w', 300); }
export function edgePx() { return cssPx('--edge', 16); }

/* Bočné panely a strana, na ktorej NAOZAJ stoja (CSS: #dock `left`, #node-panel
   aj #pack-drawer `right`). Predtým tu bol jeden `some()` a rezerva sa pripisovala
   vždy vpravo — teda aj za ľavý #dock. Dôsledok bol zmeraný: s otvoreným dockom
   ležalo 13 z 30 popiskov a vodoznakov ZA panelom (layoutNodeLabels si výrez berie
   presne odtiaľto) a fitView() scénu posunul o ďalších 163 px doľava, teda hlbšie
   pod panel.

   Šírky čítame z tokenov, nie z getBoundingClientRect(): camInsets() beží v každom
   frame (render si ním obmedzuje plochu pre popisky), takže meranie z DOM by si
   vynútilo reflow 60× za sekundu. */
const SIDE_PANELS = [
    // #dock je pod 900 px presunutý k pravej hrane; stranu preto neurčuje JS, ale
    // token --dock-at-left, ktorý prepína to isté @media pravidlo (1 = vľavo).
    { id: 'dock', side: () => (cssPx('--dock-at-left', 1) ? 'left' : 'right'), token: '--panel-w', fallback: 300 },
    { id: 'node-panel', side: () => 'right', token: '--panel-w', fallback: 300 },
    { id: 'pack-drawer', side: () => 'right', token: '--drawer-w', fallback: 320 },
];

// Otvorené bočné panely. Stav sa číta z DOM pri KAŽDOM volaní (žiadny zapamätaný
// „wasOpen"), takže hneď po mutácii triedy dáva aktuálnu odpoveď.
export function openSidePanels() {
    const out = [];
    for (const p of SIDE_PANELS) {
        const el = document.getElementById(p.id);
        if (el && !el.classList.contains('hidden')) out.push(p);
    }
    return out;
}

// Okraje pre kameru: navyše uhnú otvorenému bočnému panelu — na tej strane, kde
// panel stojí. Dva panely na tej istej strane sa vizuálne prekrývajú (oba sedia na
// `right: var(--edge)`), preto sa berie ich maximum, nie súčet.
export function camInsets() {
    const ins = viewInsets();
    const gap = edgePx();
    let addL = 0, addR = 0;
    for (const p of openSidePanels()) {
        const w = cssPx(p.token, p.fallback) + gap;
        if (p.side() === 'left') addL = Math.max(addL, w);
        else addR = Math.max(addR, w);
    }
    ins.left += addL;
    ins.right += addR;
    return ins;
}

export function usableBox() {
    const ins = viewInsets();
    return {
        w: Math.max(320, (S.w || 1600) - ins.left - ins.right),
        h: Math.max(240, (S.h || 900) - ins.top - ins.bottom),
    };
}

// Pomer strán využiteľnej plochy — jediný zdroj „ako široká má scéna byť".
export function targetAspect() {
    const u = usableBox();
    return Math.min(4, Math.max(0.6, u.w / u.h));
}

export function targetBox() {
    const ar = targetAspect();
    return { rx: SCENE_RY * ar, ry: SCENE_RY, ar };
}

/* ---------- pomôcky ---------- */

// FNV-ish hash → 0..1. Rozsev semienok a jitter stúh (edges.js) bez Math.random.
export function hash01(v) {
    let h = Math.imul(2166136261 ^ (v | 0), 16777619);
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

export function cmpLabel(a, b) {
    const la = (a.label || '').toLowerCase(), lb = (b.label || '').toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return a.id - b.id;
}

export function orderedAreas() {
    return [...S.areas.values()].sort((a, b) => (a.angle - b.angle) || (a.id - b.id));
}

export function areaColor(area) {
    return (area && area.color) || '#2f6d8f';
}

// Oddelenia oblasti s počtom uzlov (len neprázdne), najväčšie prvé.
export function areaDepts(areaId) {
    const counts = new Map();
    for (const n of S.nodes) {
        if (!n.department_id) continue;
        counts.set(n.department_id, (counts.get(n.department_id) || 0) + 1);
    }
    const out = [];
    for (const d of S.departments.values()) {
        if (d.area_id !== areaId) continue;
        const c = counts.get(d.id) || 0;
        if (c > 0) out.push({ dept: d, count: c });
    }
    return out.sort((a, b) => (b.count - a.count) || (a.dept.id - b.dept.id));
}

// Uzol + jeho priami susedia (fokusová množina úrovne 'node'), s cache.
export function neighborhoodSet(nodeId) {
    if (S._nbFor === nodeId && S._nbSet) return S._nbSet;
    const set = new Set([nodeId]);
    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        if (e.source.id === nodeId) set.add(e.target.id);
        else if (e.target.id === nodeId) set.add(e.source.id);
    }
    S._nbFor = nodeId; S._nbSet = set;
    return set;
}

export function mainCore() {
    let first = null;
    for (const n of S.nodes) {
        if (n.type !== 'core') continue;
        if (n.label === S.name) return n;
        if (!first) first = n;
    }
    return first;
}

/* ---------- VRSTVY: vodorovné pásy ----------
   Pôvodný pohľad mal 5 stĺpcov na fixných svetových X (±560) — stovky uzlov na
   stĺpec ho natiahli na 12 000 jednotiek do výšky, fit zrazil zoom a vznikol
   úzky stĺpec s 90 % prázdnej plochy. Teraz sú z toho vodorovné pásy cez celú
   šírku a všetko sa počíta z rámu odvodeného z viewportu: šírka rámu určuje,
   koľko uzlov sa vojde do riadku, z toho vyjde počet riadkov a výška pásu. */

export const LAYER_ROLES = ['input', 'hidden_in', 'core', 'hidden_out', 'output'];
export const LAYER_META = {
    input: { title: 'Vstup', sub: 'spomienky' },
    hidden_in: { title: 'Skrytá', sub: 'skills → spomienky' },
    core: { title: 'Jadro', sub: 'osobnosť' },
    hidden_out: { title: 'Skrytá', sub: 'skills → projekty' },
    output: { title: 'Výstup', sub: 'projekty' },
};

// Zaradenie do pásu: prednosť má layer_role z dát, inak fallback podľa typu.
export function layerRoleOf(n) {
    const r = n.layer_role;
    if (r === 'input' || r === 'hidden_in' || r === 'core' || r === 'hidden_out' || r === 'output') return r;
    if (n.type === 'memory') return 'input';
    if (n.type === 'project') return 'output';
    if (n.type === 'core') return 'core';
    return 'hidden_in';
}

function areaKeyOf(n) { return n.area_id == null ? -1 : n.area_id; }

// Poradie uzlov v páse: oblasti ako súvislé farebné bloky, vnútri barycentrum
// susedov z iných pásov (menej kríženia hrán medzi vrstvami).
function orderBands(groups, roleOf) {
    const nbr = new Map();
    for (const n of S.nodes) nbr.set(n.id, []);
    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        const a = nbr.get(e.source.id), b = nbr.get(e.target.id);
        if (a) a.push(e.target.id);
        if (b) b.push(e.source.id);
    }
    const rank = new Map();
    const reRank = (list) => list.forEach((n, i) => rank.set(n.id, list.length > 1 ? i / (list.length - 1) : 0.5));

    for (const role of LAYER_ROLES) {
        const list = groups.get(role);
        list.sort((a, b) => (areaKeyOf(a) - areaKeyOf(b)) || cmpLabel(a, b));
        reRank(list);
    }

    for (let it = 0; it < 3; it++) {
        for (const role of LAYER_ROLES) {
            const list = groups.get(role);
            if (list.length < 3) continue;
            const bary = new Map();
            for (const n of list) {
                let sum = 0, cnt = 0;
                for (const id of nbr.get(n.id)) {
                    if (roleOf.get(id) === role) continue;   // vnútropásové hrany nekrížia
                    const v = rank.get(id);
                    if (v == null) continue;
                    sum += v; cnt++;
                }
                bary.set(n.id, cnt ? sum / cnt : rank.get(n.id));
            }
            const aSum = new Map(), aCnt = new Map();
            for (const n of list) {
                const k = areaKeyOf(n);
                aSum.set(k, (aSum.get(k) || 0) + bary.get(n.id));
                aCnt.set(k, (aCnt.get(k) || 0) + 1);
            }
            const aRank = new Map();
            [...aSum.keys()]
                .sort((x, y) => (aSum.get(x) / aCnt.get(x)) - (aSum.get(y) / aCnt.get(y)) || (x - y))
                .forEach((k, i) => aRank.set(k, i));
            list.sort((a, b) => (aRank.get(areaKeyOf(a)) - aRank.get(areaKeyOf(b)))
                || (bary.get(a.id) - bary.get(b.id)) || (a.id - b.id));
            reRank(list);
        }
    }
}

function buildLayerBands() {
    const ar = targetAspect();
    const sp = PHYS.layerSpacing;
    const groups = new Map();
    const roleOf = new Map();
    for (const r of LAYER_ROLES) groups.set(r, []);
    for (const n of S.nodes) {
        const r = layerRoleOf(n);
        groups.get(r).push(n);
        roleOf.set(n.id, r);
    }
    orderBands(groups, roleOf);

    // Šírku rámu a počet riadkov dolaďujeme spolu: širší rám → menej riadkov →
    // nižšia scéna. Pár iterácií stačí na to, aby scéna mala pomer strán ≈ ar.
    let W = 2 * SCENE_RY * ar;
    let rows = LAYER_ROLES.map(() => 1);
    let inner = 0;
    for (let it = 0; it < 6; it++) {
        const perRow = Math.max(8, Math.floor(W / sp));
        rows = LAYER_ROLES.map((r) => Math.max(1, Math.ceil(groups.get(r).length / perRow)));
        inner = rows.reduce((s, k, i) => s + Math.max(k * sp, 44), 0);
        const need = ar * (inner + LAYER_ROLES.length * sp * 2.2);
        if (need <= W * 1.02) break;
        W = need;
    }
    const H = Math.max(inner + LAYER_ROLES.length * sp * 2.2, W / ar);
    const gap = (H - inner) / LAYER_ROLES.length;

    const of = new Map();
    const bands = [];
    let y = -H / 2 + gap / 2;
    LAYER_ROLES.forEach((role, i) => {
        const list = groups.get(role);
        const h = Math.max(rows[i] * sp, 44);
        const cols = Math.max(1, Math.ceil(list.length / rows[i]));
        list.forEach((n, k) => {
            const row = Math.floor(k / cols), col = k % cols;
            of.set(n.id, {
                x: -W / 2 + ((col + 0.5) / cols) * W,
                y: y + ((row + 0.5) / rows[i]) * h,
                y0: y, y1: y + h,
            });
        });
        bands.push({
            role, count: list.length, rows: rows[i], cols,
            y0: y, y1: y + h, cy: y + h / 2, h, x0: -W / 2, x1: W / 2,
        });
        y += h + gap;
    });
    return { of, bands, frame: { W, H } };
}

/* ---------- kotvy pre fyziku ---------- */

// S.departments.size tu MUSÍ byť: pod-kotvy oddelení sa rozsievajú zlatým uhlom
// podľa ich počtu, takže `department.created` (a presun prvého uzla do dovtedy
// prázdneho oddelenia) mení kotvy. Bez toho podpis nezmenil hodnotu, cache vrátila
// staré kotvy a nové uzly gravitovali k ťažisku celej oblasti.
function anchorSig() {
    return [S.gview, S.nodes.length, S.edges.length, S.areas.size, S.departments.size,
        Math.round(targetAspect() * 20), Math.round((S._netStretch || 1) * 100)].join('|');
}

// Ťažiská oblastí (Sieť) alebo pásy (Vrstvy). Polomer klastra vychádza z počtu
// uzlov (SPACING² plochy na uzol), veniec z ich súčtu — veľké oblasti dostanú
// viac miesta a klastre sa práve tak prelievajú do seba.
export function anchors() {
    const sig = anchorSig();
    if (S._anchors && S._anchors.sig === sig) return S._anchors;

    const ar = targetAspect();
    if (S.gview === 'layers') {
        const L = buildLayerBands();
        S._anchors = { sig, mode: 'layers', of: L.of, bands: L.bands, frame: L.frame, squash: 1, areaCenters: new Map() };
        return S._anchors;
    }

    const SPACING = 23;
    const counts = new Map();
    for (const n of S.nodes) {
        if (n.type === 'core' || n.area_id == null) continue;
        counts.set(n.area_id, (counts.get(n.area_id) || 0) + 1);
    }
    const areas = orderedAreas();
    let sumR = 0;
    const radii = new Map();
    for (const a of areas) {
        const c = counts.get(a.id) || 0;
        const r = SPACING * Math.sqrt(Math.max(1, c) / Math.PI) * 1.35;
        radii.set(a.id, r);
        sumR += r;
    }
    // obvod venca ≈ 2,3 × súčet polomerov → susedné klastre sa dotýkajú a mierne prelievajú
    const ring = Math.max(180, (sumR / Math.PI) * 1.15);
    const sq = Math.sqrt(ar);
    const stretch = S._netStretch || 1;
    const ringX = ring * sq * stretch, ringY = ring / sq;

    const areaCenters = new Map();
    for (const a of areas) {
        const dir = rad(a.angle);
        areaCenters.set(a.id, {
            x: Math.cos(dir) * ringX, y: Math.sin(dir) * ringY,
            r: radii.get(a.id) || 120, count: counts.get(a.id) || 0,
        });
    }

    // Pod-kotvy oddelení. Bez nich má oblasť jedno ťažisko a 449 uzlov sa v nej
    // rozleje do jednej hladkej gule — sieť potom nemá vnútornú textúru a popisky
    // oddelení sa zlejú v jednom bode. Rozsev po zlatom uhle (nie po kruhu) dá
    // nepravidelné pod-klastre, ktoré sa navzájom prelievajú.
    const deptCenters = new Map();
    for (const a of areas) {
        const c = areaCenters.get(a.id);
        const list = areaDepts(a.id);
        const N = list.length;
        if (!N) continue;
        const maxC = Math.max(1, ...list.map((d) => d.count));
        list.forEach(({ dept, count }, i) => {
            const t = (i + 0.5) / N;
            const rr = c.r * 0.66 * Math.pow(t, 0.62) * (0.86 + 0.28 * hash01(dept.id));
            const th = i * GOLD + hash01(a.id) * 6.2831853;
            deptCenters.set(dept.id, {
                x: c.x + Math.cos(th) * rr * sq,
                y: c.y + Math.sin(th) * rr / sq,
                r: c.r * 0.45 * Math.sqrt(count / maxC), count,
            });
        });
    }

    S._anchors = {
        sig, mode: 'net', of: null, bands: null, areaCenters, deptCenters,
        frame: { W: 2 * (ringX + sumR / areas.length), H: 2 * (ringY + sumR / areas.length) },
        squash: Math.min(8, Math.pow(ar, PHYS.squashPow)),
    };
    return S._anchors;
}

// Kotva uzla — cieľ gravitácie. Používa ju fyzika aj nové uzly z WS/chatu.
export function anchorOf(n) {
    const A = anchors();
    if (A.mode === 'layers') {
        const p = A.of.get(n.id);
        if (p) return { x: p.x, y: p.y };
        return { x: 0, y: 0 };
    }
    if (n.type === 'core') return { x: 0, y: 0 };
    const d = n.department_id != null && A.deptCenters ? A.deptCenters.get(n.department_id) : null;
    if (d) return { x: d.x, y: d.y };
    const c = n.area_id != null ? A.areaCenters.get(n.area_id) : null;
    if (c) return { x: c.x, y: c.y };
    const area = n.area_id != null ? S.areas.get(n.area_id) : null;
    if (area) return areaAnchor(area);
    return { x: 0, y: 0 };
}

// Sila gravitácie k kotve. V Sieti je Y silnejšie (squash) — z toho vzniká
// široká elipsa namiesto kruhu, a teda ≥ 70 % šírky viewportu po fite.
export function gravityOf(n) {
    const A = anchors();
    if (A.mode === 'layers') return { sx: PHYS.layerGravX, sy: PHYS.layerGravY };
    // Uzol bez hrán nedrží nič okrem gravitácie, takže ho odpudzovanie vytlačí na
    // okraj scény (48 osamelých uzlov vyrobilo prázdny pás na pravej strane).
    // Posilnená kotva ich udrží pri svojom pod-klastri.
    const deg = S.degree.get(n.id) || 0;
    const lone = deg === 0 ? 2.4 : (deg === 1 ? 1.5 : 1);
    const base = (n.type === 'core' ? PHYS.coreGrav : PHYS.grav) * lone;
    return { sx: base, sy: base * A.squash };
}

// Pás uzla (Vrstvy) — pumpa doň tvrdo zaráža y, aby sa vrstvy neprelievali.
export function bandOf(n) {
    const A = anchors();
    return A.mode === 'layers' ? A.of.get(n.id) : null;
}

export function areaAnchor(area) {
    const A = S._anchors;
    if (A && A.mode === 'net') {
        const c = A.areaCenters.get(area.id);
        if (c) return { x: c.x, y: c.y };
    }
    return {
        x: Math.cos(rad(area.angle)) * AREA_RADIUS_FALLBACK,
        y: Math.sin(rad(area.angle)) * AREA_RADIUS_FALLBACK,
    };
}

export function deptAnchor(dept) {
    const A = S._anchors;
    if (A && A.deptCenters) {
        const c = A.deptCenters.get(dept.id);
        if (c) return { x: c.x, y: c.y };
    }
    const area = S.areas.get(dept.area_id);
    return area ? areaAnchor(area) : { x: 0, y: 0 };
}

/* ---------- semienka a normalizácia ---------- */

// Uzly bez pozície dostanú štart pri svojej kotve (deterministicky z hashu —
// nie kvôli determinizmu layoutu, ale aby reload nezačínal iným chaosom).
export function ensureSeeded() {
    for (const n of S.nodes) {
        if (Number.isFinite(n.x) && Number.isFinite(n.y)) continue;
        const a = anchorOf(n);
        const t = hash01(n.id) * 6.2831853;
        const r = 40 + 260 * Math.sqrt(hash01(n.id * 7 + 3));
        n.x = a.x + Math.cos(t) * r;
        n.y = a.y + Math.sin(t) * r * 0.62;
    }
}

export function nodeBBox() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cnt = 0;
    for (const n of S.nodes) {
        if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
        cnt++;
    }
    return cnt >= 2 ? { minX, minY, maxX, maxY } : null;
}

// Poistka na kritérium šírky: keď sa oblak usadí užší, než je pomer viewportu,
// raz ho po osi X roztiahneme. Roztiahnutie vzdialenosti len zväčšuje, takže
// nikdy nevyrobí nové prekryvy. Faktor si pamätáme v S._netStretch a preberá ho
// aj veniec kotiev, aby to fyzika po ďalšom kopnutí nestiahla späť.
export function normalizeAspect() {
    if (S.gview !== 'net') return 1;
    const b = nodeBBox();
    if (!b) return 1;
    const bw = b.maxX - b.minX, bh = Math.max(1, b.maxY - b.minY);
    const cur = bw / bh;
    const want = targetAspect();
    if (!(cur > 0)) return 1;
    let f = (want * 0.98) / cur;
    f = Math.min(1.8, Math.max(1, f));
    if (f < 1.02) return 1;
    const cx = (b.minX + b.maxX) / 2;
    for (const n of S.nodes) {
        n.x = cx + (n.x - cx) * f;
        if (n.fx != null) n.fx = cx + (n.fx - cx) * f;
    }
    S._netStretch = Math.min(2.6, (S._netStretch || 1) * f);
    S._anchors = null;      // veniec sa musí prepočítať s novým stretchom
    return f;
}

/* ---------- huby ---------- */

function hubRecords(nav) {
    const out = [];
    const A = anchors();
    if (A.mode === 'layers') {
        // Vo Vrstvách sú popisky pásov jediné huby: ťažisko oblasti je tu rozmazané
        // cez celú scénu (oblasti sa v páse mieša), takže jeho značka by bola len
        // vodoznak v prázdne. Filter podľa oblasti ide klávesmi / stromom štruktúry.
        for (const b of A.bands) {
            const m = LAYER_META[b.role];
            out.push({
                kind: 'layer', id: b.role, key: 'l' + b.role, name: m.title + ' — ' + m.sub,
                count: b.count, color: 'rgb(120,120,120)', dim: 1, rw: 0, band: b, x: b.x0, y: b.cy,
            });
        }
        return out;
    }
    const filtered = nav.level !== 'map';
    for (const a of orderedAreas()) {
        const focus = !filtered || nav.area === a.id;
        out.push({
            kind: 'area', id: a.id, key: 'a' + a.id, name: a.name, count: 0,
            color: areaColor(a), dim: focus ? 1 : 0.18, rw: 0, x: 0, y: 0,
        });
    }
    // Hub oddelenia dostane popisok LEN keď je na ňom fokus. Oblasť má aj 30
    // oddelení a ich pod-klastre sa prelievajú — 30 popiskov na sebe bol vizuálny
    // šum bez informácie. Kým je fokus na oblasti, nesie meno breadcrumb.
    if (nav.dept != null && S.departments.has(nav.dept)) {
        const dept = S.departments.get(nav.dept);
        const area = S.areas.get(dept.area_id);
        out.push({
            kind: 'dept', id: dept.id, key: 'd' + dept.id, name: dept.name, count: 0,
            color: areaColor(area), dim: 1, rw: 0, x: 0, y: 0,
        });
    }
    return out;
}

// Geometria hubov z AKTUÁLNYCH pozícií uzlov — ťažisko klastra + jeho rozptyl.
// Volá to pumpa po každom tiku, takže popisky oblastí sa hýbu so sieťou.
export function syncHubs(L) {
    if (!L || !L.hubs.length) return;
    const acc = new Map();
    for (const h of L.hubs) if (h.kind !== 'layer') acc.set(h.key, { n: 0, sx: 0, sy: 0, sxx: 0, syy: 0 });
    for (const n of S.nodes) {
        if (n.type === 'core') continue;
        if (!Number.isFinite(n.x)) continue;
        const a = n.area_id != null ? acc.get('a' + n.area_id) : null;
        if (a) { a.n++; a.sx += n.x; a.sy += n.y; a.sxx += n.x * n.x; a.syy += n.y * n.y; }
        const d = n.department_id ? acc.get('d' + n.department_id) : null;
        if (d) { d.n++; d.sx += n.x; d.sy += n.y; d.sxx += n.x * n.x; d.syy += n.y * n.y; }
    }

    let maxArea = 1, maxDept = 1;
    for (const h of L.hubs) {
        const a = acc.get(h.key);
        if (!a || !a.n) continue;
        h.count = a.n;
        if (h.kind === 'area') maxArea = Math.max(maxArea, a.n);
        if (h.kind === 'dept') maxDept = Math.max(maxDept, a.n);
    }

    const span = sceneSpan(L);
    const unit = span / 1000;
    for (const h of L.hubs) {
        if (h.kind === 'layer') {
            // Značka pásu sedí pri jeho ľavom okraji, ale odsadená o 2 % šírky —
            // presne na okraji jej popisok prvým písmenom zaliezol pod rail.
            if (h.band) { h.x = h.band.x0 + (h.band.x1 - h.band.x0) * 0.02; h.y = h.band.cy; }
            h.rw = 5 * unit;
            continue;
        }
        const a = acc.get(h.key);
        if (!a || !a.n) { h.rw = 0; h.dim = 0; continue; }
        h.x = a.sx / a.n; h.y = a.sy / a.n;
        const vx = Math.max(0, a.sxx / a.n - h.x * h.x);
        const vy = Math.max(0, a.syy / a.n - h.y * h.y);
        h.spreadX = Math.sqrt(vx); h.spreadY = Math.sqrt(vy);
        if (h.kind === 'area') {
            h.rw = (9 + 15 * Math.sqrt(h.count / maxArea)) * unit * (h.dim < 0.5 ? 0.6 : 1);
            // areola regiónu — jemný tón vo farbe oblasti pod klastrom (render.drawAreolas)
            if (h.dim >= 0.5 && S.gview === 'net') {
                h.crx = Math.max(40, h.spreadX * 1.5);
                h.cry = Math.max(40, h.spreadY * 1.5);
            } else { h.crx = 0; h.cry = 0; }
        } else {
            h.rw = (6 + 9 * Math.sqrt(h.count / maxDept)) * unit * (h.dim < 0.5 ? 0.7 : 1);
            h.lry = Math.min(h.spreadY * 1.05, span * 0.12);   // popisok sa odsadí pod klaster
        }
    }
}

function sceneSpan(L) {
    const b = L && L.raw ? L.raw : nodeBBox();
    if (!b) return 1800;
    return Math.max(600, ((b.maxX - b.minX) + (b.maxY - b.minY)) / 2);
}

/* ---------- hlavný layout (prezentácia) ---------- */

export function layoutSignature() {
    const nav = S.nav;
    return [S.gview, S.nodes.length, S.edges.length, S.areas.size, S.departments.size,
        nav.level, nav.area, nav.dept, nav.node,
        Math.round((S.w || 0) / 8), Math.round((S.h || 0) / 8)].join('|');
}

function focusPredicate(nav) {
    if (nav.level === 'area' && nav.area != null) return (n) => n.area_id === nav.area;
    if (nav.level === 'dept' && nav.dept != null) return (n) => n.department_id === nav.dept;
    if (nav.level === 'node' && nav.node != null) {
        const set = neighborhoodSet(nav.node);
        return (n) => set.has(n.id);
    }
    return null;
}

// Postaví prezentáciu aktuálneho stavu. Výsledok: { pos, hubs, edgeMode, ... }
//   pos:  Map(nodeId → { x, y, kind, mul, dim, glow })   kind: core|node|dust
//   hubs: [{ kind:'area'|'dept'|'layer', id, x, y, rw, count, name, color, dim }]
// Pozície sa NEPOČÍTAJÚ — čítajú sa z n.x/n.y (fyzika v sim.js).
export function computeLayout(force) {
    const sig = layoutSignature();
    if (!force && S.layout && S.layout.sig === sig) return S.layout;

    ensureSeeded();

    // Zmena pomeru strán viewportu = iné kotvy → nech sa sieť dousadí (a stretch
    // sa počíta odznova). Kopnutie vystrelí applyLayoutPositions() v sim.js.
    const ar = targetAspect();
    if (S._layoutAr && Math.abs(ar - S._layoutAr) / S._layoutAr > 0.03) {
        S._netStretch = 1;
        S._anchors = null;
        S._layerCache = null;
        S._needKick = 1;
    }
    S._layoutAr = ar;

    const nav = S.nav;
    const pos = new Map();
    const inFocus = focusPredicate(nav);
    const main = mainCore();

    for (const n of S.nodes) {
        const focus = !inFocus || inFocus(n);
        const core = n.type === 'core';
        pos.set(n.id, {
            x: n.x, y: n.y,
            kind: core ? 'core' : (focus ? 'node' : 'dust'),
            mul: core ? (n === main ? 1.5 : 0.9) : 1,
            dim: focus ? 1 : (core ? DIM_CORE_CTX : DIM_CTX),
            glow: core ? (n === main ? 0.85 : 0.3) * (focus ? 1 : 0.35) : 0,
        });
    }

    const hubs = hubRecords(nav);
    const raw = nodeBBox() || { minX: -800, minY: -450, maxX: 800, maxY: 450 };
    const box = targetBox();
    const L = {
        sig, level: nav.level, gview: S.gview,
        area: nav.area, dept: nav.dept, node: nav.node,
        pos, hubs, ribbons: [], stubs: [], edgeMode: 'real',
        box, raw,
        bbox: { minX: raw.minX, maxX: raw.maxX, minY: raw.minY, maxY: raw.maxY },
        scale: 1, center: { x: 0, y: 0 }, aniso: { sx: 1, sy: 1 },
    };
    S.layout = L;
    syncHubs(L);
    return L;
}

// Prenesie aktuálne pozície uzlov do pos entries (a pohne hubmi). Volá pumpa.
export function syncLayout(L) {
    if (!L) return;
    for (const [id, e] of L.pos) {
        const n = S.byId.get(id);
        if (n) { e.x = n.x; e.y = n.y; }
    }
    const b = nodeBBox();
    if (b) { L.raw = b; L.bbox = { minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY }; }
    syncHubs(L);
}

/* ---------- veľkosti ---------- */

export function nodeRadius(n) {
    let base;
    if (n.type === 'core') {
        base = n.label === S.name ? 26 : 15;
    } else {
        const deg = S.degree.get(n.id) || 0;
        base = Math.min(16, 6 + 2.6 * Math.log2(1 + deg));
    }
    return base * (S.opts ? S.opts.nodeScale : 1);
}

// Polomer, ktorým sa uzol reálne kreslí. Kontext (dust) je konštantný v
// obrazovkových pixeloch — pri oddialení nezanikne ani nenarastie.
export function drawRadius(n, ent, invK) {
    if (!ent) return nodeRadius(n);
    if (ent.kind === 'dust') return 2.6 * invK;
    if (ent.kind === 'ctx') return 2.2 * invK;
    return nodeRadius(n) * (ent.mul || 1);
}
