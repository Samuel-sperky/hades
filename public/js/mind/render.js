import { animLevel, birthScale, breatheFactor, easeInOut, flowCap, lifeLevel, lifeTier, maybeSynapse } from './anim.js';
import { drawEdges } from './edges.js';
import { filterActive, localSet, nodeVisible } from './filters.js';
import { nodeAlphaMul } from './forces.js';
import { screenToWorld } from './interaction.js';
import { areaAnchor, drawLayerBands, drawLayerScaffold, layerLayout, nodeRadius } from './layout.js';
import { REDUCED_MOTION, S, canvas, ctx } from './state.js';
import { T, certColors } from './theme.js';
import { stopReplay, updateTimelineLabel } from './timeline.js';
import { highlightSet, isAwake, layerPathSet, nodeColor, now, syncSlider, ts, updateStateUi } from './util.js';

/* ---------- render ---------- */

export function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    canvas.width = S.w * S.dpr;
    canvas.height = S.h * S.dpr;
    canvas.style.width = S.w + 'px';
    canvas.style.height = S.h + 'px';
}

// Časticový systém odstránený — žiadna hmla na papieri. No-op kvôli existujúcim volaniam.
export function makeStars() {
    S.stars = [];
}

export function visibleInReplay(n) {
    if (!S.replay.on) return true;
    const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    return n.type === 'core' || ts(n.created_at) <= cutoff;
}

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
    // FÁZA RENDER PIPELINE: pri oddialení (k<0.5) sú uzly jednoduché plné disky — bez ink obrysu,
    // heat/zrod prstenca a bez donut diery/prstenca v drawShape (detail je aj tak neviditeľný).
    const simpleNodes = S.cam.k < 0.5;
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

    // zoom fade rampa (Obsidian): labely sa vynárajú medzi k 0.42 a 0.64;
    // hover/select kotva + jej susedia (highlightSet) ostávajú viditeľní vždy
    const zoomFade = Math.min(1, Math.max(0, (S.cam.k - 0.42) / 0.22));
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

// Skrátenie labelu LEN pri kreslení (hover-card a panel používajú n.label v plnej dĺžke)
export function truncLabel(s) {
    const chars = Array.from(String(s)); // mb-safe (surrogate pairs)
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : s;
}
// FÁZA CERTAINTY (F4, §4.6): mapovanie istoty → štýl prstenca (CVD-safe double-encoding).
// overené = plný prstenec, hypotéza = čiarkovaný, pasca = plný + výstražný pip.
// bez/null → žiadny prstenec. Hue istotu NEkóduje (kolízia s farbou oblasti/typu).
export const CERT_RING = { overene: 'solid', hypoteza: 'dashed', pasca: 'pip' };
// FÁZA DE-CLUTTER: uzol = biela/papierová výplň + farebný prstenec vo farbe oblasti (vzdušné,
// nie plná farebná placka). Jadro ostáva zlaté a výrazné (plná zlatá výplň + zlatý prstenec).
// Typ uzla sa rozlíši JEMNE cez hrúbku/štýl prstenca, NIE plnou farbou: spomienka tenký prstenec,
// skill hrubší (plný disk, žiadna donut diera), projekt prstenec + tiché vonkajšie echo.
export function drawShape(n, x, y, r, color, simple) {
    const k = S.cam.k;

    if (simple) {
        // FÁZA RENDER PIPELINE: oddialené (k<0.5) — plný farebný disk (papierový prstenec by zanikol)
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        return;
    }

    const a = ctx.globalAlpha;

    if (n.type === 'core') {
        // jadro ostáva výrazné — plná zlatá výplň + zlatý sústredný prstenec
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 7);
        ctx.fill();
        ctx.globalAlpha = a * 0.4;
        ctx.lineWidth = Math.max(1, 1.1 / k);
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.55, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
        return;
    }

    // papierová výplň — telo uzla splynie s papierom, ostane čistý farebný prstenec
    ctx.fillStyle = T.paper;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();

    // farebný prstenec (obrys) — hrúbka podľa typu; kreslený dovnútra, nech r ostáva polomer uzla
    const lw = n.type === 'skill' ? 2.4 / k : 1.6 / k;
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r - lw * 0.5), 0, 7);
    ctx.stroke();

    if (n.type === 'project') {
        // tiché vonkajšie echo — odlíši projekt (bez plnej farby)
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1.1 / k;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5 / k, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }

    // FÁZA CERTAINTY (F4, §4.6): značky istoty + brain-origin rim — LEN nad zoom prahom
    // k>0.8 (v hustom oddialenom grafe by pridávali šum). Subtílne, dvojkanálové, CVD-safe.
    if (k > 0.8) {
        const cc = certColors();

        // brain-origin uzly: jemný vnútorný rim (--border-strong) — ľudsky-písané „mozgy"
        // sa nenápadne odlíšia od session uzlov (nezávisí od prepínača istoty).
        if (n.origin === 'brain') {
            ctx.globalAlpha = a * 0.45;
            ctx.lineWidth = 1 / k;
            ctx.strokeStyle = cc.borderStrong;
            ctx.beginPath();
            ctx.arc(x, y, Math.max(0.5, r - lw - 1.2 / k), 0, 7);
            ctx.stroke();
            ctx.globalAlpha = a;
        }

        // certainty prstenec za uzlom — prepínateľný („Značky istoty", default ON)
        const mode = S.certRings ? CERT_RING[n.certainty] : null;
        if (mode) {
            const rr = r + 3.2 / k;
            const col = cc[n.certainty];
            ctx.save();
            ctx.globalAlpha = a * 0.8;
            ctx.lineWidth = 1.6 / k;
            ctx.strokeStyle = col;
            if (mode === 'dashed') ctx.setLineDash([3 / k, 2.4 / k]);
            ctx.beginPath();
            ctx.arc(x, y, rr, 0, 7);
            ctx.stroke();
            if (mode === 'pip') {
                // výstražný pip navrchu prstenca — druhý (tvarový) kanál pre pascu
                ctx.setLineDash([]);
                ctx.globalAlpha = a;
                ctx.fillStyle = col;
                ctx.beginPath();
                ctx.arc(x, y - rr, 1.9 / k, 0, 7);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}

export let lastFrame = now();
export let framePending = false;
export function frame() {
    framePending = false;
    // FÁZA SHELL: ak sme medzitým opustili Graf, slučka zaparkuje bez kreslenia.
    if (S.screen !== 'graf') return;
    const nowMs = now();
    const dt = Math.min((nowMs - lastFrame) / 1000, 0.1);
    lastFrame = nowMs;

    // FÁZA ANIMÁCIE: monotónny čas + efektívna intenzita animácií tohto framu
    S._clock += dt;
    S._anim = animLevel();
    // FÁZA ANIMÁCIE (Living): auto-strop z EMA nákladu draw(); ambientný život až po tier gate.
    S._lifeTier = lifeTier();
    S._life = S._lifeTier >= 2 ? 0 : lifeLevel(); // tier 2 → len event-driven (žiadny ambient)
    // kurzorová aktivácia — plynulý nábeh/uvoľnenie gravitácie (uvoľní sa keď kurzor odíde/ťaháme)
    S.cursor.a += ((S.cursor.on ? 1 : 0) - S.cursor.a) * Math.min(1, dt * 10);
    if (S.cursor.a < 0.005) S.cursor.a = 0;
    maybeSynapse(); // občasná spontánna synapsia po náhodnej hrane („myseľ premýšľa")

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES); // flash cieľa nech dohasne
        }
    }

    // FÁZA ANIMÁCIE: putujúce svetlobody po hranách — po dobehnutí jemne rozsvietia cieľ
    // (staggered dobeh dáva recall „graph-walk" vlnu). Nad rozpočet sa oreže najstaršie.
    for (let i = S._flows.length - 1; i >= 0; i--) {
        const f = S._flows[i];
        if (f.wait > 0) { f.wait -= dt; continue; }
        f.t += dt * f.speed;
        if (f.t >= 1) {
            if (f.to) f.to.flash = Math.min(1, (f.to.flash || 0) + 0.28 * f.dim);
            S._flows.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES); // flash cieľa nech dohasne
        }
    }
    const cap = flowCap();
    if (S._flows.length > cap) S._flows.splice(0, S._flows.length - cap);

    // FÁZA ANIMÁCIE: morph prechod pozícií medzi náhľadmi (sim je počas neho zastavená)
    if (S._morph) {
        const m = S._morph;
        m.t = Math.min(1, m.t + dt / m.dur);
        const e = easeInOut(m.t);
        for (const n of S.nodes) {
            const a = m.from.get(n.id), b = m.to.get(n.id);
            if (a && b) { n.x = a.x + (b.x - a.x) * e; n.y = a.y + (b.y - a.y) * e; }
        }
        if (m.t >= 1) {
            for (const n of S.nodes) { const b = m.to.get(n.id); if (b) { n.x = b.x; n.y = b.y; } }
            S._morph = null;
            // mapa/sieť: jemný dotik simulácie na dosadnutie; Vrstvy majú pevné fx/fy → nechaj zastavené
            if (S.sim && S.view !== 'layers') S.sim.alpha(0.05).restart();
            requestDraw();
        }
    }

    if (S.replay.playing) {
        S.replay.t = Math.min(1, S.replay.t + dt / 22);
        const tlr = document.getElementById('tl-range');
        tlr.value = Math.round(S.replay.t * 1000);
        syncSlider(tlr);
        updateTimelineLabel();
        if (S.replay.t >= 1) stopReplay();
    }

    // FÁZA RENDER PIPELINE: dirty-flag rozhodnutie — prekresli LEN keď je čo animovať alebo je dirty.
    // responsive = stavy, čo chcú plnú frekvenciu (sim, morph, replay, interakcia, pulzy/toky, dobeh, dim).
    // ambientLife = spojitý jemný život (dýchanie/drift/gravitácia/synapsie) — throttluje sa na ~30 FPS.
    // V pokoji (Život=0 a nič sa nedeje): 0 prekreslení, tichý CPU.
    const simActive = S.sim && S.view !== 'layers' && S.sim.alpha() > S.sim.alphaMin();
    const dimTarget = isAwake() ? 1 : 0.5;
    const dimActive = Math.abs(dimTarget - S.dim) > 0.001;
    const ambientLife = S._life > 0; // už gate-nuté cez tier a screen; ambient režim ho drží nažive
    const responsive = simActive || !!S._morph || S.replay.playing || S._interacting
        || S.pulses.length > 0 || S._flows.length > 0 || S._settleFrames > 0 || dimActive;
    const active = responsive || ambientLife;

    if (S._settleFrames > 0) S._settleFrames--;

    // responzívne / dirty stavy kreslíme okamžite; čistý ambient len keď uplynulo ~33 ms (cap 30 FPS)
    let doDraw = responsive || S._dirty;
    if (!doDraw && ambientLife && (nowMs - S._lastAmbient) >= AMBIENT_MS) doDraw = true;

    if (doDraw) {
        const _t0 = performance.now();
        draw();
        // EMA nákladu kreslenia — plynulý podklad pre auto-strop (tier), aby na hranici neflikal
        S._drawMs += (Math.min(60, performance.now() - _t0) - S._drawMs) * 0.1;
        S._dirty = false;
        if (!responsive) S._lastAmbient = nowMs;
        updateStateUi();
    }

    // Reštart slučky len keď je stále čo robiť. Inak usne — udalosti ju zobudia cez requestDraw().
    if (active) scheduleFrame();
}

export function scheduleFrame() {
    // FÁZA SHELL: mimo obrazovky Graf sa plátno nekreslí vôbec — slučka zaparkuje (tichý CPU).
    // setScreen('graf') ju znovu naštartuje.
    if (S.screen !== 'graf') return;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}

// FÁZA RENDER PIPELINE: koľko frameov po dobehnutí animácie ešte kresliť, nech flash/zrod dohasne.
// flash klesá o 0.02/frame (0.5 → 0 ≈ 25 frameov); 45 dáva rezervu aj pre zrodový prstenec (0.6 s).
export const SETTLE_FRAMES = 45;

// FÁZA ANIMÁCIE (Living): interval čistého ambientného framu (~30 FPS). Responzívne stavy
// (interakcia, sim, pulzy/toky, morph) idú plnou frekvenciou; ambientný život sa throttluje sem.
export const AMBIENT_MS = 32;

// Jednorazová požiadavka na prekreslenie (hover, kamera, výber, dáta, filter, téma).
// Nastaví dirty a zobudí uspatú rAF slučku (reset lastFrame, nech prvý dt nevyskočí).
export function requestDraw() {
    S._dirty = true;
    if (!framePending) { lastFrame = now(); scheduleFrame(); }
}
export function focusNode(n) {
    S.cam.x = -n.x * S.cam.k;
    S.cam.y = -n.y * S.cam.k;
    requestDraw(); // kamera sa presunula na uzol → prekresli
}

export function zoomBy(factor) {
    // pivot okolo stredu obrazovky — rovnaká technika ako wheel handler
    const before = screenToWorld(S.w / 2, S.h / 2);
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
    const after = screenToWorld(S.w / 2, S.h / 2);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    requestDraw(); // zoom tlačidlom zmenil kameru → prekresli
}

// Fit view — kamera obsiahne všetky viditeľné uzly aktuálneho náhľadu
export function fitView(pad = 90) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    };

    const loc = localSet();

    if (S.view === 'layers') {
        // deterministický layout — bbox sub-stĺpcov + hlavičky (vždy v zábere)
        const lay = layerLayout();
        add(lay.minX, -lay.maxHalf - 66);
        add(lay.maxX, lay.maxHalf);
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.fx != null ? n.fx : n.x, n.fy != null ? n.fy : n.y);
        }
    } else {
        for (const n of S.nodes) {
            if (!visibleInReplay(n)) continue;
            if (!nodeVisible(n, loc)) continue;
            add(n.x, n.y);
        }
    }

    if (minX > maxX) { S.cam = { x: 0, y: 0, k: 0.85 }; draw(); return; }

    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    S.cam.k = Math.min(1.6, Math.max(0.14, Math.min((S.w - 2 * pad) / bw, (S.h - 2 * pad) / bh)));
    S.cam.x = -((minX + maxX) / 2) * S.cam.k;
    S.cam.y = -((minY + maxY) / 2) * S.cam.k;
    draw();
}

// FÁZA MODULY: listener na visibilitychange (pôvodne v init()) — lastFrame je lokálny
// stav tohto modulu, preto tu žije aj jeho reset. Volá sa z main.js na pôvodnom mieste.
export function setupVisibilityRepaint() {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); requestDraw(); } // návrat na tab → istý repaint
    });
}
