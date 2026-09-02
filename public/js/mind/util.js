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

/* INLINE POTVRDENIE (kontrakt 28. 8. 2026, J2).
   Politika notifikácií má tri prípady a tento je ten prostredný:

     1. Akcia VIDITEĽNE zmení plochu (riadok odíde z frontu, čip prepne stav,
        počítadlo klesne) → nehlási sa NIČ. Tá zmena je potvrdenie a toast nad
        ňou hovorí to isté druhýkrát.
     2. Akcia plochu nezmení (kopírovanie do schránky, uloženie na disk,
        priloženie do balíka) → TOTO. Potvrdenie stojí pri prvku, ktorý ju
        vyvolal, takže oko nemusí odísť na druhý konec obrazovky.
     3. Zlyhanie alebo udalosť MIMO obrazovky (zrod uzla cez WS, dobehnutá
        synchronizácia, spadnuté spojenie) → toast. Musí prežiť prekreslenie
        a niesť dôvod.

   `role="status"` a nie `aria-live="assertive"`: je to potvrdenie, nie varovanie,
   takže čítačka ho má prečítať, keď dohovorí, nie skočiť doprostred vety.
   Predchádzajúce potvrdenie na tom istom kotviacom prvku sa ODSTRÁNI — dva
   „Skopírované" vedľa seba po dvoch klikoch sú šum, nie informácia. */
export function inlineOk(anchor, text, kind) {
    if (!anchor || !anchor.parentNode) return null;
    const prev = anchor.parentNode.querySelector(':scope > .inline-ok');
    if (prev) prev.remove();
    const el = document.createElement('span');
    /* DVE ROLE, nie jedna farba (nález review). Potvrdenie je zelené, ODMIETNUTIE
       nie: „Zadaj názov uzla" v úspechovej zelenej hlási, že sa niečo podarilo,
       hoci sa práve nestalo nič. Manuál §8 navyše žiada, aby chyba mala vlastnú
       kresbu, a appka na to má vlastnú rolu (`--danger-ink`).

       `role="alert"` pri odmietnutí a `status` pri potvrdení: potvrdenie čítačka
       prečíta, keď dohovorí, odmietnutie musí prerušiť — je to odpoveď na klik,
       ktorý sa nevykonal. */
    const bad = kind === 'error';
    el.className = 'inline-ok' + (bad ? ' inline-ok--error' : '');
    el.setAttribute('role', bad ? 'alert' : 'status');
    el.textContent = text;
    anchor.insertAdjacentElement('afterend', el);
    /* Odchod po 2,4 s. Nie kratšie: potvrdenie, ktoré zmizne skôr, než sa naň
       oko presunie, je to isté ako žiadne.

       Časovač sa NERUŠÍ a nemusí: pri druhom klike sa starý prvok odstráni vyššie,
       takže jeho timeout dobehne a `el.isConnected` ho nechá bez práce — nový
       prvok má vlastný. Komentár tu do opravy po review tvrdil, že „ďalší klik
       zruší časovač spolu s prvkom"; to nie je pravda, len výsledok je ten istý.
       Držať referenciu netreba, preto tu žiadna nie je. */
    setTimeout(() => { if (el.isConnected) el.remove(); }, 2400);
    return el;
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

/* ---------------------------------------------------------------------------
   ZNAK HADESA — SIEŤ PAMÄTI (rozhodnutie používateľa 1. 9. 2026)

   Znak prestal byť prstenec s jadrom a je to sieť: štyri uzly spojené hranami,
   jeden z nich sýty. Hovorí to, čo Hades je — živá sieť pamäti — a je to ten istý
   jazyk, akým hovorí plátno grafu: uzol je PRIEHĽADNÝ prstenec (priehľadnosť
   nesie diera, nie nízka alfa) a jadro je jediný sýty PLNÝ prvok, zlatý.

   TU JE JEDINÝ VÝKRES a je to zámer: `.load-mark` (26 px, načítavanie) aj
   `.charon-sigil` (32 px, prázdny dok nad grafom) čítajú tú istú tabuľku
   `SIGIL_NET`. Dva výkresy sa vždy rozídu — dnešný stav appky je toho dôkaz:
   `mind/charon.js` a `console/render.js` mali každý svoju kópiu starého prstenca.
   Kým geometria žije tu, dosiahnu na ňu len moduly obrazovky Graf; `/console`
   a `/chat` na ňu import nemajú a ich nosiče (`.empty-sigil`, `#chat-home`,
   `.ce-mark`, `#brand-core`, `#back-to-graph`) kreslia stále starý prstenec.
   Správny domov je preto `public/js/shared/sigil.js` — je to NAHLÁSENÁ potreba,
   nie opomenutie; tento súbor ju vlastniť nemá.

   ViewBox je 24 na všetkých nosičoch, tak ako doteraz: `transform-origin`
   aj dash matematika sa v SVG merajú v UŽÍVATEĽSKÝCH jednotkách viewBoxu, takže
   jeden výkres platí na 24, 26, 32 aj 44 px bez druhej sady čísel.

   KONTRAKT S KRESBOU (mind.css, blok ZROD ZNAKU) — markup ho musí naozaj niesť,
   inak zrod ticho nebeží:
     `class="bc-mark"` na `<svg>` je SPÍNAČ zrodu. Nesie ho `.charon-sigil`;
        `.load-mark` ho ZÁMERNE nemá (dôvod je pri jeho pravidle v mind.css:
        spinner sa montuje pri každom načítaní zoznamu a kreslenie hrán nanovo
        by z jednorazovej dramaturgie urobilo druhý, konkurenčný pohyb).
     `.bc-nodes` musí byť skupina s TROMI satelitmi ako svojimi jedinými deťmi —
        dobehy 80/160 ms visia na `:nth-child(2)` a `(3)`. Jadro do tej skupiny
        NEPATRÍ: má vlastnú, dlhšiu dráhu a `:nth-child` by mu ju rozhodil.
     `.bc-edge` je JEDEN PRVOK NA HRANU s `pathLength="100"`, nie jedna cesta so
        štyrmi podcestami. Hrany sú rôzne dlhé (6,10–8,13 jednotky), takže jedna
        podcestová dash hodnota by jednu dokreslila a ostatné zastavila v polovici;
        `pathLength` prevedie dash na percentá dĺžky a CSS tak nemusí poznať
        geometriu (kalibrácia oboch smerov je v mind.css nad `bc-draw`).
     `.bc-core` nesie LEN zlaté jadro a je to jeden prvok bez `.bc-node` — dve
        animácie nad tým istým `transform` by sa bili.

   PRAVIDLO REDUKCIE — tvrdšie než u kruhu a PRIZNANÉ po stupňoch. Hrany vedú zo
   STREDU jadra (tam sú skryté pod jeho plným kotúčom, r 2,6) na okraj prstenca
   satelitu, takže z nich VIDNO 3,90 / 3,60 / 3,50 jednotky, a chordu medzi 2. a 3.
   satelitom celú (8,13). Zmerané dĺžky ciest: 6,496 / 6,202 / 6,100 / 8,127.
   Prepočet na obrazovkové px:

     32 px (dok aj spinner): vidno 5,20 / 4,80 / 4,67 / 10,84 px · obrysy 1,60 / 1,47
     24 px (hlavičky):       vidno 3,90 / 3,60 / 3,50 /  8,13 px · obrysy 1,20 / 1,10
     16 px (favicon):        vidno 2,60 / 2,40 / 2,33 /  5,42 px · obrysy 0,80 / 0,73

   HRANICA JE 32 px — taká, akú dáva zadanie („pod ~32 px sa hrany zlejú") a akú
   nezávisle zapísala kresba (`.load-mark` v mind.css preto vyrástol z 26 na 32 px).
   Nad ňou sa kreslí sieť, pod ňou stupeň `'core'`, teda JEDEN uzol. Aritmetické
   dno je nižšie než tá hranica a je dobré to vedieť: pri 24 px sú obrysy ešte
   1,20 a 1,10 px, teda nad plným pixelom, až pri 16 px padajú na 0,80 a 0,73, kde
   antialiasing zoberie viac než polovicu kontrastu. Sieť teda pri 24 px nezmizne —
   len sa jej hrany scvrknú na 3,5 px stuble a znak prestane hovoriť „sieť". Prah sa
   preto neurčuje z obrysov, ale zo stubli, a 24 px nosiče (`#brand-core`,
   `#back-to-graph`, `#chat-home`) patria pod stupeň `'core'`.

   Stupeň `'core'` nekreslí ten uzol zo siete zväčšený, ale bajt na bajt dnešnú
   značku (prstenec `r 8,64` / obrys `2,16`, zlato `r 3,6`, teda `36 / 9 / 15`
   z `public/brand/hades-sigil-mini.svg` prepočítané do viewBoxu 24). Identita sa
   pri 16 px nerozpadne práve preto, že redukovaný tvar JE tá značka, ktorú appka
   nosila doteraz, a v jazyku plátna je to poctivý uzol: prstenec s plným stredom.
   Čo presne zmizne: tri satelitné uzly a všetky štyri hrany. Zlatý kotúč sám by
   značka nebol — amethyst musí prežiť do najmenšieho stupňa.

   FAREBNÝ KÁNON sa nemení: hrany a nesýte uzly amethyst (`--accent`, nosná
   a interaktívna rola), jadro zlaté (rola vyhradená značke a jadru vedomia).
   Tokeny, nikdy hex. Ktorá zlatá, rozhoduje NOSIČ, nie výkres: značkové nosiče
   `--brand-gold`, spinner `--gold-text` (téme prispôsobená zlatá pre malé plné
   prvky — dôvod je pri pravidle `.load-mark`), rail `currentColor`.

   POHYB je celý v CSS. SMIL sa nepoužije: nectí `prefers-reduced-motion`
   (§3 manuálu) a vo faviconách ani v `<img>` ho prehliadače neanimujú.

   Kreslí sa `createElementNS`, resp. reťazcom — nie cez `iconMarkup()` zo
   shared/icons.js: tá sada je ikonografia (60 symbolov) a znak značky do nej
   nepatrí. A pozor: `textContent` na `<svg>` nezobrazí NIČ a výnimku nevydá,
   takže znak sa nikdy neskládá priradením textu. */
const SIGIL_NET = {
    /* Jadro je PLNÝ kotúč bez prstenca. Prstenec okolo neho bol starý znak;
       v novom by z jadra urobil štvrtý prstencový uzol a „jediný sýty prvok"
       by prestal byť jediný. */
    core: { x: 12, y: 12, r: 2.6 },
    /* Vzdialenosti od jadra sú zámerne rôzne (9,00 / 8,70 / 8,60) a uhly
       nepravidelné: pravidelný trojuholník je ornament, sieť pamäti nie je
       symetrická. Ďalej to nejde — pri prstenci s vonkajším polomerom 2,50 je
       strop vzdialenosti 9,50 a satelit by sa dotkol okraja viewBoxu. */
    nodes: [
        { x: 4.06, y: 7.76, r: 1.9, sw: 1.2 },
        { x: 20.05, y: 8.70, r: 1.9, sw: 1.2 },
        { x: 14.02, y: 20.36, r: 1.9, sw: 1.2 },
    ],
    /* Tri hrany zo stredu jadra + chorda 2↔3. Chorda je z troch možných spojení
       satelitov jediná, ktorá minie jadro (zmerané: 5,63 od stredu proti polomeru
       2,60; ostatné dve by ho preťali). Sieť tým prestane byť hviezda — uzol vie
       viesť k uzlu, nie len do stredu, čo je presne to, čo graf pamäti robí. */
    edges: [
        [12, 12, 6.27, 8.94],
        [12, 12, 17.74, 9.65],
        [12, 12, 13.43, 17.93],
        [18.90, 10.92, 15.17, 18.14],
    ],
    edgeSw: 1.1,
    mini: { r: 8.64, sw: 2.16, gold: 3.6 },
};

/* Popis častí — jedna tabuľka, dva vydavatelia (reťazec pre innerHTML, prvky pre
   append). Ten istý vzor ako `iconMarkup()` / `iconSvg()`: dve cesty do DOM,
   jeden zdroj kresby. Skupina `.bc-nodes` je súčasťou kontraktu, nie kozmetika. */
function sigilParts(opts) {
    const g = SIGIL_NET;
    const gold = (opts && opts.gold) || 'var(--brand-gold)';
    if (opts && opts.step === 'core') {
        return [
            { tag: 'g', cls: 'bc-nodes', kids: [
                { tag: 'circle', a: { class: 'bc-node', cx: 12, cy: 12, r: g.mini.r,
                    fill: 'none', stroke: 'var(--accent)', 'stroke-width': g.mini.sw } },
            ] },
            { tag: 'circle', a: { class: 'bc-core', cx: 12, cy: 12, r: g.mini.gold,
                fill: gold } },
        ];
    }
    const parts = g.edges.map((e) => ({
        tag: 'path',
        a: { class: 'bc-edge', pathLength: '100', d: 'M' + e[0] + ' ' + e[1] + 'L' + e[2] + ' ' + e[3],
            fill: 'none', stroke: 'var(--accent)', 'stroke-width': g.edgeSw,
            'stroke-linecap': 'round' },
    }));
    parts.push({ tag: 'g', cls: 'bc-nodes', kids: g.nodes.map((n) => ({
        tag: 'circle',
        a: { class: 'bc-node', cx: n.x, cy: n.y, r: n.r, fill: 'none',
            stroke: 'var(--accent)', 'stroke-width': n.sw },
    })) });
    parts.push({ tag: 'circle', a: { class: 'bc-core', cx: g.core.x, cy: g.core.y,
        r: g.core.r, fill: gold } });
    return parts;
}

function sigilAttrs(a) {
    let out = '';
    Object.keys(a).forEach((k) => { out += ' ' + k + '="' + a[k] + '"'; });
    return out;
}

function sigilPartMarkup(p) {
    if (p.kids) {
        return '<g class="' + p.cls + '">' + p.kids.map(sigilPartMarkup).join('') + '</g>';
    }
    return '<' + p.tag + sigilAttrs(p.a) + '/>';
}

function sigilPartNode(p) {
    const NS = 'http://www.w3.org/2000/svg';
    const node = document.createElementNS(NS, p.tag);
    if (p.kids) {
        node.setAttribute('class', p.cls);
        p.kids.forEach((k) => { node.append(sigilPartNode(k)); });
        return node;
    }
    Object.keys(p.a).forEach((k) => { node.setAttribute(k, p.a[k]); });
    return node;
}

/** Znak ako reťazec — pre nosiče, ktoré idú do `innerHTML`. `cls` môže byť
    prázdne (nosič si rozmer drží na obale); `opts.step` je `'full'` (default)
    alebo `'core'` (redukcia pod 24 px), `opts.gold` prepíše zlatý token. */
export function sigilNetMarkup(cls, opts) {
    let out = '<svg' + (cls ? ' class="' + esc(cls) + '"' : '')
        + ' viewBox="0 0 24 24" aria-hidden="true">';
    sigilParts(opts).forEach((p) => { out += sigilPartMarkup(p); });
    return out + '</svg>';
}

/** Znak ako prvok — pre nosiče, ktoré ho `append`ujú. Nikdy nie `textContent`. */
export function sigilNetSvg(cls, opts) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    if (cls) svg.setAttribute('class', cls);
    sigilParts(opts).forEach((p) => { svg.append(sigilPartNode(p)); });
    return svg;
}

/* Načítavanie NIE JE prázdny stav — má vlastný znak značky, ktorý dýcha
   (rovnaký motív ako jadro vedomia a favicon), namiesto generických presýpacích
   hodín.

   Od 1. 9. 2026 je nosičom INLINE SVG, nie CSS `border`: rám dokáže nakresliť
   kruh, zhluk uzlov spojených hranami nie. `.load-mark` zostáva OBALOM, ktorý drží
   rozmer a dýchanie (`.load-mark > svg` v mind.css naň sadá na 100 %), a jeho
   `<svg>` zámerne NENESIE `bc-mark` — zrod je jednorazová veta „znak vzniká", kým
   toto je stav „pracujem" a montuje sa pri každom načítaní zoznamu.

   Pôsobisko sa zúžilo: kde endpoint plní ZOZNAM alebo MRIEŽKU, kreslí sa
   skeleton — má čo kopírovať. Dýchajúci znak zostáva tam, kde tvar obsahu
   dopredu známy NIE JE: hľadanie duplicít a skladanie kontextu smernice.

   Text je NEOSOBNÝ („Načítava sa…"). Do 20. 8. 2026 tu stála prvá osoba a tento
   komentár to zdôvodňoval tým, že Hades o sebe hovorí v prvej osobe — čo prestalo
   platiť rozhodnutím o hlase značky (docs/BRAND-HADES.md §1). Prvá osoba je pri
   dlhej práci rušivá a mýtus už nesie meno; nemusí ho niesť aj každá hláška.
   Pohyb rieši CSS a vypína ho prefers-reduced-motion. */
export function loadingHtml(text) {
    return '<div class="empty empty-loading"><span class="load-mark" aria-hidden="true">'
        + sigilNetMarkup(null, { gold: 'var(--gold-text)' }) + '</span>'
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
