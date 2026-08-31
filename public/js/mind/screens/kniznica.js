import { certBadge } from '../certainty.js';
import { openMdOverlay } from '../md.js';
import { bindPackButtons, packBtn } from '../pack.js';
import { closeRecPanel, onRecPanelClose, openRecPanel, recOpenId } from '../recpanel.js';
import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { ASC, DESC, moreRow, renderTable, sortRows } from '../table.js';
import { mutedColor } from '../theme.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, deferSkeleton, esc, getJson, plainInline, plainText, renderEmpty, renderError, renderFilterEmpty, timeAgo } from '../util.js';
import { iconMarkup } from '../../shared/icons.js';

/* ---------- obrazovka Knižnica (/api/library) — TABUĽKA + PRAVÝ PANEL ----------

   Vlna tabuliek, tretia obrazovka po Runách a Rozhodnutiach: karty (`.lib-skill`
   v mriežke `.lib-skills`, zoskupené do sekcií `.lib-area`) sú preč a plocha je
   `<table class="rec-table">` z `table.js`, detail playbooku žije v `#rec-panel`
   (`recpanel.js`). Karta bola dobrá na jeden playbook; 1671 playbookov (zmerané
   31. 8. 2026 na `/api/library`) sa na kartách nedalo ani porovnať, ani zoradiť —
   a hlavne sa nedalo zistiť, KTORÝ z nich je starý, čo je pri playbooku ten
   najdôležitejší údaj.

   ČO ZMIZLO A JE TO ZÁMER:
   · Zoskupenie do sekcií podľa oblasti. Oblasť je odteraz STĹPEC (so swatchom),
     takže sa dá zoradiť — a filtračný rad čipov nad tabuľkou zostáva, teda cesta
     „chcem len Vývoj & kód" je tá istá ako predtým. Sekcie navyše hovorili to isté
     dvakrát: nadpis oblasti a pod ním karty tej istej oblasti.
   · `libMeta()` a rodina `.lib-skill*` / `.lib-area*` (producent zmizol; kresba
     v `mind.css` ostáva a jej odstránenie je samostatná úloha, nie vedľajší efekt
     tejto — presne ako `.dtl-*` po prechode Rozhodnutí na tabuľku).
     PRIZNANIE REZU ZNAČIEK SA NESTRATILO, len sa presťahovalo: nebolo to
     `data-more` + CSS `attr()`, ale je to čip „+N" priamo v cele — a číslo je ten
     istý súčet (klientský rez PLUS serverový `tags_more`), plus celý zoznam
     v `title` cely. Prečo nie `data-more`: to pravidlo vie kresliť len na
     `.lib-skill-meta`, čo je kresba karty, a cela tabuľky reže sama.

   ČO ZOSTALO NEDOTKNUTÉ:
   · HĽADANIE FILTRUJE SERVER, OBLASŤ PREHLIADAČ. `q` musí ísť na server, lebo ho
     vyhodnocuje SK-aware engine (stemované korene), ktorý v prehliadači nie je.
     Oblasť nie: `LibraryController` posiela obrazovke `limit => null`, takže na
     klientovi LEŽIA VŠETKY riadky všetkých oblastí (zmerané: `counts.shown`
     1671 = `counts.skills` 1671, `truncated: false`) a dopyt navyše by len znova
     stiahol tie isté dáta. `?area=` na serveri zostáva a používa ho AI
     (`mind_library`) aj priame volania API.
   · Počty hlási SERVER (`counts.skills`, `areas[].count`). Nedopočítavajú sa
     z načítaných riadkov.

   DÔSLEDOK PRE TRIEDENIE, ktorý stojí za to povedať nahlas: `sortRows()` tu ide
   nad CELÝM výsledkom, nie nad načítaným oknom, práve preto, že `limit => null`
   pošle všetko. `PAGE` je okno kresby nad zoradeným poľom, nie stránka zo servera.
   (Runy to tak nemajú — `/api/runs` sort nepodporuje a je to známa diera.) */

/* Koľko riadkov sa kreslí naraz (G3). Okno nad UŽ ZORADENÝMI dátami; „Ďalších N"
   nie je druhý dopyt. Pri 1671 riadkoch je vykreslenie všetkého naraz zbytočná
   práca a `table-layout: fixed` na 1671 riadkoch nič nezrýchli. */
const PAGE = 50;

/* Boot z URL (slovník §6): `kna` = slug oblasti, `q` = hľadanie, `kno` = otvorený
   playbook. `q` je SPOLOČNÝ kľúč šiestich obrazoviek a jeho význam určuje `s`,
   takže si ho vezmeme len vtedy, keď odkaz mieril naozaj sem — inak by výraz
   z Kontroly zúžil Knižnicu.

   Asymetria zostáva zámerná (viď blok vyššie): `q` ide na server, `kna` nie.
   Do URL idú OBA, pretože URL nesie polohu čitateľa, nie dopyt.

   POZOR — `kno` ZATIAĽ V SLOVNÍKU `urlstate.js` NIE JE a ten súbor nevlastním.
   Kým sa doň nepridá (`{ k: 'kno', kind: 'one', v: vInt, def: null,
   screen: 'kniznica', deb: DEB_FILTER }`), `writeUrl` neznámy kľúč ticho zahodí
   („neznámy kľúč sa nezavádza adresou") a `urlValue('kno')` vráti null. Kód je
   napísaný tak, ako keby kľúč žil: je to jeden riadok v cudzom súbore a všetko
   ostatné (otvorenie, zavretie, obnova z adresy) je hotové a otestované. Tvar
   `ruo` / `roo` sa tým drží do bodky. */
const BOOT_MINE = readUrl().s === 'kniznica';
const bootKno = BOOT_MINE ? parseInt(urlValue('kno') || '', 10) : NaN;

export const libraryState = {
    /* `areas` je FILTRAČNÁ OS (názov, slug, farba, počet) a `rows` sú riadky
       tabuľky — plochý zoznam playbookov s doplnenou oblasťou. Sú to dve rôzne
       veci nad jednou odpoveďou, nie dve kópie tej istej: os nesie počty nad
       celou oblasťou aj vtedy, keď je zapnutý filter na inú. */
    areas: [], rows: [], total: 0, truncated: false,
    areaSlug: (BOOT_MINE ? urlValue('kna') : null) || null,
    q: '',
    /* Triedenie je LOKÁLNE a v adrese NIE JE — rovnako ako v Runách a
       Rozhodnutiach. Default je názov vzostupne, teda presne poradie, v akom
       riadky posiela server (`Node::orderBy('label')`), len naprieč oblasťami:
       obrazovka sa načíta v poradí, ktoré tabuľka priznáva v `aria-sort`. */
    sortKey: 'label', sortDir: ASC,
    shown: PAGE,
};

/* Hľadaný výraz nedržíme v stave, ale v `#library-search` — `renderLibrary()` si
   ho odtiaľ číta sám a podstrkovať mu inú hodnotu by bol druhý zdroj pravdy.
   Z URL sa preto do poľa dosadí RAZ, pri prvom renderi (pole v DOM pri načítaní
   modulu ešte nemusí existovať). */
let libraryBootQ = BOOT_MINE ? (urlValue('q') || null) : null;

/* Playbook, ktorý má byť otvorený v paneli, ale riadky ešte nie sú načítané (boot
   z adresy alebo Späť do stavu s `kno`). Panel otvorí `renderLibraryList()`, keď
   dáta prídu — otvárať detail z id, ktoré v odpovedi nemusí byť, nemá ako vedieť,
   čo je v ňom napísané. */
let pendingOpenId = Number.isFinite(bootKno) ? bootKno : null;

/* Späť / Dopredu: adresa je vstup, obrazovka sa jej podriadi. Výraz ide do poľa
   (jeden zdroj pravdy) a `renderLibrary()` si ho odtiaľ prečíta sám. */
registerUrlApply('kniznica', (url) => {
    if (url.s !== 'kniznica') return;
    const nextArea = url.kna || null;
    const nextQ = url.q || '';
    const inp = $('library-search');
    const curQ = inp ? ((inp.value || '').trim()) : libraryState.q;
    const sameFilter = nextArea === libraryState.areaSlug && nextQ === curQ;
    if (!sameFilter) {
        libraryState.areaSlug = nextArea;
        if (inp) inp.value = nextQ; else libraryBootQ = nextQ;
        if (document.body.dataset.screen === 'kniznica') renderLibrary();
    }
    /* Panel je SAMOSTATNÁ os adresy, preto stojí ZA `sameFilter`, nie v ňom:
       Späť smie zavrieť detail bez toho, aby sa hýbal filter — a keby to viselo
       na predošlom `return`, práve ten najčastejší krok histórie by nič neurobil. */
    applyPanelFromUrl(url.kno || null);
});

/* Adresa → panel. Voláme to z aplikátora, teda počas `applying`, kedy je
   `writeUrl` no-op — otvorenie panelu si tým adresu neprepíše samo pod sebou. */
export function applyPanelFromUrl(raw) {
    const id = raw ? parseInt(String(raw), 10) : NaN;
    const open = recOpenId('kniznica');
    if (!Number.isFinite(id)) {
        pendingOpenId = null;
        // `recOpenId` je menný priestor: cudzí panel (Runy, Rozhodnutia) sa týmto
        // nezavrie.
        if (open != null) closeRecPanel();
        return;
    }
    if (open != null && String(open) === String(id)) return;
    const skill = libraryState.rows.find((s) => s.id === id);
    if (skill) { openSkillPanel(skill); return; }
    pendingOpenId = id;
}

/* Vek playbooku. Knižnica bola jediná obrazovka bez dátumu — a pri skille je
   práve vek tá vec, ktorá rozhoduje, či sa mu dá veriť. `verified_at` má prednosť
   pred `updated_at`: „overené pred týždňom" je iná veta než „niekto sa toho
   dotkol". Slovo pri čísle je preto súčasťou údaja, nie ozdoba.

   Stav korpusu 31. 8. 2026: `verified_at` má 0 z 1671 playbookov, `updated_at`
   všetkých 1671 — takže dnes stĺpec hlási „zmenené …" vždy. Vetva `verified_at`
   napriek tomu zostáva: je to pole serializéra, nie hypotéza. */
export function libAgeText(s) {
    if (s.verified_at) return 'overené ' + timeAgo(s.verified_at);
    if (s.updated_at) return 'zmenené ' + timeAgo(s.updated_at);
    return '';
}

/* Tá istá veta v čipe — pre PANEL, kde stojí v rade odznakov (oblasť, pôvod,
   istota, vek) a musí mať ich kresbu. V CELE tabuľky je to naopak plain text:
   `.tag` má rám a `padding: 1px var(--sp-1)`, takže „zmenené 21. jún" v čipe
   presiahlo 136 px stĺpca a rezalo sa v 29 z 50 riadkov (zmerané). Slová má na
   starosti `libAgeText()` — jeden producent, dve nádoby. */
export function libAge(s) {
    const t = libAgeText(s);
    return t ? '<span class="tag muted">' + esc(t) + '</span>' : '—';
}

/* Čo z dvojice dátumov riadok naozaj nesie. Jedno miesto pre kresbu, triedenie
   aj `title` — tri kópie tejto prednosti by sa rozišli. */
function libAgeIso(s) {
    return s.verified_at || s.updated_at || '';
}

/* SORTOVACIA HODNOTA VEKU JE KANONICKÝ UTC ISO, nie surový reťazec zo servera.
   `verified_at?->toIso8601String()` nesie OFFSET (`2026-08-10T15:02:58+02:00`),
   takže jeho abecedné poradie nie je chronologické, len sa tak tvári: dnes majú
   všetky riadky `+02:00` (zmerané: jediný offset v 1671 riadkoch), ale playbook
   uložený v zime nesie `+01:00` a zoradil by sa o hodinu vedľa. `toISOString()`
   dá pevnú šírku a `Z`, takže lexikografické poradie JE chronologické.

   Prečo nie epoch číslo: stĺpec nie je `kind: 'num'` (dátum nepatrí vpravo do
   mono), takže by ho `sortRows` porovnávalo cez `localeCompare` ako text — a to
   je pre čísla správne len náhodou, kým majú rovnaký počet číslic. */
function libAgeSort(s) {
    const iso = libAgeIso(s);
    if (!iso) return '';
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : '';
}

/* Plný dátum do `title`. Cela hlási relatívny vek („zmenené 3 d"), ktorý je na
   prehľad lepší, ale nedá sa z neho zistiť, KEDY to bolo — a pri playbooku je
   presné datum práve to, čo človek chce vedieť, keď sa rozhoduje, či mu veriť. */
function libAgeTitle(s) {
    const iso = libAgeIso(s);
    if (!iso) return '';
    const word = s.verified_at ? 'Overené ' : 'Zmenené ';
    return word + new Date(iso).toLocaleString('sk', {
        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

/* ISTOTA JE ORDINÁLNA, nie abecedná. Zoradené podľa kľúča by šlo
   „hypoteza < overene < pasca", teda hypotéza pred overeným a pasca na konci ako
   najhoršia náhodou — poradie, ktoré nič neznamená. Rank drží zámer: najprv to,
   čomu sa dá veriť, potom hypotézy, potom pasce. Prázdna istota (484 z 1671
   riadkov) `sortValue` nedostane vôbec a `sortRows` ju pošle na konec —
   „bez istoty" nie je štvrtý stupeň, je to chýbajúci údaj. */
const CERT_RANK = { overene: '1', hypoteza: '2', pasca: '3' };

/* Koľko značiek sa vojde do cely. Karta niesla JEDNU (rozpočet jednoriadkového
   meta riadku pri `--card-cols: 300px`), cela stĺpca Značky je širšia, takže dve —
   a zmerané, nie odhadnuté: dve najdlhšie značky riadku majú v p90 21 znakov
   (max 35) proti ~18 % šírky tabuľky. Prepad je JEDNO číslo: klientský rez PLUS
   serverový `tags_more` (`KniznicaScreen::TAG_CAP` = 5, prepad hlási 197 z 1671
   riadkov). Nikdy nie menej, než koľko značiek naozaj chýba. */
const LIB_TAGS_SHOWN = 2;

function libTagsCell(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const shown = tags.slice(0, LIB_TAGS_SHOWN);
    const more = (tags.length - shown.length) + (Number(s.tags_more) || 0);
    if (!shown.length && !more) return '—';
    return shown.map((t) => '<span class="tag">' + esc(t) + '</span>').join('')
        + (more > 0 ? '<span class="tag muted">+' + more + '</span>' : '');
}

/* Rez sa priznáva DVAKRÁT a obe priznania sú potrebné: čip „+N" hovorí, že tam
   niečo je, `title` hovorí ČO. Serverový prepad `tags_more` sa v `title` menuje
   slovom, pretože tie značky v odpovedi naozaj nie sú a vypísať sa nedajú. */
function libTagsTitle(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    if (!tags.length) return '';
    const rest = Number(s.tags_more) || 0;
    return tags.join(' · ') + (rest > 0 ? ' · + ďalších ' + rest : '');
}

/* Poradové číslo dotazu — filtrovanie je debouncované (controls.js, 220 ms), ale
   nie serializované, takže pomalšia STARŠIA odpoveď dokáže prepísať novšiu a v
   zozname zostane výsledok pre predchádzajúci výraz. Guard zahodí všetko, čo už
   nie je posledný dotaz. */
let librarySeq = 0;

export async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    const seq = ++librarySeq;
    const inp = $('library-search');
    // Jednorazové dosadenie výrazu z odkazu; ďalej je zdrojom pravdy pole samo.
    if (libraryBootQ !== null && inp) { inp.value = libraryBootQ; libraryBootQ = null; }
    const q = ((inp && inp.value) || '').trim();
    // Načítavaciu kostru ukazujeme LEN keď nie je čo zachovať. Pri filtrovaní
    // zoznam necháme stáť a iba ho ztlmíme — inak obrazovka pri každom stlačení
    // klávesy zablikala naprázdno.
    const hasList = !!body.querySelector('.rec-table');
    // Kostra v tvare obsahu: `table` (rad filtračných čipov + hustejšie riadky),
    // nie `cards` — od prechodu na tabuľku má kopírovať to, čo naozaj príde.
    const cancelSkeleton = hasList ? null : deferSkeleton(body, 'table');
    if (hasList) body.classList.add('is-stale');
    try {
        const url = '/api/library' + (q ? ('?q=' + encodeURIComponent(q)) : '');
        const d = await getJson(url);
        // Zrušiť PRED `seq` kontrolou: naplánovaná kostra zahodenej odpovede by inak
        // dosadla nad výsledok toho dotazu, ktorý medzitým vyhral.
        if (cancelSkeleton) cancelSkeleton();
        if (seq !== librarySeq) return;                 // medzitým prišiel novší dotaz
        body.classList.remove('is-stale');
        applyLibraryPayload(d, q);
        pruneLibraryArea();
        renderLibraryView();
    } catch (e) {
        if (cancelSkeleton) cancelSkeleton();
        if (seq !== librarySeq) return;
        body.classList.remove('is-stale');
        libraryAxisSig = null;
        renderError(body, 'knižnicu', renderLibrary);
    }
}

/* Odpoveď → stav. Riadky sa SPLOŠTIA: oblasť z obalu sa dopíše do riadka, aby
   mal stĺpec Oblasť čo kresliť a čo triediť. Nie je to dopočet dát — je to tá
   istá hodnota, len presunutá z obalu do riadka, ktorý k nej patrí. */
function applyLibraryPayload(d, q) {
    libraryState.areas = d.areas || [];
    // počet hlási server (`counts.skills`), nedopočítava sa z načítaných riadkov
    libraryState.total = (d.counts && d.counts.skills) || 0;
    libraryState.truncated = !!d.truncated;
    libraryState.q = q;
    const rows = [];
    for (const a of libraryState.areas) {
        for (const s of (a.skills || [])) {
            rows.push(Object.assign({}, s, {
                area: a.name || '',
                area_slug: a.slug || '',
                area_color: a.color || '',
            }));
        }
    }
    libraryState.rows = rows;
    /* Nové dáta = nové okno. Bez tohto by po zmene hľadania ostalo rozbalených
       „prvých 150" z predošlého výsledku a „Ďalších 50" by hlásilo pomer, ktorý
       s aktuálnym výrazom nič nespája. */
    libraryState.shown = PAGE;
}

/* Zrušenie hľadania — jedna akcia prázdneho stavu `.empty--filter`.
   `#library-search` je SÚRODENEC `#library-body` (mind.blade.php), takže prežije
   prepis tela a dá sa vyprázdniť odtiaľto; `renderLibrary()` si výraz z toho poľa
   aj tak číta sám, takže sa mu nič nepodstrkuje. */
function clearLibrarySearch() {
    const inp = $('library-search');
    if (inp) inp.value = '';
    renderLibrary();
}

/* Oblasť, ktorá po zúžení textom už žiadny skill nemá, stratí svoj čip — a keby
   filter ostal zapnutý, obrazovka by bola prázdna BEZ tlačidla, ktorým sa to
   zruší. Rozhodnutia to isté robia v `pruneDecisionFilters`. */
export function pruneLibraryArea() {
    if (libraryState.areaSlug !== null
        && !libraryState.areas.some((a) => a.slug === libraryState.areaSlug)) {
        libraryState.areaSlug = null;
    }
}

export function renderLibraryView() {
    const body = $('library-body');
    if (!body) return;
    const areas = libraryState.areas;
    const q = libraryState.q;
    /* Adresa sa píše TU, nie v `renderLibrary()`: sem vedú obe cesty — nová
       odpoveď servera (po `pruneLibraryArea()`, teda orezaná pravda) aj klik do
       radu čipov, ktorý server neobťažuje vôbec. Jedno miesto, jeden zápis.
       `replace` — filter do histórie nepatrí (rozhodnutie 10). */
    writeUrl({ kna: libraryState.areaSlug, q: q || null }, 'replace');
    if (!areas.length) {
        // Niet ani osi, z ktorej by sa dal poskladať filter — prázdno berie celé telo.
        libraryAxisSig = null;
        /* Prázdno z HĽADANIA je iná správa než prázdna knižnica a má jednu akciu.
           Akcia sa dá ponúknuť len pri `q`: oblasť sem nedosiahne (filtruje sa nad
           `areas`, a keď je pole prázdne, `pruneLibraryArea()` slug už zhodil), takže
           bez výrazu naozaj nie je čo zrušiť.
           Popisok je „Zruš hľadanie", nie „Zruš filter" — je to iné gesto a stojí
           na inom prvku (`#library-search`, ktoré je mimo tohto kontejnera). */
        if (q) {
            renderFilterEmpty(body, 'Nič sa nenašlo', 'Skús kratší výraz.', clearLibrarySearch, 'Zruš hľadanie');
        } else {
            renderEmpty(body, 'book', 'Knižnica je prázdna',
                'Playbooky sa tu objavia, keď ich Hades dostane.');
        }
        return;
    }
    ensureLibraryShell(body);
    syncLibraryFilter();
    renderLibraryList();
}

/* Čipy a tabuľka sú dva bloky, nie jeden innerHTML: klik do filtra prekresľuje
   tabuľku a keby sa s ňou menil aj rad čipov, zmizol by práve ten čip, na ktorom
   stojí fokus. Rad sa preto stavia len keď sa zmení OS oblastí — teda pri novej
   odpovedi zo servera, nie pri prepínaní filtra. */
let libraryAxisSig = null;

function libraryAxisSignature() {
    return JSON.stringify(libraryState.areas.map((a) => [a.slug, a.name, a.count]));
}

function ensureLibraryShell(body) {
    const sig = libraryAxisSignature();
    if ($('library-list') && libraryAxisSig === sig) return;
    libraryAxisSig = sig;
    body.innerHTML = '<div id="library-filter"></div><div id="library-list"></div>';
    $('library-filter').innerHTML = libraryFilterHtml();
    wireLibraryFilter();
}

/* Čip hovorí tým istým jazykom ako v Denníku a Rozhodnutiach: popisok + počet
   v .chip-n. Kresba čipov sa touto vlnou NEMENÍ — swatch oblasti som do nich
   skúsil pridať a zmerané: `.chip` nie je flexový kontejner, takže `.lib-dot`
   zostal `display: inline` a mal šírku 0 px. Farbu oblasti nesie stĺpec Oblasť,
   ktorý na to má vlastné pravidlo (viď `areaSwatch`). */
export function libChip(label, active, slug, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutú oblasť LEN farba. Vzor je
    // `runy.js` (chip()). Dopĺňa sa aj v syncLibraryFilter(), inak by sa trieda
    // a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '"'
        + ' data-lib-area="' + esc(slug) + '">'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

/* Farebná bodka oblasti v cele tabuľky a v hlavičke panelu. Farba MUSÍ ísť cez
   `mutedColor()` (OKLCh, zrezaná chroma, jednotná svetlosť), inak UI hovorí inou
   farbou než plátno — v HSL by z gold bola špinavo hnedá.

   Trieda je `.lib-dot`, teda tá istá, akú niesli nadpisy oblastí v starej
   kartovej Knižnici: rovnaký význam, rovnaké meno. POZOR — `.lib-dot` má
   `width/height` bez `display`, takže mimo flexového rodiča je to `display:
   inline` a bodka má 0 px (zmerané). V `.lib-area h2` fungovala preto, že ten
   nadpis je flex. Cela tabuľky flex nie je, takže potrebuje jedno pravidlo
   v `mind.css` — je v hlásení pre vlastníka CSS. Dovtedy je stĺpec čitateľný
   (text oblasti), len bez farby; nič sa nestráca. */
function areaSwatch(color) {
    return '<span class="lib-dot" style="background:'
        + esc(color ? mutedColor(color) : 'var(--muted)') + '"></span>';
}

function libraryFilterHtml() {
    const areas = libraryState.areas;
    // jedna oblasť nie je filter, len šum (rovnaké pravidlo ako v Rozhodnutiach)
    if (areas.length < 2) return '';
    return '<div class="dtl-filter">'
        + libChip('Všetky oblasti', !libraryState.areaSlug, '', libraryState.total)
        + areas.map((a) => libChip(a.name, libraryState.areaSlug === a.slug, a.slug, a.count)).join('')
        + '</div>';
}

function syncLibraryFilter() {
    const wrap = $('library-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-lib-area]').forEach((el) => {
        const on = (libraryState.areaSlug || '') === el.dataset.libArea;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

function wireLibraryFilter() {
    const wrap = $('library-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-lib-area]').forEach((el) => {
        el.onclick = () => {
            const slug = el.dataset.libArea || null;
            if (libraryState.areaSlug === slug) return;
            libraryState.areaSlug = slug;
            /* Iný filter = iné okno. Bez tohto by po zúžení na oblasť s 52
               riadkami zostalo „shown" na 150 z predošlej oblasti a „Ďalších N"
               by hlásilo pomer, ktorý s aktuálnym filtrom nič nespája. */
            libraryState.shown = PAGE;
            renderLibraryView();
        };
    });
}

/* Riadky pre aktuálny filter oblasti. Filtruje KLIENT (viď blok na začiatku
   súboru) — server poslal všetko. */
function visibleRows() {
    const slug = libraryState.areaSlug;
    return slug ? libraryState.rows.filter((s) => s.area_slug === slug) : libraryState.rows;
}

/* ---------- stĺpce ----------
   STĹPCE SÚ LEN TIE, ČO V DÁTACH NAOZAJ SÚ. `KniznicaScreen::skill()` vracia
   `id`, `label`, `path`, `snippet`, `origin`, `certainty`, `verified_at`,
   `updated_at`, `tags`, `tags_more`; oblasť (`name`/`slug`/`color`) nesie obal.
   Nič iné neexistuje — a dopočítať čokoľvek z grafového payloadu (`S.nodes`) by
   zopakovalo chybu, ktorú si už raz zaplatili Rozhodnutia: človek by videl
   stĺpec, ktorý AI nevidí, a bez načítaného grafu by svietil prázdny.

   `snippet` stĺpec NEDOSTAL a je to rozhodnutie: je to 120 znakov popisu (1665
   z 1671 riadkov ho má), teda text, ktorý sa v cele odseká na pár slov a nič
   nepovie. Celý žije v pravom paneli, kde má miesto. Rovnako `path` — a ten navyše
   nesie len 47 z 1671 riadkov, takže by to bol stĺpec, ktorý je 97 % času prázdny.

   ŠÍRKY: `rem` tam, kde obsah nerastie (istota, vek, pôvod, akcia), percento tam,
   kde rastie s oknom (oblasť, značky). `min(7.5rem, 22%)` prehliadač
   v `table-layout: fixed` ZAHODÍ — percento vnútri `min()` sa pri výpočte šírok
   stĺpcov nedá vyriešiť a všetky stĺpce dostanú tú istú šírku (zaplatené vo vlne
   Runov). Názov playbooku `width` nedostáva vôbec: je to hlavný identifikátor
   riadka a `table-layout: fixed` mu dá zvyšok. */
export function libColumns() {
    return [
        {
            key: 'label', label: 'Playbook',
            cell: (s) => esc(plainInline(s.label)),
            /* Radí sa podľa TOHO, ČO JE VIDIEŤ. V dnešnom korpuse nemá backticky
               ani jeden z 1671 labelov (zmerané), ale label chodí z `mind_learn`
               tak, ako ho napísal Claude Code — a `plainInline` je tu aj v cele,
               takže dve rôzne hodnoty by znamenali, že riadok stojí inde, než kam
               ho oko čaká. */
            sortValue: (s) => plainInline(s.label || ''),
            // p90 dĺžky labelu je 34 znakov, max 68 — reže sa, teda sa to priznáva.
            titleFrom: (s) => plainInline(s.label || ''),
        },
        {
            key: 'area', label: 'Oblasť', width: '16%',
            cell: (s) => areaSwatch(s.area_color) + esc(s.area || '—'),
            /* Bez `sortValue` by sa triedilo podľa `row.area`, čo je presne ten
               istý text — ale explicitne, aby sa pri zmene cely nezabudlo.
               `localeCompare('sk')` v `sortRows` je tu podstatný: bez neho by
               „Dizajn & kreatíva" a „Vývoj & kód" stáli podľa kódových bodov. */
            sortValue: (s) => s.area || '',
            titleFrom: (s) => s.area || '',
        },
        {
            key: 'certainty', label: 'Istota', width: '7.5rem',
            /* Ten istý odznak ako na Kontrole a v detaile uzla — istota je jedna
               vec a má v celej appke jednu kresbu. Bez istoty je pomlčka, nie
               odznak „Bez istoty": 484 z 1671 riadkov by inak niesli odznak, ktorý
               hlási neprítomnosť údaja ako údaj. */
            cell: (s) => (s.certainty ? certBadge(s.certainty) : '—'),
            sortValue: (s) => CERT_RANK[s.certainty] || '',
        },
        {
            key: 'age', label: 'Vek', width: '8.5rem',
            cell: (s) => esc(libAgeText(s)) || '—',
            sortValue: libAgeSort,
            titleFrom: libAgeTitle,
        },
        {
            key: 'tags', label: 'Značky', width: '18%',
            /* NESORTOVATEĽNÉ zámerne: značky sú MNOŽINA a množina nemá poradie.
               Radiť podľa „prvej značky" by radilo podľa náhody serverového
               `pluck` a radiť podľa počtu by bol iný stĺpec („koľko značiek"),
               než aký je napísaný v hlavičke. `aria-sort` sa preto na tomto `<th>`
               nekreslí vôbec — stav, ktorý neexistuje, sa nehlási. */
            sortable: false,
            cell: libTagsCell,
            titleFrom: libTagsTitle,
        },
        {
            key: 'origin', label: 'Pôvod', width: '7rem',
            /* Ten istý odznak ako na Dnes, v Denníku a v Rozhodnutiach. Triedi sa
               surovým kľúčom (`brain` / `session`); poradie zobrazených slov je
               rovnaké a `ORIGIN_LABEL` sa neexportuje, takže druhá kópia
               menoslovia by tu vznikla pre nulový rozdiel.
               `.col-origin` je už v mobilnom pravidle `mind.css`, takže sa pod
               768 px skryje bez nového CSS. */
            cell: (s) => originBadge(s.origin),
        },
        {
            /* Akcia, nie údaj — teda `sortable: false`. „Do rozhovoru" bolo na
               karte (`packBtn` v `.li-wrap`) a zmiznúť nesmie: je to gesto výberu
               viacerých uzlov (kontext doku má strop 8), takže presunúť ho DO
               panelu by z jedného kliknutia urobilo otvor-panel-klikni-zavri na
               každý uzol. Kresba aj stav členstva zostávajú jeden zdroj pravdy
               v `pack.js` / `charon.js`. */
            key: '_pack', label: 'Rozhovor', sortable: false, width: '5.5rem',
            cell: (s) => packBtn(s.id, s.label),
        },
    ];
}

/* Klik na tú istú hlavičku obracia smer, klik na inú nasadí smer, ktorý má pre
   stĺpec zmysel: vek od najnovšieho, slová a istota od začiatku. Prekresľuje sa
   LEN tabuľka — triedenie nie je dopyt na server (odpoveď prišla celá) a lišta
   s čipmi nad ňou sa hýbať nesmie. */
export function sortLibrary(key) {
    if (libraryState.sortKey === key) {
        libraryState.sortDir = libraryState.sortDir === ASC ? DESC : ASC;
    } else {
        libraryState.sortKey = key;
        libraryState.sortDir = key === 'age' ? DESC : ASC;
    }
    renderLibraryList();
    /* Prekreslenie zahodilo `<th>` aj s tlačidlom, na ktoré človek práve klikol,
       takže fokus by spadol na `<body>` a Tab by začal od začiatku dokumentu.
       Vraciame ho na to isté tlačidlo v novej kresbe. */
    const again = document.querySelector('#library-list .rec-sort[data-sort="' + key + '"]');
    if (again) again.focus();
}

/* Tabuľka v samostatnom kontejneri — mení sa pri každom filtri a pri triedení,
   lišta nad ňou nie. */
export function renderLibraryList() {
    const list = $('library-list');
    if (!list) return;
    const rows = visibleRows();

    /* `empty` v `renderTable()` sa ZÁMERNE nepoužíva: prázdno má tu dve rôzne
       príčiny a každá má vlastný text aj vlastnú akciu, kým tabuľka vie povedať
       jednu vetu. Filter podľa oblasti sa síce prune-uje (`pruneLibraryArea`),
       takže prázdno z neho je nedosiahnuteľné — ale hľadanie sa neprune-uje
       a s prázdnou osou by sme sem ani nedošli, takže táto vetva patrí hľadaniu. */
    if (!rows.length) {
        if (libraryState.q) {
            renderFilterEmpty(list, 'Nič sa nenašlo', 'Skús kratší výraz.', clearLibrarySearch, 'Zruš hľadanie');
        } else {
            renderEmpty(list, 'book', 'Knižnica je prázdna',
                'Playbooky sa tu objavia, keď ich Hades dostane.');
        }
        return;
    }

    const cols = libColumns();
    /* TRIEDI SA CELÝ VÝSLEDOK, nie načítané okno — `limit => null` znamená, že
       server poslal všetkých 1671 riadkov, takže `sortRows` má k dispozícii to
       isté, čo databáza. `slice` je až za triedením: obrátené poradie by z okna
       urobilo „prvých 50 zo servera zoradených medzi sebou", čo je presne tá lož,
       ktorú tabuľka nesmie hlásiť. */
    const sorted = sortRows(rows, libraryState.sortKey, libraryState.sortDir, cols);
    const page = sorted.slice(0, libraryState.shown);
    renderTable(list, cols, {
        rows: page,
        sortKey: libraryState.sortKey,
        sortDir: libraryState.sortDir,
        onSort: sortLibrary,
        onOpen: openSkillPanel,
        openId: recOpenId('kniznica'),
        idKey: 'id',
        caption: 'Playbooky v knižnici',
    });

    /* Celok pre „Ďalších N" je počet riadkov PO filtri oblasti, teda presne
       `rows.length` — a to je známe číslo, nie odhad: `truncated: false` znamená,
       že server nič neodrezal. Keby odrezal (AI strop `AI_LIMIT`, alebo keby sa
       `limit` v kontroléri niekedy zmenil), celok známy nie je a „N z M" by bola
       lož, takže sa nekreslí nič. */
    if (!libraryState.truncated) {
        moreRow(list, Math.min(page.length, rows.length), rows.length, () => {
            libraryState.shown += PAGE;
            renderLibraryList();
        });
    }

    // Dokresba: pack tlačidlá (stopPropagation je v `bindPackButtons`, takže klik
    // na ne neotvorí aj panel).
    bindPackButtons(list);
    consumePendingOpen();
}

/* ---------- detail v pravom paneli ----------
   Panel nesie CELÝ popis, cestu k dokumentu a akcie. Dovtedy sa klikom na kartu
   otváral rovno md overlay — to je celoobrazovkový modál nad `/api/nodes/{id}/
   markdown`, takže na „čo to vlastne je" musel človek zaplatiť načítaním celého
   dokumentu a odchodom z plochy. Panel odpovie z dát, ktoré už v ruke sú,
   a dokument otvorí až keď o to človek požiada.

   `updateRecPanel()` sa NEVOLÁ a je to zámer: detail sa nedopočítava zo servera.
   Popis, oblasť, istota, vek, značky aj cesta prišli v tom istom riadku ako
   tabuľka, takže druhé kreslenie by prepísalo to isté HTML — a panel by pri
   každom otvorení zablikal bez toho, aby sa čokoľvek dozvedel. */
export function openSkillPanel(s) {
    if (!s) return;
    openRecPanel({
        ns: 'kniznica',
        id: s.id,
        urlKey: 'kno',
        title: plainInline(s.label || '') || 'Playbook',
        html: skillDetailHtml(s),
    });
    /* Akcie sa vešajú až po vykreslení: `openRecPanel` berie hotové HTML a
       o playbookoch nevie nič — je to spoločný panel s Runami a Rozhodnutiami
       a vedieť to ani nemá. */
    const body = $('rec-panel-body');
    const doc = body && body.querySelector('.lib-open-doc');
    if (doc) {
        doc.onclick = () => openMdOverlay({
            id: +doc.dataset.id,
            label: doc.dataset.label,
            path: doc.dataset.path || null,
        });
    }
    const node = body && body.querySelector('.lib-open-node');
    if (node) node.onclick = () => openNodeFromAnywhere({ id: +node.dataset.node });
    markOpenRow();
    watchPanelClose();
}

export function skillDetailHtml(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const rest = Number(s.tags_more) || 0;

    let h = '<p>' + areaSwatch(s.area_color) + '<span class="tag">' + esc(s.area || '—') + '</span> '
        + originBadge(s.origin)
        + (s.certainty ? ' ' + certBadge(s.certainty) : '')
        + ' ' + libAge(s) + '</p>';

    /* Popis je markdown a server ho SKRÁTIL na 120 znakov (`Str::limit`), takže
       rez treba priznať slovom — inak to vyzerá, že playbook má popis na jednu
       vetu. Celý text je v dokumente a tlačidlo naň stojí hneď pod tým.
       `.rec-final` je z rodiny detailu záznamu (jediná existujúca kresba pre
       utlmený viacodsekový text), nie „finálna odpoveď". */
    if (s.snippet) {
        h += '<h3>Popis</h3><div class="rec-final">' + esc(plainText(s.snippet)) + '</div>'
            + '<p class="rec-more-n">začiatok popisu · celý text je v dokumente</p>';
    }

    if (tags.length) {
        h += '<h3>Značky</h3><p>' + tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join(' ')
            // Serverový prepad sa priznáva aj tu: v paneli je miesto na všetky
            // značky, ale odpoveď ich nesie len `TAG_CAP`, takže „všetky" by bola lož.
            + (rest > 0 ? ' <span class="tag muted">+' + rest + ' neposlaných</span>' : '') + '</p>';
    }

    /* Cesta k `.md` nesie len 47 z 1671 riadkov, takže sekcia je podmienená —
       prázdny nadpis „Dokument" by tvrdil, že cesta existuje a len ju nevidno.
       Dokument sa ale dá otvoriť VŽDY: `openMdOverlay` ide na
       `/api/nodes/{id}/markdown`, cesta je len údaj pre človeka. */
    if (s.path) {
        h += '<h3>Dokument</h3><p><span class="tag muted">' + esc(s.path) + '</span></p>';
    }

    h += '<h3>Otvoriť</h3><p>'
        + '<button type="button" class="chip lib-open-doc" data-id="' + s.id + '"'
        + ' data-label="' + esc(s.label || '') + '"'
        + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
        + iconMarkup('book') + 'Čítať dokument</button> '
        + '<button type="button" class="chip lib-open-node" data-node="' + s.id + '">'
        + iconMarkup('hub') + 'Zobraziť uzol #' + s.id + '</button>'
        + '</p>';
    return h;
}

/* Otvorený riadok nesie stav v `aria-current` (odtiaľ ho číta aj CSS), takže sa
   po otvorení a po zavretí panelu musí prepnúť. Nie prekreslením tabuľky: klik
   na riadok by ju postavil znova, zahodil fokus a pri 1671 riadkoch aj polohu
   scrollu — dva atribúty na riadok sú to isté za nulovú cenu. */
export function markOpenRow() {
    const open = recOpenId('kniznica');
    document.querySelectorAll('#library-list .rec-row').forEach((tr) => {
        const on = open != null && tr.dataset.rec === String(open);
        tr.classList.toggle('open', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
    });
}

/* Panel sa dá zavrieť aj bez nás — krížikom v jeho hlavičke, Escom alebo
   `dropRecPanel()` pri prepnutí obrazovky — a bez notifikácie by v tabuľke
   svietil riadok bez otvoreného detailu. Sledovať DÔSLEDOK (`MutationObserver`
   nad triedou panelu) je chyba, ktorú si tento repo už raz zaplatil: nechytá
   tretiu cestu a každá ďalšia obrazovka si ju musí napísať znova.

   Registruje sa raz; druhá registrácia by prvú prepísala (`Map` podľa menného
   priestoru), takže opakované volanie nič nepokazí. */
let closeWatch = false;
function watchPanelClose() {
    if (closeWatch) return;
    closeWatch = true;
    onRecPanelClose('kniznica', () => {
        // Prepnutie obrazovky panel tiež zatvára; vtedy tabuľka Knižnice na
        // obrazovke nie je a jej prekreslenie by bolo práca do prázdna.
        if (document.body.dataset.screen !== 'kniznica') return;
        markOpenRow();
    });
}

/* Id z adresy sa spotrebuje aj vtedy, keď riadok v aktuálnom filtri NIE JE:
   druhý pokus by ho hľadal v tých istých dátach a `kno` by v adrese strašilo
   naveky. Keď sa nenašlo, kľúč z adresy odchádza — adresa nemá sľubovať otvorený
   detail, ktorý sa neotvoril.

   POZOR: `pendingOpenId` sa hľadá v `libraryState.rows`, teda v CELOM výsledku,
   nie vo `visibleRows()` ani v okne `shown`. Odkaz na playbook z inej oblasti sa
   tým otvorí aj vtedy, keď je zapnutý filter — panel je detail záznamu, nie
   výber v tabuľke. */
function consumePendingOpen() {
    if (pendingOpenId == null) return;
    const s = libraryState.rows.find((x) => x.id === pendingOpenId);
    pendingOpenId = null;
    if (s) { openSkillPanel(s); return; }
    writeUrl({ kno: null }, 'replace');
}
