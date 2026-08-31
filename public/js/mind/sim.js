import { animLevel } from './anim.js';
import {
    PHYS, anchorOf, anchors, computeLayout, gravityOf, nodeRadius,
    normalizeAspect, syncLayout,
} from './layout.js';
import { draw, fitBBox, fitCam, graphActive, requestDraw } from './render.js';
import { S, reducedMotionActive } from './state.js';
import { registerUrlApply, writeUrl } from './urlstate.js';
import { renderBreadcrumb } from './util.js';

/* ---------- VLNA „GRAF A": FYZIKA + FILTER ZANORENIA ----------

   d3 forceSimulation je späť (odpudzovanie, hrany, gravitácia k oblasti,
   collide) — z toho vzniká organická sieť, v ktorej sa klastre prelievajú.
   Determinizmus prestal byť požiadavkou.

   Simuláciu tikáme SAMI (sim.stop() hneď po vytvorení) v rAF pumpe, ktorá:
     • mimo obrazovky Graf nešahá na requestAnimationFrame vôbec (kritérium
       „rAF mimo Grafu = 0") — dosadá ticho v dávkach cez setTimeout,
     • pri prefers-reduced-motion: reduce dosadá ticho aj NA Grafe a kreslí až
       hotový stav (WCAG 2.2.2 / 2.3.3); výnimka je ťahanie uzla,
     • po usadení (alpha < alphaMin) skončí, takže v pokoji je CPU ticho.

   Zanorenie je LEN filter: go() nastaví S.nav, prepočíta prezentáciu (kind/dim)
   a zamieri kameru. Pozície uzlov sa pri zanorení nemenia — scéna je jedna. */

export const LEVEL_ORDER = ['map', 'area', 'dept', 'node'];

/* ---------- pozície ---------- */

// Prenesie layout do n.x/n.y. Pozície v layoute vznikli z uzlov, takže je to
// zvyčajne no-op; význam má po normalizeAspect() a pri prvom builde.
// POZOR: fx/fy sa tu NEnulujú (na rozdiel od W2a) — držia ťahaný uzol.
export function applyLayoutPositions(L) {
    if (!L) return;
    for (const n of S.nodes) {
        const e = L.pos.get(n.id);
        if (e) { n.x = e.x; n.y = e.y; }
        else if (!Number.isFinite(n.x)) { n.x = 0; n.y = 0; }
    }
    if (S._needKick) { S._needKick = 0; kickSim(0.45); }
}

/* ---------- normalizácia cieľa ---------- */

// Najväčšia oblasť / oddelenie — cieľ pre klávesy 2 a 3, keď kontext chýba.
export function largestAreaId() {
    const cnt = new Map();
    for (const n of S.nodes) if (n.area_id != null) cnt.set(n.area_id, (cnt.get(n.area_id) || 0) + 1);
    let best = null, bestC = -1;
    for (const [id, c] of cnt) if (c > bestC && S.areas.has(id)) { best = id; bestC = c; }
    return best;
}

export function largestDeptId(areaId) {
    const cnt = new Map();
    for (const n of S.nodes) if (n.department_id) cnt.set(n.department_id, (cnt.get(n.department_id) || 0) + 1);
    let best = null, bestC = -1;
    for (const [id, c] of cnt) {
        const d = S.departments.get(id);
        if (!d || (areaId != null && d.area_id !== areaId)) continue;
        if (c > bestC) { best = id; bestC = c; }
    }
    return best;
}

// Doplní chýbajúci kontext (uzol pozná svoje oddelenie a oblasť) a zhodí úroveň
// nižšie, ak cieľ neexistuje. Graceful — go() sa nikdy nesekne na neplatnom id.
export function clampNav(t) {
    let level = LEVEL_ORDER.includes(t && t.level) ? t.level : 'map';
    let area = t.area != null ? +t.area : null;
    let dept = t.dept != null ? +t.dept : null;
    let node = t.node != null ? +t.node : null;

    if (node != null && S.byId.has(node)) {
        const n = S.byId.get(node);
        if (dept == null && n.department_id) dept = n.department_id;
        if (area == null && n.area_id != null) area = n.area_id;
    }
    if (dept != null && S.departments.has(dept) && area == null) area = S.departments.get(dept).area_id;

    if (level === 'node' && (node == null || !S.byId.has(node))) level = dept != null ? 'dept' : (area != null ? 'area' : 'map');
    if (level === 'dept' && (dept == null || !S.departments.has(dept))) level = area != null ? 'area' : 'map';
    if (level === 'area' && (area == null || !S.areas.has(area))) level = 'map';

    if (level === 'map') { area = null; dept = null; node = null; }
    else if (level === 'area') { dept = null; node = null; }
    else if (level === 'dept') { node = null; }
    return { level, area, dept, node };
}

function navKey(n) { return n.level + ':' + n.area + ':' + n.dept + ':' + n.node; }

/* ---------- zanorenie do adresy ----------

   JEDEN zápis pre celé zanorenie, a to `replace`: rozhodnutie 10 menuje „pohyb
   v grafe" výslovne ako `replace`, takže Späť opustí graf, nezačne prelistúvať
   dvadsať zanorení. `level` sa NEPÍŠE — implikuje ho najhlbší prítomný kľúč
   a `clampNav()` dopĺňa kontext nahor sám, takže druhý zápis by bol druhá pravda.
   Kamera do adresy neide vôbec: force layout je živý a tá istá kamera nad inak
   usadenou scénou rámuje iné miesto siete.

   `null` znamená „zmaž kľúč" — mapa je teda adresa bez a/d/n, nie `a=0`. */
function writeNavUrl(nav) {
    writeUrl({ a: nav.area, d: nav.dept, n: nav.node }, 'replace');
}

// S.focus je zrkadlo filtra pre breadcrumb a strom štruktúry — stmievanie si
// render/edges počítajú z layoutu (ent.dim), nie z focusPass.
function syncFocus(nav) {
    const areaId = nav.level === 'map' ? null : nav.area;
    const deptId = (nav.level === 'dept' || nav.level === 'node') ? nav.dept : null;
    S.focus = { areaId: areaId || null, departmentId: deptId || null };
    S._navFocusKey = S.focus.areaId + ':' + S.focus.departmentId;
}

/* ---------- fyzika ---------- */

let pumping = false;

function d3ok() {
    return typeof window !== 'undefined' && window.d3 && typeof window.d3.forceSimulation === 'function';
}

/* ROZOSTUP: prázdna zóna okolo jadra.

   Nie je to kozmetika. Uzol sa v strede scény ocitne z dvoch dôvodov, ktoré kotvy
   samy neriešia: (1) hranou k jadru, (2) hranami do inej oblasti, ktoré ho z jeho
   klastra vytiahnu na spojnicu — a spojnica dvoch bodov na venci vedie stredom.
   Meranie hovorilo jasne: dlaždica 100 × 100 px okolo jadra mala 75 % pokrytia
   uzlami, kým na okraji scény 8 %, teda deväťnásobok. Táto sila tlačí VON len uzly
   vnútri zóny a jej veľkosť ide s hĺbkou zanorenia — na okraji zóny je nulová,
   takže sa scéna nemá o čo rozkmitať a alpha dosadne rovnako ako predtým.

   Zóna je elipsa (nesie ju anizotropia scény), preto sa tlačí po gradiente elipsy,
   nie radiálne — inak by uzly nad jadrom vyliezli ďalej než tie po jeho boku.
   `anchors()` sa volá RAZ na tik (číta getComputedStyle), nie pre každý uzol. */
function holeForce() {
    let nodes = [];
    function force(alpha) {
        const A = anchors();
        if (A.mode !== 'net' || !A.hole) return;
        const { rx, ry } = A.hole;
        if (!(rx > 1 && ry > 1)) return;
        const mag0 = PHYS.holePush * alpha * ((rx + ry) / 2);
        for (const n of nodes) {
            if (n.type === 'core') continue;
            if (n.fx != null || n.fy != null) continue;      // ťahaný uzol si drží miesto
            const ux = n.x / rx, uy = n.y / ry;
            const rho = Math.hypot(ux, uy);
            if (!(rho < 1)) continue;
            const gx = n.x / (rx * rx), gy = n.y / (ry * ry);
            const g = Math.hypot(gx, gy);
            if (!(g > 1e-9)) continue;
            const mag = (1 - rho) * mag0;
            n.vx += (gx / g) * mag;
            n.vy += (gy / g) * mag;
        }
    }
    force.initialize = (ns) => { nodes = ns; };
    return force;
}

function makeForces(sim) {
    const d3 = window.d3;
    const layers = S.gview === 'layers';
    sim.force('x', d3.forceX((d) => anchorOf(d).x).strength((d) => gravityOf(d).sx));
    sim.force('y', d3.forceY((d) => anchorOf(d).y).strength((d) => gravityOf(d).sy));
    sim.force('charge', d3.forceManyBody()
        .strength(layers ? PHYS.layerCharge : PHYS.charge)
        .distanceMax(layers ? PHYS.layerChargeMax : PHYS.chargeMax));
    sim.force('collide', d3.forceCollide((d) => nodeRadius(d) + PHYS.collidePad));
    sim.force('link', d3.forceLink(S.edges)
        .id((d) => d.id)
        // Hrana k jadru je dlhá (PHYS.coreLinkDist): 43 susedov jadra sa pri dĺžke 46
        // nemá kam vojsť a collide z nich urobil nepriehľadný veniec presne tam, kde
        // má byť najviac vzduchu. Ostatné hrany držia svoju krátku dĺžku.
        .distance(layers ? PHYS.layerLinkDist
            : (e) => ((e.source && e.source.type === 'core') || (e.target && e.target.type === 'core')
                ? PHYS.coreLinkDist : PHYS.linkDist))
        .strength(layers
            ? PHYS.layerLinkStr
            : (e) => Math.min(PHYS.linkCap, PHYS.linkPer * (e.weight || 1))));
    if (layers) sim.force('hole', null);
    else sim.force('hole', holeForce());
}

// Kotvy sa d3 zapekajú pri initialize, nie pri každom tiku — po normalizeAspect()
// (ktorý mení veniec) ich treba prepiecť, inak by fyzika scénu stiahla späť.
function reinitAnchors() {
    if (!S.sim || !d3ok()) return;
    const d3 = window.d3;
    S.sim.force('x', d3.forceX((d) => anchorOf(d).x).strength((d) => gravityOf(d).sx));
    S.sim.force('y', d3.forceY((d) => anchorOf(d).y).strength((d) => gravityOf(d).sy));
}

// Vrstvy: tvrdý clamp y do pásu. Bez neho by collide + hrany vrstvy premiešali
// a metafora neurónovej siete by sa rozpadla.
function clampBands() {
    // Kotvy si vyžiadame RAZ na kolo. Predtým sa tu volalo bandOf(n) pre každý uzol
    // a to cez anchors() → anchorSig() → targetAspect() → getComputedStyle, teda
    // ~5 čítaní štýlu × 1065 uzlov × každé kolo pumpy = 579 000 volaní na jedno
    // usadenie Vrstiev (+550 ms CPU, 7,1 ms/tik vs 4,2 ms v Sieti).
    const A = anchors();
    if (A.mode !== 'layers') return;
    for (const n of S.nodes) {
        const b = A.of.get(n.id);
        if (!b) continue;
        const r = Math.min(nodeRadius(n) * 0.6, (b.y1 - b.y0) * 0.4);
        if (n.y < b.y0 + r) { n.y = b.y0 + r; n.vy = 0; }
        else if (n.y > b.y1 - r) { n.y = b.y1 - r; n.vy = 0; }
    }
}

// Kamera, ktorá obsiahne fokusovú skupinu (bez filtra = celú sieť).
function fitTarget() {
    return fitCam(focusBBox(S.layout));
}

// Počas usadzovania kamera plynulo dobieha rastúci oblak (inak by sieť vyliezla
// z viewportu a používateľ by videl len jej stred).
function easeFit(t) {
    const c = fitTarget();
    S.cam.x += (c.x - S.cam.x) * t;
    S.cam.y += (c.y - S.cam.y) * t;
    S.cam.k += (c.k - S.cam.k) * t;
}

// Ukázali sme už používateľovi aktuálny stav v tichom režime? (viď pump())
let quietShown = false;

/* P1 — prefers-reduced-motion MUSÍ platiť aj keď sa zmení ZA BEHU. Hodnotu vlastní
   `state.js` (`reducedMotionActive()`, jeden živý zdroj pre všetky moduly); tento odber
   nesie LEN vedľajší účinok, ktorý sa zvonku spraviť nedá — pumpa fyziky je lokálna:
     • zmena na reduce → nakopni pumpu, tá cez svoju tichú vetvu sieť dosadí a ZASTAVÍ,
     • zmena späť → nakopni pumpu, sieť sa opäť usadzuje plynulo.
   Ťahanie uzla (S._interacting) je z tichého režimu vyňaté — to je pohyb rukou.
   `state.js` si svoj listener registruje pri vyhodnotení modulu, teda PRED týmto (sim.js
   z neho importuje), takže `reducedMotionActive()` je tu už prepnuté. Na poradí ale
   nezáleží: `startPump()` hodnotu číta až vo svojom ďalšom kole. */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const _rmq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onReduceChange = () => {
        quietShown = false;          // nech tichá vetva znovu ukáže usadený stav
        if (S.sim) startPump();
    };
    if (_rmq.addEventListener) _rmq.addEventListener('change', onReduceChange);
    else if (_rmq.addListener) _rmq.addListener(onReduceChange);   // starší Safari
}

function pump() {
    if (!S.sim) { pumping = false; return; }
    // TICHÉ DOSADNUTIE — dva nezávislé dôvody netikať na requestAnimationFrame:
    //
    //  (1) MIMO GRAFU sa NEKRESLÍ a nesiahame na rAF, ale tikať musíme — inak alpha
    //      nikdy neklesne a nastanú dve veci naraz: (a) tento setTimeout sa preplanuje
    //      navždy, (b) `warm` v buildSim() zostane false, takže každý WS zrod uzla
    //      zaplatí studený burst ~150 ms na zablokovanom vlákne. Appka pritom štartuje
    //      na Dnes, takže to je bežný stav, nie okrajový.
    //
    //  (2) prefers-reduced-motion: reduce — plátno nesmie ukazovať usadzovanie
    //      priebežne (WCAG 2.2.2 / 2.3.3). Do 20. 8. 2026 tu stráž nebola vôbec:
    //      utíšený bol len ambient (rAF v pokoji 360 → 20), kým fyzika sa hýbala
    //      ako inak — zmerané posun uzlov 48,33 → 48,34 sveta a rAF 293 → 215.
    //      Fyzika teda ostáva (rozloženie nie je ozdoba, je to obsah), len DOSADNE
    //      A ZASTANE: kreslí sa hotový stav, nie cesta k nemu.
    //      Výnimka je ťahanie uzla (S._interacting): to je pohyb, ktorý si používateľ
    //      práve robí rukou, a bez priebežného kreslenia by ťahanie stratilo spätnú
    //      väzbu. WCAG mieri na pohyb, ktorý sa spustí sám.
    //
    // V oboch prípadoch tikáme v krátkych dávkach cez setTimeout.
    const shown = graphActive();
    if (!shown || (reducedMotionActive() && !S._interacting)) {
        // Bez pohybu by používateľ na Grafe kukal ~4 s na neusadenú scénu s
        // nezameranou kamerou. Raz teda ukážeme, kde vec stojí (skok, nie pohyb),
        // a konečný stav dokreslí finishSettle().
        if (shown && !quietShown) {
            quietShown = true;
            syncLayout(S.layout);
            if (S._fitOnSettle) { const c = fitTarget(); S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k; }
            requestDraw();
        }
        pumping = true;
        setTimeout(() => {
            pumping = false;
            if (!S.sim) return;
            const t0 = performance.now();
            // Dávka s časovým stropom, aby sa vlákno nezablokovalo na dlho. 10 ms na
            // 50 ms interval = ~20 % vyťaženia, teda nepostrehnuteľné pri čítaní
            // dashboardu, a scéna dosadá za ~4 s. Pri 8 ms/120 ms to bolo 6 % a
            // usadenie trvalo cez 9 s, čo vyzeralo ako nekonečný timer.
            while (S.sim.alpha() > S.sim.alphaMin() && performance.now() - t0 < 10) {
                S.sim.tick();
                S._simTicks++;
            }
            if (S.gview === 'layers') clampBands();
            S._simAlpha = S.sim.alpha();
            if (S.sim.alpha() > S.sim.alphaMin()) pump();
            else {
                // Na Grafe treba pozície preniesť do layoutu — v rAF ceste to robí
                // pump() každé kolo, tu nikto.
                if (graphActive()) syncLayout(S.layout);
                finishSettle();
            }
        }, 50);
        return;
    }
    pumping = true;
    const t0 = performance.now();
    // fps usadzovania: jedno kolo pumpy = jeden vyžiadaný frame, takže rozdiel
    // časov medzi kolami JE frame time. Harness číta S._pumpFps, nemeria si sám.
    if (S._pumpAt) S._pumpFps += (1000 / Math.max(1, t0 - S._pumpAt) - S._pumpFps) * 0.2;
    S._pumpAt = t0;
    const a = S.sim.alpha();
    const steps = a > 0.35 ? 2 : 1;
    for (let i = 0; i < steps; i++) S.sim.tick();
    if (S.gview === 'layers') clampBands();
    S._simMs += (Math.min(90, performance.now() - t0) - S._simMs) * 0.15;
    S._simTicks += steps;
    S._simAlpha = S.sim.alpha();

    syncLayout(S.layout);
    if (S._fitOnSettle && S._simTicks % 6 === 0) easeFit(0.26);
    requestDraw();

    if (S.sim.alpha() > S.sim.alphaMin()) { requestAnimationFrame(pump); return; }
    pumping = false;
    S._pumpAt = 0;
    finishSettle();
}

function startPump() {
    if (!pumping && S.sim) pump();
}

function finishSettle() {
    S._simSettled = true;
    S._simAlpha = S.sim ? S.sim.alpha() : 0;
    const f = normalizeAspect();
    if (f > 1.001) { reinitAnchors(); syncLayout(S.layout); }
    if (S._fitOnSettle || f > 1.001) {
        const c = fitTarget();
        const from = { x: S.cam.x, y: S.cam.y, k: S.cam.k };
        if (reducedMotionActive() || animLevel() <= 0) { S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k; }
        else S._camTween = { from, to: c, t: 0, dur: 0.45 };
        S._fitOnSettle = false;
    }
    requestDraw();
}

// Prepočet po zmene dát alebo pohľadu (WS zrod, reload, presun uzla, filtre).
// Pozície si uzly nechávajú — nový uzol dosadne k svojej kotve a sieť sa len
// dousadí (teplý štart), takže sa graf pri každom zrode neprehádže.
export function buildSim() {
    S.degree = new Map();
    for (const e of S.edges) {
        S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
        S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
    }
    S._nbFor = null; S._nbSet = null;

    const next = clampNav(S.nav);
    // Cieľ z odkazu môže medzitým zmiznúť (uzol zmazaný). `clampNav()` spadne
    // o úroveň vyššie a adresa sa musí opraviť SPOLU s tým — inak by `F5` viedol
    // do iného stavu než odkaz. Hlási to breadcrumb, nie toast (pri obnove stránky
    // sa neplatný stav plávajúcou bublinou nehlási).
    if (navKey(next) !== navKey(S.nav)) { S.nav = next; syncFocus(next); renderBreadcrumb(); writeNavUrl(next); }

    const warm = S._simTicks > 0 && S.nodes.some((n) => Number.isFinite(n.x));
    if (S.sim) S.sim.stop();

    if (!d3ok()) {
        // d3 sa nenačítalo (offline CDN) — appka musí fungovať aj tak: uzly
        // zostanú na semienkach zo svojich kotiev, len bez relaxácie.
        S.sim = null;
        const L0 = computeLayout(true);
        applyLayoutPositions(L0);
        if (!warm) {
            S._fitOnSettle = false;
            const c = fitTarget();
            S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
        }
        requestDraw();
        return L0;
    }

    const L = computeLayout(true);          // ensureSeeded() dá nové uzly ku kotvám
    // Ťahaný uzol je pripnutý na fx/fy. Keď prestavbu vyvolá niečo iné než ťahanie
    // (prepnutie pohľadu, WS zrod uzla), nová simulácia začínala s alphaTarget 0 —
    // a keďže holdSim() sa už nemá kto zavolať, sieť sa okolo držaného uzla prestala
    // prelievať až do mouseup (zmerané: „po prepnutí na Vrstvy: pinned=1, alphaT=0").
    // Držanie je stav uzlov, nie stav simulácie, takže si ho nová simulácia prečíta.
    const held = S.nodes.some((n) => n.fx != null || n.fy != null);
    const sim = window.d3.forceSimulation(S.nodes)
        .velocityDecay(PHYS.velocityDecay)
        .alphaDecay(PHYS.alphaDecay)
        .alphaMin(PHYS.alphaMin)
        .alphaTarget(held ? HOLD_ALPHA : 0);
    sim.stop();                             // tikáme sami (rAF pumpa nižšie)
    S.sim = sim;
    makeForces(sim);
    sim.alpha(warm ? PHYS.alphaWarm : PHYS.alphaCold);

    S._simSettled = false;
    quietShown = false;
    if (held) sim.alpha(Math.max(sim.alpha(), HOLD_ALPHA));
    if (!warm) { S._simTicks = 0; S._fitOnSettle = true; }
    // Tichý rozbeh, nech prvý frame nie je chaos. Pri teplom rebuilde (zrod uzla
    // z WS) len pár krokov — 26 tikov naraz je ~100 ms zaseknutého vlákna.
    sim.tick(warm ? 4 : PHYS.burst);
    if (S.gview === 'layers') clampBands();
    syncLayout(L);
    applyLayoutPositions(L);
    startPump();
    requestDraw();
    return L;
}

// Legacy „nakopnutie simulácie" — reštartuje usadzovanie (dáta, filtre, drag).
export function kickSim(alpha) {
    const a = alpha == null ? 0.35 : alpha;
    if (!S.sim) { requestDraw(); return; }
    S._simSettled = false;
    S.sim.alpha(Math.max(S.sim.alpha(), a));
    startPump();
    requestDraw();
}

// Teplota, ktorú drží ťahanie uzla. Musí byť nad PHYS.alphaMin, inak sim zaspí.
// Číta ju aj buildSim() — prestavba počas ťahania si držanie prevezme.
export const HOLD_ALPHA = 0.12;

// Ťahanie uzla: kým drží, sim nesmie zaspať (alphaTarget > alphaMin).
export function holdSim(on) {
    if (!S.sim) { requestDraw(); return; }
    S.sim.alphaTarget(on ? HOLD_ALPHA : 0);
    if (on) { S._simSettled = false; S.sim.alpha(Math.max(S.sim.alpha(), HOLD_ALPHA)); startPump(); }
}

/* ---------- verejné API: zanorenie ako filter ---------- */

function ensureDegree() {
    if (S.degree && S.degree.size) return;
    S.degree = new Map();
    for (const e of S.edges) {
        S.degree.set(e.source_id, (S.degree.get(e.source_id) || 0) + 1);
        S.degree.set(e.target_id, (S.degree.get(e.target_id) || 0) + 1);
    }
}

// Rám fokusovej skupiny — čo má kamera po zanorení obsiahnuť. Berie uzly s
// ent.dim ≥ 0.5 (presne fokus z computeLayout) plus ich popisky.
function focusBBox(L) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cnt = 0;
    const add = (x, y) => {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        cnt++;
    };
    for (const [id, e] of L.pos) {
        if (e.dim < 0.5) continue;
        const n = S.byId.get(id);
        if (!n) continue;
        const r = nodeRadius(n) * (e.mul || 1) + 8;
        add(e.x - r, e.y - r);
        add(e.x + r, e.y + r);
    }
    for (const h of L.hubs) {
        if (h.dim < 0.5 || h.kind === 'layer') continue;
        add(h.x - h.rw, h.y - h.rw);
        add(h.x + h.rw, h.y + h.rw + 46);
    }
    if (cnt < 2) return fitBBox(L);
    // minimálny rozsah — zanorenie na jeden uzol nesmie vystreliť zoom na strop
    const MIN = 620;
    if (maxX - minX < MIN) { const c = (minX + maxX) / 2; minX = c - MIN / 2; maxX = c + MIN / 2; }
    if (maxY - minY < MIN * 0.6) { const c = (minY + maxY) / 2; minY = c - MIN * 0.3; maxY = c + MIN * 0.3; }
    return { minX, minY, maxX, maxY };
}

function aimCamera(L, animate, level) {
    const to = fitCam(focusBBox(L));
    /* PODLAHA ZOOMU JE V CIELI TWEENU, nie pred ním. Zanorenie na uzol malo
       podlahu (`S.cam.k = max(S.cam.k, 1.1)`) priradenú volajúcim PRED tweenom,
       takže kamera najprv skočila a až potom sa plynulo doletela — dva pohyby na
       jedno gesto. V cieli je to jeden pohyb a tween drží celú cestu. */
    if (level === 'node') to.k = Math.max(to.k, 1.1);
    if (!animate) {
        S.cam.x = to.x; S.cam.y = to.y; S.cam.k = to.k;
        S._camTween = null;
        return;
    }
    S._camTween = { from: { x: S.cam.x, y: S.cam.y, k: S.cam.k }, to, t: 0, dur: 0.55 };
}

// Nastavenie filtra zanorenia + zameranie kamery. Pozície sa nemenia.
export function go(target = {}) {
    ensureDegree();
    const next = clampNav(Object.assign({}, S.nav, target));
    const same = navKey(next) === navKey(S.nav);
    const first = !S.layout;
    if (same && !first) { requestDraw(); return next; }

    S.nav = next;
    try { localStorage.setItem('hades.nav', JSON.stringify(next)); } catch (e) { /* full storage — nič */ }
    // Poloha čitateľa do adresy. `localStorage` zostáva pamäťou zariadenia (druhý
    // tab si ju prepíše), adresa je to, čo sa dá poslať.
    writeNavUrl(next);
    syncFocus(next);
    S.view = 'graph';

    const L = computeLayout(true);
    renderBreadcrumb();
    /* PRECHOD STMIEVANIA (zamrznuté rozhranie §2.3): `go()` je filter, nie výmena
       scény — pozície sa nemenia a mení sa len `ent.dim`. Tween nesie ČAS, cieľ
       nesie `computeLayout()`; interpoláciu robí `render.js` a nikto iný toto pole
       nečíta ani nepíše. `null` = sadni v jednom rámci: pri tichej verzii
       (`prefers-reduced-motion`) aj pri vypnutých animáciách má byť zmena okamžitá,
       nie zamrznutá v polovici. */
    const animate = !first && !reducedMotionActive() && animLevel() > 0;
    S._dimTween = animate ? { t0: S._clock, dur: 0.18 } : null;
    // Používateľ zamieril sám → usadzovanie mu už kameru nemá preberať.
    if (!first) S._fitOnSettle = false;
    aimCamera(L, animate, next.level);
    if (graphActive()) draw();   // nech cieľ nezabliká pred prvým rAF framom
    requestDraw();
    return next;
}

// Čitateľný stav pre breadcrumb / iné vlny.
export function currentPath() {
    const nav = S.nav;
    const area = nav.area != null ? S.areas.get(nav.area) : null;
    const dept = nav.dept != null ? S.departments.get(nav.dept) : null;
    const node = nav.node != null ? S.byId.get(nav.node) : null;
    const crumbs = [{ level: 'map', label: S.name || 'Hades', id: null }];
    if (area) crumbs.push({ level: 'area', label: area.name, id: area.id });
    if (dept) crumbs.push({ level: 'dept', label: dept.name, id: dept.id });
    if (node) crumbs.push({ level: 'node', label: node.label, id: node.id });
    return {
        level: nav.level,
        area: nav.area, dept: nav.dept, node: nav.node,
        areaName: area ? area.name : null,
        deptName: dept ? dept.name : null,
        nodeName: node ? node.label : null,
        view: S.gview,
        crumbs,
    };
}

// O úroveň von (klik do prázdna, #btn-up).
export function goUp() {
    const nav = S.nav;
    if (nav.level === 'node') return go({ level: nav.dept != null ? 'dept' : (nav.area != null ? 'area' : 'map') });
    if (nav.level === 'dept') return go({ level: nav.area != null ? 'area' : 'map' });
    if (nav.level === 'area') return go({ level: 'map' });
    return nav;
}

// Zrušenie celého filtra (Esc) — späť na celú sieť.
export function clearFilter() {
    if (S.nav.level === 'map') return S.nav;
    return go({ level: 'map' });
}

// Zanorenie na to, na čo sa kliklo (hub oblasti / hub oddelenia / uzol).
export function goInto(hit) {
    if (!hit) return goUp();
    if (hit.type === 'areaHub') return go({ level: 'area', area: hit.id });
    if (hit.type === 'deptHub') return go({ level: 'dept', dept: hit.id });
    if (hit.type === 'node') {
        const n = hit.node;
        if (S.nav.level === 'map') return go({ level: 'area', area: n.area_id });
        if (S.nav.level === 'area') {
            if (n.department_id && S.departments.has(n.department_id)) return go({ level: 'dept', dept: n.department_id });
            return go({ level: 'node', node: n.id });
        }
        return go({ level: 'node', node: n.id });
    }
    return S.nav;
}

/* ---------- pohľady: Sieť / Vrstvy ---------- */

export function syncViewButtons() {
    for (const [id, v] of [['btn-view-net', 'net'], ['btn-view-layers', 'layers']]) {
        const b = document.getElementById(id);
        if (!b) continue;
        const on = S.gview === v;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

// 'net' | 'layers' prepnú POHĽAD (fyzika sa prekotví a sieť sa preleje do
// nového rozloženia). 'map' je legacy vstup z chatu = zruš filter. Čokoľvek iné
// (main.js posiela S.view === 'graph') znamená „obnov uložený stav".
export function setView(view) {
    if (view === 'net' || view === 'layers') {
        const changed = S.gview !== view;
        S.gview = view;
        try { localStorage.setItem('hades.gview', view); } catch (e) { /* full storage — nič */ }
        // Pohľad je JEDINÁ menovaná výnimka z pravidla „do adresy ide členstvo, nie
        // vzhľad": mení rozloženie, nie to, ktoré uzly sú videné — ale je to
        // pomenovaný pohľad s vlastnými tlačidlami a klávesou V, nie kozmetický
        // slider. Preto `push`: čitateľ zmenil, NA ČO sa pozerá.
        if (changed) writeUrl({ gv: view }, 'push');
        syncViewButtons();
        if (changed) {
            S._anchors = null;
            S._layerCache = null;
            S._netStretch = 1;
            S._fitOnSettle = true;
            S._simTicks = 0;              // studený štart → kamera dobehne nový rám
            buildSim();
        } else requestDraw();
        return currentPath();
    }
    if (view === 'map') return go({ level: 'map' });
    // main.js posiela S.view ('graph') = „postav fyziku a obnov uložený filter".
    // Kamera sa dorovná až po usadení (finishSettle → fokusová skupina).
    syncViewButtons();
    /* Tu sa orezáva zanorenie z odkazu prvý raz nad načítanými uzlami, takže tu sa
       musí opraviť aj adresa. Zmerané: `?n=99999999` (zmazaný uzol) spadlo na úroveň
       `dept` správne, ale `n` zostalo v adrese — `buildSim()` už rozdiel nevidel,
       pretože `clampNav()` prebehol o riadok vyššie. Adresa po načítaní musí opisovať
       to, čo je na obrazovke; inak `F5` vedie do iného stavu než odkaz. */
    const nav = clampNav(S.nav);
    const corrected = navKey(nav) !== navKey(S.nav);
    S.nav = nav;
    syncFocus(nav);
    if (corrected) writeNavUrl(nav);
    buildSim();
    renderBreadcrumb();
    return currentPath();
}

/* ---------- Späť / Dopredu: adresa je vstup ----------

   Bez tohto by tlačidlo Naspäť zmenilo adresu a nechalo scénu stáť, teda by adresa
   lhala. Aplikátor je registrovaný pod menom `graph`, pretože vlastní práve tie
   kľúče, ktoré tento modul píše (a/d/n a `gv`) — obrazovku a filtre obrazoviek
   aplikujú ich vlastníci. `urlstate.js` počas aplikovania zápisy zahadzuje, takže
   Späť nepridá nový záznam do histórie.

   `rAF` sa tu nezapína: `go()` aj `buildSim()` idú cez `requestDraw()` / pumpu,
   ktoré mimo obrazovky Graf na `requestAnimationFrame` nesiahajú vôbec. */
registerUrlApply('graph', (url) => {
    const wantView = url.gv === 'layers' ? 'layers' : 'net';
    if (wantView !== S.gview) { setView(wantView); return; }   // setView() si nav dorovná sám
    const a = url.a ? +url.a : null;
    const d = url.d ? +url.d : null;
    const n = url.n ? +url.n : null;
    const level = n ? 'node' : (d ? 'dept' : (a ? 'area' : 'map'));
    // Celý cieľ naraz (nie tri `go()`), inak by clampNav() dopĺňal kontext z toho,
    // čo práve zostalo v S.nav, a mezikroky by zamerali kameru na cudzie miesto.
    go({ level, area: a, dept: d, node: n });
});

// Zmena S.focus zvonku (strom štruktúry, breadcrumb v util.js) → dorovnaj filter.
// Volá to render.frame(), takže externý setFocus() naďalej funguje.
export function syncNavFromFocus() {
    const key = S.focus.areaId + ':' + S.focus.departmentId;
    if (key === S._navFocusKey) return false;
    S._navFocusKey = key;
    if (S.focus.departmentId) go({ level: 'dept', area: S.focus.areaId, dept: S.focus.departmentId });
    else if (S.focus.areaId) go({ level: 'area', area: S.focus.areaId });
    else go({ level: 'map' });
    return true;
}
