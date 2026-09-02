import { bindPackButtons, packBtn } from '../pack.js';
import { openNodeDetail } from '../screens.js';
import { showToast } from '../toasts.js';
import { renderSavedFilters } from '../table.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, deferSkeleton, esc, getJson, prettyLabel, renderEmpty, renderError, renderFilterEmpty } from '../util.js';
import { iconMarkup } from '../../shared/icons.js';

/* Denník — časová os zoskupená po dňoch, s filtrami.
   ============================================================================
   DENNÍK ZOSTÁVA KARTOVÝ a je to potvrdené rozhodnutie, nie rozpracovanosť:
   `table.js` to má napísané v hlavičke („Denník tabuľku NEDOSTÁVA") a je to
   naratívna os — dôležité je *čo sa stalo*, nie porovnanie stĺpcov. Z `table.js`
   si berie LEN `renderSavedFilters()`, teda mechaniku uložených filtrov, nie
   kresbu tabuľky.

   OSI FILTRA SÚ ŠTYRI A DELIA SA NA DVE POLOVICE:

     · projekt  — SERVEROVÁ os (`?project=<kľúč skupiny>`), počty zo servera nad
                  celým korpusom
     · hľadanie — SERVEROVÁ os (`?q=`), od 1. 9. 2026
     · obdobie  — klientska os nad načítaným oknom
     · zdroj    — klientska os nad načítaným oknom (`session` / `digest`)

   HĽADANIE MUSÍ BYŤ SERVEROVÉ a je to jediná možná odpoveď, nie preferencia:
   okno je 50 riadkov z 153 (namerané 1. 9. 2026), takže klientske hľadanie by
   prehľadalo tretinu denníka a na zvyšok odpovedalo „nenašlo sa". To nie je
   pomalé hľadanie, to je nesprávna odpoveď. `DennikScreen::applySearch()` hľadá
   v `label` aj `description` cez `LOWER(...) LIKE`.

   Klientske osi (obdobie, zdroj) zostávajú klientske, pretože ich `/api/journal`
   neprijíma (`JournalController::index` → `$request->only`), takže preosiať sa
   dajú len záznamy, ktoré už tu sú.

   OKNO SA DÁ PREDĹŽIŤ (`?offset=`, od 1. 9. 2026): „Ďalších 50" v pätičke načíta
   ďalšie okno a PRIPOJÍ ho k načítaným. Do tejto vlny bola pätička len text —
   endpoint offset nemal, takže tlačidlo by kliklo a nič by sa nestalo.

   A PRÁVE TU JE PASCA, ktorú si táto obrazovka raz už zaplatila (nález M6):
   čip s počtom vypočítaným z 50 načítaných záznamov sľubuje číslo nad celým
   denníkom, ktoré zoznam nedá. Preto počet na čipe **nekreslíme vždy, ale len
   keď je dokázateľne pravdivý** — a dôkaz je jeden z troch:

     1. okno je celé (`journalRecords.length >= journalFiltered`), teda nad
        aktuálnym serverovým filtrom už nič ďalšie neexistuje;
     2. obdobie je celé v okne (`periodStart(p) > windowOldest()`): keď je
        najstarší načítaný záznam STARŠÍ než začiatok obdobia, okno obsahuje
        každý záznam toho obdobia — a potom je exaktný aj počet po zdroji;
     3. os je „všetko × celý denník", čo je presne `filtered_total` zo servera.

   Kde dôkaz nie je, počet sa nekreslí. Radšej nič než lož.

   GRAF NA TEJTO OBRAZOVKE NIE JE a je to rozhodnutie, nie prázdne miesto.
   `/api/journal` posiela záznamy (`created_at`, `label`, `source`, `project`,
   `file_count`, `commit_count`) — jediná číselná os, ktorá by z nich vyšla, je
   POČET ZÁZNAMOV PO DŇOCH. A ten sa tu nakresliť nedá pravdivo: okno je 50
   z 153, takže krivka by opisovala okno, nie denník, a najstarší deň v okne je
   odrezaný — to je presne nález M6 prenesený z čipu do grafu. Ten istý údaj
   navyše už kreslí obrazovka Dnes (`heatmap`), a to zo SERVEROVÝCH per-dňových
   počtov nad celým korpusom, teda z čísel, ktoré Denník nemá.
   Spúšťač na prehodnotenie je konkrétny: keď `DennikScreen` začne posielať
   `days[]` s počtom nad celým dňom (to isté číslo, ktoré chýba „+N poznatkov"
   v hlavičke dňa nižšie), je sparkline nad ním legitímny.
   ============================================================================ */
export const SK_MONTHS_GEN = ['januára', 'februára', 'marca', 'apríla', 'mája', 'júna',
    'júla', 'augusta', 'septembra', 'októbra', 'novembra', 'decembra'];

export let journalRecords = [];
// Skupiny projektov a celkový počet chodia zo SERVERA (DennikScreen). Do 20. 8. 2026
// si ich obrazovka počítala z 50 načítaných záznamov, takže čip tvrdil iné číslo než
// server — a AI, ktorá čítala serverové počty, tretie. Počítanie je údaj, nie kresba.
export let journalGroups = [];
export let journalTotal = 0;
/* `filtered_total` = počet záznamov PO serverovom filtri, nad celou tabuľkou.
   Denník ho posiela (na rozdiel od `/api/runs`, kde sú `counts` nad celou tabuľkou
   BEZ filtrov a „N z M" by pri filtri bola lož) — namerané 31. 8. 2026:
   bez filtra 151/151, `?project=ai-mind` 151/0, `?project=#bez-projektu` 151/54.
   Preto Denník počet priznať MÔŽE a robí to v pätičke zoznamu. */
export let journalFiltered = 0;
/* Filter projektu žije v URL pod kľúčom `dep` (slovník §6). Číta sa TU, pri
   načítaní modulu — teda ešte pred prvým renderom, aby odkaz otvoril Denník už
   s nasadeným filtrom a nie až o jedno prekreslenie neskôr.

   Podmienka `BOOT_MINE` nie je opatrnosť, ale konzistencia s tým, čo pri zmene
   obrazovky robí `setScreen()`: kľúče filtrov cudzích obrazoviek maže. Keby sme
   `dep` z odkazu na inú obrazovku prevzali, filter by ostal zapnutý napriek tomu,
   že v adrese už nie je — a človek by hľadal čip, ktorý nikde nesvieti. */
const BOOT_MINE = readUrl().s === 'dennik';
export let journalProject = (BOOT_MINE ? urlValue('dep') : null) || null;
/* Hľadaný výraz. Kľúč `q` je v slovníku SPOLOČNÝ pre všetky obrazovky a
   `scoped: true`, takže sa pri prepnutí obrazovky zahodí sám — Denník si preň
   vlastný prefixovaný kľúč vymýšľať nemusí a ani nesmie (na obrazovke je najviac
   jedno voľné hľadanie, viď komentár pri `q` v `urlstate.js`). */
export let journalQ = (BOOT_MINE ? urlValue('q') : null) || '';

/* Veľkosť okna. Je to zároveň `DennikScreen::MAX_LIMIT`, teda strop, ktorý server
   stláča sám (`min(limit, 50)`) — zdvojené vedome: `?limit=200` vráti 50 riadkov
   BEZ chyby, takže sa strop nedá zistiť pokusom a offset ďalšej strany by sa
   počítal z priania, nie z reality. Offset sa preto nikdy nepočíta z `pages * 50`,
   ale z `journalRecords.length`. */
const JOURNAL_STEP = 50;

/* Koľko okien je načítaných. Nie je to len počítadlo pre pätičku: `renderJournal()`
   podľa neho okná znovu načíta, takže WS zrod uzla (`ws.js` volá `renderJournal()`
   pri každom novom `session` uzle, keď je Denník na obrazovke) nezhodí človeka
   z tretej strany späť na prvú. Namerané: jedno okno je 117 ms, takže tri okná
   sú 350 ms — na obnovu zoznamu, ktorá sa deje raz za zrod uzla, to je únosné. */
let journalPages = 1;
// Beží dopyt na ďalšie okno? Dva kliky za sebou by inak požiadali o ten istý offset.
let journalLoadingMore = false;

/* Dopyt na jedno okno. Poradie parametrov je stabilné (URLSearchParams v poradí
   `set`), takže sa dva dopyty dajú porovnať v sieťovom logu očami. */
function journalQuery(offset) {
    const p = new URLSearchParams();
    if (journalProject) p.set('project', journalProject);
    if (journalQ) p.set('q', journalQ);
    if (offset > 0) p.set('offset', String(offset));
    p.set('limit', String(JOURNAL_STEP));
    return '?' + p.toString();
}

/* Späť / Dopredu. Bez tohto by tlačidlo Naspäť zmenilo adresu a nechalo filter
   stáť — teda by URL lhala, čo je presne to, proti čomu celá vlna vznikla.
   Prekresľujeme len keď je Denník naozaj na obrazovke; inak stačí stav a kreslenie
   si vyžiada `setScreen()`. Obrazovku čítame z `body[data-screen]`, nie z `S` —
   nie je dôvod pre jeden atribút importovať celý stav grafu. */
registerUrlApply('dennik', (url) => {
    if (url.s !== 'dennik') return;
    const next = url.dep || null;
    const nextQ = url.q || '';
    /* Kľúč, ktorý v adrese NIE JE, znamená DEFAULT — `readUrl()` defaulty zámerne
       nedopisuje, aby sa „nie je" a „je na defaulte" dalo rozlíšiť, ale pre stav
       obrazovky sú to tie isté dve slová. Preto `|| 'all'`, nie „nechaj ako je":
       Späť na adresu bez `deo` musí klientsku os naozaj vypnúť. */
    const nextPer = url.deo || 'all';
    const nextSrc = url.dez || 'all';
    const serverChanged = next !== journalProject || nextQ !== journalQ;
    if (!serverChanged && nextPer === journalPeriod && nextSrc === journalSource) return;
    journalProject = next;
    journalQ = nextQ;
    journalPeriod = nextPer;
    journalSource = nextSrc;
    if (document.body.dataset.screen !== 'dennik') {
        // Mimo obrazovky stačí stav; kreslenie si vyžiada `setScreen()`. Okná ale
        // treba zhodiť rovnako, inak by sa načítali tri okná nového dopytu.
        if (serverChanged) journalPages = 1;
        return;
    }
    if (serverChanged) {
        /* Serverová os sa zmenila, takže načítané okná platia pre inú množinu —
           späť na prvé. Bez toho by Späť z tretej strany hľadania načítal tri okná
           nového dopytu, o ktoré nikto nepýtal. */
        journalPages = 1;
        renderJournal();
        return;
    }
    /* Zmenili sa len KLIENTSKE osi — dopyt na server je ten istý, takže sa
       nerefetchuje (3–4 s pri plnom denníku za nulovú zmenu dát). Prekreslí sa
       lišta (počty na čipoch ostatných osí sú počítané z okna a filtrom sa menia)
       a zoznam. Ten istý postup má klik na čip nižšie. */
    renderJournalFilter();
    renderJournalList();
});
// Projektov je bežne ~23 — všetky naraz sa lámu na dva riadky chipov nad obsahom.
// Preto zbalený rad: najčastejšie projekty + „viac".
export let journalChipsOpen = false;
export const JOURNAL_CHIPS_TOP = 8;

/* ---------------------------------------------------------------------------
   KLIENTSKE OSI: obdobie a zdroj

   V ADRESE SÚ (od 2. 9. 2026) pod kľúčmi `deo` (obdobie) a `dez` (zdroj) a je to
   ZMENA ROZHODNUTIA, nie doplnenie opomenutia. Do tejto vlny tu stálo, že v adrese
   zámerne nie sú, pretože slovník `urlstate.js` táto obrazovka nevlastní — to bol
   argument o vlastníctve súboru, nie o tvare adresy. Matica schopností má „URL stav"
   definovaný ako KAŽDÝ pohľadový stav, a obdobie so zdrojom pohľadový stav sú:
   „Súhrny za 7 dní" je presne ten odkaz, ktorý má zmysel poslať.

   Kľúč, ktorý v `DICT` nie je, `writeUrl()` TICHO ZAHODÍ (`if (!e) continue`) —
   panel/filter funguje a adresu nenesie. Preto sa to overuje `location.search`,
   nie tým, že sa UI zmenilo. Presné riadky do `DICT` sú v reporte tejto vlny
   (`urlKeys`); kým ich vlastník `urlstate.js` nedoplní, chová sa obrazovka presne
   ako predtým: stav funguje lokálne, adresa ho nenesie.

   Trvalosť POMENOVANÉHO pohľadu nesú ďalej ULOŽENÉ FILTRE — adresa nesie jeden
   aktuálny pohľad, uložený filter pomenovanú sadu. Sú to dve rôzne role, nie
   dva mechanizmy toho istého.

   `days` je počet dní VRÁTANE dneška, takže `7 dní` je dnes a šesť dní dozadu —
   nie „pred 168 hodinami". Hranica je lokálna polnoc, ten istý idióm ako
   `dayLabel()`; inak by sa „Dnes" o pol jednej v noci líšilo od hlavičky dňa.
   --------------------------------------------------------------------------- */
export const JOURNAL_PERIODS = [
    { key: 'all', label: 'Celý denník', days: null },
    { key: 'd0', label: 'Dnes', days: 1 },
    { key: 'd7', label: '7 dní', days: 7 },
    { key: 'd30', label: '30 dní', days: 30 },
];
export const JOURNAL_SOURCES = [
    { key: 'all', label: 'Všetko' },
    // `session` je automatický záznam z práce, `digest` týždenný súhrn —
    // tie isté dva zdroje, ktoré vyberá `DennikScreen::SOURCES`.
    { key: 'session', label: 'Práca' },
    { key: 'digest', label: 'Súhrny' },
];

/* Boot z adresy, ten istý idióm a to isté `BOOT_MINE` ako `dep`: kľúč z odkazu na
   CUDZIU obrazovku sa neprevezme, pretože `setScreen()` ho pri prepnutí maže —
   inak by filter svietil bez toho, aby bol v adrese. `urlValue()` vracia už
   validovanú hodnotu alebo `null`, takže „neznáme = žiadne" platí aj tu. */
export let journalPeriod = (BOOT_MINE ? urlValue('deo') : null) || 'all';
export let journalSource = (BOOT_MINE ? urlValue('dez') : null) || 'all';

function midnightOf(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Začiatok obdobia (ms). `all` je `-Infinity`, aby porovnania nepotrebovali vetvu. */
export function periodStart(key) {
    const p = JOURNAL_PERIODS.find((x) => x.key === key);
    if (!p || p.days == null) return -Infinity;
    return midnightOf(new Date()) - (p.days - 1) * 86400000;
}

/* Najstarší NAČÍTANÝ záznam. Server radí zostupne, takže by stačil posledný
   prvok — hľadá sa však minimum, pretože na tomto čísle stojí dôkaz pravdivosti
   počtov a nemá visieť na poradí, ktoré posiela niekto iný. */
function windowOldest() {
    let min = Infinity;
    for (const r of journalRecords) {
        const t = new Date(r.created_at).getTime();
        if (t < min) min = t;
    }
    return min;
}

/** Okno obsahuje všetko, čo serverový filter vybral — potom je každý počet exaktný. */
function windowComplete() {
    return journalRecords.length >= journalFiltered;
}

/**
 * Je počet nad daným obdobím dokázateľne pravdivý?
 *
 * `periodStart(p) > windowOldest()` znamená, že okno siaha ZA začiatok obdobia,
 * teda v ňom nechýba ani jeden záznam toho obdobia. Pre `all` sa to redukuje na
 * `windowComplete()`, lebo `-Infinity` nie je väčšie než nič.
 */
function periodSure(key) {
    return windowComplete() || periodStart(key) > windowOldest();
}

function matchSource(r, src) { return src === 'all' || r.source === src; }
function matchPeriod(r, per) { return per === 'all' || new Date(r.created_at).getTime() >= periodStart(per); }

/**
 * Počet pre čip a dôkaz, či sa smie zobraziť.
 *
 * Kombinácia „všetko × celý denník" je `filtered_total` zo servera, teda počet
 * nad celou tabuľkou — nie nad oknom. Ostatné sa počítajú z okna a nesú `sure`
 * podľa toho, či okno to obdobie dokázateľne pokrýva.
 */
function chipStat(src, per) {
    if (src === 'all' && per === 'all') return { n: journalFiltered, sure: true };
    let n = 0;
    for (const r of journalRecords) if (matchSource(r, src) && matchPeriod(r, per)) n++;
    return { n: n, sure: periodSure(per) };
}

/** Záznamy po klientskych osiach — jediný zdroj pravdy pre zoznam aj pre pätičku. */
export function visibleJournalRecords() {
    return journalRecords.filter((r) => matchSource(r, journalSource) && matchPeriod(r, journalPeriod));
}

function clientFilterOn() {
    return journalSource !== 'all' || journalPeriod !== 'all';
}

export function dayLabel(iso) {
    const d = new Date(iso);
    const t = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((midnight(t) - midnight(d)) / 86400000);
    if (diff === 0) return 'Dnes';
    if (diff === 1) return 'Včera';
    return d.getDate() + '. ' + SK_MONTHS_GEN[d.getMonth()] + ' ' + d.getFullYear();
}

export function timeHM(iso) {
    return new Date(iso).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
}

/* Filtruje SERVER, nie prehliadač. Kľúč skupiny („#bez-projektu") ide ako query
   parameter, takže počet na čipe a počet záznamov po kliknutí je to isté číslo —
   kým sa filtrovalo nad oknom 50 záznamov, čip sľuboval 22 a zoznam dal 9. */
export async function renderJournal() {
    const list = $('journal-list');
    /* SKELETON, nie dýchajúci znak: `/api/journal` beží 3–4 s a plní zoznam, teda
       obsah so známym tvarom (kľúč dňa + záznamy). Do 27. 8. 2026 tu bol dýchajúci
       znak — pri najpomalšom endpointe appky práve ten stav, ktorý najviac
       potreboval predkresliť rozloženie. */
    const cancelSkeleton = deferSkeleton(list, 'list');
    try {
        /* Načítajú sa VŠETKY doteraz otvorené okná, nie len prvé. Dôvod je pri
           `journalPages`. Dedupe podľa `id` nie je opatrnosť: Hades je živý
           a denník rastie NAHORE, takže záznam pribudnutý medzi dvoma dopytmi
           posunie okno o riadok dozadu a hraničný záznam príde DVAKRÁT. Presne
           tento smer chyby má offset (cursor chráni pred opačným, teda pred
           stratou — a tá tu nastať nemôže). */
        const recs = [];
        const seen = new Set();
        let data = null;
        for (let i = 0; i < Math.max(1, journalPages); i++) {
            data = await getJson('/api/journal' + journalQuery(recs.length));
            for (const r of (data.records || [])) {
                if (seen.has(r.id)) continue;
                seen.add(r.id);
                recs.push(r);
            }
            // Ďalšie okno by bolo prázdne — server už povedal, koľko riadkov má.
            if (recs.length >= (data.filtered_total ?? 0)) { journalPages = i + 1; break; }
        }
        cancelSkeleton();
        journalRecords = recs;
        journalGroups = data.project_groups || [];
        journalTotal = data.total || 0;
        /* `?? total` a nie `|| 0`: `filtered_total` môže byť legitímna NULA
           (filter, ktorý nič nezachytil) a `|| 0` by ju nerozlíšil od chýbajúceho
           kľúča. Keď kľúč chýba (staršia odpoveď), padá sa na `total` — teda na
           stav pred filtrami, nie na nulu, ktorá by hlásila prázdny denník. */
        journalFiltered = data.filtered_total ?? journalTotal;

        // Aktívny filter, ktorý v skupinách zo servera už nie je (posledný záznam
        // projektu sa premenoval), by zamkol prázdnu obrazovku — zruš ho a načítaj
        // znova. Druhýkrát sa to stať nemôže, filter je vtedy prázdny.
        if (journalProject && !journalGroups.some((g) => g.key === journalProject)) {
            journalProject = null;
            // Okná načítané pre filter, ktorý zmizol, platia pre inú množinu.
            journalPages = 1;
            return renderJournal();
        }

        /* Do adresy ide OREZANÁ pravda, nie to, čo si človek prial: filter, ktorý
           v skupinách zo servera nie je, sme práve zhodili o pár riadkov vyššie,
           takže až tu je `journalProject` platná skupina. Poradie je záväzné —
           URL → stav → dopyt → prune → replaceState.

           `replace`, nikdy `push` (rozhodnutie 10): tlačidlo Späť patrí
           obrazovkám a vláknam, nie klikaniu do radu čipov. */
        writeUrl({ dep: journalProject, q: journalQ || null,
            deo: journalPeriod, dez: journalSource }, 'replace');

        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        cancelSkeleton();
        renderError(list, 'denník', renderJournal);
    }
}

/* Skupinu „bez projektu" tvorí server ({@see App\Support\ProjectGroup}): sessions
   z dočasných adresárov majú v dátach každá svoj strojový názov („mystifying-
   mclaren-23750a") a kým ich zlučoval prehliadač, človek videl jednu skupinu, ale
   AI dvanásť uzlov so strojovými menami. Sentinel je tu už len na porovnanie. */
export const JOURNAL_NO_PROJECT = '#bez-projektu';

/* Rad čipov jednej klientskej osi. Počet sa kreslí LEN keď je dokázateľne
   pravdivý (`chipStat().sure`) — to je celá obrana proti nálezu M6 a je
   zapísaná v hlavičke súboru. */
function axisChips(items, activeKey, attr, statFor) {
    return items.map((it) => {
        const on = activeKey === it.key;
        const st = statFor(it.key);
        return '<button type="button" class="chip' + (on ? ' active' : '') + '"'
            + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
            + ' data-' + attr + '="' + esc(it.key) + '">'
            + esc(it.label)
            + (st.sure ? '<span class="chip-n">' + st.n + '</span>' : '')
            + '</button>';
    }).join('');
}

/* Rad hľadania. Vlastný rad, nie miesto medzi čipmi: vstupy majú v tejto appke
   `width: 100%`, takže v rade čipov by ich vytlačilo na ďalší riadok. Je to ten
   istý idióm ako `#dec-search` v Rozhodnutiach a `#library-search` v Knižnici,
   takže tri obrazovky hovoria rovnako.

   Kreslí sa len keď je v čom hľadať (`journalTotal > 0`) ALEBO keď v ňom niečo
   je — inak by hľadanie, ktoré nič nenašlo, zmizlo spolu s výsledkami a nedalo
   by sa zmazať. */
function searchRowHtml() {
    if (!journalTotal && !journalQ) return '';
    return '<div class="dtl-filter">'
        + '<input id="journal-q" type="search" value="' + esc(journalQ) + '"'
        + ' placeholder="Hľadať v názvoch a popisoch…" autocomplete="off"'
        + ' aria-label="Hľadať v denníku">'
        + '</div>';
}

export function renderJournalFilter() {
    const wrap = $('journal-filter');
    // Poradie aj počty sú zo servera (podľa počtu záznamov v CELOM denníku), takže
    // v zbalenom rade ostanú tie projekty, ktoré sa reálne používajú.
    const groups = journalGroups;
    /* Prázdne skupiny znamenajú prázdny KORPUS, nie prázdny výsledok hľadania:
       `DennikScreen::projectGroups()` ich počíta nad celým denníkom bez `q`
       (zmerané: `?q=zzzznieco` → records 0, filtered_total 0, project_groups 26).
       Preto tu hľadanie nemá čo strážiť — keď nie sú skupiny, nie je čo hľadať. */
    if (!groups.length) { wrap.innerHTML = ''; return; }

    const hiddenCount = Math.max(0, groups.length - JOURNAL_CHIPS_TOP);
    // aktívny filter musí byť vždy vidieť, aj keď je mimo najčastejších
    if (journalProject && groups.findIndex((g) => g.key === journalProject) >= JOURNAL_CHIPS_TOP) journalChipsOpen = true;
    const shown = journalChipsOpen ? groups : groups.slice(0, JOURNAL_CHIPS_TOP);

    /* `aria-pressed` je povinné: čip je prepínač a bez neho nesie zapnutý filter
       LEN farba, takže čítačka o filtri nevie nič. Vzor je `runy.js` (chip()) —
       ten istý atribút, nie druhý mechanizmus. `.chip-more` ho NEMÁ: rozbaľovač
       nie je filter a svoj stav hovorí popiskom („+3 viac" / „menej"). */
    const projectRow = '<button type="button" class="chip' + (journalProject ? '' : ' active') + '"'
        + ' aria-pressed="' + (journalProject ? 'false' : 'true') + '" data-project="">'
        + 'Všetky<span class="chip-n">' + journalTotal + '</span></button>'
        + shown.map((g) =>
            // data-project nesie KĽÚČ skupiny (filtruje sa ním), popisok ľudský text
            '<button type="button" class="chip' + (journalProject === g.key ? ' active' : '') + '"'
            + ' aria-pressed="' + (journalProject === g.key ? 'true' : 'false') + '"'
            + ' data-project="' + esc(g.key) + '">'
            + esc(g.label) + '<span class="chip-n">' + g.count + '</span></button>'
        ).join('')
        + (hiddenCount ? '<button type="button" class="chip chip-more" id="journal-chips-more">'
            + (journalChipsOpen ? 'menej' : '+' + hiddenCount + ' viac') + '</button>' : '');

    /* Rady stoja v OBALE, nie ako priami potomkovia `#journal-filter`. Ten je
       v CSS sám flexový rad (`#journal-filter, .dtl-filter { display:flex }`),
       takže tri `.dtl-filter` deti by sa uložili VEDĽA seba a zabalili až pri
       nedostatku šírky. Jedno dieťa je jeden flexový prvok a rady sa v ňom
       skládajú pod seba — a funguje to aj keby `#journal-filter` flexovým radom
       prestal byť. Obal je zámerne bez triedy: nemá kresbu, len blokový kontext.

       Vzor troch radov aj triedy sú Rozhodnutia / Runy / Kontrola
       (`<div class="dtl-filter">` na rad), takže tu nevzniká nový slovník. */
    /* Fokus a poloha kurzora sa musia PREŽIŤ prekreslenie: lišta sa kreslí aj po
       odpovedi servera na hľadanie (počty ostatných osí sa `q` menia), a to je
       presne okamih, keď človek v poli ešte píše. Rozhodnutia to riešia tým, že
       lištu pri hľadaní neprekresľujú vôbec; tu prekresliť treba, tak sa obnoví
       fokus. `selectionStart` je na `type="search"` legálne (selection API platí
       pre text/search/url/tel/password, nie pre number/email). */
    const act = document.activeElement;
    const hadFocus = !!act && act.id === 'journal-q';
    const caret = hadFocus ? act.selectionStart : null;

    wrap.innerHTML = '<div>'
        + searchRowHtml()
        + '<div class="dtl-filter">' + projectRow + '</div>'
        + '<div class="dtl-filter">' + axisChips(JOURNAL_PERIODS, journalPeriod, 'period',
            (k) => chipStat(journalSource, k)) + '</div>'
        + '<div class="dtl-filter">' + axisChips(JOURNAL_SOURCES, journalSource, 'source',
            (k) => chipStat(k, journalPeriod)) + '</div>'
        + '<div id="journal-saved"></div>'
        + '</div>';

    renderJournalSaved();

    wireJournalSearch(wrap);
    if (hadFocus) {
        const qi = $('journal-q');
        if (qi) {
            qi.focus();
            if (caret != null) { try { qi.setSelectionRange(caret, caret); } catch (e) { /* nepodstatné */ } }
        }
    }

    const more = $('journal-chips-more');
    if (more) more.onclick = () => { journalChipsOpen = !journalChipsOpen; renderJournalFilter(); };

    /* Klientske osi neplatia serverový dopyt, takže sa nerefetchuje — len sa
       zapíše adresa, prekreslí lišta (počty ostatných osí sa filtrom menia)
       a zoznam. */
    wrap.querySelectorAll('.chip[data-period]').forEach((chip) => {
        chip.onclick = () => setJournalPeriod(chip.dataset.period);
    });
    wrap.querySelectorAll('.chip[data-source]').forEach((chip) => {
        chip.onclick = () => setJournalSource(chip.dataset.source);
    });

    wrap.querySelectorAll('.chip[data-project]').forEach((chip) => {
        chip.onclick = () => {
            /* Aktívny stav sa nasadzuje HNEĎ, nie až po odpovedi servera.
               renderJournalFilter() čipy prekresľuje až vnútri renderJournal(),
               teda po fetchi (3–4 s pri plnom denníku) — dovtedy kliknutý čip
               vyzeral neaktívne a klik pôsobil, akoby nezabral. */
            wrap.querySelectorAll('.chip[data-project]').forEach((c) => {
                c.classList.remove('active');
                c.setAttribute('aria-pressed', 'false');
            });
            chip.classList.add('active');
            chip.setAttribute('aria-pressed', 'true');
            setJournalProject(chip.dataset.project || null);
        };
    });
}

/* Hľadanie ide na SERVER, tak sa nesmie pýtať na každé písmeno. 250 ms je to isté
   číslo, aké má `#dec-search` v Rozhodnutiach — kratšie než rozmyslenie ďalšieho
   znaku a dlhšie než rýchle písanie. Enter dopyt vypálí hneď.

   Nezmenená hodnota sa NEODOSIELA: `oninput` padne aj na Escape a na výber
   z histórie prehliadača, a nový dopyt so tým istým `q` by prekreslil zoznam pod
   rukou bez toho, aby čokoľvek zmenil. */
let journalQTimer = 0;
function wireJournalSearch(wrap) {
    const input = wrap.querySelector('#journal-q');
    if (!input) return;
    const fire = () => {
        clearTimeout(journalQTimer);
        const v = input.value || '';
        if (v === journalQ) return;
        setJournalQ(v);
    };
    input.oninput = () => {
        clearTimeout(journalQTimer);
        journalQTimer = setTimeout(fire, 250);
    };
    input.onkeydown = (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        fire();
    };
}

/**
 * Nastaví hľadanie a načíta denník znova.
 *
 * `journalPages = 1`: iná serverová os = iná množina, takže dolistované okná
 * predošlého dopytu neplatia. Adresa sa mení HNEĎ (`replace`), aby odkaz
 * skopírovaný počas dopytu nesl to, čo je v poli.
 */
export function setJournalQ(q) {
    journalQ = q || '';
    journalPages = 1;
    writeUrl({ q: journalQ || null }, 'replace');
    renderJournal();
}

/**
 * Nastaví filter projektu a prekreslí denník.
 *
 * Existuje preto, že `journalProject` je `export let` — cudzí modul doň nevie
 * priradiť (ESM väzby sú pre importéra len na čítanie). Volá to obrazovka Dnes,
 * keď človek klikne na čip projektu.
 */
export function setJournalProject(key) {
    journalProject = key || null;
    /* Adresa sa mení HNEĎ, nie až po odpovedi servera. `/api/journal` beží 3–4 s
       a zápis až v `renderJournal()` by znamenal, že odkaz skopírovaný v tej
       medzere nesie predošlý filter. Druhý zápis po prune to potom už len
       potvrdí, prípadne opraví na orezanú pravdu — oba sú `replace`, takže do
       histórie nepribúda nič.

       Kľúč skupiny môže byť `#bez-projektu`. Preto to stavia `urlstate.js`
       výhradne cez `URLSearchParams`: konkatenácia by `#` nechala odseknúť
       zvyšok adresy do fragmentu. */
    writeUrl({ dep: journalProject }, 'replace');
    // Iný projekt = iná množina, takže dolistované okná predošlého filtra neplatia.
    journalPages = 1;
    renderJournal();
}

/**
 * Obdobie (klientska os) — stav, adresa, prekreslenie.
 *
 * `journalPages` sa NEZHADZUJE a `renderJournal()` sa NEVOLÁ: dopyt na server je
 * ten istý (`/api/journal` obdobie ani zdroj neprijíma), takže refetch by stál
 * 3–4 s za nulovú zmenu dát a navyše by zahodil dolistované okná — teda by
 * klientsky filter na tretej strane vyzeral, akoby zoznam zmizol.
 *
 * `replace`, nikdy `push` (rozhodnutie 10): filter je „AKO sa pozerám".
 */
export function setJournalPeriod(key) {
    const k = JOURNAL_PERIODS.some((p) => p.key === key) ? key : 'all';
    if (k === journalPeriod) return;
    journalPeriod = k;
    writeUrl({ deo: journalPeriod }, 'replace');
    renderJournalFilter();
    renderJournalList();
}

/** Zdroj (klientska os). To isté ako `setJournalPeriod()`, druhá os. */
export function setJournalSource(key) {
    const k = JOURNAL_SOURCES.some((s) => s.key === key) ? key : 'all';
    if (k === journalSource) return;
    journalSource = k;
    writeUrl({ dez: journalSource }, 'replace');
    renderJournalFilter();
    renderJournalList();
}

/* ---------------------------------------------------------------------------
   ULOŽENÉ FILTRE

   Mechanika je `table.js` (`renderSavedFilters`), menný priestor `dennik`, teda
   `localStorage['hades.filters.dennik']`. Nie DB: filter je pohľad na dáta, nie
   dáta — a Denník má okrem plochy človeka aj plochu AI (`mind_journal`), ktorá
   o cudzích pohľadoch nemá čo vedieť.

   MENO SI FILTER SKLADÁ Z VLASTNÉHO OBSAHU. Natívny `prompt()` by bol jediné
   modálne okno v celej appke; navyše meno z obsahu („AI-mind · Súhrny · 7 dní")
   je o týždeň presnejšie než meno napísané rukou. Rovnaké meno prepíše staré,
   takže uloženie je idempotentné (to rieši `saveFilter`).

   Ukladajú sa VŠETKY TRI osi vrátane serverovej: projekt je to, čo filter robí
   užitočným, a `applyJournalFilter()` vie, že jeho zmena znamená nový dopyt.
   --------------------------------------------------------------------------- */
/* HĽADANIE SA NEUKLÁDÁ, a je to ten istý dôvod ako v Rozhodnutiach: hľadanie je
   ťah, nie pohľad — píše sa doň priebežne a uloženie by zachytilo náhodný
   medzistav („AI-mind · ngro"). Dôsledok, ktorý treba poznať: keď je aktívne LEN
   hľadanie, meno je prázdne a `renderSavedFilters` tlačidlo „Uložiť" nekreslí. */
function journalFilterName() {
    const parts = [];
    if (journalProject) {
        const g = journalGroups.find((x) => x.key === journalProject);
        parts.push(g ? g.label : journalProject);
    }
    if (journalSource !== 'all') {
        const s = JOURNAL_SOURCES.find((x) => x.key === journalSource);
        if (s) parts.push(s.label);
    }
    if (journalPeriod !== 'all') {
        const p = JOURNAL_PERIODS.find((x) => x.key === journalPeriod);
        if (p) parts.push(p.label);
    }
    return parts.join(' · ');
}

export function renderJournalSaved() {
    const box = $('journal-saved');
    if (!box) return;
    renderSavedFilters(box, 'dennik', {
        current: () => {
            const name = journalFilterName();
            // Prázdne meno = žiadny aktívny filter. `renderSavedFilters` vtedy
            // tlačidlo „Uložiť" nekreslí — uložiť „všetko" nemá zmysel.
            return name ? { name: name, state: { project: journalProject, source: journalSource, period: journalPeriod } } : null;
        },
        onApply: (st) => applyJournalFilter(st),
    });
    /* Trieda radu sa nasadzuje LEN keď je v boxe tlačidlo — inak by prázdna
       lišta platila `margin-bottom` radu a medzi filtrom a zoznamom by ostala
       diera. Ten istý riadok má `rozhodnutia.js` a z toho istého dôvodu. */
    box.classList.toggle('dtl-filter', !!box.querySelector('button'));
}

/**
 * Nasadí uložený filter. Neznáme hodnoty sa zahodia na `all`: v úložisku môže
 * ležať filter z čias, keď os mala iné kľúče, a „neznáme = žiadne" je jediný
 * stav, ktorý nič nezamkne.
 *
 * Projekt sa mení cez `setJournalProject()`, teda NOVÝM DOPYTOM — klientske osi
 * sa nasadia pred ním, aby prekreslenie po odpovedi videlo už celý stav a zoznam
 * sa nekreslil dvakrát s rôznym obsahom.
 */
export function applyJournalFilter(st) {
    const s = st || {};
    journalPeriod = JOURNAL_PERIODS.some((p) => p.key === s.period) ? s.period : 'all';
    journalSource = JOURNAL_SOURCES.some((p) => p.key === s.source) ? s.source : 'all';
    const project = s.project || null;
    /* `q` sa berie len keď ho volajúci naozaj poslal (reťazec, aj prázdny).
       Uložený filter ho nenesie (hľadanie sa neukládá — dôvod nižšie), takže
       `undefined` znamená „nechaj, ako je", nie „zmaž". Bez toho rozlíšenia by
       nasadenie uloženého filtra ticho zmazalo hľadaný výraz. */
    const q = typeof s.q === 'string' ? s.q : journalQ;
    const qChanged = q !== journalQ;
    journalQ = q;
    /* Klientske osi idú do adresy TU, jedným zápisom pred vetvením. `writeUrl()`
       zbiera zápisy jednej úlohy do jednej dávky, takže spolu s `dep`/`q` nižšie
       je z celého nasadenia uloženého filtra JEDEN záznam histórie — nie tri. */
    writeUrl({ deo: journalPeriod, dez: journalSource }, 'replace');
    if (project !== journalProject || qChanged) {
        /* Obe osi sú SERVEROVÉ, takže sa dopyt platí RAZ: `q` do adresy tu
           a `dep` + načítanie nechá na `setJournalProject()`. Dva `renderJournal()`
           by načítali dve okná, z ktorých prvé by nikto nevidel. */
        if (qChanged) writeUrl({ q: journalQ || null }, 'replace');
        setJournalProject(project);
        return;
    }
    renderJournalFilter();
    renderJournalList();
}

/* ---------------------------------------------------------------------------
   PÄTIČKA ZOZNAMU — „Ďalších 50" a priznanie počtu

   TLAČIDLO ODTERAZ NAOZAJ NAČÍTA (1. 9. 2026). Do tejto vlny tu bol len text
   a bolo to správne: `/api/journal` offset nemal, `DennikScreen::MAX_LIMIT` je 50
   a `data()` limit zviera (`?limit=200` vrátilo presne 50), takže tlačidlo by
   kliklo a nič by sa nestalo. Serializér má odteraz `?offset=`, takže `loadMoreJournal()`
   načíta ďalšie okno a PRIPOJÍ ho — kresba je kartová, nie `moreRow()` z `table.js`:
   text pri klientskom filtri nesie inú vetu, než akú `moreRow()` pozná.

   ČO SA SMIE HLÁSIŤ:
     · tlačidlo sa kreslí, keď `journalRecords.length < journalFiltered` — to je
       porovnanie dvoch SERVEROVÝCH čísel (načítané okno vs počet po serverovom
       filtri), teda pravda nezávislá od klientskych osí;
     · „Ďalších N" je `min(50, journalFiltered - načítané)`, teda koľko riadkov
       naozaj pribudne, nie okrúhle číslo;
     · počet zobrazených sa priznáva len tam, kde je dokázateľný — bez klientskej
       osi je „50 z 153" presné, s klientskou osou nad NEÚPLNÝM oknom celkový
       počet NEPOZNÁME, takže sa netvrdí (pätička vtedy povie, aké je okno a aký
       je denník).
   --------------------------------------------------------------------------- */
export function journalFooterText(shown) {
    // Zobrazená množina je dokázateľne celá: buď je celé okno, alebo obdobie
    // leží celé v okne (a potom v ňom nechýba ani jeden záznam).
    const complete = windowComplete() || (clientFilterOn() && periodSure(journalPeriod));
    if (complete) return shown === 1 ? '1 záznam' : 'všetkých ' + shown;
    if (!clientFilterOn()) return shown + ' z ' + journalFiltered;
    return shown + ' z okna ' + journalRecords.length + ' najnovších · denník má ' + journalFiltered;
}

/** Koľko riadkov ešte server má nad rámec načítaných. 0 = okno je celé. */
function journalRemaining() {
    return Math.max(0, journalFiltered - journalRecords.length);
}

function renderJournalFooter(list, shown) {
    const wrap = document.createElement('div');
    wrap.className = 'rec-more';
    const remaining = journalRemaining();
    if (remaining > 0) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'rec-more-btn';
        b.textContent = 'Ďalších ' + Math.min(JOURNAL_STEP, remaining);
        b.onclick = () => loadMoreJournal(b);
        wrap.appendChild(b);
    }
    const n = document.createElement('span');
    n.className = 'rec-more-n';
    n.textContent = journalFooterText(shown);
    wrap.appendChild(n);
    list.appendChild(wrap);
}

/**
 * Ďalšie okno záznamov.
 *
 * OFFSET JE `journalRecords.length`, nie `journalPages * 50`: dedupe mohol
 * niektoré riadky zahodiť, takže počet načítaných je jediné číslo, ktoré vie,
 * odkiaľ pokračovať.
 *
 * DEDUPE JE POVINNÝ. Denník rastie NAHORE, takže záznam pribudnutý medzi dvoma
 * dopytmi posunie okno o riadok dozadu a hraničný záznam by prišiel druhýkrát —
 * v kartovom zozname by sa objavil dvakrát pod sebou. Offset chráni pred stratou
 * len tam, kde zoznam rastie na konci; tu chráni klient.
 *
 * ZLYHANIE JE TOAST S VARIANTOM `'error'` (politika §8): tlačidlo je akcia bez
 * inej viditeľnej zmeny, takže mlčanie by vyzeralo, že klik nezabral. Tlačidlo
 * sa vráti do pôvodného stavu, aby sa dalo skúsiť znova.
 */
async function loadMoreJournal(btn) {
    if (journalLoadingMore) return;
    journalLoadingMore = true;
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Načítavam…'; }
    try {
        const data = await getJson('/api/journal' + journalQuery(journalRecords.length));
        const seen = new Set(journalRecords.map((r) => r.id));
        for (const r of (data.records || [])) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            journalRecords.push(r);
        }
        journalTotal = data.total ?? journalTotal;
        journalFiltered = data.filtered_total ?? journalFiltered;
        journalPages += 1;
        /* Lišta sa prekresľuje tiež: počty na čipoch klientskych osí sú počítané
           z okna a väčšie okno ich mení — a `periodSure()` sa novým, starším
           najstarším záznamom môže prepnúť z „netvrdíme" na exaktné číslo. */
        renderJournalFilter();
        renderJournalList();
    } catch (e) {
        showToast('Ďalšie záznamy sa nepodarilo načítať', null, 'error');
        if (btn) { btn.disabled = false; btn.textContent = label; }
    } finally {
        journalLoadingMore = false;
    }
}

/* ---------------------------------------------------------------------------
   KLÁVESOVÝ KURZOR (2. 9. 2026)

   Do tejto vlny bola Kontrola JEDINÁ obrazovka s kurzorom po riadkoch a Denník
   mal len tab-order: 50 kariet = 50 Tabov po ceste na najstarší záznam.

   POLOHU NESIE ID ZÁZNAMU, nie index. Denník je živý a rastie NAHORE (`ws.js`
   volá `renderJournal()` pri každom novom `session` uzle), takže index by po
   zrode uzla ukazoval o riadok vedľa — na susedný záznam, ticho. Kontrola drží
   index (`kontrolaState.idx`), pretože jej fronta sa mení len rozhodnutím
   človeka; tu je zdroj zmeny niekto iný.

   KURZOR SA NEOTÁČA (clamp), na rozdiel od Kontroly, ktorá po poslednom riadku
   pokračuje prvým. Dôvod je tvar plochy, nie nekonzistencia: fronta je zavretá
   množina, kým denník je OKNO (50 z 153) s tlačidlom „Ďalších 50" pod sebou —
   preskok z najstaršieho načítaného záznamu na dnešný najnovší by čitateľa
   presunul o celé okno bez toho, aby o to požiadal.

   AKTIVÁCIA IDE PRESNE TOU CESTOU, AKOU IDE KLIK (`cards[i].click()`), takže
   detail otvára jeden `openNodeDetail()` a nie druhá kópia zloženého odkazu na
   uzol. Keď je fokus už na karte kurzora, `<button>` si Enter obslúži sám —
   vtedy sa nezdvojuje (to je tá istá pasca, akú si `kontrola.js` drží
   riadkovým `onkeydown`).

   Kresba `.selected` je v `mind.css` a je súčasťou potreby tejto vlny
   (`cssNeeds`): bez nej nesie kurzor len `:focus-visible`, teda nič v okamihu,
   keď výber posunie myš alebo prekreslenie.
   --------------------------------------------------------------------------- */
let journalCursorId = null;

function journalCards() {
    return Array.from(document.querySelectorAll('#journal-list .record'));
}

function journalCursorIndex(cards) {
    if (journalCursorId == null) return -1;
    return cards.findIndex((el) => el.dataset.id === String(journalCursorId));
}

/** Nasadí triedu kurzora bez toho, aby bral fokus alebo scrolloval. */
function paintJournalCursor() {
    const cards = journalCards();
    const i = journalCursorIndex(cards);
    cards.forEach((el, n) => el.classList.toggle('selected', n === i));
    return cards;
}

function markJournalCursor(focus) {
    const cards = paintJournalCursor();
    const cur = cards[journalCursorIndex(cards)];
    if (!cur) return;
    if (focus) cur.focus({ preventScroll: true });
    /* `block: 'nearest'` — kurzor pri okraji dorolluje o riadok, nie doprostred
       obrazovky. Ten istý argument aj volanie ako `markKontrolaSelected()`. */
    cur.scrollIntoView({ block: 'nearest' });
}

export function moveJournalCursor(delta) {
    const cards = journalCards();
    if (!cards.length) return;
    const cur = journalCursorIndex(cards);
    // Prvý stisk bez kurzora chytá KONIEC, z ktorého sa vychádza: `j` prvú
    // kartu, `k` poslednú. Inak by `k` na začiatku nerobilo nič.
    const next = cur < 0
        ? (delta > 0 ? 0 : cards.length - 1)
        : Math.min(cards.length - 1, Math.max(0, cur + delta));
    journalCursorId = cards[next].dataset.id;
    markJournalCursor(true);
}

/* Kedy klávesy NEPATRIA zoznamu. Dve podmienky, obe merateľné:

   1. otvorený modál (`[role="dialog"][aria-modal="true"]` bez `.hidden`) — paleta,
      pomocník aj čítačka markdownu majú vlastnú klávesnicu;
   2. fokus v ovládači, ktorý písmená konzumuje — pole hľadania, alebo pravý panel
      (drží si Esc a tab-cyklus).

   Čipy filtra ZÁMERNE blokované nie sú: `j` hneď po kliknutí na čip má posunúť
   zoznam, nie mlčať. */
function journalKeysBlocked() {
    if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.hidden)')) return true;
    const a = document.activeElement;
    if (!a || a === document.body) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) return true;
    return !!a.closest('#node-panel, #rec-panel');
}

/* Vlastný `keydown` a nie riadok v `shortcuts.js`: dispatcher skratiek nie je
   vlastníctvom tejto vlny (dvaja pisatelia do jedného súboru sa ticho prepíšu)
   a Kontrola má rovnaké delenie — LOGIKA kurzora žije v module obrazovky,
   `shortcuts.js` len volá `kontrolaMove()`. Riadok do `SHORTCUTS` a presun
   dispatchu je nahlásený v reporte (`otherNeeds`).

   Listener sa registruje pri načítaní modulu, teda PRED `setupShortcuts()`
   (main.js ho volá až v `boot()`), takže `stopImmediatePropagation()` naozaj
   zastaví globálnu skratku — `Enter` inak nad Denníkom zameruje uzol v grafe.
   Strážca obrazovky je prvý riadok: mimo Denníka sa nepočíta nič. */
window.addEventListener('keydown', (e) => {
    if (document.body.dataset.screen !== 'dennik') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (journalKeysBlocked()) return;
    if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopImmediatePropagation();
        moveJournalCursor(1);
        return;
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopImmediatePropagation();
        moveJournalCursor(-1);
        return;
    }
    if (e.key === 'Enter') {
        const cards = journalCards();
        const i = journalCursorIndex(cards);
        if (i < 0) return;
        // Fokus je na tej istej karte — `<button>` Enter obslúži sám a druhé
        // `click()` by detail otvorilo dvakrát.
        if (document.activeElement === cards[i]) return;
        e.preventDefault(); e.stopImmediatePropagation();
        cards[i].click();
    }
});

/* Pás skratiek. Trieda `.kbd-hints` / `.kh` / bare `kbd` je tá istá kresba, akú
   nesie Kontrola — jedna kresba, dva slovníky obsahu (Denník nemá `v`/`r`/`Del`,
   pretože nad záznamom denníka niet čo rozhodnúť). */
function journalHintsHtml() {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['Esc'], 'zavrieť detail')
        + '</div>';
}

export function renderJournalList() {
    const list = $('journal-list');
    const visible = visibleJournalRecords();

    if (!visible.length) {
        /* Dve rôzne správy, dva rôzne stavy. „Filter to skryl" má vlastnú rolu
           (`.empty--filter`) a JEDNU akciu, ktorá filter naozaj zruší.

           Tlačidlo je tu legitímne, nie ozdobné: filter, ktorý v skupinách zo
           servera už nie je, zhodila `renderJournal()` vyššie a načítala znovu —
           takže ak sme sa dostali sem, `journalProject` je PLATNÁ skupina, ktorá
           dáta naozaj skrýva. To isté platí pre klientske osi: prázdno za nimi
           znamená, že v načítanom okne také záznamy naozaj nie sú.

           Jedna akcia ruší VŠETKY TRI osi. Dve tlačidlá („zruš projekt", „zruš
           obdobie") by pýtali od človeka, aby uhádol, ktorá os ho zamkla — a pri
           prázdnom zozname na to nemá z čoho prísť. */
        if (journalProject || journalQ || clientFilterOn()) {
            /* Hľadanie je štvrtá os a tá istá jedna akcia ho ruší tiež — `q: ''`
               je explicitný reťazec, takže `applyJournalFilter()` ho zmaže
               (`undefined` by znamenalo „nechaj"). Text hovorí „filter", nie
               „hľadanie": človek nemá hádať, ktorá os ho zamkla. */
            renderFilterEmpty(list, 'Žiadne záznamy pre tento filter',
                'Zruš filter a uvidíš celý denník.',
                () => applyJournalFilter({ project: null, q: '', source: 'all', period: 'all' }));
        } else {
            renderEmpty(list, 'receipt', 'Zatiaľ žiadne záznamy',
                'Pribudnú, keď si Hades zapamätá prvý poznatok.');
        }
        return;
    }

    // Radí server a serverovú os filtruje server; obrazovka nasadí klientske osi
    // (`visibleJournalRecords()` vyššie) a záznamy zoskupí po dňoch.
    const sorted = visible;

    // Dni sú štruktúra (zostávajú v jednom stĺpci pod sebou); záznamy VNÚTRI dňa
    // idú do fluidnej mriežky (.rec-grid), takže na širokom okne sa šírka vyplní
    // obsahom a nie prázdnom medzi názvom a meta.
    let html = '', lastDay = null;
    for (const r of sorted) {
        const day = dayLabel(r.created_at);
        if (day !== lastDay) {
            if (lastDay !== null) html += '</div>';
            /* „+N poznatkov" v hlavičke dňa (nález A4, tretí bod) tu ZÁMERNE NIE
               JE, a je to trvalý stav, nie rozpracovanosť. `DennikScreen` per-dňové
               počty neposiela — má `total`, `filtered_total` a `project_groups`,
               nič po dňoch. Dopočítať ich z načítaných záznamov je presne chyba M6:
               okno je `limit` 50, takže najstarší deň v okne je odrezaný a hlavička
               by sľubovala číslo, ktoré zoznam nedá.

               Číslo je ÚDAJ, nie kresba, takže podmienka je jasná: kým ho
               `DennikScreen` nepošle (`days[]` s počtom nad celým dňom, nie nad
               oknom), hlavička dňa nesie len dátum. Radšej nič než lož. */
            html += '<div class="day-head">' + esc(day) + '</div><div class="rec-grid">';
            lastDay = day;
        }
        const isDigest = r.source === 'digest';
        const badges = [];
        // Titulok často začína názvom projektu („AI-mind — práca 12.8.2026"), takže
        // chip s projektom by ten istý reťazec zopakoval a v stĺpci by zbytočne
        // zjedol šírku (a názov by sa preto skrátil). V takom prípade chip vynecháme.
        const titleHasProject = r.project && r.label
            && r.label.toLowerCase().startsWith(String(r.project).toLowerCase());
        if (r.project && !titleHasProject) badges.push('<span class="tag">' + esc(r.project_label || '') + '</span>');
        if (r.file_count) badges.push('<span class="tag muted">' + r.file_count + ' súb.</span>');
        // `commit_count` dáva server (rovnako ako `file_count`); prehliadač si ho
        // dopočítaval z pola, ktoré na obrazovke nikto nevidí.
        if (r.commit_count) {
            const c = r.commit_count;
            const word = c === 1 ? 'commit' : (c >= 2 && c <= 4 ? 'commity' : 'commitov');
            badges.push('<span class="tag muted">' + c + ' ' + word + '</span>');
        }
        // Značky žijú v hlavičke riadku (nie pod ňou) — na širokom okne tak riadok
        // využije šírku: názov vľavo, značky + čas vpravo, namiesto prázdneho stredu.
        html += '<div class="li-wrap rec-wrap">'
            + '<button type="button" class="record" data-id="' + r.id + '" data-label="' + esc(r.label) + '">'
            + '<div class="record-head">' + iconMarkup(isDigest ? 'calendar' : 'doc', { cls: 'rec-ico' })
            + '<span class="record-title">' + esc(prettyLabel(r.label, r.project)) + '</span>'
            + (badges.length ? '<span class="record-tags">' + badges.join('') + '</span>' : '')
            + '<span class="record-time">' + timeHM(r.created_at) + '</span></div>'
            + '</button>'
            + packBtn(r.id, r.label) + '</div>';
    }
    if (lastDay !== null) html += '</div>';
    list.innerHTML = html;

    /* Detail sa otvára NA MIESTE (nález A4). Do 24. 8. 2026 tu bolo
       `openNodeFromAnywhere()`, ktoré robí `setScreen('graf')` bezpodmienečne —
       klik na záznam teda vyhodil človeka z Denníka a cesta späť bola railom.
       `openNodeDetail()` je ten istý idióm, aký má Knižnica (čítačka markdownu),
       a skok na Graf zostal ako sekundárna akcia v pätičke overlayu. */
    list.querySelectorAll('.record').forEach((el) => {
        el.onclick = () => openNodeDetail({ id: el.dataset.id, label: el.dataset.label, type: 'memory' });
        /* Kurzor ide za myšou aj za Tabom — inak by mal človek dva rôzne „tu som"
           naraz. `mousedown` (nie `click`) preto, že `click` prichádza až po
           otvorení detailu. Ani jeden nekreslí `markJournalCursor(true)`: fokus
           už je tam, kam ho človek dal, a scroll patrí jemu. */
        el.addEventListener('mousedown', () => { journalCursorId = el.dataset.id; paintJournalCursor(); });
        el.addEventListener('focusin', () => {
            if (journalCursorId === el.dataset.id) return;
            journalCursorId = el.dataset.id;
            paintJournalCursor();
        });
    });
    bindPackButtons(list);
    /* Pätička ide AŽ SEM, po `innerHTML` a po napojení — `innerHTML` by ju inak
       zmazal a `appendChild` pred ním by zmizol bez chyby. */
    renderJournalFooter(list, sorted.length);
    /* Pás skratiek stojí POD pätičkou: „Ďalších 50" je akcia nad zoznamom,
       skratky sú návod. Ide tou istou cestou ako pätička, teda po `innerHTML`. */
    const hints = document.createElement('div');
    hints.innerHTML = journalHintsHtml();
    list.appendChild(hints.firstChild);
    /* Kurzor prežil prekreslenie (nesie ho ID záznamu, nie index), takže sa len
       prekreslí trieda. BEZ fokusu: prekresliť môže filter alebo WS zrod uzla
       a v tom okamihu je fokus v poli hľadania — vzor `rerenderKontrola(false)`. */
    paintJournalCursor();
}
