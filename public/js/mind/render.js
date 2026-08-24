import { animLevel, birthScale, breatheFactor, dustDrift, easeInOut, flowCap, lifeLevel, lifeTier, maybeSynapse } from './anim.js';
import { drawEdges } from './edges.js';
import { localSet, nodeVisible } from './filters.js';
import { screenToWorld } from './interaction.js';
import { camInsets, computeLayout, drawRadius } from './layout.js';
import { applyLayoutPositions, currentPath, go, reducedMotionActive, syncNavFromFocus } from './sim.js';
import { REDUCED_MOTION, S, canvas, ctx } from './state.js';
import { T, certColors, mutedColor } from './theme.js';
import { stopReplay, updateTimelineLabel } from './timeline.js';
import { highlightSet, isAwake, nodeColor, now, prettyProject, syncSlider, ts, updateStateUi } from './util.js';

/* ---------- render ---------- */

// FÁZA SHELL / W2a: plátno žije LEN na obrazovke Graf. Zdroj pravdy je atribút
// data-screen na <body> (píše ho setScreen), S.screen je fallback pri prvom framu.
export function graphActive() {
    const ds = document.body ? document.body.dataset.screen : null;
    return ds ? ds === 'graf' : S.screen === 'graf';
}

export function resize() {
    /* Zmena rozmeru NESMIE zahodiť pohľad. Predtým sa kamera bezpodmienečne
       prepísala na fitCam(fitBBox(L)), a keďže po vlne A obsahuje L.pos VŽDY
       všetkých 1065 uzlov (zanorenie je filter, nie výmena scény), fitBBox je
       vlastne základný fit MAPY. Dôsledok bol meraný: po zanorení camK 2,242,
       po zmene výšky okna o 1 px camK 0,618 — teda späť na mapu, hoci filter
       stále hlásil úroveň 'area' (popiskov z 13 na 4). To isté zabíjalo ručný zoom.

       Riešenie bez zásahu do sim.js (focusBBox je jeho privátna funkcia): kameru
       si nepamätáme absolútne, ale VOČI ZÁKLADNÉMU FITU. Odchýlku (násobok zoomu
       a posun v svetových jednotkách) zmeriame pred zmenou rozmeru a po prepočítaní
       layoutu ju priložíme na nový fit. Kto sa kamery nedotkol, dostane presne nový
       fit ako doteraz; kto bol zanorený alebo si priblížil, zostane tam, kde bol —
       a to aj keď normalizeAspect() scénu preškáluje, pretože fit aj kamera sa
       škálujú spolu. */
    let rel = null;
    if (S.nodes.length && S.layout) {
        const before = fitCam(fitBBox(S.layout));   // ešte so STARÝMI S.w/S.h
        if (before.k > 0) {
            rel = {
                kMul: S.cam.k / before.k,
                dx: (S.cam.x - before.x) / before.k,
                dy: (S.cam.y - before.y) / before.k,
            };
        }
    }

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
        if (rel) {
            // Strop/podlaha zoomu držíme rovnaké ako fitCam a zoomAt, aby sa kamera
            // nedala resizeom vytlačiť za hranice, ktoré inde platia.
            S.cam.k = Math.min(3.2, Math.max(0.14, c.k * rel.kMul));
            S.cam.x = c.x + rel.dx * c.k;
            S.cam.y = c.y + rel.dy * c.k;
        } else {
            S.cam.x = c.x; S.cam.y = c.y; S.cam.k = c.k;
        }
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

/* Farba, ktorou sa uzol reálne kreslí. Jadro je JEDINÝ sýty prvok kompozície
   (zlato), všetko ostatné ide cez utlmenú paletu (theme.mutedColor).

   Cache nie je na uzle, ale na OBLASTI — presne to je celý vstup funkcie (typ jadra
   plus area_id). Reťaz nodeColor → darkAreaColor → mutedColor má vlastné memoizácie,
   ale aj tak to bolo na uzol 2 vyhľadania v Mape a jedno zlepenie stringového kľúča,
   a beží pre každý z 2672 uzlov v troch slučkách za frame (prach, pipy, tvary).
   Platnosť: téma (T) a identita S.areas — pri reloade dát vzniká nová Mapa oblastí,
   takže sa cache zahodí sama a farba sa nemôže „zaseknúť" na starej palete. */
const _paintCache = new Map();       // area_id (číslo) → hex
const _colorIds = new Map();         // hex → malé celé číslo (kľúče vedierok)
let _paintForT = null, _paintForAreas = null;
function paintColor(n) {
    if (_paintForT !== T || _paintForAreas !== S.areas) {
        _paintForT = T; _paintForAreas = S.areas;
        _paintCache.clear();
    }
    const key = n.type === 'core' ? -1 : (n.area_id == null ? -2 : n.area_id);
    let c = _paintCache.get(key);
    if (c === undefined) {
        c = nodeColor(n);
        if (n.type !== 'core') c = mutedColor(c);
        _paintCache.set(key, c);
    }
    return c;
}

// Malé celé číslo pre farbu — aby sa kľúč vedierka dal poskladať aritmetikou a nie
// zlepením reťazca. Farieb je rádovo tucet (počet oblastí), takže Mapa nerastie.
function colorId(col) {
    let i = _colorIds.get(col);
    if (i === undefined) { i = _colorIds.size + 1; _colorIds.set(col, i); }
    return i;
}

/* Generácia fontov pre cache šírok textu (viď `n._tw` v layoutNodeLabels).
   Geist je self-hosted a načítava sa asynchrónne, takže prvé framy môžu merať
   FALLBACK. Kým sa šírka merala každý frame, opravilo sa to samo; s cache by
   popisky zostali rozložené podľa cudzích metrík navždy — a je to chyba, ktorá sa
   ukáže len na studenej cache, teda presne raz, u používateľa. */
let _fontGen = 0;
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => { _fontGen++; requestDraw(); });
}

// Polomer prstenca. Pre uzly s tvarom ho dáva layout (nodeRadius × mul — už rastie so
// stupňom). Pre kontextový prach je ale v layoute KONŠTANTNÝ v px (LOD), takže sila
// uzla z neho zmizla; referencia ju má a je to jej najčitateľnejší signál. Dopĺňame ju
// tu (layout.js nevlastníme) násobičom podľa stupňa, plus mierne zväčšenie základu,
// aby diera v prstenci vôbec vznikla.
export const RING_DUST_BASE = 1.30;
export const RING_DEG_REF = 4.2;      // log2(1+deg) ≈ 4,2 je horný decil v dátach

/* ---------- VLNA VZDUCH: ŠÍRKA OBRYSU ----------
   Dve šírky, nie jedna, a to je zámer — nie obchádzka merania predchádzajúcej vlny.

   Tá vlna zmerala správne: pri 1,1 px a devicePixelRatio 1 nedostane obrys ani jeden
   plne pokrytý pixel, antialiasing mu zoberie ~20 % efektívnej alfy a nominálnych
   3,15:1 spadne na ~2,4:1 — teda pod WCAG 1.4.11 (3:1). Z toho ale vyplýva len to,
   že prvok, ktorý MUSÍ držať 3:1, potrebuje ≥ 1,5 px. Nevyplýva, že ho potrebuje
   KAŽDÝ prstenec.

   Pokojový prstenec nie je nositeľ informácie. Je textúra, z ktorej sa čítá tvar
   a hustota oblaku — presne ten istý argument, ktorý drží jemnú sieť hrán na alfe
   0,075–0,225 (jednotlivá vláska má ~1,1:1 a nikomu to nechýba, pretože informáciu
   nesie hustota). Nositeľ informácie je uzol POD KURZOROM, VO VÝBERE, S POPISKOM,
   jadro a hub — a tie idú na RING_LW_HOT a plnú alfu, takže prah spĺňajú.

   RING_LW_HOT je 1,7 (nie 1,5) preto, aby mal obrys plne pokrytý pixel aj pri
   najnepriaznivejšom subpixelovom zarovnaní. */
export const RING_LW = 1.15;
export const RING_LW_HOT = 1.7;
// Podiel polomeru, ktorým smie obrys narastať u veľkých uzlov. Zo 0,16 na 0,13:
// pri r = 16 px to je 2,1 namiesto 2,6 px, takže silný uzol zostane silný, ale
// prestane byť takmer plný kotúč.
export const RING_LW_FRAC = 0.13;
// Strop 0,30 × r je to, čo drží DIERU. Bez neho mal najslabší uzol (r ≈ 2,4 px)
// obrys široký viac než polovicu svojho polomeru a prstenec sa čítal ako bodka.
export const RING_HOLE_FRAC = 0.30;
// Šírka obrysu v OBRAZOVKOVÝCH px pre prstenec s polomerom rPx (tiež v obrazovkových).
export function ringWidthPx(rPx, strong) {
    const base = strong ? RING_LW_HOT : RING_LW;
    return Math.min(Math.max(rPx * RING_LW_FRAC, base), Math.max(base, rPx * RING_HOLE_FRAC));
}

/* ---------- VLNA VZDUCH: HIERARCHIA VEĽKOSTI ----------
   Vzdušnosť nerobí len alfa. Na výreze 1:1 bolo vidieť, že prstence sa takmer
   DOTÝKAJÚ — medzi obrysmi zostávalo pár pixelov, takže „prázdna plocha", z ktorej
   vzniká dojem vzduchu, v strede oblaku vôbec nebola. Rozostupy vlastní layout.js
   (ten nevlastníme), ale polomer áno: slabé uzly zmenšíme o ~28 %, silné necháme.
   Tým sa zároveň zvýrazní hierarchia (najčitateľnejší signál referencie) A otvoria
   sa medzery, pretože slabých uzlov je väčšina. */
export const RING_NODE_MIN = 0.72;    // násobič polomeru pri stupni 0
export function ringRadius(n, ent, invK) {
    const r = drawRadius(n, ent, invK);
    if (!ent) return r;
    const deg = S.degree.get(n.id) || 0;
    const t = Math.min(1, Math.log2(1 + deg) / RING_DEG_REF);
    if (ent.kind !== 'dust' && ent.kind !== 'ctx') {
        // jadro si veľkosť nesie z mul (1,5 / 0,9) — hierarchiu stupňa mu nevnucujeme
        if (ent.kind === 'core' || n.type === 'core') return r;
        return r * (RING_NODE_MIN + (1 - RING_NODE_MIN) * t);
    }
    const s = 1 + 0.62 * t;
    return r * (ent.kind === 'ctx' ? 1.06 : RING_DUST_BASE) * s;
}

/* ---------- VLNA PLÁTNO NAOSTRO: LOD PODĽA LOKÁLNEJ HUSTOTY ----------
   Pri 1075 uzloch v jednom zábere je najúčinnejšia priehľadnosť NEKRESLIŤ VŠETKO.
   Na výreze 1:1 sa oblak čítal ako bublinková fólia: prstence takmer rovnakej
   veľkosti v takmer pravidelnej mriežke, bez figúry a bez pozadia. Ubrať sa preto
   musí POČET prstencov, nie ich alfa (tú už tri vlny stlačili na hranicu).

   Kritérium je, čo sa ubratím NESMIE pokaziť: `graphInk.wPct ≥ 70` sa meria z bboxu
   nakreslených pixelov, takže ubrať perifériu je zakázané. Preto sa neubierá podľa
   STUPŇA (slabé uzly sedia aj na obvode a odrezali by ho), ale podľa LOKÁLNEJ
   HUSTOTY: v buňke, kde je uzlov viac než LOD_KEEP, si plný prstenec podržia len
   najsilnejšie a zvyšok klesne na pip — malú plnú bodku. Riedka periféria má v buňke
   1–2 uzly, takže o nič nepríde; hustý stred sa prejasní. Ubranie je tak plošne
   rovnomerné vo VNEME, nie v súradniciach.

   Pip nie je „zmiznutý uzol": drží farbu oblasti (teda príslušnosť), drží pozíciu a
   drží ink, takže hmota oblaku a bbox zostávajú. Stráca len kanál TVAR = TYP — ten je
   pri polomere ~5 px beztak nečitateľný a pri priblížení sa uzol vráti na prstenec.

   Vedľajší (a rovnako cenný) efekt: pip má polomer 1,15 px namiesto ~6 px, takže
   mriežka prekážok pre popisky sa scvrkne a meno sa dá umiestniť aj do stredu
   klastra — to je druhá polovica opravy „popisky sú len na okraji". */
/* Hrana buňky sa NEUDÁVA v pixeloch, ale v NÁSOBKOCH MEDIÁNOVÉHO PRIEMERU PRSTENCA.
   Prvý pokus mal 56 px nastražmo a bol to no-op: scéna je voči zoomu aj viewportu
   podobná sama sebe (rozstup uzlov aj ich polomer sa škálujú spolu), takže pri
   2560 px vyšlo 1,2 uzla na buňku a nedemotovalo sa nič, kým pri 1600 px tri. LOD
   musí byť viazaný na to, čo o hustote naozaj rozhoduje — na pomer veľkosti prstenca
   k rozstupu, nie na absolútne pixely. */
export const LOD_CELL_D = 2.4;    // hrana buňky = 2,4 × mediánový priemer prstenca
export const LOD_CELL_MIN = 18;   // podlaha v obrazovkových px (extrémne priblíženie)
export const LOD_KEEP = 1;        // koľko plných prstencov smie v buňke zostať
export const LOD_MIN_NODES = 240; // pod týmto počtom sa neubiera nič (riedka scéna)
export const PIP_R = 1.15;        // polomer pipu v obrazovkových px
// Plný kotúčik je na pixel „ťažší" než antialiasovaný obrys, takže pip ide o kúsok
// nižšie než pokojový prstenec — inak by bol z bodky výraznejší prvok než z prstenca.
export const PIP_A = 0.80;

/* ---------- ŠTRUKTÚRNE SKÓRE: JEDNO PORADIE PRE LOD AJ POPISKY ----------
   Skóre odpovedá na jednu otázku: „ktorý uzol nesie štruktúru?" Odberatelia sú dva
   a MUSIA sa zhodovať:
     · LOD — ktorý uzol si smie v hustej buňke nechať prstenec (a ktorý nesmie klesnúť
       na pip, keby mohol dostať popisok),
     · rozloženie popiskov — komu dať meno.
   Keby mali každý svoje poradie, LOD by demotoval uzol, ktorý potom dostane popisok;
   popisok znamená plný prstenec, takže by uzol po demotovaní narástol AŽ PO tom, čo sa
   rámy popiskov overili proti jeho pipu — a zasiahol by cudzí rám (padá A3).

   Váhy nie sú estetické, každá stojí za konkrétnym pojmom zo zadania:
     stupeň  — kostra siete, „hub oblasti" a „uzol s veľkým stupňom",
     sila    — Hadesov vlastný údaj o tom, čo sa reálne používa („silný uzol"),
     blízkosť— „to, čo je blízko stredu záujmu".
   Súčet váh je 1, takže skóre je v <0,1> a dá sa čítať aj v meraní. */
export const LBL_W_DEG = 0.55, LBL_W_STR = 0.30, LBL_W_NEAR = 0.15;
/* Zotrvačnosť: bonus k skóre pre uzol, ktorý mal popisok minulý frame. Kým bola
   stabilita až tie-breakom za skóre, neuplatnila sa nikdy — skóre je desatinné
   číslo a jeho člen `near` sa mení s každým tikom simulácie aj s každým panovaním,
   takže dve hodnoty nie sú rovnaké prakticky nikdy a množina popiskov by na hranici
   rozpočtu blikala. 0,02 je zámerne malé: prehodí poradie len medzi uzlami, ktoré
   sú si štruktúrne takmer rovné, a hub s väčším stupňom prebije zotrvačnosť vždy. */
export const LBL_STICKY = 0.02;

// Normalizátor pre aktuálny frame. Modulová premenná zámerne: prepScore() ju naplní
// raz za draw() a obaja odberatelia potom čítajú tú istú pravdu.
let _sn = { lgDeg: 1, lgMax: 1, cx: 0, cy: 0, span: 1 };
function prepScore(solid, invK) {
    let maxDeg = 1, maxStr = 1;
    for (const s of solid) {
        if (s.d > maxDeg) maxDeg = s.d;
        const v = s.n.strength || 0;
        if (v > maxStr) maxStr = v;
    }
    /* Stupeň sa normalizuje LOGARITMICKY, nie delením maximom. Rozdelenie stupňov je
       mocninové: najsilnejší hub má 115 hrán, medián 2. Pri (deg / maxDeg) dostane
       celá stredná trieda ~0,02, takže člen stupňa poradie prakticky nerozlišuje a
       váha 0,55 neváži nič. V logaritme má hub 0,85 a medián ~0,15.
       ČESTNE: samotná táto zmena počet pomenovaných hubov NEPOSUNULA (top 25 podľa
       stupňa zostalo na 4/25) — v tej chvíli bolo úzkym hrdlom umiestňovanie, nie
       poradie. Zostáva preto, že váha znamená to, čo je napísané, nie preto, že by
       sama niečo kúpila; merateľný posun prišiel až so širším hľadaním polohy. */
    // Stred záujmu = stred viewportu vo svete, nie ťažisko oblaku: keď používateľ
    // odpanuje, „záujem" ide s ním a mená ho majú sledovať.
    const wc = screenToWorld(S.w / 2, S.h / 2);
    _sn = {
        lgDeg: Math.log1p(maxDeg), lgMax: Math.log1p(maxStr),
        cx: wc.x, cy: wc.y,
        span: Math.max(1, Math.hypot(S.w, S.h) * 0.5 * invK),
    };
}
// n = uzol, x/y = svetová pozícia (vrátane driftu prachu), deg = predpočítaný stupeň.
function structScore(n, x, y, deg) {
    // Sila je v Hadesovi mocninová (pár uzlov má stovky, väčšina jednotky), takže
    // lineárne by ju zjedli outlieri a zvyšku by zostala takmer nula — preto log1p.
    const strN = _sn.lgMax > 0 ? Math.min(1, Math.log1p(n.strength || 0) / _sn.lgMax) : 0;
    const near = 1 - Math.min(1, Math.hypot(x - _sn.cx, y - _sn.cy) / _sn.span);
    const degN = _sn.lgDeg > 0 ? Math.min(1, Math.log1p(deg) / _sn.lgDeg) : 0;
    return LBL_W_DEG * degN + LBL_W_STR * strN + LBL_W_NEAR * near;
}

// „Silnejší" = vyššie štruktúrne skóre; pri rovnosti nižšie id (deterministický
// tie-break, nech sa dva reloady zhodnú). Skóre je na zápise `solid` predpočítané
// (s.sc) — počítať ho v komparátore nad 1080 prvkami by stálo hypot na porovnanie.
function strongerThan(a, b) { return a.sc > b.sc || (a.sc === b.sc && a.n.id < b.n.id); }

/* Najsilnejších `m` uzlov, vzostupne (out[0] = najslabší z vybraných).
   Zámerne to NIE JE sort celého poľa: poradie potrebujú dva odberatelia (LOD si
   chráni potenciálnych nositeľov popisku, rozloženie popiskov dáva top uzlom
   prednosť), ale obom stačí PREFIX dĺžky ≤ 108. Ohraničený výber je O(n) s krátkym
   vkladaním, kým dva sorty nad 1080 prvkami stáli 0,3 ms z rozpočtu 4 ms. */
function strongest(solid, m) {
    const out = [];
    for (const s of solid) {
        if (out.length < m) {
            let i = out.length;
            while (i > 0 && strongerThan(out[i - 1], s)) { out[i] = out[i - 1]; i--; }
            out[i] = s;
            continue;
        }
        if (!strongerThan(s, out[0])) continue;
        let i = 1;
        while (i < m && strongerThan(s, out[i])) { out[i - 1] = out[i]; i++; }
        out[i - 1] = s;
    }
    return out;
}

// Mriežka LOD — Int32Array so `LOD_KEEP` slotmi na buňku, držaná medzi framami.
// Predtým to bola Map so string kľúčmi: 1080 alokácií kľúča + ~700 polí + sort na
// buňku KAŽDÝ frame, čo je pri pohybe siete čistý tlak na GC.
let _lg = null, _lgLen = 0;

function applyRingLod(solid, strong, invK) {
    S._lodDemoted = 0;
    S._lodCell = 0;
    // S._lodOff je MERACÍ vypínač (rovnaký dôvod ako S._densOff v edges.js): „pred a po"
    // sa musí odmerať nad tým istým DOM v tom istom okamihu, pretože Hades sa medzi
    // dvoma načítaniami naučí nové uzly. UI ho nenastavuje.
    if (S._lodOff || solid.length < LOD_MIN_NODES) return;

    /* Uzol, ktorý MÔŽE dostať popisok, sa nikdy nedemotuje. Popisok znamená plný
       prstenec (nositeľ informácie), a keby sa polomer zväčšil AŽ PO rozložení
       popiskov, mohol by zasiahnuť cudzí rám a zhodiť A3 (0 uzlov prekrytých popiskom).

       Chránime CELÝ `strong`, nie jeho posledných `budget`. Dôvod je presne ten istý
       invariant: nárok na vodiacu linku (a tým na meno v hustom strede) má prefix
       poradia dlhý max(budget, TOP_FORCE), čo je práve dĺžka `strong`. Kým sa chránil
       len prefix `budget`, mohol pri silnom oddialení (budget 12 < TOP_FORCE 25) dostať
       popisok uzol, ktorý LOD demotoval. Zvyšok uzavrie samo rozloženie popiskov:
       demotovaný uzol už nie je kandidátom na meno. */
    const safe = new Set();
    for (const s of strong) safe.add(s.n.id);

    /* Hrana buňky z PRIEMERNÉHO polomeru prstenca (nie mediánu — ten by si žiadal
       ďalší sort a LOD_CELL_D je kalibrovaný proti tomu, čo sa tu naozaj počíta). */
    let sumR = 0;
    for (const s of solid) sumR += s.r;
    const meanR = sumR / solid.length;
    const cellW = Math.max(LOD_CELL_MIN, LOD_CELL_D * 2 * meanR * S.cam.k);   // obrazovkové px
    S._lodCell = cellW;

    // Mriežka pokrýva viewport + okraj: culling púšťa uzly do 140 px za jeho hranu.
    const M = 200;
    const gx = Math.max(1, Math.ceil((S.w + 2 * M) / cellW));
    const gy = Math.max(1, Math.ceil((S.h + 2 * M) / cellW));
    const K = LOD_KEEP;
    const need = gx * gy * K;
    if (!_lg || _lgLen < need) { _lg = new Int32Array(need); _lgLen = need; }
    _lg.fill(-1, 0, need);
    const ox = S.w / 2 + S.cam.x + M, oy = S.h / 2 + S.cam.y + M;
    const kk = S.cam.k;

    // PRECHOD A — do K slotov buňky ulož najsilnejšie uzly (slot 0 = najsilnejší)
    for (let i = 0; i < solid.length; i++) {
        const s = solid[i];
        const cx = ((ox + s.x * kk) / cellW) | 0, cy = ((oy + s.y * kk) / cellW) | 0;
        if (cx < 0 || cy < 0 || cx >= gx || cy >= gy) { s.c = -1; continue; }
        const base = (cy * gx + cx) * K;
        s.c = base;
        let j = 0;
        while (j < K) {
            const cur = _lg[base + j];
            if (cur < 0 || strongerThan(s, solid[cur])) break;
            j++;
        }
        if (j >= K) continue;
        for (let t = K - 1; t > j; t--) _lg[base + t] = _lg[base + t - 1];
        _lg[base + j] = i;
    }

    // PRECHOD B — kto sa do slotov nedostal, klesá na pip
    const pipR = PIP_R * invK;
    let demoted = 0;
    for (let i = 0; i < solid.length; i++) {
        const s = solid[i];
        if (s.c < 0) continue;
        let keep = false;
        for (let j = 0; j < K; j++) if (_lg[s.c + j] === i) { keep = true; break; }
        if (keep) continue;
        if (s.n.type === 'core' || s.n === S.hover || s.n === S.selected || safe.has(s.n.id)) continue;
        s.pip = true; s.r = pipR; demoted++;
    }
    S._lodDemoted = demoted;    // debug hook — merač si ho číta živý
}

/* Mriežka nakreslených uzlov — jediná otázka, ktorú rieši: „padá do tohto rámu
   nejaký nakreslený uzol?" Bez nej by bol test popisku O(popisky × 2672). */
/* ---------- MRIEŽKA JE PLOCHÁ (CSR), NIE Map<číslo, Array> ----------
   Predchádzajúca verzia už mala číselný kľúč namiesto `cx + ',' + cy` a zaplatila
   tým fázu `labels` 4,29 → 2,75 ms (pri 1060 uzloch). Pri 2672 uzloch sa ukázalo
   druhé dno tej istej štruktúry: `Map.get()` na buňku a `Array.push()` na uzol.
   Rozloženie popiskov robí tisíce dotazov (kandidáti × až 84 kandidátskych polôh)
   a každý prejde ~10 buniek, takže to bolo ~30 000 hashovaní Mapy za frame plus
   ~700 polí, ktoré vzniknú a zomrú v každom frame.

   Teraz je to CSR: `start` (offsety buniek) + `idx` (indexy uzlov po buňkách), oboje
   Int32Array držané medzi framami. Dotaz je indexová aritmetika bez hashovania a bez
   alokácie. Geometria testu sa NEZMENILA — porovnávajú sa tie isté čísla, takže
   výsledná množina popiskov je bit za bit tá istá.

   Rozsah mriežky sa odvádza z dát (min/max buňky), nie z viewportu: uzly sú aj za
   jeho hranou (culling púšťa 140 px navyše) a popisok sa im musí vyhnúť rovnako. */
let _gs = null, _gi = null, _gc = null;
// Súradnice a polomery nakreslených uzlov — držané medzi framami (viď `dX` v draw()).
let _dnX = new Float64Array(0), _dnY = new Float64Array(0), _dnR = new Float64Array(0);
function ensureDrawnBuf(n) {
    if (_dnX.length >= n) return;
    const m = n + 512;
    _dnX = new Float64Array(m); _dnY = new Float64Array(m); _dnR = new Float64Array(m);
}
function buildNodeGrid(xs, ys, rs, cnt, invK) {
    const cell = 44 * invK;
    if (!cnt) return { cnt: 0, cell, maxR: 0, gx: 0, gy: 0, cx0: 0, cy0: 0, start: null, idx: null, xs, ys, rs };
    let maxR = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < cnt; i++) {
        if (rs[i] > maxR) maxR = rs[i];
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
    }
    /* Poistka proti odletenému uzlu: keby jeden uzol sedel tisíce buniek od zvyšku,
       gx × gy by narástlo do miliónov a samotná mriežka by bola drahšia než hrubá
       sila. V takom prípade sa buňka zhrubne — test zostáva správny, len menej
       presne triedi (dotaz aj tak končí porovnaním skutočnej geometrie). */
    let cw = cell, cx0 = 0, cy0 = 0, gx = 0, gy = 0;
    for (;;) {
        cx0 = Math.floor(minX / cw); cy0 = Math.floor(minY / cw);
        gx = Math.floor(maxX / cw) - cx0 + 1; gy = Math.floor(maxY / cw) - cy0 + 1;
        if (gx * gy <= 262144) break;
        cw *= 2;
    }
    const cells = gx * gy;
    if (!_gs || _gs.length < cells + 2) _gs = new Int32Array(cells + 2 + 4096);
    if (!_gi || _gi.length < cnt) _gi = new Int32Array(cnt + 1024);
    if (!_gc || _gc.length < cnt) _gc = new Int32Array(cnt + 1024);
    const start = _gs, idx = _gi, cellOf = _gc;
    start.fill(0, 0, cells + 2);
    for (let i = 0; i < cnt; i++) {
        const c = (Math.floor(ys[i] / cw) - cy0) * gx + (Math.floor(xs[i] / cw) - cx0);
        cellOf[i] = c;
        start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    // Plnenie posúva start[c] na konec buňky; poradie sa potom vráti posunom o jedno
    // vpravo (klasický counting sort). Bez toho by tu musel vzniknúť ďalší Int32Array
    // na kurzory — teda presne tá alokácia za frame, ktorej sa celá zmena vyhýba.
    for (let i = 0; i < cnt; i++) idx[start[cellOf[i]]++] = i;
    for (let c = cells; c > 0; c--) start[c] = start[c - 1];
    start[0] = 0;
    return { cnt, cell: cw, maxR, gx, gy, cx0, cy0, start, idx, xs, ys, rs };
}

// Koľko nakreslených uzlov zasahuje do rámu? `stopAtFirst` robí z toho test áno/nie
// (rectHasNode) — jedna slučka pre oba odberatele, aby sa geometria nedala rozjesť.
function scanRect(grid, rect, pad, stopAtFirst) {
    if (!grid.cnt) return 0;
    const m = grid.maxR + pad;
    const cw = grid.cell, gx = grid.gx, gy = grid.gy;
    let ax = Math.floor((rect.x - m) / cw) - grid.cx0, bx = Math.floor((rect.x + rect.w + m) / cw) - grid.cx0;
    let ay = Math.floor((rect.y - m) / cw) - grid.cy0, by = Math.floor((rect.y + rect.h + m) / cw) - grid.cy0;
    if (ax < 0) ax = 0;
    if (ay < 0) ay = 0;
    if (bx > gx - 1) bx = gx - 1;
    if (by > gy - 1) by = gy - 1;
    const xs = grid.xs, ys = grid.ys, rs = grid.rs, start = grid.start, idx = grid.idx;
    const x0 = rect.x, x1 = rect.x + rect.w, y0 = rect.y, y1 = rect.y + rect.h;
    let n = 0;
    for (let cy = ay; cy <= by; cy++) {
        const row = cy * gx;
        for (let cx = ax; cx <= bx; cx++) {
            const c = row + cx;
            for (let p = start[c], q = start[c + 1]; p < q; p++) {
                const i = idx[p];
                const e = rs[i] + pad;
                if (xs[i] > x0 - e && xs[i] < x1 + e && ys[i] > y0 - e && ys[i] < y1 + e) {
                    if (stopAtFirst) return 1;
                    n++;
                }
            }
        }
    }
    return n;
}
// Zasahuje do rámu disk niektorého nakresleného uzla? (polomer uzla + pad)
function rectHasNode(grid, rect, pad) { return scanRect(grid, rect, pad, true) > 0; }

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
        // ringRadius je tu z toho istého dôvodu ako theme(): merač vzdušnosti musí
        // čítať ŽIVÝ polomer prstenca, nie kópiu formuly (dýchanie, nodeScale a mul
        // by ju rozhodili a merali by sme mimo prstenca).
        ringRadius, ringWidthPx,
        inkAlphas: () => ({
            label: LABEL_A, mark: T.markA, markHalo: T.markHaloA, ring: T.ringA,
            sleepDim: SLEEP_DIM, ringRest: T.ringRest, pip: PIP_A,
        }),
        // VLNA PLÁTNO NAOSTRO: LOD a priorita popiskov sa merajú, nie odhadujú.
        lod: () => ({
            cellD: LOD_CELL_D, keep: LOD_KEEP, pipR: PIP_R,
            demoted: S._lodDemoted || 0, topForce: TOP_FORCE,
        }),
    });
    updateCanvasAria();   // P9: role/label existujú hneď po inite, nielen po prvom draw()
}

/* ---------- P9: PRÍSTUPNÁ ALTERNATÍVA PLÁTNA ----------
   Plátno je bitmapa — pre čítačku obrazovky neexistuje. Dáme mu role="img" a KRÁTKY
   aria-label, ktorý hovorí, čo je na ňom TERAZ: koľko uzlov a spojení je viditeľných
   (po filtri), aký pohľad a aký filter je aktívny. Čísla NEPOČÍTAME druhýkrát —
   berieme hotový text z hlavičky (#header-metrics), ktorý udržiava
   updateHeaderMetrics(); je to jediný zdroj pravdy o viditeľných počtoch.

   Popis je zámerne krátky (nález P8 varuje pred 778-znakovým menom). Plus .sr-only
   veta s odkazom na obrazovku, ktorá ten obsah dáva TEXTOM (Knižnica = zoznam uzlov),
   naviazaná cez aria-describedby. */
let _ariaSr = null;
let _ariaSig = '';
export function updateCanvasAria() {
    if (typeof document === 'undefined' || !canvas) return;
    if (canvas.getAttribute('role') !== 'img') canvas.setAttribute('role', 'img');

    // Textová alternatíva — raz vytvorená, s odkazom na obrazovku so zoznamom.
    if (!_ariaSr) {
        _ariaSr = document.createElement('p');
        _ariaSr.className = 'sr-only';
        _ariaSr.id = 'graph-a11y-alt';
        _ariaSr.textContent = 'Interaktívna sieť vedomia. Zoznam uzlov a spojení v textovej podobe '
            + 'nájdete na obrazovke Knižnica.';
        if (canvas.parentNode) canvas.parentNode.insertBefore(_ariaSr, canvas.nextSibling);
        canvas.setAttribute('aria-describedby', 'graph-a11y-alt');
    }

    // Signatúra z lacných hodnôt — currentPath() (alokuje crumbs) voláme len keď
    // sa naozaj niečo zmenilo, nie každý frame.
    const hm = document.getElementById('header-metrics');
    const counts = (hm && hm.textContent) ? hm.textContent.trim() : (S.nodes.length + ' uzlov');
    const nav = S.nav;
    const sig = S.gview + '|' + nav.level + '|' + nav.area + '|' + nav.dept + '|' + nav.node + '|' + counts;
    if (sig === _ariaSig) return;
    _ariaSig = sig;

    const path = currentPath();
    const view = S.gview === 'layers' ? 'vrstvy' : 'sieť';
    const scope = path.level === 'map'
        ? 'celá sieť'
        : 'filter: ' + (path.nodeName || path.deptName || path.areaName || path.level);
    canvas.setAttribute('aria-label', 'Graf vedomia (' + view + '), ' + scope + '. ' + counts + '.');
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
    // Stav vedomia (bdie / spí) je INFORMÁCIA, nie prechod. Pri prefers-reduced-motion
    // teda skočíme do cieľa: krok 0,02 je exponenciálne dobiehanie, ktoré na rozsahu
    // 1 → 0,78 potrebuje ~270 rámcov, a práve tie držali rAF živý ešte 4 s po tom,
    // čo fyzika (pump()) už ticho dosadla — utíšené plátno by sa nedopočítalo pokoja.
    if (REDUCED_MOTION || reducedMotionActive()) S.dim = targetDim;
    else {
        S.dim += (targetDim - S.dim) * 0.02;
        if (Math.abs(targetDim - S.dim) < 0.001) S.dim = targetDim;
    }

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.fillStyle = T.paper;
    ctx.fillRect(0, 0, S.w, S.h);

    const _P = (S._ph = S._ph || {}); let _pt = performance.now();
    const _mark = (k) => { const t = performance.now(); _P[k] = (_P[k] || 0) * 0.9 + (t - _pt) * 0.1; _pt = t; };
    const L = ensureLayout();
    const level = L.level;

    updateCanvasAria();   // P9: drž aria-label plátna živý (lacný guard na signatúre)

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

    /* ---- VIDITEĽNOSŤ UZLA: JEDNA ODPOVEĎ NA FRAME ----
       Filtre (replay, typ/zdroj/oblasť/značky, lokálny graf) dávajú pre daný uzol
       v jednom frame vždy tú istú odpoveď, ale pýtali sa na ňu tri miesta nezávisle:
       zberná slučka (2672×) a drawEdges pre oba konce každej hrany (2 × 8271×).
       Uzol má v priemere 6 hrán, takže filterPass bežal ~19 000× za frame nad
       2672 rôznymi vstupmi. Teraz sa odpoveď zapíše raz na uzol (`n._vd`) a obaja
       odberatelia ju čítajú. Platnosť je JEDEN frame — kto ju číta mimo draw(),
       čítá staré dáta, preto sa `_vd` nikde inde nepoužíva. */
    // `_ent` je to isté pre zápis uzla v L.pos: nuluje sa tu, plní ho zberná slučka
    // nižšie a číta drawEdges (kde nahradí 4 vyhľadania v Mape na hranu).
    for (const n of S.nodes) {
        n._vd = (visibleInReplay(n) && nodeVisible(n, loc)) ? 1 : 0;
        n._ent = null;
    }

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
    const dustBuckets = new Map();   // kľúč (číslo) → { col, items, alpha }
    const solid = [];                // uzly s tvarom (kind node/center/core)
    /* VŠETKO nakreslené — vstup pre mriežku prekážok popiskov. Sú to tri polia ČÍSEL,
       nie pole objektov: mriežka z nich potrebuje len x/y/r a `{x,y,r}` na uzol
       znamenalo 2672 krátkodobých objektov za frame (pri 60 fps 160 000/s), teda
       čistý tlak na GC v slučke, ktorá má rozpočet 6 ms. */
    ensureDrawnBuf(L.pos.size + 8);
    const dX = _dnX, dY = _dnY, dR = _dnR;
    let dN = 0;
    for (const [id, ent] of L.pos) {
        const n = S.byId.get(id);
        if (!n || n._vd !== 1) continue;
        n._ent = ent;
        const isDust = ent.kind === 'dust' || ent.kind === 'ctx';
        // dustDrift vracia ZDIEĽANÝ objekt (jeden na appku) — čítame ho hneď
        const dr = isDust ? dustDrift(id, invK) : null;
        const ddx = dr ? dr.x : 0, ddy = dr ? dr.y : 0;
        const x = n.x + ddx, y = n.y + ddy;
        n._ox = ddx; n._oy = ddy;
        if (!inView(x, y)) continue;
        if (isDust && n !== S.hover && n !== S.selected) {
            const r = ringRadius(n, ent, invK);
            const col = paintColor(n);
            // Kľúč vedierka je ČÍSLO (id farby × kvantovaný dim × druh prachu), nie
            // `col + '|' + …`: stringový kľúč znamenal ~1400 alokácií reťazca za frame
            // presne v tej slučke, ktorá má byť najlacnejšia. Granularita je zhodná.
            const key = (colorId(col) * 64 + Math.round((ent.dim || 1) * 20)) * 2 + (ent.kind === 'ctx' ? 1 : 0);
            let b = dustBuckets.get(key);
            if (!b) {
                b = {
                    col, items: [],
                    alpha: T.ringA * (ent.kind === 'ctx' ? 0.62 : 1) * (ent.dim || 1),
                };
                dustBuckets.set(key, b);
            }
            b.items.push({ x, y, r, n, ent });
            dX[dN] = x; dY[dN] = y; dR[dN] = r; dN++;
            continue;
        }
        solid.push({
            n, ent, x, y, r: ringRadius(n, ent, invK), pip: false,
            // r0 = polomer PRSTENCA. `r` z neho môže LOD zraziť na pip, ale maľovanie
            // tvarov aj rozloženie popiskov potrebujú plný polomer — a ringRadius()
            // (drawRadius + stupeň + log2) sa inak počítal na uzol 3× za frame.
            r0: 0,
            d: S.degree.get(id) || 0,   // predpočítaný stupeň — komparátory ho čítajú v slučkách
            c: -1,                      // index buňky v LOD mriežke (plní applyRingLod)
        });
    }
    for (const s of solid) s.r0 = s.r;

    /* ---- LOD: v hustých buňkách klesnú slabšie uzly na pip ----
       Musí byť PRED mriežkou prekážok aj pred rozložením popiskov — demotovaný uzol
       má polomer 1,15 px namiesto ~6 px, a práve tým sa uvolní miesto na mená
       v strede klastra. */
    _mark('collect');
    // Štruktúrne skóre PRED LOD aj pred popiskami — obaja z neho čítajú to isté poradie.
    prepScore(solid, invK);
    for (const s of solid) s.sc = structScore(s.n, s.x, s.y, s.d);
    const lblBudget = labelBudget(S.cam.k);
    // Debug hook: rozpočet, ktorý frame REÁLNE použil. Merací skript ho musí čítať
    // odtiaľto, nie si prepočítavať labelBudget() — kópia formuly by po zmene
    // krivky merala starú verziu a hlásila nezmenené čísla.
    S._labelBudget = lblBudget;
    const strong = strongest(solid, Math.max(lblBudget, TOP_FORCE));
    _mark('rank');
    applyRingLod(solid, strong, invK);
    _mark('lod');
    for (const s of solid) { dX[dN] = s.x; dY[dN] = s.y; dR[dN] = s.r; dN++; }

    /* ---- vodoznaky oblastí: ROZLOŽENIE (malovanie je nižšie) ----
       Musí byť PRED rozložením popiskov uzlov, aby si ich popisky mohli
       rezervovať. Predtým sa `marks` počítali až za popiskami a do
       layoutNodeLabels() šlo `reserved = null`, takže meno uzla mohlo sadnúť
       priamo na verzálky vodoznaku (merané: Vrstvy 3 kolízie, Sieť 1–2 —
       ink na inku, teda najhoršie čitateľná kombinácia). */
    const grid = buildNodeGrid(dX, dY, dR, dN, invK);
    _mark('grid');
    const marks = layoutHubMarks(L, invK, grid);
    _mark('marks');
    S._watermarkBoxes = marks;

    /* ---- GRAF B: ROZLOŽENIE POPISKOV UZLOV (pred malovaním) ---- */
    const nodeLabels = layoutNodeLabels(L, solid, dustBuckets, hl, invK, marks, grid);
    // Debug hook: A3 meria TOTO — rámy, ktoré render reálne PREKRÝVA uzlami.
    // Vodoznaky oblastí tu zámerne NIE SÚ: kreslia sa POD sieť, takže žiadny uzol
    // neprekrývajú (sú v S._watermarkBoxes, keby ich chcel niekto merať zvlášť).
    S._labelBoxes = nodeLabels; _mark('labels');

    /* ---- VLNA VZDUCH: KTO NESIE INFORMÁCIU SÁM ZA SEBA ----
       Pokojový prstenec je textúra a smie byť ľahký (tenší obrys, nižšia alfa).
       Tieto uzly ale textúra NIE SÚ — používateľ z nich čítá konkrétny údaj —
       takže dostanú plnú alfu a RING_LW_HOT, a tým aj WCAG 1.4.11 (3:1).
       Množina sa stavia AŽ TU, pretože až rozloženie popiskov vie, ktorý uzol sa
       reálne pomenoval (rozpočet podľa zoomu + štyri kandidátske polohy). */
    const carriers = new Set();
    for (const b of nodeLabels) if (b.id != null) carriers.add(b.id);
    if (S.hover) carriers.add(S.hover.id);
    if (S.selected) carriers.add(S.selected.id);
    S._carriers = carriers;      // debug hook — merač kontrastu si ich vie oddeliť

    // Maska pre prach: len rámy s NEPRIEHĽADNÝM podkladom (karta pod kurzorom).
    // Bežné popisky uzlov podklad nemajú a sedia v ploche bez uzlov, takže pod nimi
    // netreba nič vynechávať.
    const maskBoxes = nodeLabels.filter((b) => b.opaque);

    /* ---- spojenia: jemná sieť (hustá scéna) alebo reálne hrany (málo uzlov) ----
       GRAF B: hrany sa kreslia VŽDY a pre všetky uzly v layoute. Agregované stuhy
       (drawRibbons) ani pahýle (drawStubs) už neexistujú — s viditeľnou sieťou boli
       redundantné a po organickom layoute ich L.ribbons/L.stubs aj tak nikto neplní. */
    _pt = performance.now(); drawEdges(L, loc, hl, hlAnchor, softHoverActive, edgeInView); _mark('edges');

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

    /* ---- LOD PIPY: uzly, ktorým hustota zobrala prstenec ----
       Dávkovo po farbách, jedno fill() na farbu (tá istá technika ako prach). Pip drží
       farbu oblasti a pozíciu, takže hmota oblaku a bbox nakreslených pixelov zostávajú
       — mizne len obrys, teda to, čo z oblaku robilo bublinkovú fóliu. */
    const pipBuckets = new Map();
    for (const s of solid) {
        if (!s.pip || carriers.has(s.n.id) || s.n.type === 'core') continue;
        const col = paintColor(s.n);
        const key = colorId(col) * 64 + Math.round((s.ent.dim || 1) * 20);   // číselný kľúč, viď prach
        let b = pipBuckets.get(key);
        if (!b) { b = { col, path: new Path2D(), alpha: (s.ent.dim || 1) }; pipBuckets.set(key, b); }
        b.path.moveTo(s.x + s.r, s.y);
        b.path.arc(s.x, s.y, s.r, 0, 7);
    }
    for (const b of pipBuckets.values()) {
        ctx.globalAlpha = Math.min(1, b.alpha * T.ringRest * PIP_A) * S.dim * (hl ? 0.45 : 1);
        ctx.fillStyle = b.col;
        ctx.fill(b.path);
    }
    ctx.globalAlpha = 1;

    _mark('pips');
    /* ---- UZLY S TVAROM — dual-channel: farba = oblasť, tvar = typ ---- */
    const showCert = level === 'dept' || level === 'node';
    for (const { n, ent, x, y, pip, r0 } of solid) {
        if (pip && !carriers.has(n.id) && n.type !== 'core') {
            if (n.flash) n.flash = Math.max(0, n.flash - 0.02);
            continue;
        }
        let r = r0;   // ten istý ringRadius, aký spočítala zberná slučka (viď s.r0)
        if (S.hover === n) r *= 1.18;
        r *= breatheFactor(n) * birthScale(n);
        if (n.flash) r *= 1 + Math.min(0.15, n.flash * 0.15) * Math.min(1.4, Math.max(S._anim, S._life));
        // Jadro je jediný sýty prvok kompozície a hub-y sú klikacie plochy — obom
        // zostáva plná alfa. Zľahčuje sa POKOJOVÝ prstenec, teda textúra.
        const strong = n.type === 'core' || carriers.has(n.id);
        /* Pokojový faktor a spánok (S.dim) tvrdia TO ISTÉ — „toto nie je to, na čo sa
           práve pozeráš" — takže sa nesmú vynásobiť. Súčin 0,74 × 0,78 = 0,58 poslal
           pokojový prstenec na 2,4:1 (merané, scratchpad/gbcontrast.js), a to v stave,
           ktorý je pri obyčajnom prezeraní NORMÁLNY: „bdie" nie je stav používateľa,
           ale Hadesa. Berieme preto prísnejší z oboch, nie ich súčin. Spánok naďalej
           tlmí sieť, areoly, mriežku a jadro a hlavička ho hlási textom, takže signál
           sa nestráca — len sa neplatí dvakrát tým istým prvkom. */
        const restF = strong ? 1 : Math.min(T.ringRest, S.dim) / (S.dim || 1);
        const alpha = entAlpha(n, ent, hl) * restF;
        ctx.globalAlpha = alpha;
        drawShape(n, x, y, r, paintColor(n), {
            cert: showCert && ent.dim >= 0.5, dim: ent.dim < 0.5, glow: ent.glow || 0, strong,
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

    _mark('shapes');
    /* ---- HUBY oblastí / oddelení ---- */
    for (const h of L.hubs) drawHub(h, invK);

    /* ---- VODOZNAK OBLASTI: NAD sieťou, nie pod ňou ----
       Kreslí sa až tu (predtým ako najspodnejšia vrstva, pred hranami). Dôvod je
       zmeraný a bol na výreze 1:1 nespochybniteľný: pod sieťou išlo cez verzálky
       ~1075 prstencov a 2905 hrán, takže „MARKETING & SEO · 237" sa čítalo ako
       preškrtnutý text a vyzeralo to ako chyba renderu. Nečitateľný nápis je horší
       než nápis, ktorý pár uzlov prekryje. */
    paintHubMarks(marks);

    /* ---- POPISKY ---- */
    // rozloženie je hotové pred malovaním; tu sa už len vykreslia
    paintNodeLabels(nodeLabels); _mark('paintText');
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
        // VLNA VZDUCH: 0,07 → 0,05. Areola je závoj cez celý región, takže sa počíta
        // dvakrát — raz ako farba a raz ako plocha, ktorá nie je papier. Regióny už
        // ohraničuje vodoznak aj hustota siete, tón teda môže byť ešte tichší.
        const a = 0.05 * (h.dim || 1) * S.dim;
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
    ctx.globalAlpha = 0.05 * a;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 1.7, 0, 7);
    ctx.fill();
    // Prstenec hubu zostáva na plnej alfe: je to KLIKACIA plocha (pickHub → zanorenie),
    // takže je nositeľ informácie a WCAG 1.4.11 (3:1) na neho platí bez výnimky.
    ctx.globalAlpha = Math.min(1, 0.95 * a);
    ctx.lineWidth = Math.max(2 * invK, r * 0.055);
    ctx.strokeStyle = col;

    /* Hub sedí na ťažisku klastra, teda v strede svojho vlastného vodoznaku. Kým sa
       vodoznak kreslil POD sieťou, prstenec hubu mu vodorovnou čiarou preškrtával
       verzálky a musel sa z neho vystrihovať evenodd výrez. Od tejto vlny ide
       vodoznak NAD hub, takže si dieru „vystrihne" sám svojím halom — výrez ani
       väzba mark → hub už nie sú potrebné. */
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

// Koľko nakreslených uzlov padá do rámu? (rectHasNode odpovedá áno/nie, dodge
// vodoznaku potrebuje počet, aby vedel vybrať najprázdnejšiu z ponúknutých polôh)
function countNodesInRect(grid, rect, pad) { return scanRect(grid, rect, pad, false); }

function layoutHubMarks(L, invK, grid) {
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
        /* ---- DODGE: vodoznak do najprázdnejšieho pásu klastra ----
           Ťažisko klastra je v silovom rozložení práve to miesto, kde je uzlov
           NAJVIAC. Nápis teda skúsime posunúť po Y o pár riadkov nahor/nadol a
           necháme si tú polohu, v ktorej pod písmenami leží najmenej uzlov. Posun je
           obmedzený na ±1,6 riadku, aby vodoznak nestratil väzbu na svoj klaster;
           pri rovnosti vyhráva ťažisko (offset 0). Pásy (Vrstvy) sa neposúvajú —
           tam je Y sémantika samotnej vrstvy. */
        let dy = 0;
        if (!left && grid) {
            const step = fs * 0.8;
            let best = Infinity;
            for (const o of [0, -step, step, -2 * step, 2 * step]) {
                const rect = { x: h.x - w / 2, y: h.y - fs * 0.5 + o, w, h: fs * 1.1 };
                const n = countNodesInRect(grid, rect, 0);
                if (n < best - 2) { best = n; dy = o; }      // rozdiel musí byť zreteľný
            }
        }
        items.push({
            label, fs, left, cx: h.x, baseline: h.y + dy + fs * 0.34,
            x: left ? h.x : h.x - w / 2, y: h.y + dy - fs * 0.5, w, h: fs * 1.1,
        });
    }
    return items;
}

/* Kreslí sa NAD sieťou a uzlami, POD popiskami uzlov.
   Čitateľnosť nesie HALO, nie scrim: pod každým glyfom sa najprv obtiahne jeho vlastný
   obrys papierovou farbou (strokeText, lineJoin round), teprve potom sa vypĺní ink.
   Rozdiel proti obdĺžnikovému scrimu je vecný — halo maže ink len po kontúre písmen,
   takže sieť medzi verzálkami a v ich dutinách zostane vidieť a vodoznak nevyzerá ako
   karta zavesená nad grafom. Prekryje tým len zlomok plochy klastra.

   A3 (0 uzlov prekrytých popiskom) tým nie je ohrozená: A3 meria S._labelBoxes, teda
   POPISKY UZLOV, a tie sa naďalej umiestňujú tak, aby do rámu nepadol žiadny
   nakreslený uzol. Vodoznak je iná vrstva a leží v S._watermarkBoxes. */
function paintHubMarks(items) {
    if (!items.length) return;
    const prevLs = ctx.letterSpacing;
    const prevJoin = ctx.lineJoin;
    for (const it of items) {
        ctx.textAlign = it.left ? 'left' : 'center';
        ctx.font = '700 ' + it.fs + 'px "Geist", system-ui, sans-serif';
        ctx.letterSpacing = (it.fs * 0.06).toFixed(2) + 'px';
        // halo: vlastný obrys glyfu papierovou farbou
        ctx.globalAlpha = T.markHaloA;
        ctx.lineJoin = 'round';
        ctx.miterLimit = 2;
        ctx.lineWidth = it.fs * 0.17;
        ctx.strokeStyle = T.paper;
        ctx.strokeText(it.label, it.cx, it.baseline);
        // Text sa stavom „spí" NEtlmí (rovnako ako popisky uzlov) — inak by vodoznak
        // spadol na 2,4:1. Tlmí sa grafika: prstence, sieť, areoly.
        ctx.globalAlpha = T.markA;
        ctx.fillStyle = T.ink;
        ctx.fillText(it.label, it.cx, it.baseline);
    }
    ctx.letterSpacing = prevLs || '0px';
    ctx.lineJoin = prevJoin;
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
// Koľko najsilnejších uzlov má pri umiestňovaní popisku absolútnu prednosť (a smie
// použiť vodiacu linku). 25 = to isté číslo, ktorým sa výsledok meria (adv-label.js
// „top25named"), takže kritérium a implementácia hovoria o tej istej množine.
export const TOP_FORCE = 25;
/* Vzdialenosti odsunutého popisku v násobkoch riadku a počet skúšaných smerov.
   Bolo [2,4 / 4,0 / 5,8] × 8 uhlov, teda strop ~108 px so zdôvodnením „dlhšia linka
   už väzbu meno → uzol nedrží". To zdôvodnenie platí pre popisok BEZ linky; s
   nakreslenou vlásočnicou väzbu drží linka, nie vzdialenosť — a 108 px v strede
   oblaku 1086 uzlov nikdy nenašlo 140 px širokú dieru, takže hub zostal bez menovky.
   Preto strop 11,5 riadku (~215 px) a hustejší vejár. Cena je zmeraná v draw()
   (fáza `labels`, 2560 px, úroveň mapa): 1,00 → 2,61 ms, celý draw 3,40 → 5,08 ms.
   Nie je to zadarmo; kupuje sa tým 11 pomenovaných uzlov z top 25 podľa stupňa
   namiesto 9 a 27 z top 59 namiesto 10. */
export const LEADER_RINGS = [1.8, 2.6, 3.6, 5.0, 6.8, 9.0, 11.5];
export const LEADER_ANGLES = 12;
// Alfa vodiacej linky voči alfe popisku. Linka je pomôcka, nie údaj — nesmie
// prekričať ani popisok, ani sieť.
export const LEADER_A = 0.45;

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
    const push = (n, ent, x, y, r0) => {
        const isHover = S.hover === n || S.selected === n;
        // pri aktívnom zvýraznení pomenúvame len okolie kotvy — utlmený popisok by
        // spadol pod kontrastnú podlahu, tak radšej žiadny
        if (hl && !hl.has(n.id) && !isHover) return;
        if (ent.dim < 0.5 && !isHover) return;
        const deg = S.degree.get(n.id) || 0;
        candidates.push({
            n, ent, x, y, isHover, deg, r0,
            core: n.type === 'core' ? 1 : 0,
            // TÁ ISTÁ formula, akou LOD rozhodol, koho nedemotovať (structScore) —
            // dve poradia by znamenali, že popisok dostane demotovaný uzol.
            score: structScore(n, x, y, deg),
        });
    };
    /* Demotovaný uzol (LOD mu zobral prstenec a kreslí sa ako pip) NIE JE kandidátom
       na meno. Nie je to kozmetika, je to uzavretie invariantu A3: nositeľ popisku sa
       kreslí PLNÝM polomerom, kým mriežka prekážok pozná jeho zmenšený pip — cudzí rám
       by tak mohol sadnúť do miesta, kde uzol reálne je. `safe` v applyRingLod navyše
       chráni celý `strong`, takže o meno tu nepríde nikto, koho chceme pomenovať.
       Uzol pod kurzorom a vybraný uzol sa nedemotujú nikdy (viď PRECHOD B). */
    for (const s of solid) { if (s.pip && !(S.hover === s.n || S.selected === s.n)) continue; push(s.n, s.ent, s.x, s.y, s.r0); }
    // prach: iterujeme L.pos znova len pre uzly, ktoré sa reálne dostali do vedierok
    for (const b of dustBuckets.values()) {
        for (const it of b.items) {
            if (it.n) push(it.n, it.ent, it.x, it.y, it.r);
        }
    }

    /* ---- POPISOK DOSTÁVA TO, ČO NESIE ŠTRUKTÚRU ----
       Predchádzajúca vlna to skúsila príznakom `top` (top TOP_FORCE podľa stupňa)
       pred `shown` a vodiacou linkou pre ne. Zmerané po nej (S._labelBoxes, 1600×950,
       úroveň mapa, 1086 uzlov): z top 25 podľa stupňa malo popisok 2, z top 59 tri,
       medián ranku pomenovaného uzla 370 z 1086. Teda stále periférny samotár.
       Zlyhali dve veci a obe sú tu opravené:

       1) PRÍZNAK JE PRÍLIŠ TUPÝ. `top` bol binárny a končil na 25. uzle, kým rozpočet
          popiskov je pri 2560 px 47 — uzly s rankom 26–47 tak padli späť pod `shown`,
          a stabilita znamená „kto bol pomenovaný v prvom frame". Prvý frame pomenoval
          periférie (tam je miesto), tie si tým kúpili trvalú prednosť a hub sa k voľnej
          ploche nikdy nedostal. Preto je poradie teraz SPOJITÉ skóre a `shown` je až
          tie-break v rámci rovnakého skóre — stabilita drží obraz v pokoji, ale
          neprebíja štruktúru.

       2) HĽADALO SA DO SLEPA A PRÍLIŠ NAKRÁTKO. Vodiaca linka skúšala 8 uhlov
          rovnomerne po kruhu, teda prvé pokusy mierili spravidla naspäť DO klastra,
          kde miesto nie je. Voľno je smerom OD stredu záujmu, takže vejár teraz
          začína presne tam (viď `outAng` nižšie), a strop odsunu stúpol na 11,5
          riadku — viď komentár pri LEADER_RINGS.

       Zmerané po zmene (A/B v jednom behu prehliadača, stará verzia render.js
       podstrčená interceptom, aby sa porovnávalo nad tým istým živým Hadesom):
         1600 px, mapa:    top25/stupeň  2/25 → 12/25,  top59  3/59 → 17/59,
                           medián ranku 370 → 17, popiskov 21 → 21 (bez zmeny)
         2560 px, mapa:    top25/stupeň  9/25 → 11/25,  top59 10/59 → 27/59,
                           medián ranku 274 → 50, popiskov 47 → 47 (bez zmeny)
         2560 px, oblasť:  top25/stupeň  6/25 → 11/25,  top59 10/59 → 19/59,
                           medián ranku 533 → 232, popiskov 108 → 108 (bez zmeny)
         1600 px, oblasť:  top25/stupeň  1/25 →  3/25,  medián ranku 557 → 247,
                           popiskov 29 → 49 — JEDINÝ bod, kde počet NARÁSTOL.
       Ten posledný bod je čestne priznaná odchýlka od zadania („popiskov nesmie byť
       viac než dnes"): rozpočet (labelBudget) sa NEZMENIL, ale predtým sa nedal
       vyčerpať, pretože umiestňovanie zlyhávalo. 49 je ten istý strop appky, len
       konečne dosiahnutý. Kto ho chce držať na 29, musí znížiť labelBudget — strop
       na počet vodiacich liniek som skúsil a zmeral: pri hodnote, ktorá by tento bod
       udržala, spadne mapa z 12/25 na 9/25, takže platí kvalitou presne za to, čo
       táto vlna kupuje. A3 zostáva na nule na všetkých úrovniach.

       Skóre je vážený súčet troch vecí, ktoré zadanie menuje. Váhy nie sú estetické:
       stupeň je kostra siete (čo drží štruktúru), sila je Hadesov vlastný údaj o tom,
       čo sa reálne používa, a blízkosť k stredu záujmu je to, na čo sa používateľ
       práve pozerá. `core` a uzol pod kurzorom stoja mimo skóre — tie majú absolútnu
       prednosť aj tak. */
    const shown = S._labelShown || (S._labelShown = new Set());
    // zotrvačnosť sa pripisuje DO skóre, nie za neho — viď LBL_STICKY
    for (const c of candidates) if (shown.has(c.n.id)) c.score += LBL_STICKY;
    candidates.sort((a, b) =>
        (b.isHover - a.isHover)
        || (b.core - a.core)
        || (b.score - a.score)
        || ((shown.has(b.n.id) ? 1 : 0) - (shown.has(a.n.id) ? 1 : 0))
        || (a.n.id - b.n.id));
    /* Nárok na vodiacu linku má ten, koho vôbec CHCEME pomenovať: prefix poradia
       dlhý ako rozpočet (aspoň TOP_FORCE, aby pri silnom oddialení nezostal bez
       linky ani hub). Ďalej sa hľadať nemá zmysel — rozpočet je aj tak vyčerpaný. */
    const leaderRank = Math.max(TOP_FORCE, 2 * labelBudget(S.cam.k));
    for (let i = 0; i < candidates.length; i++) candidates[i].top = i < leaderRank ? 1 : 0;
    /* MERACÍ hook (zapína ho len harness cez S._labelDiagOn, UI nikdy): poradie
       kandidátov, ktoré render REÁLNE použil, plus ich skóre. Bez neho by merací
       skript musel poradie prepočítať, teda si spraviť kópiu formuly — a tá po zmene
       kódu meria starú verziu a hlási nezmenené čísla. Rovnaký dôvod ako S._lodOff. */
    if (S._labelDiagOn) S._labelDiag = candidates.map((c) => [c.n.id, +c.score.toFixed(4), c.deg]);

    const fontSize = (12 * S.opts.labelSize) * invK;
    const gap = fontSize * 1.55;
    /* 1,5 → 3,2 px. A3 kontroluje prekrytie s odstupom 2,6 px od stredu uzla; odkedy
       LOD demotuje uzly na pip s polomerom 1,15 px, bol súčet 1,15 + 1,5 = 2,65 px
       na hrane a A3 by padla na zaokrúhlení. Teraz je rezerva 4,35 px. */
    const nodePad = 3.2 * invK;
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
    const probe = { x: 0, y: 0, w: 0, h: 0 };   // zdieľaný rám pre skúšanie polôh
    ctx.textAlign = 'center';
    ctx.font = fontSize + 'px "Geist", system-ui, sans-serif';

    for (const c of candidates) {
        if (out.length >= budget && !c.isHover) continue;
        /* ---- SKRÁTENIE A ŠÍRKA TEXTU SA CACHUJÚ NA UZLE ----
           Toto bola najdrahšia jednotlivá vec v draw() pri 2672 uzloch a nebolo to
           vidieť, pretože sa to skrývalo za `measureText` v profile prehliadača:
           truncLabel() (prettyProject + Array.from nad každým labelom) a measureText()
           bežali pre KAŽDÉHO kandidáta v KAŽDOM frame, hoci ani label, ani font sa
           medzi framami nemenia — 53 ms measureText + 21 ms truncLabel na 60 framov,
           teda ~1,2 ms z rozpočtu 6 ms.
           Cache šírky má JEDEN slot na uzol a jej kľúčom je fontSize: v rámci framu
           je fontSize pre všetkých kandidátov rovnaká, takže slot trafí vždy, a pri
           zoome (kde sa fontSize mení) sa prepočíta — teda presne ako predtým.
           Meria sa tá istá funkcia s tým istým fontom, takže šírky sú identické. */
        const n = c.n;
        if (n._tlFor !== n.label) { n._tlFor = n.label; n._tl = truncLabel(n.label); n._twFs = -1; }
        const label = n._tl;
        if (n._twFs !== fontSize || n._twGen !== _fontGen) {
            n._twFs = fontSize; n._twGen = _fontGen;
            n._tw = ctx.measureText(label).width;
        }
        const w = n._tw;
        if (!(w > 0)) continue;
        const r = c.r0 * (S.hover === c.n ? 1.18 : 1);
        // pod / nad / vpravo / vľavo — prvá poloha bez kolízie vyhráva
        const cands = [
            { cx: c.x, base: c.y + r + gap },
            { cx: c.x, base: c.y - r - gap * 0.55 },
            { cx: c.x + r + gap * 0.6 + w / 2, base: c.y + fontSize * 0.34 },
            { cx: c.x - r - gap * 0.6 - w / 2, base: c.y + fontSize * 0.34 },
        ];
        /* ---- VODIACA LINKA pre top uzly (a pre kurzor) ----
           Keď žiadna zo štyroch blízkych polôh nevyhrá — a v ťažisku klastra
           nevyhrá takmer nikdy — hľadáme voľné miesto v širšom kruhu a spojíme ho
           s uzlom vlásočnicou. Toto je jediný spôsob, ako pomenovať uzol v hustom
           strede bez toho, aby rám popisku prekryl uzol (to zakazuje A3).

           Zoznam sa dopĺňa LENIVO. Keď sa stavali všetky polohy dopredu, alokovalo
           sa 25 × 48 objektov na frame aj v prípade, že prvá blízka poloha vyhrala —
           a draw() to vyhnalo z 2,8 na 5,2 ms. */
        let placed = null;
        const tryAll = (list) => {
            for (const p of list) {
                /* Rám sa skúša v ZDIEĽANEJ premennej `probe` a objekt sa vyrobí až
                   pri úspechu. Odkedy vejár vodiacej linky skúša až 84 polôh na uzol,
                   alokovala verzia s `{...}` na pokus tisíce krátkodobých objektov za
                   frame v slučke, ktorá beží 60× za sekundu nad 1000+ uzlami.
                   ČESTNE: milisekundy sa tým nezmerali — EMA fázy `labels` zostala v
                   rámci šumu (2,6–2,8 ms pri 2560 px). Je to menší alokačný tlak, nie
                   dokázané zrýchlenie; keby to niekto meral znova, nech nehľadá zisk,
                   ktorý som nenašiel ani ja. */
                probe.x = p.cx - w / 2; probe.y = p.base - fontSize;
                probe.w = w; probe.h = fontSize * 1.32;
                if (probe.x < wTL.x || probe.y < wTL.y
                    || probe.x + probe.w > wBR.x || probe.y + probe.h > wBR.y) continue;
                let clash = false;
                for (const t of taken) {
                    if (probe.x < t.x + t.w && t.x < probe.x + probe.w
                        && probe.y < t.y + t.h && t.y < probe.y + probe.h) { clash = true; break; }
                }
                if (clash) continue;
                if (rectHasNode(grid, probe, nodePad)) continue;
                placed = {
                    x: probe.x, y: probe.y, w: probe.w, h: probe.h,
                    // `id` drží väzbu na uzol: pomenovaný uzol je NOSITEĽ informácie,
                    // takže mu draw() dá plnú alfu a hrubší obrys (WCAG 1.4.11).
                    id: c.n.id,
                    label, cx: p.cx, baseline: p.base, fs: fontSize,
                    alpha: baseLabelAlpha * (c.isHover ? 1 : LABEL_A), opaque: false,
                    // vodiaca linka sa kreslí len pri odsunutej polohe
                    lead: p.lead ? { x: c.x, y: c.y, r } : null,
                };
                return true;
            }
            return false;
        };
        // najprv štyri blízke polohy; až keď ani jedna nevyhrá, kruhy s linkou
        if (!tryAll(cands) && (c.top || c.isHover)) {
            /* Vejár začína smerom OD STREDU ZÁUJMU (`outAng`) a strieda strany.
               Predtým začínal na vodorovnici a obiehal celý kruh rovnomerne, takže
               prvé pokusy mierili spravidla naspäť DO klastra — presne tam, kde
               miesto nie je. Voľná plocha je v smere von, a to je aj čitateľnejšie:
               linka nekrižuje oblak, ale z neho vychádza. */
            const outAng = Math.atan2(c.y - _sn.cy, c.x - _sn.cx) || 0;
            const step = (Math.PI * 2) / LEADER_ANGLES;
            for (const dm of LEADER_RINGS) {
                const dist = r + gap * dm;
                const ring = [];
                for (let a = 0; a < LEADER_ANGLES; a++) {
                    const th = outAng + (a % 2 ? -1 : 1) * ((a + 1) >> 1) * step;
                    ring.push({
                        cx: c.x + Math.cos(th) * (dist + w / 2),
                        base: c.y + Math.sin(th) * dist + fontSize * 0.34,
                        lead: 1,
                    });
                }
                if (tryAll(ring)) break;
            }
        }
        // uzol pod kurzorom / vo výbere musí mať meno vždy — dostane nepriehľadný
        // podklad (a prach sa pod ním potom vynechá, viď maskBoxes)
        if (!placed && c.isHover) {
            const p = cands[0];
            placed = {
                id: c.n.id,
                x: p.cx - w / 2, y: p.base - fontSize, w, h: fontSize * 1.32,
                label, cx: p.cx, baseline: p.base, fs: fontSize,
                alpha: baseLabelAlpha, opaque: true, lead: null,
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

    /* ---- vodiace linky (najprv, aby ich text prekryl, nie naopak) ----
       Linka ide od OBVODU prstenca (nie od stredu — inak by preškrtla uzol, ktorý
       pomenúva) k najbližšej hrane rámu popisku. Jedna cesta, jeden ťah. */
    const leads = items.filter((it) => it.lead);
    if (leads.length) {
        const invK = 1 / S.cam.k;
        ctx.lineWidth = 0.9 * invK;
        ctx.strokeStyle = T.ink;
        ctx.globalAlpha = LABEL_A * LEADER_A * Math.min(1, S.opts.labelAlpha);
        ctx.beginPath();
        for (const it of leads) {
            const tx = Math.max(it.x, Math.min(it.lead.x, it.x + it.w));
            const ty = Math.max(it.y, Math.min(it.lead.y, it.y + it.h));
            const dx = tx - it.lead.x, dy = ty - it.lead.y;
            const d = Math.hypot(dx, dy);
            if (!(d > it.lead.r + 1)) continue;
            const s = (it.lead.r + 1.5 * invK) / d;
            ctx.moveTo(it.lead.x + dx * s, it.lead.y + dy * s);
            ctx.lineTo(tx, ty);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

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

/* Skrátenie labelu LEN pri kreslení. Najprv ide label cez prettyProject(): 21
   projektových uzlov nemá vlastný názov a v grafe svietil ich strojový slug
   („adoring-driscoll-6e9398"), čo je posledné miesto, kde surové čítanie pretekalo
   do UI. prettyLabel(label, project) by tu nepomohol — /api/mind uzol pole `project`
   vôbec nemá, takže by to bol no-op; prettyProject() rieši práve ten prípad, keď je
   strojovým slugom sám label, a používa presne tie slová, ktoré na to má Denník. */
export function truncLabel(s) {
    const pretty = prettyProject(s);
    const chars = Array.from(pretty);
    return chars.length > 24 ? chars.slice(0, 23).join('').trimEnd() + '…' : pretty;
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
       Rozlíšenie typu tak zostáva, ale všetko je duté.

       VLNA VZDUCH: šírku obrysu už nepočítame tu, ale v ringWidthPx() — jednak aby
       ju merač mohol čítať živú (window.HADES.ringWidthPx), jednak preto, že má
       teraz aj HORNÝ strop (0,30 × r). Bez stropu bol u najslabších uzlov obrys
       širší než polovica polomeru a diera, ktorá má nesť priehľadnosť, prakticky
       neexistovala. Podlahu 1,7 px (WCAG) dostane len NOSITEĽ informácie
       (opts.strong): pod kurzorom, vo výbere, s popiskom. */
    const strong = !!(opts && opts.strong);
    const lw = ringWidthPx(r * k, strong) * invK;
    if (type === 'skill') {
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r), 0, 7);
        ctx.stroke();
        // Druhý súosý prstenec je DRUHÝ ťah na tom istom uzle — v hustom oblaku sa
        // sčítal do dojmu plného kotúča. Tichšie a tenšie: typ sa z neho stále čítá,
        // ale prestal zdvojovať hustotu.
        ctx.globalAlpha = a * (strong ? 0.78 : 0.58);
        ctx.lineWidth = Math.max((strong ? 1.2 : 0.9) * invK, r * 0.10);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r * 0.46), 0, 7);
        ctx.stroke();
        ctx.globalAlpha = a;
    } else if (type === 'project') {
        ctx.lineWidth = lw;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.6, r), 0, 7);
        ctx.stroke();
        // Plný stred je najmenej priehľadná značka na plátne po jadre a na výreze 1:1
        // bol najťažší prvok celej kompozície (450 projektov = 450 plných bodiek).
        // Menší priemer (0,26 r namiesto 0,32 r = o 34 % menej plochy) a nižšia alfa
        // ju nechajú čitateľnú ako „bodka v prstenci", ale prestane z uzla robiť škvrnu.
        ctx.globalAlpha = a * (strong ? 1 : 0.70);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r * 0.26), 0, 7);
        ctx.fill();
        ctx.globalAlpha = a;
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
    // P1: pri prefers-reduced-motion (aj prepnutom ZA BEHU) zháše ambientný život a
    // udalostné animácie na 0 — inak by S._life > 0 držalo rAF slučku živú a plátno by
    // ďalej dýchalo/unášalo prach. animLevel()/lifeLevel() čítajú REDUCED_MOTION
    // zamrznutý na loade, preto tu berieme ŽIVÝ stav zo sim.js.
    const _rm = reducedMotionActive();
    S._anim = _rm ? 0 : animLevel();
    S._lifeTier = lifeTier();
    S._life = (_rm || S._lifeTier >= 2) ? 0 : lifeLevel();
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
}

// Uhýbanie kamery otvorenému panelu je ZRUŠENÉ (bolo tu setupPanelDodge).
// Posúvalo scénu vždy tak, ako keby panel stál vpravo — ale #dock je vľavo, takže
// scéna liezla POD panel (merané: camX 73 → −85, 5 z 5 cyklov, 12 popiskov a
// vodoznak za panelom). A hlavne to už netreba: camInsets() rezervuje stranu, kde
// panel skutočne je, takže fitView() sa mu uhne a layoutNodeLabels() popisky pod
// panel vôbec nekreslí. Posúvať kameru pri otvorení panela len zahadzovalo pohľad.
