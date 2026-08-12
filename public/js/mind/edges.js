import { nodeVisible } from './filters.js';
import { hash01 } from './layout.js';
import { visibleInReplay } from './render.js';
import { EDGE_DIM, S, ctx } from './state.js';
import { T } from './theme.js';

// FÁZA HRANY: kategória hrany — relation má prednosť pred kind.
// manual + skill_mention (bez relation) = štruktúra → 'core' (vždy viditeľné, kostra).
export function edgeCategory(e) {
    if (e.relation === 'part_of') return 'part_of';
    if (e.relation === 'uses') return 'uses';
    if (e.kind === 'co_activation') return 'co_activation';
    if (e.kind === 'similarity') return 'similarity';
    return 'core';
}

// FÁZA HRANY: skrytá hrana? Filter kategórií vzťahov + režim kostry (len 'core' + 'part_of').
export function edgeCategoryHidden(e) {
    const cat = edgeCategory(e);
    if (S.filter.relations.has(cat)) return true;
    if (S.skeleton && cat !== 'core' && cat !== 'part_of') return true;
    return false;
}

// FÁZA DE-CLUTTER: kostrová hrana? Štruktúra (manual + skill_mention = 'core'),
// part_of a hrany posilnené opakovaním (váha > 1). Slabé auto spojenia sa v pozadí skryjú.
export function edgeSkeletal(e) {
    const cat = edgeCategory(e);
    if (cat === 'core' || cat === 'part_of') return true;
    return (e.weight || 1) > 1;
}

// Jednotný štýl čiar — max 2 vzory (plná / jemná bodkovaná).
export const EMPTY_DASH = [];
export function edgeDashed(e) {
    if (e.relation === 'part_of') return false;
    if (e.relation === 'uses') return true;
    return e.kind === 'co_activation' || e.kind === 'similarity';
}
export function edgeKindDim(e) {
    if (e.relation === 'part_of' || e.relation === 'uses') return 1;
    if (e.kind === 'co_activation') return 0.6;
    if (e.kind === 'similarity') return 0.4;
    return 1;
}

/* ---------- W3a: STUHY PO PERIMETRI (úroveň map / area) ----------
   W2a viazala stuhy dovnútra (riadiace body na 38 % cesty k stredu + posun po
   bisektore). Pri protiľahlých huboch je bisektor nulový, takže stuha išla PRIAMO
   cez stred — päť hubov tak vykreslilo zjemnený pentagram a stred vedomia mizol
   pod hviezdou. W3a to obracia: stuha je aproximácia kruhového oblúka po perimetri
   kruhu hubov, vyklenutá VON od stredu. Kompozícia sa číta ako veniec/prstenec a
   žiadna stuha stredovú zónu jadra nepretína.

   Oblúk počítame v „kruhovom" priestore (pred anizotropným natiahnutím scény), inak
   by elipsa oblúk skosila a symetria venca by sa rozpadla. */

// Ladenie vyklenutia — viď m nižšie. Base < 1 drží susedné páry pri kruhu hubov (žiadna
// veľká dekoratívna elipsa), Span oddelí vzdialené páry do druhého pásu venca a Jit
// rozostrie jednotlivé stuhy po polomere, aby sa nezliali do jednej jasnej dráhy —
// veniec má byť čitateľne PLETENÝ (n vlákien), nie jeden obeh.
export const MAP_ARC_BASE = 0.88;
export const MAP_ARC_SPAN = 0.26;
export const MAP_ARC_JIT = 0.15;

// Riadiace body kubiky, ktorá aproximuje oblúk z uhla θa do θb po perimetri.
// Pre 4 body na kružnici v uhloch 0, φ/3, 2φ/3, φ platí pre polomer stredu krivky
//   m = (2·cos(φ/2) + 6·bulge·cos(φ/6)) / 8
// → z požadovaného m vieme bulge analyticky vyjadriť (drží konštantné vyklenutie
//   bez ohľadu na to, či sú huby susedné (72°) alebo cez jeden (144°)).
function arcControls(L, a, b) {
    const c = L.center, an = L.aniso;
    if (!c || !an || !(an.sx > 1e-6) || !(an.sy > 1e-6)) return null;
    const ax = (a.x - c.x) / an.sx, ay = (a.y - c.y) / an.sy;
    const bx = (b.x - c.x) / an.sx, by = (b.y - c.y) / an.sy;
    const ra = Math.hypot(ax, ay), rb = Math.hypot(bx, by);
    if (ra < 1e-4 || rb < 1e-4) return null;           // hub priamo v strede → nechaj priamku
    const ta = Math.atan2(ay, ax);
    let d = Math.atan2(by, bx) - ta;                    // vždy kratšou cestou (|d| ≤ π)
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const phi = Math.abs(d);
    // Jitter je deterministický (hash z páru hubov) — dva reloady dajú rovnaké vlákna.
    const jit = (hash01(((a.id | 0) * 131 + (b.id | 0) * 17) | 0) - 0.5) * MAP_ARC_JIT;
    // Cieľový polomer stredu oblúka. Susedné huby (72°) vedú tesne POD kruhom hubov,
    // vzdialené (144°) tesne NAD ním — vznikne pletený veniec z dvoch pásov namiesto
    // jednej dekoratívnej elipsy, a vzdialený oblúk zreteľne obíde medziľahlý hub.
    const m = MAP_ARC_BASE + MAP_ARC_SPAN * (phi / Math.PI) + jit;
    const den = 6 * Math.cos(phi / 6);
    const bulge = den > 1e-6 ? (8 * m - 2 * Math.cos(phi / 2)) / den : m;
    const r1 = (ra * 2 + rb) / 3 * bulge, r2 = (ra + rb * 2) / 3 * bulge;
    const t1 = ta + d / 3, t2 = ta + (d * 2) / 3;
    return {
        c1x: c.x + Math.cos(t1) * r1 * an.sx, c1y: c.y + Math.sin(t1) * r1 * an.sy,
        c2x: c.x + Math.cos(t2) * r2 * an.sx, c2y: c.y + Math.sin(t2) * r2 * an.sy,
    };
}

export function drawRibbons(L) {
    if (!L.ribbons.length) return;
    const invK = 1 / S.cam.k;
    const maxRib = Math.max(1, ...L.ribbons.map((r) => r.count));
    const lg = Math.log2(1 + maxRib);
    ctx.setLineDash(EMPTY_DASH);
    ctx.lineCap = 'round';
    // od najslabšej po najsilnejšiu, nech tie hlavné ostanú navrchu
    const sorted = L.ribbons.slice().sort((a, b) => a.count - b.count).slice(-64);
    for (const r of sorted) {
        const t = Math.log2(1 + r.count) / lg;
        const a = r.from, b = r.to;
        // W3a: stuhy sú kontext, nie hlavný motív — po presune na perimeter sa desiatka
        // oblúkov prekrývala do jednej jasnej dráhy, ktorá prekričala huby aj prach.
        // Tenšie a jemnejšie: veniec sa dá prečítať, ale nedominuje kompozícii.
        ctx.lineWidth = (0.7 + 3.4 * t) * invK;
        ctx.globalAlpha = (0.028 + 0.052 * t) * S.dim * S.opts.edgeAlpha;
        ctx.strokeStyle = 'rgb(' + T.edge + ')';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        const cc = arcControls(L, a, b);
        if (cc) ctx.bezierCurveTo(cc.c1x, cc.c1y, cc.c2x, cc.c2y, b.x, b.y);
        else ctx.lineTo(b.x, b.y);
        ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
}

/* ---------- W2a: PAHÝLE (úroveň dept) ----------
   Hrana vedúca VON z oddelenia sa nekreslí cez celú scénu — uzol dostane krátky
   pahýľ smerom od stredu, ktorého dĺžka nesie počet vonkajších spojení. */
export function drawStubs(L) {
    if (!L.stubs.length) return;
    const invK = 1 / S.cam.k;
    ctx.setLineDash(EMPTY_DASH);
    ctx.lineWidth = 0.9 * invK;
    ctx.strokeStyle = 'rgb(' + T.edge + ')';
    ctx.globalAlpha = 0.30 * S.dim * S.opts.edgeAlpha;
    ctx.beginPath();
    for (const s of L.stubs) {
        const p = L.pos.get(s.id);
        if (!p) continue;
        const n = S.byId.get(s.id);
        if (!n || !nodeVisible(n, null) || !visibleInReplay(n)) continue;
        const r0 = 9 * invK;
        const len = (7 + 5 * Math.log2(1 + s.count)) * invK;
        ctx.moveTo(p.x + s.ux * r0, p.y + s.uy * r0);
        ctx.lineTo(p.x + s.ux * (r0 + len), p.y + s.uy * (r0 + len));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
}

/* ---------- W2a: REÁLNE HRANY (úroveň dept / node) ----------
   Kreslia sa len hrany, ktorých OBA konce sú v layoute aktuálnej úrovne. Dávkovo
   po vedierkach (dashed × kvantovaná alfa), zvýraznené incidentné hrany navrchu. */
export function drawEdges(L, loc, hl, hlAnchor, softHoverActive, edgeInView) {
    if (L.edgeMode !== 'real') return;
    const invK = 1 / S.cam.k;
    const dash = [1.5 * invK, 3 * invK];
    const buckets = new Map();
    const fg = [];
    const showAllBg = !!loc || L.level === 'node' || L.pos.size <= 60;

    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        const pa = L.pos.get(e.source.id), pb = L.pos.get(e.target.id);
        if (!pa || !pb) continue;                          // aspoň jeden konec je mimo úrovne
        if (pa.dim < 0.5 || pb.dim < 0.5) continue;        // kontextový prach hrany nekreslí
        if ((e.weight || 1) < S.minWeight) continue;
        if (edgeCategoryHidden(e)) continue;
        if (!visibleInReplay(e.source) || !visibleInReplay(e.target)) continue;
        if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
        if (!edgeInView(e.source, e.target)) continue;

        const dashed = edgeDashed(e);
        // Na úrovni oddelenia/uzla sú reálne hrany hlavným nosičom informácie — preto
        // vyššia základná alfa než mala stará hairball mapa (a bez plošného stlmenia).
        let alpha = Math.min(0.62, 0.34 + 0.10 * Math.log2(1 + (e.weight || 1))) * S.opts.edgeAlpha;
        alpha = Math.max(0.18, alpha) * EDGE_DIM * edgeKindDim(e) * S.dim;

        const incident = !!(hlAnchor && (e.source.id === hlAnchor.id || e.target.id === hlAnchor.id));
        if (hl && !incident) alpha *= 0.22;
        alpha = Math.max(hl && !incident ? T.edgeFloor * 0.5 : alpha, alpha);

        if (incident) {
            fg.push({
                e, alpha: Math.min(0.8, alpha * 2.4), dashed,
                width: Math.min(1.9, 0.55 + 0.3 * Math.log2(1 + (e.weight || 1))) * invK,
            });
            continue;
        }

        if (!showAllBg && !edgeSkeletal(e)) continue;
        if (softHoverActive) alpha *= 0.82;
        if (alpha < 0.03) continue;
        const q = Math.max(1, Math.round(alpha / 0.05));
        const key = (dashed ? 1000 : 0) + q;
        let b = buckets.get(key);
        if (!b) { b = { dashed, alpha: q * 0.05, path: new Path2D() }; buckets.set(key, b); }
        b.path.moveTo(e.source.x, e.source.y);
        b.path.lineTo(e.target.x, e.target.y);
    }

    ctx.lineWidth = 0.75 * invK;
    for (const b of buckets.values()) {
        ctx.setLineDash(b.dashed ? dash : EMPTY_DASH);
        ctx.strokeStyle = 'rgb(' + T.edge + ')';
        ctx.globalAlpha = b.alpha;
        ctx.stroke(b.path);
    }
    ctx.globalAlpha = 1;

    for (const f of fg) {
        ctx.setLineDash(f.dashed ? dash : EMPTY_DASH);
        ctx.lineWidth = f.width;
        ctx.strokeStyle = 'rgba(' + T.accent + ',' + f.alpha + ')';
        ctx.beginPath();
        ctx.moveTo(f.e.source.x, f.e.source.y);
        ctx.lineTo(f.e.target.x, f.e.target.y);
        ctx.stroke();
    }
    ctx.setLineDash(EMPTY_DASH);
    ctx.globalAlpha = 1;
}
