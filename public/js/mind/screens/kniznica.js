import { certBadge } from '../certainty.js';
import { openMdOverlay } from '../md.js';
import { bindPackButtons, packBtn } from '../pack.js';
import { originBadge } from './dnes.js';
import { mutedColor } from '../theme.js';
import { $, esc, getJson, plainInline, plainText, renderEmpty, renderLoading, timeAgo } from '../util.js';

/* ---------- obrazovka Knižnica (/api/library) ----------

   HĽADANIE FILTRUJE SERVER, OBLASŤ PREHLIADAČ — a je to zámer, nie nedôslednosť.
   `q` musí ísť na server, lebo ho vyhodnocuje SK-aware engine (stemované korene),
   ktorý v prehliadači nie je. Oblasť nie: `LibraryController` posiela obrazovke
   `limit => null`, takže na klientovi LEŽIA VŠETKY karty všetkých oblastí a
   dopyt navyše by len znova stiahol tie isté dáta (520 kB). `?area=` na serveri
   zostáva a používa ho AI (`mind_library`) aj priame volania API.

   Rovnaká úvaha ako v Rozhodnutiach, len s opačným výsledkom: tam filtruje server,
   lebo odpoveď má strop 500 a klientský filter by hľadal len v prvej stránke.
   Tu strop nie je, takže klientský filter vidí presne to isté, čo server. */

export const libraryState = { areas: [], total: 0, areaSlug: null, q: '' };

// F4: meta riadok skillu v Knižnici — origin + cert (icon) + vek + značky (chipy).
//
// Značky NEREŽEME kvôli dátam. Strop odpovede je na serveri
// (`KniznicaScreen::TAG_CAP` = 5), lebo `slice(0, 5)` v tomto riadku bola tichá
// strata dát v pohľade: uzol s ôsmimi značkami vyzeral ako uzol s piatimi, kým AI
// z tej istej odpovede dostala všetkých osem. Server teda pošle päť a povie
// `tags_more`, takže obe plochy čítajú to isté.
//
// Režeme tu kvôli MIESTU: riadok je jednoriadkový (blok „meta riadok karty je
// JEDEN riadok" v mind.css). Koľko toho zostalo je JEDNO číslo — prepad z tohto
// rezu PLUS `tags_more` — a ide do `data-more`, odkiaľ ho ::after vykreslí
// ako `attr()`.
//
// **Jedna značka, nie dve — a je to zmerané, nie odhadnuté.** Pri dvoch sa
// rozpočet riadku nezmestil: `origin` 83 + `cert` 18 + vek 105–112 + dve značky
// 117–190 + medzery ≈ 346–420 px proti 342 px vnútornej šírky karty pri
// `--card-cols: 300px`. Zmerané 24. 8. 2026 na 1440×900: **67 % kariet** (267
// zo 400) malo `scrollWidth > clientWidth`, takže druhá značka sa odrezala —
// a `data-more` ju nepočítalo, lebo počíta len to, čo sme nezobrazili. Riadok
// tak hlásil menej, než koľko naozaj chýbalo. Pri jednej značke sa rozpočet
// zmestí (~301 px) a prepad je znova pravdivý: čo nevidíš, je v čísle.
//
// Prečo počíta číslo JS: `tags_more` je údaj v dátach a CSS ho prečítať nevie.
// Kým skladalo značky CSS (`display: none` + tri `:has()` stavy), muselo si
// serverový čip „+N" nechať stáť, inak by riadok ohlásil menšie číslo než je
// skutočnosť — a karta s viac než piatimi značkami tak hlásila dva počty vedľa
// seba („+2" z CSS a „+3" zo servera). Jedno miesto, jedno číslo.
const LIB_TAGS_SHOWN = 1;

export function libMeta(s) {
    const tags = Array.isArray(s.tags) ? s.tags : [];
    const shown = tags.slice(0, LIB_TAGS_SHOWN);
    // `tags_more` je to, čo odrezal server, `tags.length - shown.length` to, čo
    // režeme my. Prepad je súčet — nikdy nie menej, než koľko značiek chýba.
    const more = (tags.length - shown.length) + (Number(s.tags_more) || 0);
    const chips = shown.map((t) => '<span class="tag">' + esc(t) + '</span>').join('');
    const cert = s.certainty ? certBadge(s.certainty, true) : '';
    const parts = originBadge(s.origin) + cert + libAge(s) + chips;
    const overflow = more > 0 ? ' data-more="+' + more + '"' : '';
    return '<span class="lib-skill-meta"' + overflow + '>' + parts + '</span>';
}

/* Vek playbooku. Knižnica bola jediná obrazovka bez dátumu — a pri skille je
   práve vek tá vec, ktorá rozhoduje, či sa mu dá veriť. `verified_at` má prednosť
   pred `updated_at`: „overené pred týždňom" je iná veta než „niekto sa toho
   dotkol". Slovo pri čísle je preto súčasťou údaja, nie ozdoba. */
export function libAge(s) {
    if (s.verified_at) return '<span class="tag muted">overené ' + esc(timeAgo(s.verified_at)) + '</span>';
    if (s.updated_at) return '<span class="tag muted">zmenené ' + esc(timeAgo(s.updated_at)) + '</span>';
    return '';
}

// Poradové číslo dotazu — filtrovanie je debouncované (controls.js, 220 ms), ale
// nie serializované, takže pomalšia STARŠIA odpoveď dokáže prepísať novšiu a v
// zozname zostane výsledok pre predchádzajúci výraz. Guard zahodí všetko, čo už
// nie je posledný dotaz.
let librarySeq = 0;

export async function renderLibrary() {
    const body = $('library-body');
    if (!body) return;
    const seq = ++librarySeq;
    const q = ($('library-search').value || '').trim();
    // Načítavaciu značku ukazujeme LEN keď nie je čo zachovať. Pri filtrovaní
    // zoznam necháme stáť a iba ho ztlmíme — inak obrazovka pri každom stlačení
    // klávesy zablikala naprázdno (a s výraznejšou značkou to bije ešte viac).
    const hasList = !!body.querySelector('.lib-area');
    if (hasList) body.classList.add('is-stale');
    else renderLoading(body, 'Načítavam knižnicu…');
    try {
        const url = '/api/library' + (q ? ('?q=' + encodeURIComponent(q)) : '');
        const d = await getJson(url);
        if (seq !== librarySeq) return;                 // medzitým prišiel novší dotaz
        body.classList.remove('is-stale');
        libraryState.areas = d.areas || [];
        // počet hlási server (`counts.skills`), nedopočítava sa z načítaných kariet
        libraryState.total = (d.counts && d.counts.skills) || 0;
        libraryState.q = q;
        pruneLibraryArea();
        renderLibraryView();
    } catch (e) {
        if (seq !== librarySeq) return;
        body.classList.remove('is-stale');
        libraryAxisSig = null;
        renderEmpty(body, 'cloud_off', 'Nepodarilo sa načítať knižnicu', 'Skús obnoviť stránku.');
    }
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
    if (!areas.length) {
        // Niet ani osi, z ktorej by sa dal poskladať filter — prázdno berie celé telo.
        libraryAxisSig = null;
        renderEmpty(body, 'menu_book',
            q ? 'Nič sa nenašlo' : 'Knižnica je prázdna',
            q ? 'Skús kratší výraz.' : 'Playbooky sa tu objavia, keď ich Hades dostane.');
        return;
    }
    ensureLibraryShell(body);
    syncLibraryFilter();
    const shown = libraryState.areaSlug
        ? areas.filter((a) => a.slug === libraryState.areaSlug)
        : areas;
    const list = $('library-list');
    list.innerHTML = shown.map(libAreaHtml).join('');
    list.querySelectorAll('.lib-skill[data-id]').forEach((el) => {
        el.onclick = () => openMdOverlay({ id: +el.dataset.id, label: el.dataset.label, path: el.dataset.path || null });
    });
    bindPackButtons(list);
}

/* Čipy a zoznam sú dva bloky, nie jeden innerHTML: klik do filtra prekresľuje
   zoznam a keby sa s ním menil aj rad čipov, zmizol by práve ten čip, na ktorom
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
   v .chip-n. Do 20. 8. 2026 sa oblasť dala zúžiť len tým, že človek uhádol jej
   presné slovo a napísal ho do hľadania. */
export function libChip(label, active, slug, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutú oblasť LEN farba. Vzor je
    // `runy.js` (chip()). Dopĺňa sa aj v syncLibraryFilter(), inak by sa trieda
    // a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '"'
        + ' data-lib-area="' + esc(slug) + '">'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
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
            renderLibraryView();
        };
    });
}

function libAreaHtml(a) {
    return '<section class="lib-area"><h2>'
        + '<span class="lib-dot" style="background:' + esc(a.color ? mutedColor(a.color) : 'var(--muted)') + '"></span>'
        // počet hlási server (`count`), nedopočítava sa z načítaných kariet
        + esc(a.name) + '<span class="lib-count">' + (a.count ?? 0) + '</span></h2>'
        + '<div class="lib-skills">'
        + (a.skills || []).map((s) =>
            '<div class="li-wrap lib-wrap">'
            + '<button type="button" class="lib-skill" data-id="' + s.id + '" data-label="' + esc(s.label) + '"'
            + (s.path ? ' data-path="' + esc(s.path) + '"' : '') + '>'
            + '<span class="lib-skill-label">' + esc(plainInline(s.label)) + '</span>'
            // popis playbooku je markdown — v náhľade z neho chceme len text
            + (s.snippet ? '<span class="lib-skill-snip">' + esc(plainText(s.snippet)) + '</span>' : '')
            + libMeta(s)
            + '</button>'
            + packBtn(s.id, s.label) + '</div>').join('')
        + '</div></section>';
}
