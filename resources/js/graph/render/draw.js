import { truncLabel } from '../../core/format.js';
import { REDUCED_MOTION } from '../../core/motion.js';
import { S } from '../../core/state/index.js';
import { areaAnchor } from '../anchors.js';
import { birthScale, breatheFactor } from '../animation.js';
import { isAwake } from '../awake.js';
import { screenToWorld } from '../camera.js';
import { T } from '../canvas-colors.js';
import { ctx } from '../canvas-el.js';
import { nodeColor } from '../colors.js';
import { filterActive, nodeVisible } from '../filters.js';
import { highlightSet, layerPathSet } from '../focus.js';
import { nodeRadius } from '../geometry.js';
import { layerLayout } from '../layers.js';
import { localSet } from '../local.js';
import { drawEdges, nodeAlphaMul } from './edges.js';
import { drawLayerBands, drawLayerScaffold } from './layers-draw.js';
import { drawShape } from './shapes.js';
import { visibleInReplay } from '../timeline.js';
import { K_DETAIL, labelFade } from './zoom.js';


export function draw() {
    const targetDim = isAwake() ? 1 : 0.5;
    S.dim += (targetDim - S.dim) * 0.02;
    // FÁZA RENDER PIPELINE: epsilon-snap útlmu — nech sa stav označí za ustálený a slučka usne
    if (Math.abs(targetDim - S.dim) < 0.001) S.dim = targetDim;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    // FÁZA RENDER PIPELINE: viewport culling — svetové hranice viditeľnej plochy + okraj.
    // Uzly, hrany aj popisky mimo tohto rámca sa vôbec nekreslia. Okraj pokryje polomer + popisky.
    const _vTL = screenToWorld(0, 0);
    const _vBR = screenToWorld(S.w, S.h);
    const VM = 140 / S.cam.k;
    const vpX0 = _vTL.x - VM, vpY0 = _vTL.y - VM, vpX1 = _vBR.x + VM, vpY1 = _vBR.y + VM;
    const inView = (x, y) => x >= vpX0 && x <= vpX1 && y >= vpY0 && y <= vpY1;
    // hrana v zábere? bbox koncov pretína viewport (nezahodí hranu prechádzajúcu cez plochu)
    const edgeInView = (a, b) => !(Math.max(a.x, b.x) < vpX0 || Math.min(a.x, b.x) > vpX1
        || Math.max(a.y, b.y) < vpY0 || Math.min(a.y, b.y) > vpY1);
    // FÁZA ANIMÁCIE (Living): zapamätaj svetové hranice viewportu pre cielenie spontánnych synapsií.
    S._vp = { x0: vpX0, y0: vpY0, x1: vpX1, y1: vpY1 };
    // kurzor v svetových súradniciach (raz za frame) — podklad pre gravitáciu/parallax uzlov
    const cursorWorld = (S._life > 0 && S.cursor.a > 0.01) ? screenToWorld(S.cursor.sx, S.cursor.sy) : null;

    const hl = highlightSet();
    const hlAnchor = S.hover || S.selected;
    // lokálny graf: členovia BFS množiny sa kreslia, ostatné sa úplne preskočia
    const loc = localSet();

    const layersView = S.view === 'layers';
    // vrstvová cesta cez layery (2-skoky VON) — len v náhľade Vrstvy; inde null (staré správanie)
    const pathEdges = layersView ? layerPathSet(hlAnchor) : null;
    const pathNodes = layersView ? S._lpNodes : null;
    // FÁZA HRANY: soft-hover — v pokoji (žiadny hover/fokus/local) sú hrany extra jemné (×0.35),
    // spojenia sa vynoria až keď je uzol pod kurzorom / vo fokuse.
    const softHoverActive = S.opts.edgeSoftHover && !hlAnchor && !S.focus.areaId && !loc;
    const bgLevel = layersView ? 0 : S.opts.bg;
    if (bgLevel > 0.01) {
        const invK = 1 / S.cam.k;

        // jemna technicka mriezka (world-space, hyba sa so sietou) — jedine pozadie
        // rozsah z viditelneho viewportu, start zarovnany na nasobok kroku
        const _step = 240;
        const _tl = screenToWorld(0, 0);
        const _br = screenToWorld(S.w, S.h);
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + T.gridColor + ',' + (T.gridAlpha * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = Math.floor(_tl.x / _step) * _step; gx <= _br.x; gx += _step) { ctx.moveTo(gx, _tl.y); ctx.lineTo(gx, _br.y); }
        for (let gy = Math.floor(_tl.y / _step) * _step; gy <= _br.y; gy += _step) { ctx.moveTo(_tl.x, gy); ctx.lineTo(_br.x, gy); }
        ctx.stroke();
    }

    if (S.view === 'map') {
        // bbox uzlov kazdej oblasti — label centrovany nad vrcholom klastra
        const areaBox = new Map();
        for (const n of S.nodes) {
            if (n.type === 'core' || !n.area_id || !visibleInReplay(n)) continue;
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
        ctx.font = '600 ' + (12.5 / S.cam.k) + 'px "Geist Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        for (const area of S.areas.values()) {
            const b = areaBox.get(area.id);
            if (!loc && S.filter.areas.has(area.id)) continue; // skrytá oblasť — bez captionu
            if (!b && (loc || filterActive())) continue; // žiadne viditeľné uzly — bez labelu
            const a = areaAnchor(area);
            ctx.fillText(area.name.toUpperCase(), b ? (b.minX + b.maxX) / 2 : a.x, (b ? b.minY : a.y) - 36);
        }
        ctx.globalAlpha = 1;
    }

    if (layersView) {
        // (1) pozadie: vodiace línie sub-stĺpcov + farebné pásy oblastí (nahradilo O(n²) mriežku)
        const lay = layerLayout();
        drawLayerBands(lay);
        // (2) skutočné spojenia zo S.edges — dávkovo (rovnaké váhové štýlovanie ako mapa/sieť)
        drawEdges(loc, hl, hlAnchor, pathEdges, softHoverActive, true, edgeInView);
        drawLayerScaffold(lay);
    } else {
        drawEdges(loc, hl, hlAnchor, null, softHoverActive, false, edgeInView);
    }

    ctx.globalCompositeOperation = 'source-over';

    for (const p of S.pulses) {
        if (!(nodeVisible(p.from, loc) && nodeVisible(p.to, loc))) continue;
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    // FÁZA ANIMÁCIE: putujúce svetlobody po hranách (Q10) — malý bod, fade na koncoch.
    // Kreslené priamočiaro (aj v layers), jemné; alfa nesie anim intenzitu.
    const _flowI = Math.max(S._anim, S._life); // toky nesie buď udalostná animácia, alebo ambientný život
    if (_flowI > 0 && S._flows.length) {
        const fr = 3 / S.cam.k;
        for (const f of S._flows) {
            if (f.wait > 0) continue;
            if (!(nodeVisible(f.from, loc) && nodeVisible(f.to, loc))) continue;
            const x = f.from.x + (f.to.x - f.from.x) * f.t;
            const y = f.from.y + (f.to.y - f.from.y) * f.t;
            const a = Math.min(0.7, 0.6 * f.dim * Math.min(1.2, _flowI)) * Math.sin(Math.PI * Math.min(f.t, 1));
            if (a < 0.02) continue;
            ctx.globalAlpha = a;
            ctx.fillStyle = f.tone === 'ink' ? 'rgb(' + T.edge + ')'
                : f.tone === 'accent' ? 'rgb(' + T.accent + ')' : f.tone;
            ctx.beginPath();
            ctx.arc(x, y, fr, 0, 7);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    ctx.globalCompositeOperation = 'source-over';
    // FÁZA RENDER PIPELINE: pri oddialení (k<K_DETAIL) sú uzly jednoduché plné disky — bez ink obrysu,
    // heat/zrod prstenca a bez donut diery/prstenca v drawShape (detail je aj tak neviditeľný).
    const simpleNodes = S.cam.k < K_DETAIL;
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        if (!inView(n.x, n.y)) continue; // viewport culling
        let r = layersView ? Math.max(6, nodeRadius(n)) * 0.9 : nodeRadius(n);
        if (S.hover === n) r *= 1.15; // hover zväčšenie (Obsidian)
        r *= breatheFactor(n) * birthScale(n); // FÁZA ANIMÁCIE: idle dýchanie + zrod uzla
        // FÁZA ANIMÁCIE: jemný pop pri dobehnutí pulzu/toku (v mape/sieti; layers rieši flash vlastnou alfou)
        if (!layersView && n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
        const color = nodeColor(n);
        const flash = layersView ? (n.flash || 0) : 0;
        const mul = nodeAlphaMul(n, hl, pathNodes);

        // FÁZA ANIMÁCIE (Living): vizuálny offset — drift („sieť pláva") + kurzorová gravitácia/parallax.
        // Len pri kreslení; pick()/hover čítajú n.x/n.y, takže presnosť výberu ostáva nedotknutá.
        // Pinned Vrstvy sa neposúvajú (deterministický layout). n._ox/_oy číta aj slučka popiskov.
        let ox = 0, oy = 0, gGlow = 0;
        if (S._life > 0 && !simpleNodes && !layersView) {
            const lf = Math.min(1.4, S._life);
            if (S._lifeTier === 0 && n.type !== 'core') {
                ox += Math.sin(S._clock * 0.6 + n.id * 1.7) * lf;   // ±~1 px mikro-drift (nekumulatívny)
                oy += Math.cos(S._clock * 0.5 + n.id * 2.3) * lf;
            }
            if (cursorWorld && S._lifeTier <= 1) {
                const dx = cursorWorld.x - n.x, dy = cursorWorld.y - n.y;
                const dd = Math.hypot(dx, dy);
                const R = 140 / S.cam.k;
                if (dd < R && dd > 0.001) {
                    const ff = 1 - dd / R;
                    const pull = ff * ff * (6 / S.cam.k) * S.cursor.a * (S._lifeTier === 1 ? 0.5 : 1);
                    ox += (dx / dd) * pull; oy += (dy / dd) * pull; // max ~6 px prihnutie ku kurzoru
                    gGlow = ff * S.cursor.a;                        // blízkosť kurzora uzol mierne rozsvieti
                }
            }
        }
        n._ox = ox; n._oy = oy;
        const px = n.x + ox, py = n.y + oy;

        // FÁZA DE-CLUTTER: bez teplotnej modulácie výplne (heat je konštanta 1, nenesie info).
        // Plná alfa, tlmí sa len highlight/focus násobičom; vo Vrstvách flash pridá jas.
        ctx.globalAlpha = Math.min(1, (layersView ? 0.9 + flash * 0.5 : 1)) * mul;
        drawShape(n, px, py, r, color, simpleNodes);

        if (simpleNodes) { if (n.flash) n.flash = Math.max(0, n.flash - 0.02); continue; } // lacný disk, žiadne prstence

        // FÁZA ANIMÁCIE (Living): ŽIARA — nedávno aktívne uzly (flash) jemne pulzujú teal, uzol pri
        // kurzore sa prisvieti. Beží aj pri REDUCED_MOTION (flash je statický event pulz, gGlow=0).
        const glowA = Math.max((n.flash || 0) * (0.55 + 0.45 * Math.sin(S._clock * 6 + n.id)), gGlow * 0.6);
        if (glowA > 0.03) {
            ctx.globalAlpha = Math.min(0.55, glowA) * mul;
            ctx.lineWidth = 1.4 / S.cam.k;
            ctx.strokeStyle = 'rgb(' + T.accent + ')';
            ctx.beginPath();
            ctx.arc(px, py, r + 3 / S.cam.k, 0, 7);
            ctx.stroke();
        }

        // FÁZA ANIMÁCIE (Q13): zrod uzla — krátky rozpínavý prstenec, ktorý dobehne a zmizne
        if (n._born != null) {
            const age = S._clock - n._born;
            if (age < 0.6 && S._anim > 0 && !REDUCED_MOTION) {
                const p = age / 0.6;
                ctx.globalAlpha = (1 - p) * 0.6 * mul;
                ctx.lineWidth = 1.4 / S.cam.k;
                ctx.strokeStyle = 'rgb(' + T.accent + ')';
                ctx.beginPath();
                ctx.arc(px, py, r + (3 + p * 14) / S.cam.k, 0, 7);
                ctx.stroke();
            } else if (age >= 0.6) {
                n._born = null; // zrod dobehol — vyčisti časovač
            }
        }

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }
    ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'source-over';

    // zoom fade rampa (Obsidian): labely sa vynárajú medzi K_LABEL_FADE_FROM a _TO;
    // hover/select kotva + jej susedia (highlightSet) ostávajú viditeľní vždy
    const zoomFade = labelFade(S.cam.k);
    const showLabels = zoomFade > 0 && S.opts.labelAlpha > 0.02;
    const baseLabelAlpha = Math.min(1, S.opts.labelAlpha);
    const candidates = [];
    for (const n of S.nodes) {
        if (!visibleInReplay(n)) continue;
        if (!nodeVisible(n, loc)) continue;
        if (!inView(n.x, n.y)) continue; // viewport culling — popisky mimo záberu preskoč
        const isHover = S.hover === n || S.selected === n;
        const inHl = !!(hl && hl.has(n.id)) || !!(pathNodes && pathNodes.has(n.id));
        if (!showLabels && !isHover && !inHl) continue;
        const alpha = baseLabelAlpha * nodeAlphaMul(n, hl, pathNodes) * (isHover || inHl ? 1 : zoomFade);
        // pod prahom čitateľnosti: nekresliť ani nerezervovať obdĺžnik
        if (alpha < 0.12) continue;
        candidates.push({ n, isHover, alpha });
    }
    // FÁZA DE-CLUTTER: stabilita popiskov — hover vždy prvý, potom už-zobrazené popisky (držia
    // si slot pri miernom pohybe, nebliká), potom čitateľnosť (alfa) a stupeň uzla. Mŕtva
    // strength nahradená degree. S._labelShown = množina id vykreslených minulý frame.
    const shown = S._labelShown || (S._labelShown = new Set());
    candidates.sort((a, b) =>
        (b.isHover - a.isHover)
        || ((shown.has(b.n.id) ? 1 : 0) - (shown.has(a.n.id) ? 1 : 0))
        || (b.alpha - a.alpha)
        || ((S.degree.get(b.n.id) || 0) - (S.degree.get(a.n.id) || 0)));

    const fontSize = (12 * S.opts.labelSize) / S.cam.k;
    const taken = [];
    const newShown = new Set();
    ctx.textAlign = 'center';
    // FÁZA RENDER PIPELINE: font raz pred slučkou (jedna váha/veľkosť) — hover sa odlíši
    // papierovým podkladom a plnou alfou, nie tučným rezom, takže font sa nemusí prepisovať.
    ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';
    for (const { n, isHover, alpha } of candidates) {
        const label = truncLabel(n.label);
        const w = ctx.measureText(label).width;
        // FÁZA ANIMÁCIE (Living): popisok sleduje vizuálny offset uzla (drift/gravitácia), nech nedrifuje od bodu
        const nx = n.x + (n._ox || 0), ny = n.y + (n._oy || 0);
        // label centrovaný POD uzlom — baseline r + 13/k, hover počíta so zväčšením
        const y = ny + nodeRadius(n) * (S.hover === n ? 1.15 : 1) + 13 / S.cam.k;
        const rect = { x: nx - w / 2, y: y - fontSize, w, h: fontSize * 1.4 };

        const collides = taken.some((t) =>
            rect.x < t.x + t.w && t.x < rect.x + rect.w
            && rect.y < t.y + t.h && t.y < rect.y + rect.h);
        if (collides && !isHover) continue;
        taken.push(rect);
        newShown.add(n.id);

        // FÁZA RENDER PIPELINE: žiadne strokeText halo (bolo ~44% času draw()). Bežné popisky
        // sa spoliehajú na de-clutter (drop-on-collision); hover/vybraný dostane jemný papierový podklad.
        if (isHover) {
            const px = 5 / S.cam.k, py = 3 / S.cam.k;
            ctx.globalAlpha = alpha * 0.82;
            ctx.fillStyle = T.paper;
            ctx.fillRect(rect.x - px, rect.y - py, rect.w + 2 * px, rect.h + 2 * py);
        }
        // alfa nesie zoom fade aj highlight/focus tlmenie
        ctx.globalAlpha = alpha;
        ctx.fillStyle = T.ink;
        ctx.fillText(label, nx, y);
    }
    S._labelShown = newShown; // FÁZA DE-CLUTTER: zapamätaj vykreslené popisky pre stabilitu
    ctx.globalAlpha = 1;
}
