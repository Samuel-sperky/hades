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

/* ---------- GRAF B: SIEŤ HRÁN NA VŠETKÝCH ÚROVNIACH ----------
   Predtým sa reálne hrany kreslili len na úrovni dept/node; na mape ich zastupovalo
   5×5 agregovaných stúh a jednotlivé spojenia neboli vidieť VÔBEC. To bola hlavná
   výčitka referenčnému porovnaniu — na referencii je práve tá jemná svetlá sieť tým,
   čo z bodového oblaku robí „neurónovú sieť".

   Teraz existujú dva režimy tej istej funkcie, prepínané HUSTOTOU scény:
     mesh (nad ~140 uzlami) — VŠETKY hrany, ktorých oba konce sú v layoute, ako
        vlásková textúra. Čitateľnosť nesie HUSTOTA, nie jednotlivá čiara: preto veľmi
        nízka alfa (T.meshA0..meshA1 podľa váhy) a šírka 0,7 px. Pri oddialení sa alfa
        ešte zníži (meshFade) — inak by sa 2000 čiar na malej ploche zlialo do sivej
        vaty, čo je presne druhá výčitka. Utlmiť áno, SKRYŤ nikdy.
     real (pod ~140 uzlami, alebo lokálny graf) — hrán je málo a nesú informáciu,
        takže vyššia alfa, prerušované vzory pre typy vzťahov a plný kontrast.

   Vedierkovanie (dashed × kvantovaná alfa → jeden Path2D) drží počet stroke() volaní
   na desiatkach aj pri 2000 hranách (draw() beží 2–3 ms pri 1060 uzloch). */

// Alfa mesh hrany podľa váhy — normalizovaná na log škále, aby jedna ťažká hrana
// nezhodila celý zvyšok siete do neviditeľna.
const MESH_W_REF = 3.2;   // log2(1+w) referenčný strop (w ≈ 8,6 je maximum v dátach)

// Zoslabenie siete pri oddialení. k ≤ 0,18 (celá sieť) → 0,72; k ≥ 0,9 → 1.
function meshFade(k) {
    const t = Math.min(1, Math.max(0, (k - 0.18) / 0.72));
    return 0.72 + 0.28 * t;
}

export function drawEdges(L, loc, hl, hlAnchor, softHoverActive, edgeInView) {
    // O režime NEROZHODUJE L.edgeMode — vlna A ho zjednotila na 'real' pre všetky
    // úrovne — ale HUSTOTA scény. Nad ~140 uzlami je jedna hrana beztak nečitateľná
    // ako jednotlivosť a musí sa chovať ako textúra; pod tým je hrán málo a každá
    // nesie informáciu sama za seba.
    const dense = !loc && L.pos.size > 140;
    const real = !dense;
    const invK = 1 / S.cam.k;
    const dash = [1.5 * invK, 3 * invK];
    const buckets = new Map();
    const fg = [];
    const showAllBg = !!loc || L.level === 'node' || L.pos.size <= 60;
    const fade = real ? 1 : meshFade(S.cam.k);
    const qStep = real ? 0.05 : 0.012;          // mesh potrebuje jemnejšie kvantovanie
    const minA = real ? 0.03 : 0.006;

    for (const e of S.edges) {
        if (!e.source || !e.target) continue;
        const pa = L.pos.get(e.source.id), pb = L.pos.get(e.target.id);
        if (!pa || !pb) continue;                          // aspoň jeden konec nie je v layoute
        // Kontextová hrana sa STLMÍ, nezmizne. Kým bolo zanorenie prepínanie scén,
        // stmavnutý zvyšok grafu v layoute vôbec nebol a `continue` bol správny. Teraz
        // je zanorenie FILTER: fokus zostane plný, zvyšok siete klesne na DIM_CTX —
        // a `continue` by mu zobral všetky hrany, takže by z kontextu zostali holé
        // prstence. To je presne to „zmiznutie siete", ktoré používateľ kritizoval.
        const dimCtx = Math.min(pa.dim == null ? 1 : pa.dim, pb.dim == null ? 1 : pb.dim);
        if ((e.weight || 1) < S.minWeight) continue;
        if (edgeCategoryHidden(e)) continue;
        if (!visibleInReplay(e.source) || !visibleInReplay(e.target)) continue;
        if (!(nodeVisible(e.source, loc) && nodeVisible(e.target, loc))) continue;
        if (!edgeInView(e.source, e.target)) continue;

        // v mesh režime nekreslíme prerušované vzory — pri 0,7 px a ~8 % alfy sa dash
        // číta ako šum a rozbije dojem spojitej siete
        const dashed = real && edgeDashed(e);
        const wt = Math.min(1, Math.log2(1 + (e.weight || 1)) / MESH_W_REF);
        let alpha;
        if (real) {
            // Na úrovni oddelenia/uzla sú reálne hrany hlavným nosičom informácie — preto
            // vyššia základná alfa než mala stará hairball mapa (a bez plošného stlmenia).
            alpha = Math.min(0.62, 0.34 + 0.10 * Math.log2(1 + (e.weight || 1))) * S.opts.edgeAlpha;
            alpha = Math.max(0.18, alpha) * EDGE_DIM * edgeKindDim(e) * S.dim;
        } else {
            alpha = (T.meshA0 + (T.meshA1 - T.meshA0) * wt)
                * S.opts.edgeAlpha * edgeKindDim(e) * S.dim * fade;
        }
        alpha *= dimCtx;

        const incident = !!(hlAnchor && (e.source.id === hlAnchor.id || e.target.id === hlAnchor.id));
        if (hl && !incident) alpha *= 0.22;
        alpha = Math.max(hl && !incident ? T.edgeFloor * 0.5 : alpha, alpha);

        if (incident) {
            // Incidentná hrana je JEDINÝ stav, v ktorom má jedna čiara nesť informáciu
            // sama za seba — preto ide na akcentnú farbu a nad prah 3:1 (WCAG 1.4.11).
            // T.hotA je kalibrovaná podlaha alfy; šírka má podlahu 1,5 px, pretože
            // tenšia čiara stratí v antialiasingu polovicu kontrastu (merané).
            fg.push({
                e, alpha: Math.max(T.hotA, Math.min(0.9, alpha * (real ? 2.4 : 9))),
                dashed,
                width: Math.max(1.5, Math.min(2.4, 1.0 + 0.5 * Math.log2(1 + (e.weight || 1)))) * invK,
            });
            continue;
        }

        if (real && !showAllBg && !edgeSkeletal(e)) continue;
        if (softHoverActive) alpha *= real ? 0.82 : 0.90;
        if (alpha < minA) continue;
        const q = Math.max(1, Math.round(alpha / qStep));
        const key = (dashed ? 1000 : 0) + q;
        let b = buckets.get(key);
        if (!b) { b = { dashed, alpha: q * qStep, path: new Path2D() }; buckets.set(key, b); }
        b.path.moveTo(e.source.x, e.source.y);
        b.path.lineTo(e.target.x, e.target.y);
    }

    // Vlásková šírka je konštantná v OBRAZOVKOVÝCH pixeloch — sieť tak pri zoome
    // nezhrubne na pásy a pri oddialení nezmizne pod 1/10 pixela.
    ctx.lineWidth = (real ? 0.75 : 0.70) * invK;
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
