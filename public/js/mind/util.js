import { neighborsOf } from './anim.js';
import { edgeCategoryHidden } from './edges.js';
import { filterPass } from './filters.js';
import { draw, requestDraw } from './render.js';
// W2c: breadcrumb číta stav zo stavového stroja zanorenia. util.js ↔ sim.js je
// cyklický import — obidve strany preto exportujú HOISTOVANÉ `function`
// deklarácie (nie const arrow), inak by prvé volanie spadlo na ReferenceError.
import { currentPath, go } from './sim.js';
import { CORE_COLOR, S } from './state.js';
import { T, THEMES } from './theme.js';
import { iconMarkup } from '../shared/icons.js';

export function setOpt(key, value) {
    S.opts[key] = value;
    localStorage.setItem('hades.opts', JSON.stringify(S.opts));
    applyOpts();
    requestDraw(); // zmena nastavenia vzhľadu → prekresli (slučka mohla spať)
}

export function syncSlider(inp) {
    const min = parseFloat(inp.min || 0);
    const max = parseFloat(inp.max || 100);
    const val = parseFloat(inp.value);
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 100;
    inp.style.setProperty('--pct', pct + '%');

    // číselný odpočet vedľa slidera — alfy ako percento, mierky ako násobok
    const wrap = inp.closest('label.slider');
    const out = wrap && wrap.querySelector('output');
    if (out) {
        const opt = inp.dataset.opt;
        const force = inp.dataset.force;
        if (force) {
            // sily: multiplikátory ako ×N.N, absolútne hodnoty (charge/distance) surové číslo
            out.textContent = (force === 'linkStrength' || force === 'gravity')
                ? '×' + val.toFixed(1)
                : String(Math.round(val));
        } else {
            out.textContent = (opt === 'nodeScale' || opt === 'labelSize')
                ? '×' + val.toFixed(2)
                : Math.round(val * 100) + ' %';
        }
    }
}

export function applyOpts() {
    document.documentElement.style.setProperty('--panel-alpha', S.opts.panelAlpha);
    document.querySelectorAll('input[data-opt]').forEach((inp) => {
        const v = S.opts[inp.dataset.opt];
        if (v !== undefined && parseFloat(inp.value) !== v) inp.value = v;
        syncSlider(inp);
    });
}
/* ---------- pomocníci ---------- */

export function now() { return Date.now(); }
export function rad(deg) { return (deg * Math.PI) / 180; }
export function ts(iso) { return iso ? new Date(iso).getTime() : 0; }

// Svetlejší/sytejší variant farby oblasti pre tmavý papier — hex→HSL→hex, cache
export const _darkColorCache = new Map();
export function darkAreaColor(hex) {
    const cached = _darkColorCache.get(hex);
    if (cached) return cached;
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex));
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    const r = ((num >> 16) & 255) / 255, g = ((num >> 8) & 255) / 255, b = (num & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0, s = 0, l = (max + min) / 2;
    if (d > 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    l = Math.max(l, 0.62);
    s = Math.min(s + 0.12, 0.9);
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const toHex = (t) => Math.round(hue2rgb(p, q, t) * 255).toString(16).padStart(2, '0');
    const out = '#' + toHex(h + 1 / 3) + toHex(h) + toHex(h - 1 / 3);
    _darkColorCache.set(hex, out);
    return out;
}

// Farba = oblasť vo VŠETKÝCH náhľadoch; typ vyjadruje tvar (drawShape)
export function nodeColor(n) {
    let hex;
    if (n.type === 'core') hex = CORE_COLOR;
    else {
        const area = S.areas.get(n.area_id);
        hex = area ? area.color : '#2f6d8f';
    }
    return T === THEMES.dark ? darkAreaColor(hex) : hex;
}

// Focus mód (priečinky): zaostrenie na oblasť / oddelenie
// Jediná cesta k zmene fokusu — synchronizuje breadcrumb, strom aj plátno.
export function setFocus(areaId, departmentId) {
    S.focus = { areaId: areaId || null, departmentId: departmentId || null };
    renderBreadcrumb();
    markTreeActive();
    draw();
}

// W2c: breadcrumb zvládne všetky ŠTYRI úrovne (Hades / oblasť / oddelenie / uzol).
// Zdrojom pravdy je currentPath().crumbs zo sim.js, nie S.focus (ten pozná len
// oblasť + oddelenie, takže na úrovni 'node' by posledný crumb chýbal).
// go() volá renderBreadcrumb() po každom prechode sám.
export function renderBreadcrumb() {
    const bc = document.getElementById('breadcrumb');
    const p = currentPath();
    syncUpButton(p);
    if (!bc) return;

    const crumbs = p.crumbs || [];
    if (!crumbs.length) { bc.innerHTML = ''; return; }
    /* Na najvyššej úrovni breadcrumb odteraz NEMLČÍ (predtým ho zastupoval eyebrow
       wordmarku v hlavičke, ktorý sa vlnou CHRÓM presunul do railu — hlavička Grafu
       by inak bola prázdna). Nevypisuje sa tam ale názov vedomia: ten je 150 px
       vľavo v raile a dve „Hades" vedľa seba nič nepridajú. Koreň jednoprvkovej
       cesty preto povie STAV — že sieť nie je nijako zúžená. Veľké „C": v tom istom
       slote píše renderScreenBreadcrumb() názvy obrazoviek („Dnes", „Denník"), takže
       malé „celá sieť" bolo jediné, čo v hlavičke začínalo malým písmenom. */
    if (crumbs.length === 1) {
        bc.innerHTML = '<span class="current">Celá sieť</span>';
        return;
    }

    bc.innerHTML = crumbs.map((c, i) => {
        const sep = i ? '<span class="sep">/</span>' : '';
        return sep + (i === crumbs.length - 1
            ? '<span class="current">' + esc(c.label) + '</span>'
            : '<button type="button" class="crumb" data-i="' + i + '">' + esc(c.label) + '</button>');
    }).join('');

    bc.querySelectorAll('.crumb[data-i]').forEach((b) => {
        const c = crumbs[+b.dataset.i];
        b.onclick = () => go({
            level: c.level,
            area: c.level === 'area' ? c.id : undefined,
            dept: c.level === 'dept' ? c.id : undefined,
            node: c.level === 'node' ? c.id : undefined,
        });
    });
}

// W2c: #btn-up nahradil mŕtvy #view-switch — na mape nie je kam ísť, tak sa skryje.
// VLNA CHRÓM: prepínanie triedy .deep na wordmarku zmizlo spolu s wordmarkom —
// značka je v raile, takže hlavička už nemá s čím kolidovať a breadcrumb nesie
// celú cestu vrátane koreňového „Hades".
function syncUpButton(p) {
    const deep = !!(p.crumbs && p.crumbs.length > 1);
    const up = document.getElementById('btn-up');
    if (up) {
        up.classList.toggle('hidden', p.level === 'map');
        const parent = deep ? p.crumbs[p.crumbs.length - 2].label : 'Hades';
        up.title = 'Späť na „' + parent + '" (Esc)';
    }
}

export function markTreeActive() {
    const tree = document.getElementById('structure-tree');
    if (!tree) return;
    tree.querySelectorAll('.tree-row').forEach((row) => {
        const aid = row.dataset.area ? +row.dataset.area : null;
        const did = row.dataset.dept ? +row.dataset.dept : null;
        const active = !!S.focus.areaId && aid === S.focus.areaId
            && (did ? did === S.focus.departmentId : !S.focus.departmentId);
        row.classList.toggle('active', active);
    });
}

/* ---------- počty v hlavičke ----------

   Hlavička vypisovala SUROVÉ `S.nodes.length` / `S.edges.length`. Po vypnutí dvoch
   typov uzlov v Pokročilých nastaveniach teda ďalej tvrdila plný počet — číslo
   v hlavičke hovorilo o inej sieti než plátno pod ním. Viditeľnosť sa preto pýtame
   tej istej brány, akou ju rieši kreslenie: filterPass() pre uzly (typy, zdroje,
   oblasti, značky) a edgeCategoryHidden() + minWeight + oba konce pre hrany
   (kategórie vzťahov, kostra).

   Lokálny graf a prehrávanie času sem zámerne NEVSTUPUJÚ: oba majú vlastný
   indikátor (čip lokálneho grafu, posuvník replayu) a sú to dočasné pohľady, nie
   nastavenie toho, čo sieť obsahuje.

   Cena: updateHeaderMetrics() sa NEVOLÁ za frame, ale len pri zmene dát (načítanie,
   zrod uzla z WS, vytvorenie/zmazanie v paneli) a pri zmene filtra — teda rádovo
   jednotky volaní, nie 60/s. Jeden prechod cez ~2700 uzlov a ~8300 hrán je tam
   neviditeľný a cache by bola réžia navyše. */
function visibleCounts() {
    const vis = new Set();
    for (const n of S.nodes) if (filterPass(n)) vis.add(n.id);
    let edges = 0;
    for (const e of S.edges) {
        if (!vis.has(e.source_id) || !vis.has(e.target_id)) continue;
        if ((e.weight || 1) < S.minWeight) continue;
        if (edgeCategoryHidden(e)) continue;
        edges++;
    }
    return { nodes: vis.size, edges };
}

/* Odtlačok filtra — lacné porovnanie „zmenilo sa niečo?". Poradie v množinách je
   poradie vkladania, takže to isté nastavenie naklikané v inom poradí dá iný
   reťazec; horší dôsledok je jeden zbytočný prepočet, nie zlé číslo. */
function currentFilterSig() {
    const f = S.filter;
    return [[...f.types], [...f.sources], [...f.areas], [...f.tags], [...f.relations]]
        .map((a) => a.join(',')).join('|') + '|' + (S.skeleton ? 1 : 0) + '|' + S.minWeight;
}

let filterSig = null;
let metricsWired = false;

/* Filtre sa prepínajú v troch moduloch (controls.js — typy/zdroje/vzťahy,
   panels.js — legenda oblastí, tagfilter.js — značky) a ani jeden o hlavičke nevie.
   Namiesto štyroch nových volaní naprieč cudzími modulmi tu visí jeden delegovaný
   listener: po každom kliknutí či zmene porovná odtlačok filtra a prepočíta len
   vtedy, keď sa naozaj zmenil. Beží v bublinovej fáze, teda až po handleroch, ktoré
   S.filter menia.

   Bez graphActive() strážcu zámerne: nesiaha na plátno ani na rAF, len číta dáta —
   a keby v pokoji zaspal, hlavička by po návrate na Graf ukazovala staré číslo
   (prepnutie obrazovky updateHeaderMetrics() nevolá). */
function wireFilterMetrics() {
    if (metricsWired) return;
    metricsWired = true;
    const check = () => {
        if (currentFilterSig() === filterSig) return;
        updateHeaderMetrics();
    };
    document.addEventListener('change', check);
    document.addEventListener('click', check);
}

export function updateHeaderMetrics() {
    const el = document.getElementById('header-metrics');
    if (!el) return;
    wireFilterMetrics();
    filterSig = currentFilterSig();
    const c = visibleCounts();
    // Bez aktívneho filtra ostáva veta znak po znaku taká, aká bola.
    el.textContent = (c.nodes === S.nodes.length && c.edges === S.edges.length)
        ? S.nodes.length + ' uzlov · ' + S.edges.length + ' spojení'
        : c.nodes + ' z ' + S.nodes.length + ' uzlov · ' + c.edges + ' z ' + S.edges.length + ' spojení';
}

// W2c: focusPass() zmazaný — jediným čitateľom boli nodeAlphaMul/edgeAlphaMul
// vo forces.js, ktoré nikto nevolal. Stmievanie ide výhradne cez ent.dim z layoutu.

// Zvýraznená množina pri hover/select — cache podľa kotvového uzla
export function highlightSet() {
    const anchor = S.hover || S.selected;
    if (!anchor) { S._hlFor = null; S._hlSet = null; return null; }
    if (S._hlFor !== anchor) {
        const set = new Set([anchor.id]);
        for (const m of neighborsOf(anchor)) set.add(m.id);
        S._hlFor = anchor;
        S._hlSet = set;
    }
    return S._hlSet;
}

export function markAwake() {
    S.awakeUntil = now() + S.awakeMinutes * 60000;
}

export function isAwake() {
    return now() < S.awakeUntil;
}
/* ---------- zvuk ---------- */

export function audioCtx() {
    if (!S.audio) {
        S.audio = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (S.audio.state === 'suspended') S.audio.resume();
    return S.audio;
}

export function blip(freq, dur = 0.35, vol = 0.05) {
    if (!S.sound) return;
    try {
        const ac = audioCtx();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ac.currentTime);
        gain.gain.linearRampToValueAtTime(vol, ac.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
        osc.connect(gain).connect(ac.destination);
        osc.start();
        osc.stop(ac.currentTime + dur + 0.05);
    } catch (e) { /* zvuk nie je kritický */ }
}
/* ---------- stav (bdie / spí) ---------- */

export let lastStateUi = '';
export function updateStateUi() {
    const awake = isAwake();
    const key = awake ? 'awake' : 'asleep';
    if (key === lastStateUi) return;
    lastStateUi = key;
    const brand = document.getElementById('brand-core');
    brand.classList.toggle('awake', awake);
    brand.classList.toggle('asleep', !awake);
    brand.title = awake ? 'Hades — bdie' : 'Hades — spí';

    // stavový čip v hlavičke (bdie / spí)
    const chip = document.getElementById('status-chip');
    if (chip) {
        chip.classList.toggle('awake', awake);
        const txt = chip.querySelector('.txt');
        if (txt) txt.textContent = awake ? 'bdie' : 'spí';
    }
}
export function $(id) { return document.getElementById(id); }
export function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------- surové strojové čítanie → ľudský text ----------

   Tri veci presakovali z databázy priamo na obrazovku a všetky tri sú kozmetika,
   ktorá patrí do UI, nie do dát:

   1) markdown v náhľadoch. `description` záznamu je markdown („**Čo:** …
      **Výsledok:** …"), takže náhľad vypisoval hviezdičky a spätné apostrofy.
   2) neformátované tisíce — „18322 za rok" sa v mono číta ako kód, nie ako počet.
   3) strojové názvy sessions („mystifying-mclaren-23750a"), ktoré Claude Code
      generuje pre dočasné adresáre a ktoré sa sem dostali ako názov projektu.

   Zdrojové dáta sa NEMENIA (Hades ich vidí presne také, aké sú) — mení sa len to,
   čo z nich prečíta človek. */

// Markdown → obyčajný text pre jednoriadkové náhľady. Nie je to parser: zmaže
// zvýrazňovanie, kód, odkazy a nadpisy a zlepí zvyšok do jedného riadka.
export function plainText(s) {
    if (!s) return '';
    return String(s)
        .replace(/```[\s\S]*?```/g, ' ')          // bloky kódu
        .replace(/`([^`]+)`/g, '$1')              // inline kód
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')// odkazy a obrázky → len text
        .replace(/(\*\*|__)(.*?)\1/g, '$2')       // bold
        .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italic
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')       // nadpisy
        .replace(/^\s{0,3}[-*+]\s+/gm, '')        // odrážky
        .replace(/^\s{0,3}>\s?/gm, '')            // citácie
        // Zvyšky NEPÁROVÉHO zvýraznenia. Snippety prichádzajú z backendu odseknuté
        // („… **Výsledok..."), takže párové pravidlá vyššie na ne nesadnú a v UI
        // svietil zvyšok syntaxe — zmerané na 2 zo 6 živých záznamov.
        .replace(/\*\*|__|`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/* To isté pre NÁZVY (label uzla, text rozhodnutia). Rozdiel proti plainText je
   jediný, ale podstatný: NEMAŽE nepárové zvyšky zvýraznenia. Názvy nie sú odseknuté
   snippety, takže nepárová dvojica podčiarkovníkov v nich nie je zvyšok syntaxe, ale
   OBSAH — v Knižnici žije skill „__Host- cookie prefix" a plainText by z neho urobil
   „Host- cookie prefix", teda vecnú chybu v mene veci, ktorú ten skill učí.
   Zmerané na živých dátach: 2 názvy v Denníku a 4 rozhodnutia nesú `backticky`
   (Claude Code do nich píše identifikátory), 1 skill v Knižnici nesie `__`. */
export function plainInline(s) {
    if (!s) return '';
    return String(s)
        .replace(/`([^`]+)`/g, '$1')              // inline kód
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')// odkazy a obrázky → len text
        .replace(/(\*\*|__)(.*?)\1/g, '$2')       // bold (len párový)
        // Nepárový spätný apostrof padá tiež: názvy prichádzajú odseknuté („The
        // production build (`docker compose exec…"), takže párové pravidlo naň
        // nesadne — a na rozdiel od `__` nie je samotný apostrof nikdy obsahom.
        .replace(/`/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/* To isté pre VIACRIADKOVÝ text (popis uzla v paneli detailu, ktorý sa vykresľuje
   s `white-space: pre-wrap`): zmaže syntax zvýraznenia, ale NEZLEPÍ riadky —
   odseky, odrážky a prázdne riadky sú tu nositeľom štruktúry. Zámerne to nie je
   mdToHtml: panel je 300 px široký a plná sadzba markdownu (tabuľky, bloky kódu)
   by doň nepatrila. */
export function plainBlock(s) {
    if (!s) return '';
    return String(s)
        .replace(/```([a-z]*)\n?([\s\S]*?)```/gi, '$2')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/\*\*|__|`/g, '')          // nepárové zvyšky (odseknuté snippety)
        .replace(/[ \t]+$/gm, '')
        .trim();
}

// Tisíce s pevnou medzerou (sk formát). Mono + tabular-nums drží čísla v stĺpci,
// medzera z nich robí počet: 18 322 namiesto 18322.
export function fmtNum(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    // Oddeľovač normalizujeme na NEZLOMITEĽNÚ medzeru explicitným escapom —
    // toLocaleString vracia podľa platformy raz U+0020, raz U+00A0, raz U+202F
    // a číslo sa potom v úzkom stĺpci láme na dva riadky.
    return Math.round(v).toLocaleString('sk-SK').replace(/[\s\u00a0\u202f]/g, '\u00a0');
}

/* Strojové názvy sessions: „mystifying-mclaren-23750a" — dve anglické slová a hex
   chvost, ktorý generuje Claude Code pre dočasný adresár. Ako názov projektu
   nenesie žiadny význam, takže sa v UI ukáže ako „bez projektu". Pravidlo je
   zámerne úzke (dve slová malými + ≥5 znakov alfanumerického chvosta so číslicou),
   aby nezožralo reálne názvy typu „sperky-ai" alebo „hades-redizajn". */
const MACHINE_SLUG = /^[a-z]{3,}-[a-z]{3,}-(?=[a-z0-9]*\d)[a-z0-9]{5,}$/;

export function isMachineName(s) {
    return MACHINE_SLUG.test(String(s || '').trim());
}

/* Slovenské názvy typov uzlov — JEDEN zdroj pravdy. Ten istý objekt bol
   skopírovaný v panels.js, search.js, structure.js, cmdk.js a interaction.js
   (päťkrát), a obrazovka Kontrola nemala kópiu žiadnu, takže v jej čipoch svietilo
   surové anglické „memory" — jediné neslovenské slovo v tom riadku, hneď vedľa
   slovenského „Bez istoty". */
export const TYPE_NAMES = { core: 'jadro', skill: 'skill', memory: 'spomienka', project: 'projekt' };

export function typeName(t) {
    return TYPE_NAMES[t] || String(t || 'uzol');
}

export function prettyProject(s) {
    return isMachineName(s) ? 'bez projektu' : String(s || '');
}

/* Názov záznamu často začína názvom projektu („mystifying-mclaren-23750a — práca
   13.8.2026"). Keď je ten názov strojový, celý prefix aj s oddeľovačom vypadne a
   zostane to, čo záznam naozaj hovorí: „Práca 13.8.2026". Dopísať namiesto neho
   „Bez projektu — …" by len nahradilo jeden šum druhým. */
/* Zároveň je to JEDINÉ miesto, kde sa z názvu odstraňuje inline markdown (plainInline):
   labely chodia z databáze tak, ako ich zapísal Claude Code, a v živých dátach nesú
   `backticky` okolo identifikátorov. Denník aj Dnes vypisujú názvy cez túto funkciu,
   takže obe obrazovky tým hovoria jedným jazykom. */
export function prettyLabel(label, project) {
    const l = plainInline(label);
    if (!project || !isMachineName(project) || !l.startsWith(project)) return l;
    const rest = l.slice(String(project).length).replace(/^\s*[—–-]\s*/, '').trim();
    if (!rest) return 'Bez projektu';
    return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/* GET + JSON s kontrolou stavu — JEDEN zdroj pravdy pre čítacie volania obrazoviek.
   `(await fetch(u)).json()` samo o sebe stav neprečíta: pri 500 s JSON telom
   (`{"message": "..."}`) sa parsovanie podarí, `d.records` je undefined a obrazovka
   ukáže PRÁZDNY stav namiesto chyby — teda povie „nič tu nie je" o dátach, ktoré
   existujú. Chybová cesta obrazoviek stojí na tom, že táto funkcia hodí výnimku. */
export async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
}

// Async spätná väzba tlačidiel — disable + dočasný text počas behu
export async function busy(btn, fn, busyText) {
    /* Volanie BEZ tlačidla je legitímne: paletu Ctrl-K zatvárame ešte pred štartom
       akcie, takže žiadne tlačidlo neexistuje a spätnú väzbu nesie toast. Bez tejto
       stráže by `doSync(null)` padlo na čítaní `.disabled` z null. Ochrana proti
       dvojkliku sa tým pre takého volajúceho nezapína — a nemá: zavretá paleta sa
       druhýkrát kliknúť nedá. */
    if (!btn) return await fn();
    if (btn.disabled) return;
    const old = btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
    try { return await fn(); }
    finally { btn.disabled = false; btn.textContent = old; }
}

/* ---------- prázdne, chybové a načítavacie stavy ----------

   JEDEN slovník pre celú plochu `/`. Základ je `.empty`, modifikátor nesie
   PRÍČINU — a to je informácia, nie kozmetika: „nič tu nie je“, „tvoj filter to
   skryl“ a „načítanie padlo" sú tri rôzne správy a do 27. 8. 2026 mali všetky tri
   ten istý tvar (ikona + veta + rada), takže sa nedali odlíšiť ani okom, ani
   aserciou nad DOM.

     .empty          — dáta neexistujú
     .empty--filter  — dáta existujú, filter ich skryl (jediná akcia: zruš filter)
     .empty--error   — načítanie padlo (jediná akcia: skús znova)

   Hlas: vecne, krátko, po slovensky a NEOSOBNE (docs/BRAND-HADES.md §1).
   Prvý riadok povie ČO JE, druhý ČO S TÝM. Akcia je NAJVIAC JEDNA — dve akcie
   znamenajú, že stav nevie, ktorá je jeho jedna cesta ďalej.

   Kresba všetkých troch je v `mind.css`; tento modul píše len markup. */

/* Akcia prázdneho stavu. `data-act` je značka pre napojenie zvonku, listener
   pripája renderer nižšie — inline `onclick=` by pod `script-src 'self'` bez
   `unsafe-inline` bol mŕtvy kód (ContentSecurityPolicy.php). */
function actionHtml(action) {
    if (!action || !action.label) return '';
    return '<button type="button" class="empty-act"'
        + (action.act ? ' data-act="' + esc(action.act) + '"' : '') + '>'
        + esc(action.label) + '</button>';
}

/* Napojí JEDINÉ `.empty-act` v kontejneri. Keď `on` nie je funkcia, nerobí nič —
   a renderery nižšie v tom prípade tlačidlo vôbec nevykreslia, takže mŕtve
   tlačidlo nevznikne. */
function wireAction(container, on) {
    if (typeof on !== 'function') return;
    const btn = container.querySelector('.empty-act');
    if (btn) btn.addEventListener('click', on);
}

/* `hint` je TRETÍ a `action` ŠTVRTÝ parameter, a to je väzba, nie štýl: tvar
   `emptyHtml(icon, text)` volá päť modulov, ktoré táto vlna nevlastní (cmdk.js,
   md.js, panels.js, pack.js, charon.js). Zmena poradia alebo významu prvých troch
   parametrov by ich rozbila TICHO — vykreslil by sa nesprávny text alebo
   „undefined". Preto sa `emptyHtml` nesmie prepísať ani na objektový argument.

   `action` je `{ label, act, on }`: `on` je nepovinná funkcia a napojí ju
   `renderEmpty`. Volajúci, ktorý vracia reťazec, si listener pripojí sám podľa
   `data-act`. */
export function emptyHtml(icon, text, hint, action) {
    return '<div class="empty">' + iconMarkup(icon) + '<p>' + esc(text) + '</p>'
        + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '')
        + actionHtml(action)
        + '</div>';
}

export function renderEmpty(container, icon, text, hint, action) {
    if (!container) return;
    container.innerHTML = emptyHtml(icon, text, hint, action);
    if (action) wireAction(container, action.on);
}

/* ---------- chyba: JEDEN komponent ---------- */

const ERROR_HINT = 'Server neodpovedá — skús to znova.';

/* Vetu skládá HELPER, nie volajúci. `subject` je predmet v 4. páde a bez slova
   „nepodarilo“: „denník“, „knižnicu“, „behy“, „frontu“. Helper z neho vyrobí
   „Denník sa nepodarilo načítať“.

   Prečo tu a nie u volajúceho: jedenásť chybových ciest si vetu skládalo samo a
   rozišli sa — dve z nich (structure.js) nepovedali ani predmet („Nepodarilo sa
   načítať") a jedna (smernica.js) kreslila chybu ako tichý riadok prázdneho stavu.

   Ikona `cloud_off` je grafika s prahom 3:1, nie text. Text chyby ide vždy cez
   `--text` / `--muted`; `--danger` nesie kresbu, pre text má appka `--danger-ink`. */
function errorMarkup(subject, hint, action) {
    const s = String(subject || '').trim();
    const title = (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Obsah') + ' sa nepodarilo načítať';
    return '<div class="empty empty--error">'
        + iconMarkup('cloud-off')
        + '<p class="title">' + esc(title) + '</p>'
        + '<p class="hint">' + esc(hint || ERROR_HINT) + '</p>'
        + actionHtml(action)
        + '</div>';
}

/* Chyba BEZ akcie — pre miesta, kde volajúci vracia reťazec a nemá kam napojiť
   listener (čiastočný pád dashboardu, zoznam uložených smerníc). Tlačidlo tu
   zámerne nie je: mŕtve „Skúsiť znova" je horšie než žiadne. */
export function errorHtml(subject, hint) {
    return errorMarkup(subject, hint, null);
}

/* `retry` je funkcia, typicky ta istá render funkcia, v ktorej fetch spadol.
   MUSÍ čítať stav z modulu, nie z DOM — DOM, ktorý ju vyvolal, práve zmizol.
   Bez `retry` sa tlačidlo nevykreslí. */
export function renderError(container, subject, retry, hint) {
    if (!container) return;
    const action = typeof retry === 'function' ? { label: 'Skúsiť znova', act: 'retry' } : null;
    container.innerHTML = errorMarkup(subject, hint, action);
    wireAction(container, retry);
}

/* ---------- prázdno spôsobené filtrom ---------- */

function filterMarkup(text, hint, action) {
    return '<div class="empty empty--filter">'
        + iconMarkup('filter-off')
        + '<p>' + esc(text) + '</p>'
        + (hint ? '<p class="hint">' + esc(hint) + '</p>' : '')
        + actionHtml(action)
        + '</div>';
}

// Varianta pre volajúceho, ktorý skládá reťazec a napojí `.empty-act` sám
// (obrazovka Runy stavia celú časovú os jedným `innerHTML`).
export function filterEmptyHtml(text, hint) {
    return filterMarkup(text, hint, null);
}

/* JEDINÉ miesto, kde prázdny stav MENÍ stav appky. `clear` musí filter naozaj
   zrušiť — appka má tri funkcie, ktoré neplatný filter rušia samé
   (`pruneLibraryArea`, `pruneDecisionFilters`, `pruneRunFilters`), takže tlačidlo
   sa smie ponúknuť len tam, kde je filter PLATNÝ a naozaj skrýva dáta. Inak
   vznikne tlačidlo, ktoré nič nerobí.
   `label` je nepovinný, pretože „zruš hľadanie" a „zruš filter" sú pre človeka
   dve rôzne veci — príčinu pozná volajúci, nie helper. */
export function renderFilterEmpty(container, text, hint, clear, label) {
    if (!container) return;
    const action = typeof clear === 'function'
        ? { label: label || 'Zruš filter', act: 'clear-filter' }
        : null;
    container.innerHTML = filterMarkup(text, hint, action);
    wireAction(container, clear);
}

/* ---------- skeleton v tvare obsahu ----------

   `/api/journal` a `/api/dashboard` bežia 3–4 s, takže načítavanie nie je
   okrajový stav a prázdna plocha je z možností najhoršia. Skeleton drží
   ROZLOŽENIE, aby obsah po prílete neposkočil.

   `shape` je ENUM, nie objekt s rozmermi: rozmery patria CSS (`--skel-h`), inak
   sú pre CSSOM neviditeľné a žiadna asercia ich nenájde — presne tak vznikol
   inline `font-size:10px` na osi grafu. Neznámy `shape` padne na `list`. */

const SKEL_LINE = '<div class="skel skel-line"></div>';
const SKEL_LINE_HALF = '<div class="skel skel-line skel-line--half"></div>';
const SKEL_LINE_SHORT = '<div class="skel skel-line skel-line--short"></div>';
const SKEL_BLOCK = '<div class="skel skel-block"></div>';
const SKEL_CARD = '<div class="skel skel-card"></div>';

function rep(html, n) {
    let out = '';
    for (let i = 0; i < n; i++) out += html;
    return out;
}

/* Tvary kopírujú hierarchiu hotovej obrazovky, nie abstraktné „boxy".
   `dashboard` používa SKUTOČNÉ mriežky obrazovky Dnes (`.kpi-grid`,
   `.dash-grid`), nie ich napodobeninu — stĺpce, medzery aj zalomenie na úzkom
   okne sú preto tie isté, aké bude mať obsah.

   Hľadacie pole v `dashboard` ZÁMERNE nie je, hoci ho starý `todaySkeleton()`
   kreslil ako prvý pás: veľké hľadanie odišlo z obrazovky Dnes do hlavičky,
   takže skeleton sľuboval prvok, ktorý po dobehnutí dát nepríde. */
const SKEL_SHAPES = {
    dashboard: '<div class="skel-list">'
        + '<div class="skel skel-block skel-block--hero"></div>'
        + '<div class="kpi-grid">' + rep(SKEL_BLOCK, 4) + '</div>'
        + '<div class="dash-grid">' + rep(SKEL_CARD, 2) + '</div>'
        + '</div>',
    // zoznam po dňoch: kľúč dňa (krátky riadok) + záznamy pod ním
    list: '<div class="skel-list">' + rep(SKEL_LINE_SHORT + rep(SKEL_BLOCK, 3), 3) + '</div>',
    // rad filtračných čipov + karty
    cards: '<div class="skel-list">' + SKEL_LINE_HALF + rep(SKEL_CARD, 4) + '</div>',
    // rad filtračných čipov + hustejšie riadky časovej osi
    table: '<div class="skel-list">' + SKEL_LINE_HALF + rep(SKEL_BLOCK, 6) + '</div>',
    prose: '<div class="skel-list">' + rep(SKEL_LINE, 4) + SKEL_LINE_HALF + '</div>',
};

/* `sr-only` oznámenie je povinná časť skeletonu, nie ozdoba: plochy samotné sú
   kresba bez textu, takže bez tejto vety čítačka obrazovky o načítavaní nedostane
   nič. Vzor je `console/main.js`. */
export function skeletonHtml(shape) {
    return '<p class="sr-only">Obsah sa načítava…</p>'
        + (SKEL_SHAPES[shape] || SKEL_SHAPES.list);
}

export function renderSkeleton(container, shape) {
    if (!container) return;
    container.innerHTML = skeletonHtml(shape);
}

const SKELETON_DELAY = 300;

/* Skeleton pod 300 ms je BLIK a pôsobí pomalšie než ticho. `deferSkeleton` preto
   kresbu len naplánuje a vráti funkciu, ktorou volajúci čakanie zruší; tá vráti
   true, keď sa skeleton ešte nevykreslil (kontejner teda drží pôvodný obsah).

   Zrušiť sa MUSÍ pred zápisom obsahu, nie v `finally` za ním: naplánovaná kresba
   by inak dosadla nad hotový obsah a zmazala ho. */
export function deferSkeleton(container, shape) {
    let timer = setTimeout(() => { timer = null; renderSkeleton(container, shape); }, SKELETON_DELAY);
    return function cancelSkeleton() {
        if (timer === null) return false;
        clearTimeout(timer);
        timer = null;
        return true;
    };
}

/* Prázdno VNÚTRI karty je iná veta než prázdno na celej obrazovke. Karta má
   vlastný nadpis, ktorý už povedal, o čo ide, takže 28px ikona pod ním len
   zdvojí to isté a z malej kartičky urobí plakát — presne tak vyzerali „Aktivita"
   a „Podľa oblasti", keď nemali dáta. Zostáva jeden tichý riadok v --muted.
   Zámerne bez ikony a bez hintu: v karte nie je čo robiť, len sa ešte nič nestalo.
   NEZLIEVAŤ s `.empty` — je to iná rola, nie zabudnutý variant. */
export function emptyCardHtml(text) {
    return '<p class="card-empty">' + esc(text) + '</p>';
}

/* Načítavanie NIE JE prázdny stav — má vlastný znak: súosé kruhy značky, ktoré
   dýchajú (rovnaký motív ako jadro vedomia a favicon), namiesto generických
   presýpacích hodín.

   Pôsobisko sa zúžilo: kde endpoint plní ZOZNAM alebo MRIEŽKU, kreslí sa
   skeleton — má čo kopírovať. Dýchajúci znak zostáva tam, kde tvar obsahu
   dopredu známy NIE JE: hľadanie duplicít a skladanie kontextu smernice.

   Text je NEOSOBNÝ („Načítava sa…"). Do 20. 8. 2026 tu stála prvá osoba a tento
   komentár to zdôvodňoval tým, že Hades o sebe hovorí v prvej osobe — čo prestalo
   platiť rozhodnutím o hlase značky (docs/BRAND-HADES.md §1). Prvá osoba je pri
   dlhej práci rušivá a mýtus už nesie meno; nemusí ho niesť aj každá hláška.
   Pohyb rieši CSS a vypína ho prefers-reduced-motion. */
export function loadingHtml(text) {
    return '<div class="empty empty-loading"><span class="load-mark" aria-hidden="true"></span>'
        + '<p>' + esc(text || 'Načítava sa…') + '</p></div>';
}

export function renderLoading(container, text) {
    container.innerHTML = loadingHtml(text);
}
export function timeAgo(iso) {
    if (!iso) return '';
    const d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 3600) return Math.max(1, Math.round(d / 60)) + ' min';
    if (d < 86400) return Math.round(d / 3600) + ' h';
    if (d < 604800) return Math.round(d / 86400) + ' d';
    return new Date(iso).toLocaleDateString('sk', { day: 'numeric', month: 'short' });
}
