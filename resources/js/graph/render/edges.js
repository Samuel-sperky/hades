import { S } from '../../core/state/index.js';
import { T } from '../canvas-colors.js';
import { ctx } from '../canvas-el.js';
import { EDGE_DIM } from '../colors.js';
import { nodeVisible } from '../filters.js';
import { focusPass } from '../focus.js';
import { LAYER_X } from '../layers.js';
import { visibleInReplay } from '../timeline.js';


// pathNodes (voliteľné, len Vrstvy): uzly na vrstvovej ceste sa netlmia ako cudzie
export function nodeAlphaMul(n, hl, pathNodes) {
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
export function edgeCategoryHidden(e) {
    const cat = edgeCategory(e);
    if (S.filter.relations.has(cat)) return true;
    if (S.skeleton && cat !== 'core' && cat !== 'part_of') return true;
    return false;
}


// FÁZA DE-CLUTTER: kostrová hrana? V pokoji sa kreslí len kostra — štruktúra (manual +
// skill_mention = 'core'), part_of a hrany posilnené opakovaním (váha > 1). Slabé auto
// spojenia (uses / co_activation / similarity s váhou 1 = 82 % hairballu) sa v pozadí skryjú;
// vynoria sa až ako incidentné hrany uzla pod kurzorom (fg vetva v drawEdges).
export function edgeSkeletal(e) {
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
export function drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, layersView, edgeInView) {
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
