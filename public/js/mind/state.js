/* Query string. `urlstate.js` je JEDINÉ miesto v repe, ktoré ho číta aj píše
   (rozhodnutie 27 + 31), takže `state.js` sa ho nikdy nedotkne priamo — do
   27. 8. 2026 tu bolo jediné čítanie URL v celom JS (`?screen=`) a zároveň jediné
   miesto, kde adresa mohla lhať. `urlstate.js` neimportuje z `mind/` nič, takže
   tento import nezavádza cyklus. */
import { bootValue, flushUrl, urlValue, wireUrlState, writeUrl } from './urlstate.js';

/* KÁNON AKCENTU — jadro je jediná zlatá plocha na plátne.
   Hodnota MUSÍ zostať zhodná s tokenom --gold v :root (mind.css), inak legenda
   v paneli (panels.js kreslí jadro cez var(--gold)) hovorí inú farbu než plátno.
   Interaktívny stav na plátne — hover, výber, žiara, zrod — je VŽDY teal cez
   T.accent; zlatá nesmie nikdy označovať stav, len identitu jadra. */
export const CORE_COLOR = '#b88a3a';

// FÁZA HRANY: základné stlmenie hrán (~40 %) — uzly a popisky vyniknú nad sieťou.
export const EDGE_DIM = 0.6;
export const canvas = document.getElementById('mind');
export const ctx = canvas.getContext('2d');

/* ---------- BOOT: URL > localStorage > default V KÓDE ----------

   Poradie je záväzné (manuál §10) a to tretie miesto je dôvod, prečo tu tie
   defaulty vôbec sú: na čerstvom profile appka pri boote zapisovala len 2 z 15
   kľúčov, takže „default v úložisku" neexistuje a čítať ho odtiaľ znamená čítať
   nič. `localStorage` sa pýtame IBA keď kľúč v adrese nie je — to rozhoduje
   `bootValue()` v `urlstate.js`, jednom mieste, nie pätnástich.

   Čítanie úložiska musí byť v `try/catch`: privátne okno a plné úložisko hodia,
   a pád tu by zhodil celý modul, ktorý importuje každý ďalší. */
function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
}

function lsJson(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key) || 'null');
        return v == null ? fallback : v;
    } catch (e) { return fallback; }
}

/* Platnosť obrazovky sa overuje MARKUPOM, nie druhým zoznamom mien. Zoznam
   vlastní `screens.js` (`SCREENS`) a importovať ho odtiaľ nemožno — `state.js`
   importuje každý modul a vznikol by cyklus. Tretia kópia zoznamu je pritom presne
   tá chyba, ktorá tu už raz bola: pri pridaní obrazovky Runy sa na zadrôtovaný
   zoznam zabudlo a uložená voľba `runy` tichým fallbackom padla na `dnes`.
   Markup je zdroj, ktorý sa nedá zabudnúť aktualizovať — bez cieľa v raile (alebo
   sekcie v `#screens`) obrazovka neexistuje. Musia sa prijať OBA markery a je to
   namerané, nie opatrnosť: `#screens .screen` má len sedem sekcií, pretože Graf je
   plátno, nie sekcia — kontrola len podľa `#screen-<slug>` odmietla `?screen=graf`,
   teda presne tú skratku, na ktorej stojí Electron shell aj `bin/hades.cmd`. */
function validScreen(name) {
    if (!name) return null;
    // Hodnota už prešla validátorom slugu v `bootValue()`, takže do selektora ide
    // len [a-z0-9-]; `try` je poistka, aby chybný selektor nikdy nezhodil boot.
    try { if (document.querySelector('#rail .dest[data-screen="' + name + '"]')) return name; } catch (e) { /* zlý selektor = neplatná obrazovka */ }
    return document.getElementById('screen-' + name) ? name : null;
}

const BOOT_SCREEN = validScreen(bootValue('s', lsGet('hades.screen'), 'dnes')) || 'dnes';

export const S = {
    name: 'Hades',
    nodes: [],
    edges: [],
    areas: new Map(),
    departments: new Map(),
    byId: new Map(),
    sim: null,
    cam: { x: 0, y: 0, k: 0.85 },
    dpr: 1, w: 0, h: 0,
    pulses: [],
    hover: null,
    selected: null,
    focus: { areaId: null, departmentId: null },
    _hlFor: null,
    _hlSet: null,
    // Lokálny graf (Obsidian local graph). Kľúč `loc` je `<rootId>.<depth>` v JEDNOM
    // kľúči, pretože bez koreňa hĺbka nič neznamená a dva kľúče by dovolili polovičný
    // stav. Doteraz žil len v pamäti taba — do URL patrí, mení KTORÉ uzly sú videné.
    local: (() => {
        const v = urlValue('loc');
        if (!v) return null;
        const [root, depth] = v.split('.');
        return { rootId: +root, depth: +depth };
    })(),
    _localFor: null,
    _localSet: null,
    degree: new Map(),    // nodeId → počet hrán, prepočet v buildSim
    connectFrom: null,    // id zdrojového uzla pri ručnom prepájaní (connect mode)
    awakeUntil: 0,
    awakeMinutes: 5,
    dim: 1,
    activations: [],
    replay: { on: false, t: 1, playing: false, tMin: 0, tMax: 0 },
    // Zvuk je preferencia zariadenia — do URL nepatrí (zdieľaný odkaz by ju vnucoval).
    sound: lsGet('hades.sound') !== 'off',
    audio: null,
    // S.view ostáva len ako spätne kompatibilné zrkadlo ('graph') pre staré čítania.
    view: 'graph',
    // VLNA GRAF A: pohľad na scénu — 'net' (organická sieť) alebo 'layers'
    // (vodorovné pásy podľa layer_role). Prepínač je v hlavičke (#graph-tools).
    gview: bootValue('gv', lsGet('hades.gview'), 'net'),
    // Zanorenie = FILTER nad jednou veľkou scénou (nie prepnutie scény):
    // level: 'map' | 'area' | 'dept' | 'node'; area/dept/node = id kontextu.
    //
    // Z adresy sa čítajú `a` / `d` / `n`; `level` KĽÚČ NIE JE — implikuje ho najhlbší
    // prítomný z tých troch, pretože `clampNav()` dopĺňa kontext nahor sám (namerané:
    // `go({level:'dept', dept:1})` uložilo `area:2`, hoci area sa neposielala).
    // Keď adresa nenesie ani jeden z troch, berie sa uložený nav — teda odkaz
    // s čistým query stringom znamená „moje posledné miesto v sieti", nie mapa.
    nav: (() => {
        const a = urlValue('a'), d = urlValue('d'), n = urlValue('n');
        if (a || d || n) {
            return {
                level: n ? 'node' : (d ? 'dept' : 'area'),
                area: a ? +a : null, dept: d ? +d : null, node: n ? +n : null,
            };
        }
        const v = lsJson('hades.nav', null);
        if (v && ['map', 'area', 'dept', 'node'].includes(v.level)) {
            return { level: v.level, area: v.area ?? null, dept: v.dept ?? null, node: v.node ?? null };
        }
        return { level: 'map', area: null, dept: null, node: null };
    })(),
    layout: null,          // prezentácia scény z computeLayout() (cache podľa signatúry)
    // VLNA GRAF A: stav d3 simulácie. Pumpa (sim.js) tiká ručne, aby sa mimo
    // obrazovky Graf nesiahalo na rAF. Metriky sú tu preto, aby ich overovací
    // harness ČÍTAL z appky a nemeral kópiu formuly.
    _simMs: 2,             // EMA nákladu jedného kroku simulácie (ms)
    _simTicks: 0,          // počet odtikaných krokov od studeného štartu
    _simAlpha: 0,          // alpha simulácie minulý krok (0 = usadené)
    _simSettled: false,    // dosadla? (harness čaká na toto, nie na fixný čas)
    _pumpFps: 0,           // EMA fps počas usadzovania (kolo pumpy = jeden frame)
    _pumpAt: 0,            // čas posledného kola pumpy (ms)
    _fitOnSettle: false,   // po usadení dorovnaj kameru na fokusovú skupinu
    _needKick: 0,          // layout zistil zmenu pomeru strán → dousaď sieť
    _netStretch: 1,        // jednorazové roztiahnutie po X (kritérium šírky)
    _layoutAr: 0,          // pomer strán, na ktorý je postavený aktuálny layout
    _anchors: null,        // cache kotiev fyziky (ťažiská oblastí / pásy vrstiev)
    _nbFor: null,          // cache okolia uzla pre filter úrovne 'node'
    _nbSet: null,
    _camTween: null,       // tweenovaná kamera pri zanorení: { from, to, t, dur }
    _navFocusKey: null,    // posledný S.focus, ktorý sme sami zapísali (detekcia zmien zvonku)
    _navApi: 0,            // window.HADES.go/currentPath už exportované?
    // FÁZA SHELL: aktívna obrazovka. Plátno (rAF) beží len na 'graf'.
    //
    // `?screen=graf` má prednosť pred uloženou voľbou — na tom stojí lokálna appka
    // (`bin/hades.cmd`), ktorá otvára rovno graf bez toho, aby človek klikal.
    //
    // Zoznam obrazoviek sa tu už NEOPAKUJE. Bol tu zadrôtovaný a pri pridaní
    // obrazovky Runy sa naň zabudlo, takže uložená voľba `runy` tichým fallbackom
    // padla na `dnes` — chyba, ktorú nič nenahlási. Platnosť overuje `setScreen()`
    // v `screens.js`, ktorý zoznam vlastní; sem sa hodnota len prečíta.
    // Import odtiaľ NEROB: `state.js` importuje každý modul a vznikol by cyklus.
    //
    // `?screen=` je vonkajší kontrakt dvoch nasadených spúšťačov (electron/main.js,
    // bin/hades-app.mjs otvárajú rovno Graf) — prijíma sa ako alias `s` a prvý zápis
    // ho normalizuje na `s=` a odstráni. Do 27. 8. 2026 tu hodnota NEBOLA validovaná
    // vôbec, takže `?screen=bogus` zostalo v adrese a appka ukázala Dnes: adresa
    // lhala. Teraz sa neplatná hodnota zahodí ticho (bez toastu — pri obnove stránky
    // sa nehlási plávajúcou bublinou) a adresa sa opraví `replaceState`om nižšie.
    screen: BOOT_SCREEN,
    // Default 0 = celá sieť. Predtým tu bolo 1.0, čo skrylo 791 z 2877 hrán (všetky
    // similarity 0.5 a jednorazové co_activation 0.6) — a odkedy sú hrany hlavným
    // nosičom neurónového dojmu, je to presne to, čo nemá byť skryté.
    // Kľúč 'hades.minWeight3', aby sa nový default prejavil aj starým používateľom.
    minWeight: parseFloat(bootValue('mw', lsGet('hades.minWeight3'), '0')) || 0,
    // FÁZA HRANY: režim kostry — zobraz len najsilnejšiu štruktúru (manual + part_of + skill_mention)
    skeleton: bootValue('sk', lsGet('hades.skeleton') === '1' ? '1' : '0', '0') === '1',
    // FÁZA ANIMÁCIE: stav animačnej vrstvy
    _flows: [],           // putujúce svetlobody po hranách (event-driven): { from,to,e,t,speed,tone,dim,wait }
    _morph: null,         // prechod náhľadov: { from:Map, to:Map, t, dur }
    _clock: 0,            // monotónny animačný čas (s) — fáza pre dýchanie / sínusovky (mrzne pri skrytom tabe)
    _anim: 0,             // efektívna intenzita animácií tento frame (animLevel(), vrátane ambient boostu)
    _interacting: false,  // drag/pan prebieha → dýchanie sa pozastaví
    _labelShown: null,    // FÁZA DE-CLUTTER: id uzlov s viditeľným popiskom minulý frame (stabilita)
    // FÁZA ANIMÁCIE (Living Hades): ambientný „život" — spojitá jemná slučka na Grafe.
    _life: 0,             // efektívna intenzita ambientného života tento frame (lifeLevel(), 0 = pokoj)
    _lifeTier: 0,         // auto-strop: 0 = plný, 1 = redukovaný (bez driftu), 2 = len event-driven
    _drawMs: 4,           // EMA nákladu draw() (ms) — podklad pre auto-strop (nižší = viac hlavy)
    _lastAmbient: 0,      // čas posledného ambientného framu (ms) — cap ~30 FPS pre život
    _nextSynapse: 3,      // _clock, kedy vyšle ďalšiu spontánnu synapsiu („myseľ premýšľa")
    cursor: { sx: 0, sy: 0, on: false, a: 0 }, // kurzor pre gravitáciu/parallax (screen + aktivácia 0..1)
    _vp: null,            // svetové hranice viewportu minulý frame — cieľ pre spontánne synapsie
    // FÁZA RENDER PIPELINE: dirty-flag rAF slučka — v pokoji 0 prekreslení (tichý CPU).
    _dirty: true,         // jednorazová požiadavka na prekreslenie (hover, kamera, dáta, filter)
    _settleFrames: 0,     // dobeh po animácii (flash/zrod dohasne, potom sa slučka zastaví)
};

export const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const OPT_DEFAULTS = {
    panelAlpha: 0.92,
    bg: 1,
    edgeAlpha: 1,
    labelAlpha: 1,
    nodeScale: 1,
    labelSize: 1,
    // `glow` a `sizeByDegree` sú zmazané spolu s ich ovládačmi (viď #sec-settings
    // v blade): žiadny renderovací modul ich nečítal. Staré hodnoty môžu ešte ležať
    // v localStorage — Object.assign ich prenesie, ale nikto sa ich nespýta.
    edgeSoftHover: true, // FÁZA HRANY: v pokoji sú hrany jemné, rozsvietia sa pri hover/fokuse uzla
    anim: 0.5,           // FÁZA ANIMÁCIE: intenzita udalostných animácií (toky, zrod, morph; 0 = vyp)
    life: 0.5,           // FÁZA ANIMÁCIE (Living): intenzita ambientného života (dýchanie, drift, synapsie; 0 = pokoj)
};

S.opts = Object.assign({}, OPT_DEFAULTS, JSON.parse(localStorage.getItem('hades.opts') || '{}'));

// Fyzika: konštanty sú v layout.js (PHYS). Slidery síl v Nastaveniach zostávajú
// zmazané — vlna GRAF A vrátila d3 forceSimulation, ale nie 4 ovládače k nej.

// Filtre siete (Obsidian filters) — množiny SKRYTÝCH typov / zdrojov / oblastí.
// tags je POZITÍVNY filter (F4): množina VYBRANÝCH značiek — prázdna = bez filtra,
// inak sa zobrazia len uzly nesúce aspoň jednu vybranú značku (jadro vždy prejde).
//
// Boot: `ft` / `fs` / `fa` / `fg` z adresy, inak uložený filter, inak prázdno.
// POZOR na typ: `fa` sú id oblastí a `filterPass()` ich porovnáva s `n.area_id`,
// teda s ČÍSLOM — z adresy prichádzajú stringy, takže sa musia previesť tu.
// Bez toho by filter oblastí z odkazu ticho nefiltroval nič.
S.filter = { types: new Set(), sources: new Set(), areas: new Set(), tags: new Set() };
{
    const f = lsJson('hades.filter', {});
    const KEYS = [['types', 'ft', false], ['sources', 'fs', false], ['areas', 'fa', true], ['tags', 'fg', false]];
    for (const [prop, key, numeric] of KEYS) {
        const list = bootValue(key, Array.isArray(f[prop]) ? f[prop] : null, []);
        S.filter[prop] = new Set(numeric ? list.map(Number) : list);
    }
}

// FÁZA CERTAINTY (F4, §4.6): značky istoty na canvase (prstenec + dash encoding).
// Default ON, prepínateľné v Nastaveniach („Značky istoty"). Perzistuje 'hades.certRings'.
// Do URL NEPATRÍ: je to kódovanie prstenca, teda AKO uzly vyzerajú, nie KTORÉ sú.
S.certRings = lsGet('hades.certRings') !== '0';

// FÁZA HRANY: filter kategórií vzťahov (part_of / uses / similarity / co_activation).
// manual + skill_mention (kategória 'core') je štruktúra a nefiltruje sa. Množina drží SKRYTÉ kategórie.
S.filter.relations = (() => {
    const rf = lsJson('hades.relfilter', null);
    return new Set(bootValue('fr', Array.isArray(rf) ? rf : null, []));
})();
// FÁZA OBRAZOVKY: rozsah grafu — 'live' (jadro + projekty + spomienky + aktívne skilly)
// alebo 'all' (celá sieť vrátane knižnice). Perzistuje 'hades.graphScope', default 'live'.
S.graphScope = bootValue('gs', lsGet('hades.graphScope'), 'live');

/* `sel` (uzol s otvoreným panelom detailu) je iná vec než `n`: `n` filtruje scénu,
   `sel` otvára panel. Panel vlastní `panels.js`, takže si tu len odložíme, čo prišlo
   z adresy — otvoriť ho môže až modul, ktorý o paneli vie, a to po načítaní uzlov.
   Držať to na `S` je jediná cesta bez importu do cudzieho súboru. */
S._bootSel = (() => { const v = urlValue('sel'); return v ? +v : null; })();

/* ---------- ADRESA PO NAČÍTANÍ OPISUJE, ČO JE NA OBRAZOVKE ----------

   Jeden `replaceState` s ORAZENOU PRAVDOU: neplatné hodnoty z odkazu sú už zahodené
   (validátory v `urlstate.js`), defaulty sa vynechajú a legacy `screen=` sa
   normalizuje na `s=`. Bez tohto zápisu by `?screen=bogus` zostalo v adrese a `F5`
   by viedol do iného stavu než odkaz — presne ten defekt, ktorý tu bol pre jeden
   kľúč a s 37 kľúčmi by sa zmnožil.

   `replace`, nie `push`: obnovenie stavu z odkazu ani z úložiska nie je gesto
   človeka a nesmie pridať záznam do histórie. `flushUrl()` je tu preto, aby adresa
   bola opravená ešte pred prvým renderom — a nie preto, že by dávkovanie inak
   nefungovalo. Zanorenie sa píše neorezané (`clampNav()` beží až nad načítanými
   uzlami a `buildSim()` adresu opraví, keď cieľ neexistuje). */
wireUrlState();
writeUrl({
    s: S.screen,
    gv: S.gview,
    gs: S.graphScope,
    ft: S.filter.types, fs: S.filter.sources, fa: S.filter.areas,
    fg: S.filter.tags, fr: S.filter.relations,
    mw: S.minWeight, sk: S.skeleton ? '1' : '0',
    loc: S.local ? S.local.rootId + '.' + S.local.depth : null,
    a: S.nav.area, d: S.nav.dept, n: S.nav.node,
}, 'replace');
flushUrl();

// A8 (kontrakt R-6): „Balík pre Claude Code" (S.pack) a kontext doku Charóna
// (S.charonCtx) SPLYNULI do jedného mechanizmu — kontextu doku. S.pack tu už
// nie je: tlačidlá „Do balíka" (packBtn) aj čítačka plnia priamo kontext doku
// (S.charonCtx vlastní charon.js) a poznatok sa von dostane rozhovorom s
// Charónom nad tým istým kontextom, nie kopírovaním do schránky. Starý kľúč
// 'hades.pack' sa NEMIGRUJE (strop kontextu je 8 uzlov proti 50 v balíku a
// tvar sa líši) — je to nevratná zmena významu ovládača, ktorú používateľ
// schválil (R-6).
