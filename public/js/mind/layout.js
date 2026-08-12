import { S, ctx } from './state.js';
import { rad } from './util.js';

/* ---------- W2a: JEDEN GRAF, ŠTYRI ÚROVNE ZANORENIA ----------

   Layout je čisto deterministický (žiadny Math.random, žiadna d3 simulácia):
   rovnaké dáta + rovnaký viewport → rovnaké pozície. Rozloženia sú radiálne
   (prirodzený pomer ~1:1) a na konci sa jednou afinnou transformáciou natiahnu
   do cieľového rámu, ktorého pomer strán kopíruje využiteľnú plochu viewportu.
   Preto z kruhu vznikne elipsa vyplňujúca 16:9 — to je oprava „úzkeho grafu".

   Úrovne: 'map' → 'area' → 'dept' → 'node' (stavový stroj žije v sim.js: go()).
*/

export const CORE_COLOR_FALLBACK = '#b88a3a';
export const SCENE_RY = 520;                       // polovýška cieľového rámu (svetové jednotky)
export const GOLD = Math.PI * (3 - Math.sqrt(5));  // zlatý uhol — phyllotaxis (rovnomerný disk)
export const LEVELS = ['map', 'area', 'dept', 'node'];

// Legacy kotvy (mapa/sieť/vrstvy) sú zrušené; konstanty ostávajú len ako fallback
// pre anchorOf() pri uzloch, ktoré ešte nie sú v layoute (WS zrod pred prepočtom).
export const AREA_RADIUS_FALLBACK = 640;

/* ---------- W3a: ladenie estetiky mapy ----------
   MAP_HUB_R0/R1: vzdialenosť hubu oblasti od stredu = R0 + R1 · clusterR. Menšie R0
   pritiahne veniec oblastí k jadru (tesnejšia kompozícia, menšia mŕtva plocha v strede).
   Normalizácia je invariantná na mierku, takže tieto čísla NEmenia vyplnenie viewportu.
   MAP_DUST_POW: radiálny profil oblaku prachu (viď phyllo) — > 0.5 zhusťuje prach k hubu. */
export const MAP_HUB_R0 = 0.86;
export const MAP_HUB_R1 = 0.52;
export const MAP_DUST_POW = 0.95;

/* ---------- rám scény ---------- */

// Okraje, ktoré necháva layout voľné pre plávajúce UI (rail vľavo, hlavička hore).
// fitView() používa TIE ISTÉ okraje, takže scéna nikdy nelezie pod rail a zároveň
// je pomer rámu presne pomerom využiteľnej plochy → fit vyjde na oboch osiach naraz.
// Okraje scény čítame z CSS tokenov, nie zo zadrôtovaných čísel — pri zmene šírky
// railu alebo výšky hlavičky sa inak rozladí fit. Pozor: getPropertyValue() vracia
// pri --content-left/-top doslovný calc(...) string, preto berieme už vyriešené
// left/top z #screens a fallback skladáme z primitívov (tie sa vracajú v px).
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

// Okraje pre kameru: navyše uhnú otvorenému bočnému panelu, aby na úrovni uzla
// nezakrýval susedov. Zámerne sa NEpoužívajú v targetBox() — layout tým zostáva
// stabilný a pri otvorení panela sa hýbe len kamera, nie uzly.
// Šírka, ktorú si otvorený bočný panel rezervuje, a základný okraj — čítané zo
// tokenov, aby posun scény pri otvorení panela sedel aj po zmene rozmerov v CSS.
export function panelReserve() { return cssPx('--panel-w', 300); }
export function edgePx() { return cssPx('--edge', 16); }

export function camInsets() {
    const ins = viewInsets();
    const open = ['node-panel', 'dock', 'pack-drawer'].some((id) => {
        const el = document.getElementById(id);
        return el && !el.classList.contains('hidden');
    });
    if (open) ins.right += cssPx('--panel-w', 300) + cssPx('--edge', 16);
    return ins;
}

export function targetBox() {
    const ins = viewInsets();
    const uw = Math.max(320, (S.w || 1600) - ins.left - ins.right);
    const uh = Math.max(240, (S.h || 900) - ins.top - ins.bottom);
    const ar = Math.min(4, Math.max(0.5, uw / uh));
    return { rx: SCENE_RY * ar, ry: SCENE_RY, ar };
}

/* ---------- deterministické pomôcky ---------- */

// FNV-ish hash → 0..1. Nahrádza Math.random() v layoute (stabilita medzi reloadmi).
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

// Oblasti v stabilnom poradí podľa uhla (rovnaký vejár ako doteraz).
export function orderedAreas() {
    return [...S.areas.values()].sort((a, b) => (a.angle - b.angle) || (a.id - b.id));
}

export function areaColor(area) {
    return (area && area.color) || '#2f6d8f';
}

// Uzly oblasti (bez jadra) v deterministickom poradí.
export function areaNodes(areaId) {
    const out = [];
    for (const n of S.nodes) if (n.type !== 'core' && n.area_id === areaId) out.push(n);
    return out.sort(cmpLabel);
}

export function deptNodes(deptId) {
    const out = [];
    for (const n of S.nodes) if (n.department_id === deptId) out.push(n);
    return out.sort(cmpLabel);
}

// Uzly oblasti bez oddelenia — sadnú do stredu oblasti.
export function areaLooseNodes(areaId) {
    const out = [];
    for (const n of S.nodes) {
        if (n.type === 'core' || n.area_id !== areaId) continue;
        if (n.department_id && S.departments.has(n.department_id)) continue;
        out.push(n);
    }
    return out.sort(cmpLabel);
}

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
    // veľké oddelenia bližšie k jadru oblasti → stabilné a čitateľné
    return out.sort((a, b) => (b.count - a.count) || (a.dept.id - b.dept.id));
}

// Susedia uzla podľa reálnych hrán, zoradení podľa váhy (stabilne).
export function neighborRefs(nodeId) {
    const out = [];
    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        if (e.source.id === nodeId) out.push({ n: e.target, w: e.weight || 1 });
        else if (e.target.id === nodeId) out.push({ n: e.source, w: e.weight || 1 });
    }
    const seen = new Set();
    return out
        .filter((r) => (seen.has(r.n.id) ? false : (seen.add(r.n.id), true)))
        .sort((a, b) => (b.w - a.w) || cmpLabel(a.n, b.n));
}

/* ---------- rozmiestnenia ---------- */

// Phyllotaxis (slnečnicový disk). Vďaka zlatému uhlu nevznikajú radiálne špice ani diery.
// pow riadi radiálny profil hustoty: rr ∝ t^pow → hustota ∝ t^(1−2·pow).
//   0.5  = rovnomerná plocha (tvrdý disk),
//   ~1.0 = hustý stred a rednúci okraj → čitateľný „oblak" namiesto poľa bodov.
// Krajný bod zostáva ~r0 pri každom pow, takže bbox scény (a tým aj fit) sa nemení.
// Pri pow ≠ 0.5 prestane byť phyllotaxis rovnomerná a začnú byť vidieť spirálové ramená
// (zlatý uhol + takmer lineárny polomer = Archimedova spirála). Preto pri zadanom pow
// pridávame deterministický radiálny rozptyl z hashu id — oblak stratí matematický vzor
// a začne pôsobiť organicky. Bez pow (oblasť/oddelenie) sa nemení nič.
function phyllo(list, cx, cy, r0, seed, out, ent, pow) {
    const n = list.length;
    if (!n) return;
    const p = pow || 0.5;
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        let rr = r0 * (p === 0.5 ? Math.sqrt(t) : Math.pow(t, p));
        if (pow) rr *= 0.84 + 0.32 * hash01(list[i].id);
        const th = i * GOLD + seed;
        out.set(list[i].id, Object.assign({ x: cx + Math.cos(th) * rr, y: cy + Math.sin(th) * rr }, ent));
    }
}

// Prstenec (alebo viac prstencov) — susedia uzla, kontextové okolie.
function rings(list, cx, cy, radii, phase, out, ent) {
    const n = list.length;
    if (!n) return;
    const R = radii.length;
    // kapacita prstenca rastie s obvodom → vonkajšie prstence unesú viac
    const wsum = radii.reduce((s, r) => s + r, 0);
    const caps = radii.map((r) => Math.max(1, Math.round((n * r) / wsum)));
    let i = 0;
    for (let r = 0; r < R; r++) {
        const cap = (r === R - 1) ? (n - i) : Math.min(caps[r], n - i);
        if (cap <= 0) continue;
        for (let j = 0; j < cap && i < n; j++, i++) {
            const th = (j / cap) * Math.PI * 2 - Math.PI / 2 + phase + r * 0.35;
            out.set(list[i].id, Object.assign({ x: cx + Math.cos(th) * radii[r], y: cy + Math.sin(th) * radii[r] }, ent));
        }
    }
}

/* ---------- agregované stuhy ---------- */

// Spočíta hrany medzi skupinami (oblasť↔oblasť alebo oddelenie↔oddelenie).
// Namiesto 2779 jednotlivých hrán kreslíme max ~pár desiatok zviazaných stúh.
function aggregateRibbons(groupOf) {
    const m = new Map();
    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        const a = groupOf(e.source), b = groupOf(e.target);
        if (a == null || b == null || a === b) continue;
        const k = a < b ? a + '|' + b : b + '|' + a;
        m.set(k, (m.get(k) || 0) + 1);
    }
    const out = [];
    for (const [k, count] of m) {
        const [a, b] = k.split('|');
        out.push({ a, b, count });
    }
    return out.sort((x, y) => (y.count - x.count) || (x.a < y.a ? -1 : 1));
}

/* ---------- hlavný layout ---------- */

// Veľkosť hubu (svetové jednotky pred normalizáciou nezáleží — hub r sa počíta
// až po normalizácii, aby bol v rovnakej mierke ako uzly).
function hubRadius(count, maxCount, base, span) {
    return base + span * Math.sqrt(count / Math.max(1, maxCount));
}

export function layoutSignature() {
    const nav = S.nav;
    return [S.nodes.length, S.edges.length, S.areas.size, S.departments.size,
        nav.level, nav.area, nav.dept, nav.node,
        Math.round((S.w || 0) / 8), Math.round((S.h || 0) / 8)].join('|');
}

// Postaví layout aktuálnej úrovne. Výsledok: { level, pos, hubs, ribbons, stubs, box, bbox }
//   pos:  Map(nodeId → { x, y, kind, mul, dim })   kind: core|node|dust|ctx|center
//   hubs: [{ kind:'area'|'dept', id, x, y, r, count, name, color, dim, label }]
export function computeLayout(force) {
    const sig = layoutSignature();
    if (!force && S.layout && S.layout.sig === sig) return S.layout;

    const nav = S.nav;
    const pos = new Map();
    const hubs = [];
    let ribbons = [];
    let edgeMode = 'ribbons';   // 'ribbons' | 'real'
    let showStubs = false;

    const cores = S.nodes.filter((n) => n.type === 'core').sort(cmpLabel);
    const mainCore = cores.find((n) => n.label === S.name) || cores[0] || null;

    // mul: násobič polomeru jadra na tejto úrovni. Na mape je jadro jediná vec v strede
    // kompozície — dostane väčšiu váhu (halo kreslí render.drawShape), aby stred nepôsobil
    // nedokončene. glow = intenzita hala (0 = bez hala).
    const placeCores = (r0, mul, glow) => {
        const m = mul || 1;
        if (mainCore) pos.set(mainCore.id, { x: 0, y: 0, kind: 'core', mul: m, glow: glow || 0 });
        const rest = cores.filter((n) => n !== mainCore);
        rest.forEach((n, i) => {
            const a = ((Math.PI * 2) / Math.max(1, rest.length)) * i - Math.PI / 2;
            pos.set(n.id, {
                x: Math.cos(a) * r0, y: Math.sin(a) * r0, kind: 'core',
                mul: 0.8 * m, glow: (glow || 0) * 0.55,
            });
        });
    };

    const areas = orderedAreas();
    const areaCount = new Map();
    for (const a of areas) areaCount.set(a.id, areaNodes(a.id).length);
    const maxAreaCount = Math.max(1, ...areaCount.values());

    if (nav.level === 'map') {
        /* ---- MAPA: jadro v strede, 5 hubov oblastí po elipse, všetkých 1025 uzlov
               ako veľmi jemný prach zoskupený okolo svojho hubu, medzi oblasťami
               len agregované zviazané stuhy. ---- */
        // W3a: jadro dostane váhu (mul + halo) a kruh hubov je tesnejšie pri strede,
        // aby stredová prázdnota nebola dominantná plocha kompozície.
        placeCores(0.19, 1.7, 1);
        for (const a of areas) {
            const dir = rad(a.angle);
            const cnt = areaCount.get(a.id) || 0;
            const clusterR = 0.28 + 0.30 * Math.sqrt(cnt / maxAreaCount);
            const cx = Math.cos(dir) * (MAP_HUB_R0 + MAP_HUB_R1 * clusterR);
            const cy = Math.sin(dir) * (MAP_HUB_R0 + MAP_HUB_R1 * clusterR);
            hubs.push({
                kind: 'area', id: a.id, x: cx, y: cy, count: cnt,
                name: a.name, color: areaColor(a), dim: 1, rw: 0,
                // cloud = surový polomer oblaku prachu; po normalizácii z neho vznikne
                // crx/cry (elipsa) a render z toho kreslí jemnú tónovanú areolu regiónu
                cloud: clusterR,
            });
            phyllo(areaNodes(a.id), cx, cy, clusterR, hash01(a.id) * 6.2831, pos,
                { kind: 'dust', mul: 1, dim: 1 }, MAP_DUST_POW);
        }
        ribbons = aggregateRibbons((n) => (n.type === 'core' || n.area_id == null ? null : 'a' + n.area_id))
            .map((r) => ({ a: r.a, b: r.b, count: r.count }));

    } else if (nav.level === 'area') {
        /* ---- OBLASŤ: oddelenia ako sub-huby v prstenci, uzly oblasti s tvarom,
               ostatné oblasti stmavnuté na okraji ako kontext. ---- */
        const area = S.areas.get(nav.area);
        const depts = areaDepts(nav.area);
        const maxDeptCount = Math.max(1, ...depts.map((d) => d.count));
        const N = depts.length;
        const radii = N <= 9 ? [0.62] : (N <= 22 ? [0.40, 0.82] : [0.30, 0.60, 0.90]);
        const R = radii.length;
        const wsum = radii.reduce((s, r) => s + r, 0);
        const caps = radii.map((r) => Math.max(1, Math.round((N * r) / wsum)));

        // loose uzly (bez oddelenia) do stredu oblasti
        phyllo(areaLooseNodes(nav.area), 0, 0, 0.17, hash01(nav.area) * 6.2831, pos,
            { kind: 'node', mul: 0.55, dim: 1 });

        let i = 0;
        for (let r = 0; r < R; r++) {
            const cap = (r === R - 1) ? (N - i) : Math.min(caps[r], N - i);
            const gap = R > 1 ? (r + 1 < R ? radii[r + 1] - radii[r] : radii[r] - radii[r - 1]) : 0.55;
            for (let j = 0; j < cap && i < N; j++, i++) {
                const { dept, count } = depts[i];
                const th = (j / cap) * Math.PI * 2 - Math.PI / 2 + r * 0.42;
                const dx = Math.cos(th) * radii[r], dy = Math.sin(th) * radii[r];
                hubs.push({
                    kind: 'dept', id: dept.id, x: dx, y: dy, count,
                    name: dept.name, color: areaColor(area), dim: 1, rw: 0,
                });
                const spread = Math.min(gap * 0.40, 0.055 + 0.14 * Math.sqrt(count / maxDeptCount));
                phyllo(deptNodes(dept.id), dx, dy, spread, hash01(dept.id) * 6.2831, pos,
                    { kind: 'node', mul: 0.55, dim: 1 });
            }
        }

        // kontext: ostatné oblasti ako stmavnuté obláčiky na okraji
        for (const a of areas) {
            if (a.id === nav.area) continue;
            const dir = rad(a.angle);
            const cx = Math.cos(dir) * 1.16, cy = Math.sin(dir) * 1.16;
            hubs.push({
                kind: 'area', id: a.id, x: cx, y: cy, count: areaCount.get(a.id) || 0,
                name: a.name, color: areaColor(a), dim: 0.15, rw: 0,
            });
            phyllo(areaNodes(a.id), cx, cy, 0.125, hash01(a.id) * 6.2831, pos,
                { kind: 'ctx', mul: 1, dim: 0.15 });
        }

        ribbons = aggregateRibbons((n) => {
            if (n.area_id !== nav.area) return null;
            return n.department_id && S.departments.has(n.department_id) ? 'd' + n.department_id : null;
        });

    } else if (nav.level === 'dept') {
        /* ---- ODDELENIE: uzly v plnej veľkosti, reálne hrany medzi sebou,
               hrany von len ako krátke pahýle na okraji. ---- */
        edgeMode = 'real';
        showStubs = true;
        const dept = S.departments.get(nav.dept);
        const list = deptNodes(nav.dept);
        const ids = new Set(list.map((n) => n.id));
        // vnútrooddelenský stupeň → huby doprostred (phyllotaxis kladie index 0 do stredu)
        const deg = new Map();
        for (const e of S.edges) {
            if (!e.source || !e.target) continue;
            if (!ids.has(e.source.id) || !ids.has(e.target.id)) continue;
            deg.set(e.source.id, (deg.get(e.source.id) || 0) + 1);
            deg.set(e.target.id, (deg.get(e.target.id) || 0) + 1);
        }
        list.sort((a, b) => ((deg.get(b.id) || 0) - (deg.get(a.id) || 0)) || cmpLabel(a, b));
        phyllo(list, 0, 0, 0.95, hash01(nav.dept) * 6.2831, pos, { kind: 'node', mul: 1.25, dim: 1 });

        // kontext: sesterské oddelenia tej istej oblasti ako stmavnuté značky na okraji
        const area = dept ? S.areas.get(dept.area_id) : null;
        const sibs = dept ? areaDepts(dept.area_id).filter((d) => d.dept.id !== nav.dept) : [];
        const maxSib = Math.max(1, ...sibs.map((d) => d.count), 1);
        sibs.forEach((d, i) => {
            const th = (i / Math.max(1, sibs.length)) * Math.PI * 2 - Math.PI / 2;
            hubs.push({
                kind: 'dept', id: d.dept.id, x: Math.cos(th) * 1.03, y: Math.sin(th) * 1.03,
                count: d.count, name: d.dept.name, color: areaColor(area), dim: 0.28, rw: 0,
                maxRef: maxSib,
            });
        });

    } else {
        /* ---- UZOL: zvolený uzol v strede, rodič (oddelenie) a susedia okolo,
               sesterské uzly ako tichý kontextový prach na okraji. ---- */
        edgeMode = 'real';
        const node = S.byId.get(nav.node);
        if (node) {
            pos.set(node.id, { x: 0, y: 0, kind: 'center', mul: 2.1, dim: 1 });
            const nb = neighborRefs(node.id).map((r) => r.n);
            const nbList = nb.filter((n) => n.id !== node.id);
            const radii = nbList.length <= 13 ? [0.66]
                : (nbList.length <= 34 ? [0.46, 0.90] : [0.34, 0.66, 0.96]);
            rings(nbList, 0, 0, radii, hash01(node.id) * 6.2831, pos, { kind: 'node', mul: 1.15, dim: 1 });

            // rodič — oddelenie uzla ako značka nad ním
            const dept = node.department_id ? S.departments.get(node.department_id) : null;
            const area = S.areas.get(node.area_id);
            if (dept) {
                const cnt = deptNodes(dept.id).length;
                hubs.push({
                    kind: 'dept', id: dept.id, x: 0, y: -1.05, count: cnt,
                    name: dept.name, color: areaColor(area), dim: 0.9, rw: 0, maxRef: cnt,
                });
            } else if (area) {
                hubs.push({
                    kind: 'area', id: area.id, x: 0, y: -1.05, count: areaCount.get(area.id) || 0,
                    name: area.name, color: areaColor(area), dim: 0.9, rw: 0,
                });
            }

            // kontext: sesterské uzly (rovnaké oddelenie / oblasť), ktoré nie sú susedmi
            const inSet = new Set([...pos.keys()]);
            const sibs = (dept ? deptNodes(dept.id) : areaNodes(node.area_id))
                .filter((n) => !inSet.has(n.id));
            rings(sibs, 0, 0, [1.05], 0.21, pos, { kind: 'ctx', mul: 1, dim: 0.30 });
        }
    }

    /* ---- normalizácia: afinné natiahnutie do cieľového rámu ----
       Bbox surových pozícií (uzly + huby) sa namapuje presne na rám rx × ry.
       Tým je zaručené, že nakreslená scéna má pomer strán viewportu a fitView
       ju vyplní na oboch osiach naraz (≥ 70 % šírky na každej úrovni). */
    const box = targetBox();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };
    for (const e of pos.values()) acc(e.x, e.y);
    for (const h of hubs) acc(h.x, h.y);
    if (minX > maxX) { minX = maxX = minY = maxY = 0; }

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let hw = Math.max((maxX - minX) / 2, 1e-4), hh = Math.max((maxY - minY) / 2, 1e-4);
    let sx = box.rx / hw, sy = box.ry / hh;
    // strop anizotropie — jednorozmerné rozloženie sa nesmie roztiahnuť do absurdna
    const lo = 0.38, hi = 2.9;
    if (sx / sy > hi) sx = sy * hi;
    if (sx / sy < lo) sx = sy * lo;

    for (const e of pos.values()) { e.x = (e.x - cx) * sx; e.y = (e.y - cy) * sy; }
    for (const h of hubs) { h.x = (h.x - cx) * sx; h.y = (h.y - cy) * sy; }

    // W3a: stred scény (obraz surového bodu 0,0) a anizotropia natiahnutia. Stuhy z toho
    // počítajú oblúky po perimetri v „kruhovom" priestore — inak by ich elipsa skosila.
    const center = { x: -cx * sx, y: -cy * sy };
    const aniso = { sx, sy };

    // veľkosti hubov v svetových jednotkách (po normalizácii → rovnaká mierka ako uzly)
    const scale = (sx + sy) / 2;
    for (const h of hubs) {
        if (h.cloud) { h.crx = h.cloud * sx; h.cry = h.cloud * sy; }
        if (h.kind === 'area') {
            h.rw = hubRadius(h.count, maxAreaCount, 0.026, 0.060) * scale * (h.dim < 0.5 ? 0.55 : 1);
        } else {
            const mx = h.maxRef || Math.max(1, ...hubs.filter((q) => q.kind === 'dept').map((q) => q.count));
            h.rw = hubRadius(h.count, mx, 0.016, 0.026) * scale * (h.dim < 0.5 ? 0.6 : 1);
        }
    }

    // koncové body stúh — index hubov podľa kľúča skupiny
    const hubKey = new Map();
    for (const h of hubs) hubKey.set((h.kind === 'area' ? 'a' : 'd') + h.id, h);
    const maxRib = Math.max(1, ...ribbons.map((r) => r.count));
    ribbons = ribbons
        .map((r) => ({ from: hubKey.get(r.a), to: hubKey.get(r.b), count: r.count, t: r.count / maxRib }))
        .filter((r) => r.from && r.to && r.from.dim > 0.5 && r.to.dim > 0.5);

    // pahýle hrán von z oddelenia (kreslené na okraji, nie cez celú scénu)
    const stubs = [];
    if (showStubs) {
        const out = new Map();
        for (const e of S.edges) {
            if (!e.source || !e.target) continue;
            const si = pos.has(e.source.id), ti = pos.has(e.target.id);
            if (si === ti) continue;
            const id = si ? e.source.id : e.target.id;
            out.set(id, (out.get(id) || 0) + 1);
        }
        for (const [id, c] of out) {
            const p = pos.get(id);
            if (!p) continue;
            const d = Math.hypot(p.x, p.y) || 1;
            stubs.push({ id, ux: p.x / d, uy: p.y / d, count: c });
        }
    }

    const L = {
        sig, level: nav.level, area: nav.area, dept: nav.dept, node: nav.node,
        pos, hubs, ribbons, stubs, edgeMode, box,
        bbox: { minX: -box.rx, maxX: box.rx, minY: -box.ry, maxY: box.ry },
        scale, center, aniso,
    };
    S.layout = L;
    return L;
}

/* ---------- veľkosti a farby ---------- */

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

// Polomer, ktorým sa uzol NA TEJTO ÚROVNI reálne kreslí (LOD).
// Prach je konštantný v obrazovkových pixeloch — pri oddialení nezanikne ani nenarastie.
export function drawRadius(n, ent, invK) {
    if (!ent) return nodeRadius(n);
    if (ent.kind === 'dust') return 2.6 * invK;
    if (ent.kind === 'ctx') return 2.2 * invK;
    return nodeRadius(n) * (ent.mul || 1);
}

/* ---------- legacy kotvy (pre nové uzly z WS / chatu pred prepočtom) ---------- */

export function areaAnchor(area) {
    const L = S.layout;
    if (L) { for (const h of L.hubs) if (h.kind === 'area' && h.id === area.id) return { x: h.x, y: h.y }; }
    return {
        x: Math.cos(rad(area.angle)) * AREA_RADIUS_FALLBACK,
        y: Math.sin(rad(area.angle)) * AREA_RADIUS_FALLBACK,
    };
}

export function deptAnchor(dept) {
    const L = S.layout;
    if (L) { for (const h of L.hubs) if (h.kind === 'dept' && h.id === dept.id) return { x: h.x, y: h.y }; }
    const area = S.areas.get(dept.area_id);
    return area ? areaAnchor(area) : { x: 0, y: 0 };
}

// Kotva uzla — pozícia z aktuálneho layoutu, inak hub jeho oddelenia/oblasti.
export function anchorOf(n) {
    const L = S.layout;
    if (L) {
        const e = L.pos.get(n.id);
        if (e) return { x: e.x, y: e.y };
    }
    if (n.type === 'core') return { x: 0, y: 0 };
    if (n.department_id && S.departments.has(n.department_id)) return deptAnchor(S.departments.get(n.department_id));
    if (n.area_id && S.areas.has(n.area_id)) return areaAnchor(S.areas.get(n.area_id));
    return { x: 0, y: 0 };
}
