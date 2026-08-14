import { animLevel, birthScale, breatheFactor, dustDrift, easeInOut, flowCap, lifeLevel, lifeTier, maybeSynapse } from './anim.js';
import { drawEdges } from './edges.js';
import { localSet, nodeVisible } from './filters.js';
import { screenToWorld } from './interaction.js';
import { camInsets, computeLayout, drawRadius, edgePx, panelReserve } from './layout.js';
import { applyLayoutPositions, currentPath, go, syncNavFromFocus } from './sim.js';
import { REDUCED_MOTION, S, canvas, ctx } from './state.js';
import { T, certColors, mutedColor } from './theme.js';
import { stopReplay, updateTimelineLabel } from './timeline.js';
import { highlightSet, isAwake, nodeColor, now, syncSlider, ts, updateStateUi } from './util.js';

/* ---------- render ---------- */

// FÁZA SHELL / W2a: plátno žije LEN na obrazovke Graf. Zdroj pravdy je atribút
// data-screen na <body> (píše ho setScreen), S.screen je fallback pri prvom framu.
export function graphActive() {
    const ds = document.body ? document.body.dataset.screen : null;
    return ds ? ds === 'graf' : S.screen === 'graf';
}

export function resize() {
    S.dpr = window.devicePixelRatio || 1;
    S.w = window.innerWidth;
    S.h = window.innerHeight;
    canvas.width = S.w * S.dpr;
    canvas.height = S.h * S.dpr;
    canvas.style.width = S.w + 'px';
    canvas.style.height = S.h + 'px';
    // W2a: layout je aspect-aware — zmena rozmeru prepočíta scénu a znovu ju nafitne
    if (S.nodes.length) {
        const L = computeLayout();
        applyLayoutPositions(L);
        S._morph = null; S._camTween = null;
        const c = fitCam(fitBBox(L));
        S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
    }
}

// Časticový systém odstránený — žiadna hmla na papieri. No-op kvôli existujúcim volaniam.
export function visibleInReplay(n) {
    if (!S.replay.on) return true;
    const cutoff = S.replay.tMin + (S.replay.tMax - S.replay.tMin) * S.replay.t;
    return n.type === 'core' || ts(n.created_at) <= cutoff;
}

// Layout aktuálnej úrovne + istota, že n.x/n.y sedia (napr. po zmene viewportu).
function ensureLayout() {
    const prev = S.layout;
    const L = computeLayout();
    if (L !== prev) { applyLayoutPositions(L); S._morph = null; }
    return L;
}

// Alfa uzla: základ z layoutu (kontext je stmavnutý na ~15 %) × zvýraznenie hoverom.
function entAlpha(n, ent, hl) {
    const base = ent.dim != null ? ent.dim : 1;
    let a = base;
    if (hl && !hl.has(n.id)) a *= 0.30;
    if (base >= 0.5) a = Math.max(T.nodeFloor, a);
    return a * S.dim;
}

/* ---------- GRAF B: VIZUÁLNY JAZYK ---------- */

// Farba, ktorou sa uzol reálne kreslí. Jadro je JEDINÝ sýty prvok kompozície
// (zlato), všetko ostatné ide cez utlmenú paletu (theme.mutedColor).
function paintColor(n) {
    const c = nodeColor(n);
    return n.type === 'core' ? c : mutedColor(c);
}

// Polomer prstenca. Pre uzly s tvarom ho dáva layout (nodeRadius × mul — už rastie so
// stupňom). Pre kontextový prach je ale v layoute KONŠTANTNÝ v px (LOD), takže sila
// uzla z neho zmizla; referencia ju má a je to jej najčitateľnejší signál. Dopĺňame ju
// tu (layout.js nevlastníme) násobičom podľa stupňa, plus mierne zväčšenie základu,
// aby diera v prstenci vôbec vznikla.
export const RING_DUST_BASE = 1.30;
export const RING_DEG_REF = 4.2;      // log2(1+deg) ≈ 4,2 je horný decil v dátach
// Šírka obrysu prstenca v OBRAZOVKOVÝCH px. 1,5 nie je estetické číslo, ale merané:
// pri 1,1 px antialiasing zoberie prstencu viac než polovicu kontrastu (nominálne
// 4,6:1 → 2,2:1 na reálnych pixeloch), takže grafický prvok spadne pod WCAG 3:1.
// Priehľadnosť drží DIERA, nie tenkosť čiary — tá sa dá zaplatiť bez straty vzdušnosti.
export const RING_LW = 1.5;
export function ringRadius(n, ent, invK) {
    const r = drawRadius(n, ent, invK);
    if (!ent || (ent.kind !== 'dust' && ent.kind !== 'ctx')) return r;
    const deg = S.degree.get(n.id) || 0;
    const s = 1 + 0.62 * Math.min(1, Math.log2(1 + deg) / RING_DEG_REF);
    return r * (ent.kind === 'ctx' ? 1.06 : RING_DUST_BASE) * s;
}

/* Mriežka nakreslených uzlov — jediná otázka, ktorú rieši: „padá do tohto rámu
   nejaký nakreslený uzol?" Bez nej by bol test popisku O(popisky × 1060). */
function buildNodeGrid(drawn, invK) {
    const cell = 44 * invK;
    const g = new Map();
    let maxR = 0;
    for (const d of drawn) {
        if (d.r > maxR) maxR = d.r;
        const k = Math.floor(d.x / cell) + ',' + Math.floor(d.y / cell);
        let a = g.get(k);
        if (!a) { a = []; g.set(k, a); }
        a.push(d);
    }
    return { g, cell, maxR };
}
// Zasahuje do rámu disk niektorého nakresleného uzla? (polomer uzla + pad)
function rectHasNode(grid, rect, pad) {
    const m = grid.maxR + pad;
    const cx0 = Math.floor((rect.x - m) / grid.cell), cx1 = Math.floor((rect.x + rect.w + m) / grid.cell);
    const cy0 = Math.floor((rect.y - m) / grid.cell), cy1 = Math.floor((rect.y + rect.h + m) / grid.cell);
    for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
            const a = grid.g.get(cx + ',' + cy);
            if (!a) continue;
            for (const d of a) {
                const e = d.r + pad;
                if (d.x > rect.x - e && d.x < rect.x + rect.w + e
                    && d.y > rect.y - e && d.y < rect.y + rect.h + e) return true;
            }
        }
    }
    return false;
}

// API stavového stroja pre konzolu a testy. Publikuje sa z main.js na konci init(),
// nie z draw() — tam to fungovalo len vďaka poradiu: keby draw() prebehol prvý,
// _navApi by bolo 1 a priradenie window.HADES v main.js by go/currentPath zahodilo.
export function publishNavApi() {
    window.HADES = Object.assign(window.HADES || {}, {
        go, currentPath, computeLayout,
        // GRAF B: kontrastné overenie musí čítať ŽIVÉ hodnoty plátna (utlmená paleta,
        // alfy prstenca / siete / vodoznaku), nie svoju kópiu konštánt. Inak by po
        // prekalibrovaní palety meralo starú verziu a tvrdilo, že je všetko v poriadku.
        theme: () => T,
        mutedColor,
        inkAlphas: () => ({ label: LABEL_A, mark: T.markA, ring: T.ringA, sleepDim: SLEEP_DIM }),
    });
}

// GRAF B: podlaha tlmenia v stave „spí". Pôvodných 0,5 znamenalo, že celé plátno
// (prstence, vodoznak, sieť) je na polovičnej alfe — a keďže „bdie" nie je stav
// používateľa, ale stav Hadesa (aktívna session v posledných 5 minútach), je toto
// pri obyčajnom prezeraní dashboardu ten NORMÁLNY stav. Pri 0,5 spadli prstence na
// ~2,0:1, teda pod WCAG 1.4.11. Pri 0,78 držia 3,3:1 a rozdiel voči bdeniu je
// stále zreteľný (plus stav nesie textovo hlavička).
export const SLEEP_DIM = 0.78;

export function draw() {
    const targetDim = isAwake() ? 1 : SLEEP_DIM;
    S.dim += (targetDim - S.dim) * 0.02;
    if (Math.abs(targetDim - S.dim) < 0.001) S.dim = targetDim;

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    const L = ensureLayout();
    const level = L.level;

    ctx.translate(S.w / 2 + S.cam.x, S.h / 2 + S.cam.y);
    ctx.scale(S.cam.k, S.cam.k);

    const invK = 1 / S.cam.k;

    // viewport culling — svetové hranice viditeľnej plochy + okraj
    const _vTL = screenToWorld(0, 0);
    const _vBR = screenToWorld(S.w, S.h);
    const VM = 140 * invK;
    const vpX0 = _vTL.x - VM, vpY0 = _vTL.y - VM, vpX1 = _vBR.x + VM, vpY1 = _vBR.y + VM;
    const inView = (x, y) => x >= vpX0 && x <= vpX1 && y >= vpY0 && y <= vpY1;
    const edgeInView = (a, b) => !(Math.max(a.x, b.x) < vpX0 || Math.min(a.x, b.x) > vpX1
        || Math.max(a.y, b.y) < vpY0 || Math.min(a.y, b.y) > vpY1);
    S._vp = { x0: vpX0, y0: vpY0, x1: vpX1, y1: vpY1 };

    const hl = highlightSet();
    const hlAnchor = S.hover || S.selected;
    const loc = localSet();
    const softHoverActive = S.opts.edgeSoftHover && !hlAnchor && !loc;

    /* ---- pozadie: jemná technická mriežka ---- */
    const bgLevel = S.opts.bg * (level === 'map' ? 0.7 : 1);
    if (bgLevel > 0.01) {
        const _step = 240;
        ctx.lineWidth = 0.5 * invK;
        ctx.strokeStyle = 'rgba(' + T.gridColor + ',' + (T.gridAlpha * S.dim * bgLevel) + ')';
        ctx.beginPath();
        for (let gx = Math.floor(_vTL.x / _step) * _step; gx <= _vBR.x; gx += _step) { ctx.moveTo(gx, _vTL.y); ctx.lineTo(gx, _vBR.y); }
        for (let gy = Math.floor(_vTL.y / _step) * _step; gy <= _vBR.y; gy += _step) { ctx.moveTo(_vTL.x, gy); ctx.lineTo(_vBR.x, gy); }
        ctx.stroke();
    }

    /* ---- W3a: areola regiónu — veľmi jemný tón pod oblakom prachu ---- */
    drawAreolas(L);

    /* ---- GRAF B: ZBER NAKRESLENÝCH UZLOV (bez malovania) ----
       Zbierame pozície a polomery skôr, než sa čokoľvek namaľuje, pretože rozloženie
       popiskov ich potrebuje (popisok sa musí uhnúť KAŽDÉMU nakreslenému uzlu) a
       naopak maska pod nepriehľadnými popiskami rozhoduje, ktorý prach sa vynechá.
       Predtým sa prach maľoval hneď v zbernej slučke, takže popisky uzlov nemali
       ako o uzloch vedieť — a preto ani nemohli byť na mape. */
    const dustBuckets = new Map();   // color → { col, items, alpha }
    const solid = [];                // uzly s tvarom (kind node/center/core)
    const drawn = [];                // VŠETKO nakreslené — vstup pre mriežku popiskov
    for (const [id, ent] of L.pos) {
        const n = S.byId.get(id);
        if (!n) continue;
        if (!visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        const isDust = ent.kind === 'dust' || ent.kind === 'ctx';
        const dr = isDust ? dustDrift(id, invK) : null;
        const x = n.x + (dr ? dr.x : 0), y = n.y + (dr ? dr.y : 0);
        n._ox = dr ? dr.x : 0; n._oy = dr ? dr.y : 0;
        if (!inView(x, y)) continue;
        if (isDust && n !== S.hover && n !== S.selected) {
            const r = ringRadius(n, ent, invK);
            const col = paintColor(n);
            const key = col + '|' + (ent.kind === 'ctx' ? 'c' : 'd') + Math.round((ent.dim || 1) * 20);
            let b = dustBuckets.get(key);
            if (!b) {
                b = {
                    col, items: [],
                    alpha: T.ringA * (ent.kind === 'ctx' ? 0.62 : 1) * (ent.dim || 1),
                };
                dustBuckets.set(key, b);
            }
            b.items.push({ x, y, r, n, ent });
            drawn.push({ x, y, r });
            continue;
        }
        solid.push({ n, ent, x, y });
        drawn.push({ x, y, r: ringRadius(n, ent, invK) });
    }

    /* ---- GRAF B: ROZLOŽENIE POPISKOV UZLOV (pred malovaním) ---- */
    const grid = buildNodeGrid(drawn, invK);
    const nodeLabels = layoutNodeLabels(L, solid, dustBuckets, hl, invK, null, grid);
    // Debug hook: A3 meria TOTO — rámy, ktoré render reálne PREKRÝVA uzlami.
    // Vodoznaky oblastí tu zámerne NIE SÚ: kreslia sa POD sieť, takže žiadny uzol
    // neprekrývajú (sú v S._watermarkBoxes, keby ich chcel niekto merať zvlášť).
    S._labelBoxes = nodeLabels;
    // Maska pre prach: len rámy s NEPRIEHĽADNÝM podkladom (karta pod kurzorom).
    // Bežné popisky uzlov podklad nemajú a sedia v ploche bez uzlov, takže pod nimi
    // netreba nič vynechávať.
    const maskBoxes = nodeLabels.filter((b) => b.opaque);

    /* ---- vodoznak oblasti (najspodnejšia vrstva) ---- */
    const marks = layoutHubMarks(L, invK);
    S._watermarkBoxes = marks;
    paintHubMarks(marks);

    /* ---- spojenia: jemná sieť (hustá scéna) alebo reálne hrany (málo uzlov) ----
       GRAF B: hrany sa kreslia VŽDY a pre všetky uzly v layoute. Agregované stuhy
       (drawRibbons) ani pahýle (drawStubs) už neexistujú — s viditeľnou sieťou boli
       redundantné a po organickom layoute ich L.ribbons/L.stubs aj tak nikto neplní. */
    drawEdges(L, loc, hl, hlAnchor, softHoverActive, edgeInView);

    ctx.globalCompositeOperation = 'source-over';

    /* ---- pulzy + putujúce svetlobody (len medzi uzlami tejto úrovne) ---- */
    for (const p of S.pulses) {
        if (!L.pos.has(p.from.id) || !L.pos.has(p.to.id)) continue;
        const x = p.from.x + (p.to.x - p.from.x) * p.t;
        const y = p.from.y + (p.to.y - p.from.y) * p.t;
        ctx.globalAlpha = 0.7 * p.dim * Math.sin(Math.PI * Math.min(p.t, 1));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(x, y, 8 * invK, 0, 7);
        ctx.fill();
    }
    ctx.globalAlpha = 1;

    const _flowI = Math.max(S._anim, S._life);
    if (_flowI > 0 && S._flows.length) {
        const fr = 3 * invK;
        for (const f of S._flows) {
            if (f.wait > 0) continue;
            if (!L.pos.has(f.from.id) || !L.pos.has(f.to.id)) continue;
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

    /* ---- PRACH AKO PRSTENCE: dávkovo po farbách, jedno stroke() na farbu ----
       Priehľadnosť nesie DIERA v prstenci, nie nízka alfa. Vďaka tomu sa prekrývajúce
       uzly dajú prečítať (to bola hlavná estetická požiadavka) a zároveň zostáva
       kompozitná farba nad WCAG 1.4.11 podlahou 3:1 — pri alfe 0,42 (starý plný bod)
       by utlmená paleta spadla na ~1,8:1. Šírka obrysu je konštantná v obrazovkových
       px, takže prstenec nezhrubne pri zoome. */
    ctx.lineWidth = RING_LW * invK;
    for (const b of dustBuckets.values()) {
        const path = new Path2D();
        let any = false;
        for (const it of b.items) {
            // pod nepriehľadným popiskom prach nekreslíme — podklad by ho aj tak prekryl
            if (inLabelBox(maskBoxes, it.x, it.y, it.r)) continue;
            path.moveTo(it.x + it.r, it.y);
            path.arc(it.x, it.y, it.r, 0, 7);
            any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = b.alpha * S.dim * (hl ? 0.45 : 1);
        ctx.strokeStyle = b.col;
        ctx.stroke(path);
    }
    ctx.globalAlpha = 1;

    /* ---- UZLY S TVAROM — dual-channel: farba = oblasť, tvar = typ ---- */
    const showCert = level === 'dept' || level === 'node';
    for (const { n, ent, x, y } of solid) {
        let r = ringRadius(n, ent, invK);
        if (S.hover === n) r *= 1.18;
        r *= breatheFactor(n) * birthScale(n);
        if (n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
        const alpha = entAlpha(n, ent, hl);
        ctx.globalAlpha = alpha;
        drawShape(n, x, y, r, paintColor(n), {
            cert: showCert && ent.dim >= 0.5, dim: ent.dim < 0.5, glow: ent.glow || 0,
        });

        if (ent.dim < 0.5) { if (n.flash) n.flash = Math.max(0, n.flash - 0.02); continue; }

        // ŽIARA — nedávno aktívne uzly jemne pulzujú teal (event-driven, aj pri REDUCED_MOTION)
        const glowA = (n.flash || 0) * (0.55 + 0.45 * Math.sin(S._clock * 6 + n.id));
        if (glowA > 0.03) {
            ctx.globalAlpha = Math.min(0.55, glowA) * alpha;
            ctx.lineWidth = 1.4 * invK;
            ctx.strokeStyle = 'rgb(' + T.accent + ')';
            ctx.beginPath();
            ctx.arc(x, y, r + 3 * invK, 0, 7);
            ctx.stroke();
        }

        // zrod uzla — krátky rozpínavý prstenec
        if (n._born != null) {
            const age = S._clock - n._born;
            if (age < 0.6 && S._anim > 0 && !REDUCED_MOTION) {
                const p = age / 0.6;
                ctx.globalAlpha = (1 - p) * 0.6 * alpha;
                ctx.lineWidth = 1.4 * invK;
                ctx.strokeStyle = 'rgb(' + T.accent + ')';
                ctx.beginPath();
                ctx.arc(x, y, r + (3 + p * 14) * invK, 0, 7);
                ctx.stroke();
            } else if (age >= 0.6) {
                n._born = null;
            }
        }

        if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
    }
    ctx.globalAlpha = 1;

    /* ---- HUBY oblastí / oddelení ---- */
    for (const h of L.hubs) drawHub(h, invK);

    /* ---- POPISKY ---- */
    // rozloženie je hotové pred malovaním; tu sa už len vykreslia
    paintNodeLabels(nodeLabels);
}

/* ---------- W3a: areoly regiónov ---------- */

// hex → 'r,g,b' (s cache) — potrebné pre gradientové zastávky s alfou
const _ribCache = new Map();
function rgbTriplet(col) {
    let v = _ribCache.get(col);
    if (v) return v;
    v = '128,128,128';
    const m = /^#?([0-9a-f]{6})$/i.exec(String(col || '').trim());
    if (m) {
        const n = parseInt(m[1], 16);
        v = ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255);
    }
    _ribCache.set(col, v);
    return v;
}

// Každý oblak prachu má svoj hub. Bez tónovania sa 1026 bodov čítalo ako šum cez celé
// plátno; jemná areola (radiálny gradient vo farbe oblasti, doslova pár percent alfy)
// región ohraničí, ale prach nechá priehľadný a bez hrán. Kreslí sa PRED sieťou.
// GRAF B: alfa dole z 0,12 na 0,07 a farba cez utlmenú paletu — regióny teraz
// ohraničuje aj hustota siete, takže farebný závoj môže byť oveľa tichší (predtým
// z neho boli výrazné barevné škvrny, ktoré prekričali štruktúru).
function drawAreolas(L) {
    for (const h of L.hubs) {
        if (!(h.crx > 0) || !(h.cry > 0)) continue;
        const a = 0.07 * (h.dim || 1) * S.dim;
        if (a < 0.004) continue;
        const rgb = rgbTriplet(mutedColor(h.color));
        const R = h.crx * 1.08;
        ctx.save();
        ctx.translate(h.x, h.y);
        ctx.scale(1, h.cry / h.crx);
        // Profil je zámerne „plochý" v strednom pásme — gradient s jedinou zastávkou
        // spadol tak rýchlo, že tón bol viditeľný len pod hubom a okrajové body oblaku
        // ostávali osamotené bodky. Takto tón podrží celý región a na obvode dojde na nulu.
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
        g.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(4) + ')');
        g.addColorStop(0.38, 'rgba(' + rgb + ',' + (a * 0.72).toFixed(4) + ')');
        g.addColorStop(0.72, 'rgba(' + rgb + ',' + (a * 0.34).toFixed(4) + ')');
        g.addColorStop(1, 'rgba(' + rgb + ',0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, 7);
        ctx.fill();
        ctx.restore();
    }
    ctx.globalAlpha = 1;
}

/* ---------- huby ---------- */

// GRAF B: hub je najväčší prstenec kompozície a zároveň klikacia plocha (pickHub →
// zanorenie do oblasti/oddelenia), takže viditeľný zostať MUSÍ. Papierové telo ale
// padlo: vyrezávalo do siete prázdny kruh a prekrývalo aj vodoznak pod ňou, takže
// hub vyzeral ako cudzí artefakt zavesený nad oblakom. Teraz je to len prstenec
// v jazyku uzlov — o stupeň hrubší, s veľmi jemným halom, sieť ním presvitá.
function drawHub(h, invK) {
    // Značka pásu (pohľad Vrstvy) nie je klikateľná (pickHub ju preskakuje) a jej x/y
    // je počiatok vľavo zarovnaného vodoznaku — kotúčik tam sedel priamo na prvom
    // písmene názvu („JADRO" sa čítalo ako „ADRO"). Pás nesie vodoznak, kruh netreba.
    if (h.kind === 'layer') return;
    const r = Math.max(6 * invK, h.rw);
    const a = h.dim * S.dim;
    const col = mutedColor(h.color);
    ctx.globalAlpha = 0.07 * a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 1.7, 0, 7);
    ctx.fill();
    ctx.globalAlpha = Math.min(1, 0.95 * a);
    ctx.lineWidth = Math.max(2 * invK, r * 0.055);
    ctx.strokeStyle = col;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, 7);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

// Popisky hubov idú NAVRCH všetkého a majú papierový podklad — inak ich prach prekryje
// (to bola jedna z konkrétnych bolestí starého grafu).
// Rozloženie popiskov hubov sa počíta PRED kreslením prachu, aby ho prach mohol
// obísť. Popisok zámerne zostáva pri svojom hube (nie pod celým oblakom, kde by
// stratil väzbu na hub a lezol susedom do plochy) — namiesto odsúvania popisku sa
// pod ním prach nekreslí, takže jeho podklad nemá čo prekryť. Predtým podklad
// prekrýval 26–51 uzlov na mape a 59–76 v oblasti.
/* ---------- GRAF B: NÁZOV OBLASTI AKO VODOZNAK ----------
   Predtým: chip s papierovým podkladom NAD sieťou, umiestnený k svojmu hubu; prach
   sa pod ním vynechával, aby nič neprekryl. To fungovalo, kým bol layout
   deterministický a stred klastra bol prázdny.

   V organickom (silovom) rozložení je ale ťažisko klastra presne to miesto, kde je
   uzlov NAJVIAC — nepriehľadný chip tam musí niečo prekryť, nech ho posunieme kam
   chceme (A3 to hneď ukázala: 32 prekrytých uzlov na mape). Riešenie je obrátiť
   vrstvenie: názov oblasti je veľký bledý VODOZNAK pod sieťou. Uzly idú NAD ním,
   takže neprekrýva nič — kritérium „popisok neprekrýva nakreslený uzol" platí
   konštrukčne, nie kalibráciou.

   Veľkosť sa riadi rozptylom klastra (h.spreadX), takže veľká oblasť má veľké písmo
   a malá malé — mapa sa dá čítať aj bez legendy. Písmo je verzálkové, tučné a
   rozšírené, aby bolo pri nízkej alfe stále čitateľné ako slovo, nie ako šum.

   Kontrast: pri fs ≥ 19 px a weight 700 ide o „large text" podľa WCAG (≥ 18,66 px
   bold), takže platí prah 3:1 — a T.markA je nastavená tak, aby ho splnil v oboch
   témach. Preto je aj počet na TOM ISTOM riadku a v tej istej veľkosti; ako menší
   druhý riadok by spadol pod prah malého textu (4,5:1). */
export const MARK_MIN = 19, MARK_MAX = 116;

function layoutHubMarks(L, invK) {
    let strong = L.hubs.filter((h) => h.dim >= 0.5 && (h.count > 0 || h.kind === 'layer'));
    if (!strong.length) return [];
    // Z hierarchie oblasť→oddelenie berieme len NAJHLBŠIU zaostrenú úroveň. Na úrovni
    // oddelenia mali oblasť aj oddelenie takmer rovnaké ťažisko, takže sa dva vodoznaky
    // prekrývali do kaše — a názov nadradenej oblasti aj tak nesie breadcrumb.
    // Značky pásov (kind 'layer') sú iná os (pohľad Vrstvy) a zostávajú vždy.
    const bands = strong.filter((h) => h.kind === 'layer');
    let tree = strong.filter((h) => h.kind !== 'layer');
    for (const kind of ['dept', 'area']) {
        const deep = tree.filter((h) => h.kind === kind);
        if (deep.length) { tree = deep; break; }
    }
    strong = bands.concat(tree);
    const items = [];
    for (const h of strong) {
        const label = String(h.name || '').toLocaleUpperCase('sk-SK')
            + (h.count > 0 ? '  ·  ' + h.count : '');
        // Šírka nápisu ≈ 1,45 × rozptyl klastra → vodoznak podloží klaster, nevytŕča.
        const target = Math.max(150 * invK, (h.spreadX || 0) * 1.45);
        ctx.font = '700 100px "Geist", system-ui, sans-serif';
        const w100 = ctx.measureText(label).width || 1;
        const fs = Math.min(MARK_MAX * invK, Math.max(MARK_MIN * invK, (target / w100) * 100));
        ctx.font = '700 ' + fs + 'px "Geist", system-ui, sans-serif';
        const w = ctx.measureText(label).width;
        const left = h.kind === 'layer';
        items.push({
            label, fs, left, cx: h.x, baseline: h.y + fs * 0.34,
            x: left ? h.x : h.x - w / 2, y: h.y - fs * 0.5, w, h: fs * 1.1,
        });
    }
    return items;
}

// Kreslí sa PRED hranami a uzlami — vodoznak je najspodnejšia vrstva kompozície.
function paintHubMarks(items) {
    if (!items.length) return;
    const prevLs = ctx.letterSpacing;
    ctx.fillStyle = T.ink;
    for (const it of items) {
        ctx.textAlign = it.left ? 'left' : 'center';
        ctx.font = '700 ' + it.fs + 'px "Geist", system-ui, sans-serif';
        ctx.letterSpacing = (it.fs * 0.06).toFixed(2) + 'px';
        // Text sa stavom „spí" NEtlmí (rovnako ako popisky uzlov) — inak by vodoznak
        // spadol na 2,4:1. Tlmí sa grafika: prstence, sieť, areoly.
        ctx.globalAlpha = T.markA;
        ctx.fillText(it.label, it.cx, it.baseline);
    }
    ctx.letterSpacing = prevLs || '0px';
    ctx.textAlign = 'center';
    ctx.globalAlpha = 1;
}

// Padá bod do niektorého rezervovaného rámu popisku? (rozšírené o polomer uzla,
// aby sa nekreslili ani uzly, ktoré do rámu zasahujú len časťou)
function inLabelBox(boxes, x, y, pad) {
    for (const b of boxes) {
        if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return true;
    }
    return false;
}

/* ---------- GRAF B: POPISKY UZLOV PODĽA ZOOMU ----------
   Pravidlo, ktoré si vybral používateľ: oddialené len najsilnejšie uzly, pri
   približovaní pribúdajú ostatné. Rieši to ROZPOČET (koľko popiskov smie byť) krát
   poradie podľa sily uzla — nie stmievanie. Stmievanie by popisky poslalo pod
   kontrastnú podlahu (pri alfe 0,4 má ink na tmavom papieri už len 3,5:1), takže
   popisok sa buď zobrazí čitateľne, alebo sa nezobrazí vôbec.

   Popisky sú teraz aj na mape — predtým sa uzly pomenovali až od úrovne oddelenia,
   takže mapa bola anonymný prach. Cenou je striktnejšie umiestňovanie: rám popisku
   nesmie zasahovať do disku ŽIADNEHO nakresleného uzla (štyri kandidátske pozície
   okolo uzla), inak sa popisok zahodí. Preto nemusí mať podklad — a preto sa pod ním
   nemusí (a nesmie) nič vynechávať. */

// Alfa, pri ktorej ink na papieri drží ≥ 4,5:1 v OBOCH témach (dark 6,7:1, light 5,4:1).
export const LABEL_A = 0.72;
export const LBL_K0 = 0.20, LBL_K1 = 1.30;

// Rozpočet popiskov podľa priblíženia. Kvadraticky, aby pri oddialení bola mapa
// naozaj len o najsilnejších menách a názvy pribúdali plynule, nie skokom.
export function labelBudget(k) {
    const t = Math.min(1, Math.max(0, (k - LBL_K0) / (LBL_K1 - LBL_K0)));
    return Math.round(12 + 96 * t * t);
}

function layoutNodeLabels(L, solid, dustBuckets, hl, invK, reserved, grid) {
    const baseLabelAlpha = Math.min(1, S.opts.labelAlpha);
    if (baseLabelAlpha < 0.02) { S._labelShown = new Set(); return []; }

    // kandidáti: tvarové uzly + prach (prach nesie label až teraz)
    const candidates = [];
    const push = (n, ent, x, y) => {
        const isHover = S.hover === n || S.selected === n;
        // pri aktívnom zvýraznení pomenúvame len okolie kotvy — utlmený popisok by
        // spadol pod kontrastnú podlahu, tak radšej žiadny
        if (hl && !hl.has(n.id) && !isHover) return;
        if (ent.dim < 0.5 && !isHover) return;
        candidates.push({ n, ent, x, y, isHover, core: n.type === 'core' ? 1 : 0, deg: S.degree.get(n.id) || 0 });
    };
    for (const s of solid) push(s.n, s.ent, s.x, s.y);
    // prach: iterujeme L.pos znova len pre uzly, ktoré sa reálne dostali do vedierok
    for (const b of dustBuckets.values()) {
        for (const it of b.items) {
            if (it.n) push(it.n, it.ent, it.x, it.y);
        }
    }

    // Poradie: kurzor → jadro (má meno vždy, je to stred vedomia) → čo bolo pomenované
    // minulý frame (stabilita, popisky pri pohybe siete neblikajú) → sila uzla → id
    // (deterministický tie-break, nech sa dva reloady zhodnú).
    const shown = S._labelShown || (S._labelShown = new Set());
    candidates.sort((a, b) =>
        (b.isHover - a.isHover)
        || (b.core - a.core)
        || ((shown.has(b.n.id) ? 1 : 0) - (shown.has(a.n.id) ? 1 : 0))
        || (b.deg - a.deg)
        || (a.n.id - b.n.id));

    const fontSize = (12 * S.opts.labelSize) * invK;
    const gap = fontSize * 1.55;
    const nodePad = 1.5 * invK;
    const budget = labelBudget(S.cam.k);
    // Použiteľná plocha vo SVETOVÝCH súradniciach: popisok, ktorý by skončil pod railom,
    // hlavičkou alebo otvoreným panelom, sa nekreslí vôbec. Fit (fitBBox) počíta len
    // geometriu uzlov, o šírkach textov nevie — a s popiskami po celej sieti to bolo
    // vidieť: mená pri ľavom okraji lezli pod rail a čítalo sa z nich pol slova.
    const ins = camInsets();
    const wTL = screenToWorld(ins.left, ins.top);
    const wBR = screenToWorld(S.w - ins.right, S.h - ins.bottom);
    const taken = reserved ? reserved.slice() : [];
    const out = [];
    const newShown = new Set();
    ctx.textAlign = 'center';
    ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';

    for (const c of candidates) {
        if (out.length >= budget && !c.isHover) continue;
        const label = truncLabel(c.n.label);
        const w = ctx.measureText(label).width;
        if (!(w > 0)) continue;
        const r = ringRadius(c.n, c.ent, invK) * (S.hover === c.n ? 1.18 : 1);
        // pod / nad / vpravo / vľavo — prvá poloha bez kolízie vyhráva
        const cands = [
            { cx: c.x, base: c.y + r + gap },
            { cx: c.x, base: c.y - r - gap * 0.55 },
            { cx: c.x + r + gap * 0.6 + w / 2, base: c.y + fontSize * 0.34 },
            { cx: c.x - r - gap * 0.6 - w / 2, base: c.y + fontSize * 0.34 },
        ];
        let placed = null;
        for (const p of cands) {
            const rect = { x: p.cx - w / 2, y: p.base - fontSize, w, h: fontSize * 1.32 };
            if (rect.x < wTL.x || rect.y < wTL.y
                || rect.x + rect.w > wBR.x || rect.y + rect.h > wBR.y) continue;
            const clash = taken.some((t) => rect.x < t.x + t.w && t.x < rect.x + rect.w
                && rect.y < t.y + t.h && t.y < rect.y + rect.h);
            if (clash) continue;
            if (rectHasNode(grid, rect, nodePad)) continue;
            placed = Object.assign(rect, {
                label, cx: p.cx, baseline: p.base, fs: fontSize,
                alpha: baseLabelAlpha * (c.isHover ? 1 : LABEL_A), opaque: false,
            });
            break;
        }
        // uzol pod kurzorom / vo výbere musí mať meno vždy — dostane nepriehľadný
        // podklad (a prach sa pod ním potom vynechá, viď maskBoxes)
        if (!placed && c.isHover) {
            const p = cands[0];
            placed = {
                x: p.cx - w / 2, y: p.base - fontSize, w, h: fontSize * 1.32,
                label, cx: p.cx, baseline: p.base, fs: fontSize,
                alpha: baseLabelAlpha, opaque: true,
            };
        } else if (placed && c.isHover) {
            placed.opaque = true;
        }
        if (!placed) continue;
        taken.push(placed);
        out.push(placed);
        newShown.add(c.n.id);
    }
    S._labelShown = newShown;
    return out;
}

function paintNodeLabels(items) {
    if (!items.length) return;
    ctx.textAlign = 'center';
    for (const it of items) {
        ctx.font = it.fs + 'px "Geist", system-ui, sans-serif';
        if (it.opaque) {
            const px = 5 * it.fs / 12, py = 3 * it.fs / 12;
            ctx.globalAlpha = it.alpha * 0.85;
            ctx.fillStyle = T.paper;
            ctx.fillRect(it.x - px, it.y - py, it.w + 2 * px, it.h + 2 * py);
        }
        ctx.globalAlpha = it.alpha;
        ctx.fillStyle = T.ink;
        ctx.fillText(it.label, it.cx, it.baseline);
    }
    ctx.globalAlpha = 1;
}

// Skrátenie labelu LEN pri kreslení (hover-card a panel používajú n.label v plnej dĺžke)
export function truncLabel(s) {
    const chars = Array.from(String(s));
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : s;
}

// FÁZA CERTAINTY (F4, §4.6): mapovanie istoty → štýl prstenca (CVD-safe double-encoding).
export const CERT_RING = { overene: 'solid', hypoteza: 'dashed', pasca: 'pip' };

/* ---------- W2a: DUAL-CHANNEL TVARY ----------
   farba = oblasť (area.color), tvar = typ:
     memory  → plný disk
     skill   → donut (krúžok s dierou)
     project → disk s vonkajším prstencom
     core    → zlaté súosé kruhy
   Vďaka tomu farba prestala niesť dva významy naraz. Značku istoty kreslíme až
   od úrovne 'dept' (na mape by preťažila vnem) — opts.cert to zapína. */
export function drawShape(n, x, y, r, color, opts) {
    const k = S.cam.k;
    const invK = 1 / k;
    const a = ctx.globalAlpha;
    const type = n.type;

    if (type === 'core') {
        // W3a: na mape je jadro jediná vec v strede kompozície — dostane mäkké halo
        // a tretí, najjemnejší prstenec, aby stred nepôsobil ako prázdna plocha
        // s troma bodkami. Halo pýta layout (pos.glow), inde je 0 → jadro sa nemení.
        const gl = opts && opts.glow ? opts.glow : 0;
        if (gl > 0) {
            const R = r * 3.6;
            const grd = ctx.createRadialGradient(x, y, r * 0.5, x, y, R);
            const rgb = rgbTriplet(color);
            grd.addColorStop(0, 'rgba(' + rgb + ',' + (0.17 * gl * a).toFixed(4) + ')');
            grd.addColorStop(0.42, 'rgba(' + rgb + ',' + (0.065 * gl * a).toFixed(4) + ')');
            grd.addColorStop(1, 'rgba(' + rgb + ',0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(x, y, R, 0, 7);
            ctx.fill();
            ctx.globalAlpha = a;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.46, 0, 7);
        ctx.fill();
        ctx.lineWidth = Math.max(1.1 * invK, r * 0.10);
        ctx.strokeStyle = color;
        ctx.globalAlpha = a * 0.85;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.76, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a * 0.45;
        ctx.beginPath();
        ctx.arc(x, y, r * 1.10, 0, 7);
        ctx.stroke();
        if (gl > 0) {
            ctx.globalAlpha = a * 0.20;
            ctx.lineWidth = Math.max(0.8 * invK, r * 0.055);
            ctx.beginPath();
            ctx.arc(x, y, r * 1.62, 0, 7);
            ctx.stroke();
        }
        ctx.globalAlpha = a;
        return;
    }

    /* GRAF B: TVARY V PRSTENCOVOM JAZYKU
       Predtým: spomienka = plný disk, skill = donut, projekt = disk s prstencom.
       Plný disk je ale najmenej priehľadný prvok, aký sa dá nakresliť — pri hustom
       grafe sa dva prekryté disky čítajú ako jedna škvrna. Preložené do prstencov:
         spomienka → jeden tenký prstenec
         skill     → dva súosé prstence (nadväzuje na starý „donut")
         projekt   → prstenec + malý plný stred (zostatok starej výplne = váha projektu)
       Rozlíšenie typu tak zostáva, ale všetko je duté. Šírka obrysu má podlahu
       1,1 px v obrazovkových px, aby prstenec nezmizol v antialiasingu (a s ním
       ani kontrast voči papieru). */
    const lw = Math.max(RING_LW * invK, r * 0.16);
    if (type === 'skill') {
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r), 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a * 0.78;
        ctx.lineWidth = Math.max(1.2 * invK, r * 0.12);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r * 0.50), 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    } else if (type === 'project') {
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r), 0, 7);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r * 0.32), 0, 7);
        ctx.fill();
    } else {
        // memory (a neznámy typ) — jeden prstenec
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r), 0, 7);
        ctx.stroke();
    }

    if (!opts || !opts.cert) return;

    const cc = certColors();
    if (n.origin === 'brain') {
        ctx.globalAlpha = a * 0.5;
        ctx.lineWidth = 1 * invK;
        ctx.strokeStyle = cc.borderStrong;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.6 * invK, 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    }

    const mode = S.certRings ? CERT_RING[n.certainty] : null;
    if (!mode) return;
    const rr = r + 4.2 * invK;
    const col = cc[n.certainty];
    ctx.save();
    ctx.globalAlpha = a * 0.85;
    ctx.lineWidth = 1.6 * invK;
    ctx.strokeStyle = col;
    if (mode === 'dashed') ctx.setLineDash([3 * invK, 2.4 * invK]);
    ctx.beginPath();
    ctx.arc(x, y, rr, 0, 7);
    ctx.stroke();
    if (mode === 'pip') {
        ctx.setLineDash([]);
        ctx.globalAlpha = a;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y - rr, 2 * invK, 0, 7);
        ctx.fill();
    }
    ctx.restore();
}

/* ---------- slučka ---------- */

export let lastFrame = now();
export let framePending = false;
export function frame() {
    framePending = false;
    // W2a: mimo Grafu slučka zaparkuje bez kreslenia (nulové CPU).
    if (!graphActive()) return;
    const nowMs = now();
    const dt = Math.min((nowMs - lastFrame) / 1000, 0.1);
    lastFrame = nowMs;

    // zmena S.focus zvonku (strom štruktúry / Esc / breadcrumb) → dorovnaj úroveň
    syncNavFromFocus();

    S._clock += dt;
    S._anim = animLevel();
    S._lifeTier = lifeTier();
    S._life = S._lifeTier >= 2 ? 0 : lifeLevel();
    S.cursor.a += ((S.cursor.on ? 1 : 0) - S.cursor.a) * Math.min(1, dt * 10);
    if (S.cursor.a < 0.005) S.cursor.a = 0;
    maybeSynapse();

    for (const p of S.pulses) p.t += dt * p.speed;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
        if (S.pulses[i].t >= 1) {
            S.pulses[i].to.flash = Math.min(1, (S.pulses[i].to.flash || 0) + 0.5 * S.pulses[i].dim);
            S.pulses.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
        }
    }

    for (let i = S._flows.length - 1; i >= 0; i--) {
        const f = S._flows[i];
        if (f.wait > 0) { f.wait -= dt; continue; }
        f.t += dt * f.speed;
        if (f.t >= 1) {
            if (f.to) f.to.flash = Math.min(1, (f.to.flash || 0) + 0.28 * f.dim);
            S._flows.splice(i, 1);
            S._settleFrames = Math.max(S._settleFrames, SETTLE_FRAMES);
        }
    }
    const cap = flowCap();
    if (S._flows.length > cap) S._flows.splice(0, S._flows.length - cap);

    // W2a: tweenovaná kamera pri zanorení (ease-in-out cubic, ~600 ms)
    if (S._camTween) {
        const c = S._camTween;
        c.t = Math.min(1, c.t + dt / c.dur);
        const e = easeInOut(c.t);
        S.cam.x = c.from.x + (c.to.x - c.from.x) * e;
        S.cam.y = c.from.y + (c.to.y - c.from.y) * e;
        S.cam.k = c.from.k + (c.to.k - c.from.k) * e;
        if (c.t >= 1) S._camTween = null;
    }

    // morph pozícií medzi úrovňami (rovnaký časovač ako kamera → jeden plynulý pohyb)
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

    const dimTarget = isAwake() ? 1 : SLEEP_DIM;
    const dimActive = Math.abs(dimTarget - S.dim) > 0.001;
    const ambientLife = S._life > 0; // pokoj = dýchajúce jadro + veľmi pomalý prach
    const responsive = !!S._morph || !!S._camTween || S.replay.playing || S._interacting
        || S.pulses.length > 0 || S._flows.length > 0 || S._settleFrames > 0 || dimActive;
    const active = responsive || ambientLife;

    if (S._settleFrames > 0) S._settleFrames--;

    let doDraw = responsive || S._dirty;
    if (!doDraw && ambientLife && (nowMs - S._lastAmbient) >= AMBIENT_MS) doDraw = true;

    if (doDraw) {
        const _t0 = performance.now();
        draw();
        S._drawMs += (Math.min(60, performance.now() - _t0) - S._drawMs) * 0.1;
        S._dirty = false;
        if (!responsive) S._lastAmbient = nowMs;
        updateStateUi();
    }

    if (active) scheduleFrame();
}

export function scheduleFrame() {
    // W2a: mimo obrazovky Graf sa plátno nekreslí vôbec — žiadny rAF (nulové CPU).
    if (!graphActive()) return;
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(frame);
}

export const SETTLE_FRAMES = 45;
export const AMBIENT_MS = 32;

export function requestDraw() {
    S._dirty = true;
    if (!framePending) { lastFrame = now(); scheduleFrame(); }
}

// Zaostrenie na uzol = zanorenie na úroveň 'node' (Cmd-K, hľadanie, toasty, panely).
export function focusNode(n) {
    if (!n) return;
    go({ level: 'node', node: n.id });
}

export function zoomBy(factor) {
    const before = screenToWorld(S.w / 2, S.h / 2);
    S.cam.k = Math.min(3.2, Math.max(0.14, S.cam.k * factor));
    const after = screenToWorld(S.w / 2, S.h / 2);
    S.cam.x += (after.x - before.x) * S.cam.k;
    S.cam.y += (after.y - before.y) * S.cam.k;
    S._camTween = null;
    requestDraw();
}

/* ---------- fit ---------- */

// Bbox, ktorý má kamera obsiahnuť — nakreslené uzly a huby aktuálnej úrovne.
// Pri aktívnych filtroch sa zmenší na to, čo reálne zostalo viditeľné.
export function fitBBox(L) {
    const loc = localSet();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cnt = 0;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cnt++;
    };
    for (const [id, e] of L.pos) {
        const n = S.byId.get(id);
        if (!n || !visibleInReplay(n) || !nodeVisible(n, loc)) continue;
        add(e.x, e.y);
    }
    // hub sa počíta so svojím polomerom + miestom na dvojriadkový popisok pod ním,
    // inak by hub na okraji scény vyliezol pod hlavičku alebo mu popisok odrezalo
    for (const h of L.hubs) {
        add(h.x - h.rw, h.y - h.rw);
        add(h.x + h.rw, h.y + h.rw + (h.dim >= 0.5 ? 46 : 0));
    }
    if (cnt < 2) return L.bbox;
    return { minX, minY, maxX, maxY };
}

// Kamera, ktorá bbox vloží do využiteľnej plochy viewportu (mimo railu a hlavičky).
// Rovnaké okraje ako targetBox() v layout.js → fit sadne na obe osi naraz a scéna
// vyplní ≥ 70 % šírky viewportu na každej úrovni.
export function fitCam(bbox) {
    const ins = camInsets();
    const uw = Math.max(160, S.w - ins.left - ins.right);
    const uh = Math.max(160, S.h - ins.top - ins.bottom);
    const bw = Math.max(bbox.maxX - bbox.minX, 1);
    const bh = Math.max(bbox.maxY - bbox.minY, 1);
    const k = Math.min(3.2, Math.max(0.14, Math.min(uw / bw, uh / bh)));
    const cx = (bbox.minX + bbox.maxX) / 2, cy = (bbox.minY + bbox.maxY) / 2;
    return { x: ins.left + uw / 2 - S.w / 2 - cx * k, y: ins.top + uh / 2 - S.h / 2 - cy * k, k };
}

// Legacy signatúra fitView(pad) — pad sa ignoruje, okraje riadi viewInsets().
export function fitView() {
    const L = ensureLayout();
    const c = fitCam(fitBBox(L));
    S._camTween = null;
    S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
    draw();
}

export function setupVisibilityRepaint() {
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) { lastFrame = now(); requestDraw(); }
    });
    setupPanelDodge();
}

// Otvorenie bočného panela zmenší využiteľnú plochu (camInsets), takže scéna sa mu
// má uhnúť. Kameru ale NEfitujeme — fit by zahodil ručný pan/zoom a zrušil by
// tween pri zanorení do uzla (panely.selectNode odkrýva panel ešte pred goInto).
// Namiesto toho posunieme kameru len o polovicu rozdielu pravého insetu, čím sa
// obsah odsunie spod panela a zoom aj rozbehnutá animácia zostanú nedotknuté.
function setupPanelDodge() {
    const targets = ['node-panel', 'dock', 'pack-drawer']
        .map((id) => document.getElementById(id))
        .filter(Boolean);
    if (!targets.length) return;

    const anyOpen = () => targets.some((el) => !el.classList.contains('hidden'));
    let wasOpen = anyOpen();
    let queued = false;

    const obs = new MutationObserver(() => {
        // graphActive() a stav panela testujeme SYNCHRÓNNE — keby sme čakali na
        // rAF callback, samotné naplánovanie rAF by už bolo kreslenie mimo Grafu.
        if (queued || !graphActive() || !S.nodes.length) return;
        const open = anyOpen();
        if (open === wasOpen) return;                 // iná class, nie otvorenie/zatvorenie
        wasOpen = open;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            // Posun berieme z šírky panela, nie z rozdielu insetov: pri zatváraní je
            // panel už skrytý, takže camInsets() − viewInsets() by dalo nulu.
            const shift = (panelReserve() + edgePx()) / 2;
            S.cam.x += open ? -shift : shift;
            requestDraw();
        });
    });
    for (const el of targets) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
}
