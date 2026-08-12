import { nodeVisible } from './filters.js';
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

/* ---------- W2a: AGREGOVANÉ ZVIAZANÉ STUHY (úroveň map / area) ----------
   Namiesto 2779 jednotlivých hrán kreslíme pár desiatok stúh medzi skupinami.
   Šírka = počet hrán medzi skupinami, riadiaci bod je pritiahnutý k stredu scény
   (edge bundling), takže stuhy nevytvárajú šedú vatu cez celú plochu. */
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
        // hierarchické zviazanie: stuha sa zvezie k jadru scény a vyjde k druhému hubu.
        // Posun po bisektore drží zväzok mimo samotného jadra (nekreslíme cez ♛).
        const la = Math.hypot(a.x, a.y) || 1, lb = Math.hypot(b.x, b.y) || 1;
        let bx = a.x / la + b.x / lb, by = a.y / la + b.y / lb;
        const lbis = Math.hypot(bx, by);
        if (lbis > 1e-3) { bx /= lbis; by /= lbis; } else { bx = 0; by = 0; }
        const off = 0.26 * (la + lb) / 2;
        ctx.lineWidth = (0.9 + 6.5 * t) * invK;
        ctx.globalAlpha = (0.035 + 0.085 * t) * S.dim * S.opts.edgeAlpha;
        ctx.strokeStyle = 'rgb(' + T.edge + ')';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(a.x * 0.38 + bx * off, a.y * 0.38 + by * off,
            b.x * 0.38 + bx * off, b.y * 0.38 + by * off, b.x, b.y);
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
