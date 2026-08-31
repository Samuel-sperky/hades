import { openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { closeRecPanel, onRecPanelClose, openRecPanel, recOpenId } from '../recpanel.js';
import { S } from '../state.js';
import { ASC, DESC, moreRow, renderSavedFilters, renderTable, sortRows } from '../table.js';
import { showToast } from '../toasts.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, busy, deferSkeleton, emptyHtml, esc, getJson, inlineOk, plainBlock, plainInline, renderError, renderFilterEmpty } from '../util.js';
import { iconMarkup } from '../../shared/icons.js';

/* ---------- obrazovka Rozhodnutia (/api/decisions) — tabuľka + detail ----------
   Kontrakt 28. 8. 2026 (G1 + G6): karty a časová os sú preč. Plocha je TABUĽKA
   (`table.js`) a text rozhodnutia s dôvodom žijú v PRAVOM PANELI (`recpanel.js`).
   Karta bola dobrá na príbeh jedného rozhodnutia, ale štyridsať rozhodnutí sa na
   nej nedalo porovnať — a dôvod, ktorý sa rozbaľoval NA karte, posúval celý
   viacstĺpcový blok pod prstami práve tam, kde človek čítal.

   Kľúč `month` zo servera sa preto NEČÍTA a je to zámer, nie opomenutie:
   štruktúru nesie zoradený stĺpec „Kedy". Mesiac ako šiesty stĺpec by bol ten
   istý údaj dvakrát. `monthLabel()` a `decisionsTimelineHtml()` tým zmizli;
   `.dtl*` v CSS zostáva živé, kreslia ním Runy.

   STĹPCE SÚ LEN TIE, ČO V DÁTACH NAOZAJ SÚ. Kontrakt vymenúva aj „Projekt"
   a „Istotu" — tabuľka `decisions` ani jeden z nich nemá (schéma: `node_id`,
   `area_id`, `decided_on`, `text`, `reason`, `origin`, `source_file`) a
   `/api/decisions` ich teda nevracia. Dopočítať projekt z grafového payloadu
   (`S.nodes`) by zopakovalo presne tú chybu, ktorú si táto obrazovka už raz
   zaplatila pri názve oblasti: človek by videl stĺpec, ktorý AI nevidí, a bez
   načítaného grafu by svietil prázdny. Kým to nie je v serializéri, stĺpec nie je.

   Filtre obdobie/oblasť (reuse .chip v .dtl-filter), uložené filtre (G2),
   „Ďalších 50" (G3), manuálne pridanie → POST /api/decisions a mazanie →
   DELETE /api/decisions/{id} zostávajú.

   DÁTA SÚ SERVEROVÉ. Obrazovka si nič nedopočítava: os rokov (`years`), os
   oblastí (`areas`), počty (`counts`), názov oblasti riadku (`area`) aj mesiac
   pre hlavičku bloku (`month`) prichádzajú z `App\Serializers\Screen\
   RozhodnutiaScreen` — tej istej triedy, z ktorej čerpá MCP. Predtým sa roky
   aj počty počítali tu z načítaných riadkov a názov oblasti sa bral z GRAFOVÉHO
   payloadu (`S.areas`), takže človek videl oblasť, AI to isté rozhodnutie bez
   nej, a bez načítaného grafu svietilo „#7". Nedávaj to sem späť.

   FILTRUJE SERVER. Do 20. 8. 2026 sa `/api/decisions` volalo BEZ parametrov a
   rok, oblasť aj hľadanie sa preosievali tu, nad jedným fetchom — hoci serializér
   `q`/`area`/`year`/`origin` vie odjakživa. Nad stropom 500 riadkov by to prestalo
   byť pravda: filter by hľadal v prvej stránke a tváril sa, že hľadal vo všetkom.
   Preto každá zmena filtra znamená nový dopyt (`decisionsQuery()`).

   Osi (`years`, `areas`, `counts`) sú v serializéri zámerne GLOBÁLNE — filter ich
   nemení. Preto sa lišta prekresľuje len raz a pri filtrovaní sa mení iba zoznam
   (`#dec-list`): inak by pod prstami mizli práve tie čipy, ktorými sa filter ruší. */

/* Boot z URL (slovník §6): `roy` rok · `roa` id oblasti · `q` hľadanie ·
   `roo` otvorené rozhodnutie. Číta sa pri načítaní modulu, teda pred prvým
   `decisionsQuery()`.

   Tvary sa držia toho, čo už v stave žije: rok je REŤAZEC (porovnáva sa so
   `String(y.year)`), oblasť ČÍSLO (porovnáva sa s `a.id`). Prepisovať to na jeden
   typ by znamenalo prejsť aj `pruneDecisionFilters`, `syncDecChips` a čipy —
   a to je refaktor, nie napojenie na URL. */
const BOOT_MINE = readUrl().s === 'rozhodnutia';
const bootRoa = BOOT_MINE ? parseInt(urlValue('roa') || '', 10) : NaN;
const bootRoo = BOOT_MINE ? parseInt(urlValue('roo') || '', 10) : NaN;

/* Koľko riadkov sa kreslí naraz (G3). „Ďalších 50" je okno nad UŽ NAČÍTANÝMI
   riadkami, nie druhý dopyt: server posiela celú stránku jedným volaním (strop
   `RozhodnutiaScreen::MAX_LIMIT` = 500, v odpovedi ako `limit`) a offset ani
   `page` v tom endpointe neexistuje. Vymyslieť si serverový parameter by
   znamenalo, že tlačidlo pýta niečo, čo nikto nečíta. */
const PAGE = 50;

export const decisionsState = {
    all: [], years: [], areas: [], counts: {},
    year: (BOOT_MINE ? urlValue('roy') : null) || null,
    areaId: Number.isFinite(bootRoa) ? bootRoa : null,
    q: (BOOT_MINE ? urlValue('q') : null) || '',
    adding: false, managing: false,
    /* Triedenie je LOKÁLNE a v adrese NIE JE. Slovník `urlstate.js` má pre túto
       obrazovku kľúče `roy`, `roa`, `q` a `roo`; kľúč pre triedenie by som doň
       musel dopísať, a ten súbor je hotový a vlastní ho niekto iný. Default je
       dátum zostupne, teda presne poradie, v akom riadky posiela server —
       obrazovka sa načíta v tom poradí, ktoré tabuľka priznáva v `aria-sort`. */
    sortKey: 'decided_on', sortDir: DESC,
    shown: PAGE,
    seq: 0, qTimer: null,
};

/* Rozhodnutie, ktoré má byť otvorené v paneli, ale riadky ešte nie sú načítané
   (boot z adresy alebo Späť do stavu s `roo`). Panel otvorí `renderDecisionsList()`,
   keď dáta prídu — otvárať detail z id, ktoré v odpovedi nemusí byť, nemá ako
   vedieť, čo je v ňom napísané. */
let pendingOpenId = Number.isFinite(bootRoo) ? bootRoo : null;

/* Adresa sa píše z JEDNÉHO miesta, ale volá sa z dvoch: `renderDecisions()` (po
   prune, teda orezaná pravda) a `refreshDecisionList()` (klik do čipu alebo
   písanie do hľadania — tá cesta prune nerobí, lebo osi sú globálne a filter ich
   nemení). Bez druhého volania by adresa po prekliku čipu zamrzla na predošlom
   filtri. `replace` — filter do histórie nepatrí (rozhodnutie 10). */
function syncDecisionsUrl() {
    writeUrl({
        roy: decisionsState.year || null,
        roa: decisionsState.areaId != null ? String(decisionsState.areaId) : null,
        q: decisionsState.q.trim() || null,
    }, 'replace');
}

/* Späť / Dopredu: adresa je vstup. Ide to cez `renderDecisions()`, nie
   `refreshDecisionList()` — prázdny filter môže odomknúť rady čipov, ktoré sa
   vypisujú len keď je z čoho vyberať, takže lišta sa musí prestaviť. */
registerUrlApply('rozhodnutia', (url) => {
    if (url.s !== 'rozhodnutia') return;
    const roa = parseInt(url.roa || '', 10);
    const nextYear = url.roy || null;
    const nextArea = Number.isFinite(roa) ? roa : null;
    const nextQ = url.q || '';
    const sameFilter = nextYear === decisionsState.year && nextArea === decisionsState.areaId
        && nextQ === decisionsState.q;
    if (!sameFilter) {
        decisionsState.year = nextYear;
        decisionsState.areaId = nextArea;
        decisionsState.q = nextQ;
        clearTimeout(decisionsState.qTimer);
        const search = $('dec-search');
        if (search) search.value = nextQ;
        if (document.body.dataset.screen === 'rozhodnutia') renderDecisions();
    }
    /* Panel je SAMOSTATNÁ os adresy, preto stojí za `sameFilter`, nie v ňom:
       Späť smie zavrieť detail bez toho, aby sa hýbal filter — a keby to viselo
       na predošlom `return`, práve ten najčastejší krok histórie by nič neurobil. */
    applyPanelFromUrl(url.roo || null);
});

/* Adresa → panel. Voláme to z aplikátora, teda počas `applying`, kedy je
   `writeUrl` no-op — otvorenie panelu si tým adresu neprepíše samo pod sebou. */
export function applyPanelFromUrl(raw) {
    const id = raw ? parseInt(String(raw), 10) : NaN;
    const open = recOpenId('rozhodnutia');
    if (!Number.isFinite(id)) {
        pendingOpenId = null;
        // `recOpenId` je menný priestor: cudzí panel (Runy) sa týmto nezavrie.
        if (open != null) closeRecPanel();
        return;
    }
    if (open != null && String(open) === String(id)) return;
    const dec = decisionsState.all.find((d) => d.id === id);
    if (dec) { openDecisionPanel(dec); return; }
    pendingOpenId = id;
}

/* Dopyt na server z aktuálneho filtra. Jediné miesto, kde sa filter prekladá na
   URL — dve kópie by znamenali, že prvé načítanie a filtrovanie hľadajú inak. */
export function decisionsQuery() {
    const p = new URLSearchParams();
    if (decisionsState.year !== null) p.set('year', decisionsState.year);
    if (decisionsState.areaId !== null) p.set('area', String(decisionsState.areaId));
    const q = decisionsState.q.trim();
    if (q) p.set('q', q);
    const s = p.toString();
    return '/api/decisions' + (s ? '?' + s : '');
}

function applyDecisionsPayload(d) {
    decisionsState.all = d.decisions || [];
    decisionsState.years = d.years || [];
    decisionsState.areas = d.areas || [];
    decisionsState.counts = d.counts || {};
    /* Nové dáta = nové okno. Bez tohto by po zmene filtra ostalo rozbalených
       „prvých 150" z predošlého výsledku a „Ďalších 50" by hlásilo pomer, ktorý
       s aktuálnym filtrom nič nespája. */
    decisionsState.shown = PAGE;
}

export async function renderDecisions() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    /* Skeleton v tvare obsahu — od prechodu na tabuľku `table` (rad filtračných
       čipov + hustejšie riadky), nie `cards`: kostra má kopírovať to, čo príde. */
    const cancelSkeleton = deferSkeleton(body, 'table');
    const seq = ++decisionsState.seq;
    try {
        const d = await getJson(decisionsQuery());
        // pred `seq` kontrolou, inak by kostra zahodenej odpovede dosadla nad výsledok
        cancelSkeleton();
        if (seq !== decisionsState.seq) return;
        applyDecisionsPayload(d);
        pruneDecisionFilters();
        syncDecisionsUrl();
        renderDecisionsView();
    } catch (e) {
        cancelSkeleton();
        if (seq !== decisionsState.seq) return;
        renderError(body, 'rozhodnutia', renderDecisions);
    }
}

/* Zmena filtra prekresľuje LEN zoznam. Lišta (čipy, hľadanie, tlačidlá) stojí:
   `renderLoading` nad celým telom by pri každom písmene zhodil aj pole, do
   ktorého sa práve píše — a s ním fokus aj kurzor. Starý zoznam ostáva na
   obrazovke, kým nepríde nový; Knižnica to isté rieši triedou `is-stale`, tá je
   ale naviazaná na `#library-body`. */
export async function refreshDecisionList() {
    if (!$('dec-list')) { renderDecisions(); return; }
    const seq = ++decisionsState.seq;
    try {
        const d = await getJson(decisionsQuery());
        if (seq !== decisionsState.seq) return;
        applyDecisionsPayload(d);
        syncDecisionsUrl();
        // Meno uloženého filtra sa skladá z AKTÍVNYCH osí, takže sa mení spolu
        // s nimi; bez tohto by lišta ponúkala uložiť predošlú kombináciu.
        renderDecSaved();
        renderDecisionsList();
    } catch (e) {
        if (seq !== decisionsState.seq) return;
        showToast('Rozhodnutia sa nepodarilo načítať', null, 'error');
    }
}

/* Filter, ktorý po znovunačítaní nemá ani jeden záznam, je pasca: rady čipov sa
   vypisujú len keď je z čoho vyberať (years.length > 1), takže po uložení
   rozhodnutia v inom roku mohla obrazovka ostať prázdna BEZ čipu, ktorým sa filter
   zruší. Denník to isté robí pri projektoch (journalProject sa vynuluje) — tu to
   dosiaľ sľuboval len komentár. */
export function pruneDecisionFilters() {
    if (decisionsState.year !== null
        && !decisionsState.years.some((y) => String(y.year) === decisionsState.year)) {
        decisionsState.year = null;
    }
    if (decisionsState.areaId !== null
        && !decisionsState.areas.some((a) => a.id === decisionsState.areaId)) {
        decisionsState.areaId = null;
    }
}

/* Filtračný čip hovorí tým istým jazykom ako v Denníku: popisok + počet v
   .chip-n. Predtým tu čipy počty nemali, takže dve obrazovky mali dva rôzne
   filtračné idiomy — a človek nevedel, či sa filtrom niečo vôbec ukáže. */
export function decChip(label, active, attrs, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutý filter LEN farba. Vzor je
    // `runy.js` (chip()). Dopĺňa sa aj v syncDecChips(), inak by sa trieda
    // a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

export function renderDecisionsView() {
    const body = $('rozhodnutia-body');
    if (!body) return;
    // Os období aj os oblastí prichádzajú zo servera už zoradené a s počtami nad
    // CELÝM korpusom. Počítať ich tu z `all` znamenalo, že nad stropom 500 by čip
    // hlásil iné číslo než realita — a AI by o osi nevedela nič.
    const years = decisionsState.years;
    const areas = decisionsState.areas;
    const total = decisionsState.counts.total != null ? decisionsState.counts.total : decisionsState.all.length;

    /* Akcia „Pridať rozhodnutie" stála na SAMOSTATNOM riadku nad filtrami, takže
       medzi podtitulom a čipmi zostal celý prázdny pás — Denník aj Knižnica dávajú
       pod hlavičku hneď ovládanie. Tlačidlá preto idú do TOHO ISTÉHO riadku ako
       posledný rad filtrov (vpravo, margin-left:auto v .dec-toolbar-row) a vlastný
       pás si vyžiadajú len vtedy, keď filtre nie sú (jeden rok, jedna oblasť). */
    const addBtn = '<button type="button" id="dec-add-toggle" class="chip">'
        + iconMarkup((decisionsState.adding ? 'x' : 'plus')) + ''
        + (decisionsState.adding ? 'Zrušiť' : 'Pridať rozhodnutie') + '</button>';

    /* Mazanie je za režimom, nie pri každej karte. Časová os má stovky záznamov a
       stovka košov vedľa nich je šum, ktorý na obrazovke o pamäti nemá čo robiť —
       a zároveň je nechcený klik o kúsok bližšie. Režim je prvý z dvoch krokov,
       druhý je ozbrojené potvrdenie na samotnom tlačidle. */
    const manageBtn = '<button type="button" id="dec-manage" class="chip' + (decisionsState.managing ? ' active' : '') + '">'
        + iconMarkup((decisionsState.managing ? 'check' : 'pencil')) + ''
        + (decisionsState.managing ? 'Hotovo' : 'Upraviť zoznam') + '</button>';

    /* Hľadanie má vlastný rad, nie miesto medzi čipmi: vstupy majú v tejto appke
       `width: 100%`, takže v rade čipov by ich vytlačilo na ďalší riadok — a
       dorovnať to inline štýlom si tento blok zakázal (viď komentár pri
       `.dec-toolbar` v mind.css). Celý rad je zároveň to, ako vyzerá filtračné
       pole v Knižnici (`#library-search`), takže obe obrazovky hovoria rovnako. */
    const searchRow = total > 0
        ? '<div class="dtl-filter">'
            + '<input id="dec-search" type="search" value="' + esc(decisionsState.q) + '"'
            + ' placeholder="Hľadať v texte a dôvodoch…" autocomplete="off" aria-label="Hľadať v rozhodnutiach">'
            + '</div>'
        : '';   // v prázdnej pamäti nie je v čom hľadať

    const tools = addBtn + (total > 0 ? manageBtn : '');

    // Filtre obdobie / oblasť — s počtami, ako v Denníku. Roky idú chronologicky
    // (je to os, nie množina), oblasti podľa počtu zhora; obe poradia určuje
    // server, aby ich AI videla tak, ako človek.
    const rows = [];
    if (years.length > 1) {
        rows.push(decChip('Celé obdobie', decisionsState.year === null, 'data-year=""', total)
            + years.map((y) => decChip(String(y.year), decisionsState.year === String(y.year),
                'data-year="' + y.year + '"', y.count)).join(''));
    }
    if (areas.length > 1) {
        rows.push(decChip('Všetky oblasti', decisionsState.areaId === null, 'data-area=""', total)
            + areas.map((a) => decChip(a.name, decisionsState.areaId === a.id,
                'data-area="' + a.id + '"', a.count)).join(''));
    }

    let h = searchRow;
    rows.forEach((chips, i) => {
        const last = i === rows.length - 1;
        h += '<div class="dtl-filter' + (last ? ' dec-toolbar-row' : '') + '">'
            + chips + (last ? tools : '') + '</div>';
    });
    if (!rows.length) h += '<div class="dec-toolbar">' + tools + '</div>';
    if (decisionsState.adding) h += decAddFormHtml();

    /* Uložené filtre (G2) stoja NAD tabuľkou a POD radmi čipov: je to skratka
       k filtru, nie ďalšia filtračná os. Obal dostane triedu `.dtl-filter` (ten
       istý pás ako čipy) až vtedy, keď v ňom naozaj niečo je — pozri
       `renderDecSaved()`; prázdny pás s triedou by si vzal medzeru navyše. */
    body.innerHTML = h + '<div id="dec-saved"></div><div id="dec-list"></div>';
    renderDecSaved();
    renderDecisionsList();
    wireDecisions(body);
}

/* ---------- uložené filtre (G2) ----------
   Ukladá sa ROK a OBLASŤ, nie hľadanie. Meno filtra si `renderSavedFilters`
   berie z `current()`, takže by muselo niesť aj hľadaný výraz — a „2026 ·
   Vývoj & kód · ngrok" je meno, ktoré po týždni nikto neprečíta ako filter.
   Hľadanie je navyše ťah, nie pohľad: píše sa doň priebežne a uloženie by
   zachytilo náhodný medzistav. Dôsledok, ktorý treba poznať: keď je aktívne LEN
   hľadanie, `current()` vráti null a tlačidlo „Uložiť" sa nekreslí — nie je čo
   uložiť a prázdny filter menom „všetko" by bol lož. */
export function renderDecSaved() {
    const box = $('dec-saved');
    if (!box) return;
    renderSavedFilters(box, 'rozhodnutia', {
        onApply: applySavedDecFilter,
        current: decSavedCurrent,
    });
    /* Trieda pásu sa nasadzuje PODĽA OBSAHU, nie dopredu. Dve veci by inak
       platili za prázdnu lištu: `.dtl-filter` má vlastný `margin-bottom`, a hlavne
       `.dtl-filter:has(+ .dtl-filter)` zmenší medzeru PREDOŠLÉMU radu čipov —
       takže by sa filtre priblížili k tabuľke kvôli pásu, ktorý nič nenesie.
       `display: none` by druhý efekt neodstránil, selektor sa pýta na DOM. */
    box.classList.toggle('dtl-filter', !!box.querySelector('button'));
}

export function decSavedCurrent() {
    const parts = [];
    if (decisionsState.year !== null) parts.push(decisionsState.year);
    const area = decisionsState.areas.find((a) => a.id === decisionsState.areaId);
    if (area) parts.push(area.name);
    if (!parts.length) return null;
    /* Meno je poskladané z toho, čo `state` naozaj nesie — inak by uloženie
       sľubovalo obnovu niečoho, čo v ňom nie je. Oddeľovač „ · " je ten istý,
       aký používajú metriky v hlavičke. */
    return { name: parts.join(' · '), state: { year: decisionsState.year, area: decisionsState.areaId } };
}

export function applySavedDecFilter(st) {
    const s = st || {};
    decisionsState.year = s.year != null && s.year !== '' ? String(s.year) : null;
    const area = parseInt(s.area, 10);
    decisionsState.areaId = Number.isFinite(area) ? area : null;
    /* Ide to cez `renderDecisions()`, nie `refreshDecisionList()`: uložený filter
       môže odomknúť alebo zamknúť celý rad čipov, takže sa lišta musí prestaviť.
       Rok alebo oblasť, ktoré už v osi nie sú (rozhodnutie sa medzitým zmazalo),
       zhodí `pruneDecisionFilters()` — uložený filter nemá väčšie práva než adresa. */
    renderDecisions();
}

/* Zoznam v samostatnom kontajneri — mení sa pri každom filtri, lišta nad ním nie. */
export function renderDecisionsList() {
    const list = $('dec-list');
    if (!list) return;
    const rows = decisionsState.all;
    // Prázdno má dve rôzne príčiny a nesmú znieť rovnako. `rows` je od 20. 8. 2026
    // už PREFILTROVANÝ serverom, takže „máme vôbec nejaké rozhodnutia?" povie len
    // globálny `counts.total`.
    const anyAtAll = (decisionsState.counts.total || 0) > 0;
    const filtered = decisionsState.year !== null || decisionsState.areaId !== null || decisionsState.q.trim() !== '';

    if (!rows.length) {
        /* Prázdno z filtra má vlastnú rolu a JEDNU akciu. `pruneDecisionFilters()`
           zhodí rok a oblasť, ktoré v serverovej osi nie sú, ale `q` nepruneuje —
           takže sem sa dá dostať s PLATNÝM filtrom (napr. výraz bez zásahu alebo
           kombinácia rok + oblasť), a vtedy tlačidlo naozaj niečo urobí.
           Popisok je „Zruš filter" aj pri hľadaní: `clearDecisionFilters()` ruší
           všetky tri osi naraz, tak by „Zruš hľadanie" sľubovalo menej, než robí. */
        if (anyAtAll && filtered) {
            renderFilterEmpty(list, 'Žiadne rozhodnutia pre tento filter',
                'Zruš filter a uvidíš celý zoznam.', clearDecisionFilters);
        } else {
            list.innerHTML = emptyHtml('gavel', 'Zatiaľ žiadne rozhodnutia',
                'Objavia sa, keď Hades zaznamená prvé rozhodnutie.');
        }
        wireDecisionList(list);
        return;
    }

    /* `empty` v `renderTable()` sa ZÁMERNE nepoužíva: prázdno má tu dve rôzne
       príčiny (filter vs. prázdna pamäť) a každá má vlastný text aj vlastnú
       akciu, kým tabuľka vie povedať jednu vetu. Preto sa kreslí až tu, keď
       riadky naozaj sú. */
    const cols = decColumns();
    const sorted = sortRows(rows, decisionsState.sortKey, decisionsState.sortDir, cols);
    const page = sorted.slice(0, decisionsState.shown);
    renderTable(list, cols, {
        rows: page,
        sortKey: decisionsState.sortKey,
        sortDir: decisionsState.sortDir,
        onSort: sortDecisions,
        onOpen: openDecisionPanel,
        openId: recOpenId('rozhodnutia'),
        idKey: 'id',
        caption: 'Rozhodnutia',
    });

    /* Celok pre „Ďalších N" je `counts.shown`, teda počet riadkov, ktoré server
       pre TENTO filter naozaj poslal — nie `counts.total`, ktorý je nad celým
       korpusom bez filtra a tlačidlo by ním sľubovalo riadky, čo v odpovedi
       nie sú. Nad stropom 500 je `counts.shown` zhodné s `limit` a viac o celku
       odpoveď nevie; hlásiť sa smie len to, čo je zmerané. */
    const total = decisionsState.counts.shown != null ? decisionsState.counts.shown : rows.length;
    moreRow(list, Math.min(page.length, total), total, () => {
        decisionsState.shown += PAGE;
        renderDecisionsList();
    });
    wireDecisionList(list);
    consumePendingOpen();
}

/* Stĺpce sa skladajú funkciou, nie konštantou: posledný (kôš) existuje len
   v režime „Upraviť zoznam". Konštanta by musela mať kôš vždy a skrývať ho
   CSS-om, teda držať v tabuľke stĺpec, ktorý väčšinu času nič nenesie. */
export function decColumns() {
    const cols = [
        {
            key: 'decided_on', label: 'Kedy', width: '5.5rem',
            cell: (d) => esc(fmtDecDate(d.decided_on)),
            /* Triedi sa podľa ISO dátumu zo servera. Zobrazené „14. aug" by sa
               radilo abecedne, teda apríl pred augustom a december pred májom. */
            sortValue: (d) => d.decided_on || '',
        },
        {
            key: 'text', label: 'Rozhodnutie',
            /* Bez `width`: `table-layout: fixed` dá zvyšok šírky práve tomuto
               stĺpcu a text je hlavný identifikátor riadka. Reže ho CSS
               (`text-overflow`), celý ho nesie `title` na cele (`titleFrom` nižšie)
               a detail v paneli.

               ŠÍRKY OSTATNÝCH SÚ ZMERANÉ, NIE ODHADNUTÉ. Prvý pokus (7,5 + 11
               + 8 rem = 424 px pevne) nechal v okne 600 px na text 112 px, teda
               najužší stĺpec z celej tabuľky mal hlavný identifikátor. Druhý
               pokus `min(7.5rem, 22%)` sa zdal správny, ale prehliadač ho
               v `table-layout: fixed` ZAHODIL: percento vnútri `min()` sa pri
               výpočte šírok stĺpcov nedá vyriešiť (šírka tabuľky sa práve
               počíta), takže všetky štyri stĺpce dostali rovnakých 125,5 px —
               overené na `getComputedStyle`. Preto: `rem` tam, kde obsah
               nerastie (dátum, odznak pôvodu), a čisté percento na Oblasť, ktorá
               rastie s oknom. Text si berie zvyšok.

               Aj tie `rem` sú namerané, nie vybrané okom: odznak „session" je
               87 px + 16 px paddingu celly, takže pri 6 rem (96 px) sa REZAL
               (`scrollWidth` 111 > `clientWidth` 96) — a odznak s výpustkou je
               nečitateľný, nie skrátený. Preto Pôvod 7 rem; dátum naopak 5,5 rem
               stačí aj s rokom („24. 8. 2026" ≈ 65 px + padding). */
            cell: (d) => esc(plainInline(d.text)),
            /* Radí sa podľa TOHO, ČO JE VIDIEŤ: surový text nesie `backticky`
               (zmerané na 4 zo 41 živých rozhodnutí), takže by sa tie riadky
               zoradili inde, než kam ich oko na obrazovke čaká. */
            sortValue: (d) => plainInline(d.text),
            // Text sa reže takmer vždy — plný text nesie `title` na cele.
            titleFrom: (d) => plainInline(d.text || ''),
        },
        {
            key: 'area', label: 'Oblasť', width: '20%',
            /* Bez oblasti je pomlčka, ale `sortValue` sa nedopĺňa: `sortRows`
               posiela prázdne hodnoty vždy na konec — „nič" nie je najmenšia
               hodnota. Pomlčka ako `sortValue` by ich zaradila medzi oblasti. */
            cell: (d) => (d.area ? esc(d.area) : '—'),
            // Oblasť sa reže menej často než text, ale reže — priznáva to rovnako.
            titleFrom: (d) => d.area || '',
        },
        {
            key: 'origin', label: 'Pôvod', width: '7rem',
            /* Ten istý odznak ako na Dnes a v Denníku — pôvod je jedna vec a má
               v celej appke jednu kresbu. Triedi sa surovým kľúčom
               (`brain` / `session`); poradie zobrazených slov („playbook" /
               „session") je rovnaké a `ORIGIN_LABEL` sa neexportuje, takže druhá
               kópia menoslovia by tu vznikla pre nulový rozdiel. */
            cell: (d) => originBadge(d.origin),
        },
    ];

    if (decisionsState.managing) {
        /* Otázka je „Zmazať?", nie „Naozaj zmazať?" ako na kartách: cela je
           `overflow: hidden` s výpustkou, takže dlhšia otázka by sa odsekla —
           a odseknuté potvrdenie je horšie než žiadne. Šírka stĺpca je
           dorovnaná na OZBROJENÝ stav, nie na ikonu: pri 4,5 rem sa ozbrojené
           tlačidlo do celly nevošlo (zmerané `scrollWidth` > `clientWidth`),
           hoci kôš v nej sedel s rezervou. */
        cols.push({
            key: '_del', label: 'Zmazať', sortable: false, width: '6rem',
            cell: (d) => '<button type="button" class="danger dec-del" data-id="' + d.id + '"'
                + ' title="Zmazať rozhodnutie" aria-label="Zmazať rozhodnutie">'
                + iconMarkup('trash') + '</button>',
        });
    }
    return cols;
}

/* Klik na tú istú hlavičku obracia smer, klik na inú nasadí smer, ktorý má pre
   stĺpec zmysel: dátum od najnovšieho, slová od A. Prekresľuje sa LEN zoznam —
   triedenie nie je dopyt na server (stránka prišla naraz) a lišta s hľadaním
   nad ním sa hýbať nesmie. */
export function sortDecisions(key) {
    if (decisionsState.sortKey === key) {
        decisionsState.sortDir = decisionsState.sortDir === ASC ? DESC : ASC;
    } else {
        decisionsState.sortKey = key;
        decisionsState.sortDir = key === 'decided_on' ? DESC : ASC;
    }
    renderDecisionsList();
    /* Prekreslenie zahodilo `<th>` aj s tlačidlom, na ktoré človek práve klikol,
       takže fokus by spadol na `<body>` a Tab by začal od začiatku dokumentu.
       Vraciame ho na to isté tlačidlo v novej kresbe. */
    const again = document.querySelector('#dec-list .rec-sort[data-sort="' + key + '"]');
    if (again) again.focus();
}

/* Zrušenie všetkých troch osí filtra naraz. Ide cez `renderDecisions()`, nie cez
   `refreshDecisionList()`: prázdny filter môže odomknúť rady čipov, ktoré sa
   vypisujú len keď je z čoho vyberať, takže lišta sa musí prestaviť. */
function clearDecisionFilters() {
    decisionsState.year = null;
    decisionsState.areaId = null;
    decisionsState.q = '';
    clearTimeout(decisionsState.qTimer);
    const search = $('dec-search');
    if (search) search.value = '';
    renderDecisions();
}

export function decAddFormHtml() {
    // Tu `S.areas` ZOSTÁVA a je to zámer: formulár potrebuje VŠETKY oblasti, aj
    // tie, ktoré ešte žiadne rozhodnutie nemajú. Serverová os `areas` nesie len
    // oblasti s rozhodnutím, pretože to je filtračná os obrazovky, nie zoznam
    // oblastí vedomia. Sú to dve rôzne veci, nie dva zdroje tej istej.
    const areaOpts = '<option value="">— oblasť (voliteľné) —</option>'
        + [...S.areas.values()].map((a) => '<option value="' + a.id + '">' + esc(a.name) + '</option>').join('');
    const today = new Date().toISOString().slice(0, 10);
    return '<div class="dec-add">'
        + '<input id="dec-text" placeholder="Čo si rozhodol?" autocomplete="off" maxlength="5000" aria-label="Text rozhodnutia">'
        + '<textarea id="dec-reason" rows="2" placeholder="Dôvod (voliteľné)" maxlength="5000" aria-label="Dôvod"></textarea>'
        + '<div class="dec-add-row">'
        + '<select id="dec-area" aria-label="Oblasť">' + areaOpts + '</select>'
        + '<input id="dec-date" type="date" value="' + today + '" aria-label="Dátum">'
        + '<button type="button" id="dec-save" class="primary">Uložiť</button>'
        + '</div></div>';
}

/* Deň a mesiac stačia, kým je zoznam jednoročný. Keď korpus siaha cez viac rokov
   (a pri filtri „Celé obdobie" sa práve tak aj vypisuje), je „14. aug" v stĺpci
   Kedy dvojznačné. `withYear` je preto default z OSI ROKOV, nie z počtu
   vykreslených riadkov — inak by ten istý dátum písal rok podľa toho, koľko
   riadkov práve prežilo filter. */
export function fmtDecDate(iso, withYear) {
    if (!iso) return '—';
    const year = withYear == null ? decisionsState.years.length > 1 : !!withYear;
    const opts = year
        ? { day: 'numeric', month: 'short', year: 'numeric' }
        : { day: 'numeric', month: 'short' };
    return new Date(iso + 'T00:00:00').toLocaleDateString('sk', opts);
}

/* ---------- detail v pravom paneli (G6) ----------
   Panel nesie CELÝ text a CELÝ dôvod, teda presne to, čo predtým rozbaľovala
   karta. Rozdiel nie je kozmetický: rozbalenie na karte menilo výšku zoznamu
   pod prstami, kým panel stojí vedľa a tabuľka sa nepohne.

   `updateRecPanel()` sa NEVOLÁ a je to zámer: detail sa nedopočítava zo servera.
   Text, dôvod, oblasť aj zdroj prišli v tom istom riadku ako tabuľka, takže
   druhé kreslenie by prepísalo to isté HTML — a panel by pri každom otvorení
   zablikal bez toho, aby sa čokoľvek dozvedel. */
export function openDecisionPanel(dec) {
    if (!dec) return;
    openRecPanel({
        ns: 'rozhodnutia',
        id: dec.id,
        urlKey: 'roo',
        title: decTitle(dec.text),
        html: decisionDetailHtml(dec),
    });
    /* Odkaz na uzol je jediná AKCIA v paneli, tak sa vešia až po vykreslení:
       `openRecPanel` berie hotové HTML a o rozhodnutiach nevie nič — je to
       spoločný panel s Runami a vedieť to ani nemá. */
    const node = document.querySelector('#rec-panel-body .dec-open-node');
    if (node) node.onclick = () => openNodeFromAnywhere({ id: +node.dataset.node });
    markOpenRow();
    watchPanelClose();
}

/* Meno panelu je KRÁTKY text rozhodnutia. Nadpis panelu je jednoriadkový
   s výpustkou (`.dock-head h2`), takže dlhý text sa odseká aj tak — ale
   v polovici slova. Rez na hranici slova je čitateľnejší a celý text stojí hneď
   pod nadpisom, takže sa rezom nič nestráca. */
export function decTitle(text) {
    const s = plainInline(text || '');
    if (!s) return 'Rozhodnutie';
    if (s.length <= 72) return s;
    const cut = s.slice(0, 72);
    const sp = cut.lastIndexOf(' ');
    return (sp > 40 ? cut.slice(0, sp) : cut).trim() + '…';
}

export function decisionDetailHtml(dec) {
    // Názov oblasti dáva SERVER (kľúč `area`). Predtým sa čítal z grafového
    // payloadu, takže obrazovka závisela od toho, či je graf načítaný, a AI
    // dostávala to isté rozhodnutie bez oblasti.
    const area = dec.area || null;
    /* Text aj dôvod chodia z mind_decision tak, ako ich zapísal Claude Code — a nesú
       `backticky` okolo identifikátorov (zmerané na 4 zo 41 živých rozhodnutí).
       plainInline pre text (je to jedna veta), plainBlock pre dôvod: `.rec-final`
       má `white-space: pre-wrap`, takže odseky sú v ňom nositeľom štruktúry.
       `.rec-final` je pritom z rodiny detailu záznamu, nie „finálna odpoveď" —
       je to jediná existujúca kresba pre utlmený viacodsekový text a nová trieda
       v CSS podľa zadania vzniknúť nemá. */
    const reason = plainBlock(dec.reason || '');
    let h = '<p><span class="meta-chip">' + esc(fmtDecDate(dec.decided_on, true)) + '</span> '
        + originBadge(dec.origin)
        + (area ? ' <span class="tag">' + esc(area) + '</span>' : '') + '</p>';
    h += '<h3>Rozhodnutie</h3><p>' + esc(plainInline(dec.text)) + '</p>';
    // Nadpis „Dôvod" má LEN rozhodnutie, ktoré dôvod naozaj nesie. Prázdna sekcia
    // by tvrdila, že dôvod zapísaný je a len ho nevidno.
    if (reason) h += '<h3>Dôvod</h3><div class="rec-final">' + esc(reason) + '</div>';
    if (dec.source_file) {
        // Zrkadlo v `.md` je pri `origin=brain` zdroj pravdy, takže cesta k nemu
        // je informácia, nie technický detail — mazanie ju tiež hlási.
        h += '<h3>Zdroj</h3><p><span class="tag muted">' + esc(dec.source_file) + '</span></p>';
    }
    if (dec.node_id != null) {
        h += '<h3>Uzol</h3><p><button type="button" class="chip dec-open-node" data-node="' + dec.node_id + '">'
            + iconMarkup('hub') + 'Zobraziť uzol #' + dec.node_id + '</button></p>';
    }
    return h;
}

/* Otvorený riadok nesie stav v `aria-current` (odtiaľ ho číta aj CSS), takže sa
   po otvorení a po zavretí panelu musí prepnúť. Nie prekreslením tabuľky: klik
   na riadok by ju postavil znova, zahodil fokus a pri dlhom zozname aj polohu
   scrollu — dva atribúty na riadok sú to isté za nulovú cenu. */
export function markOpenRow() {
    const open = recOpenId('rozhodnutia');
    document.querySelectorAll('#dec-list .rec-row').forEach((tr) => {
        const on = open != null && tr.dataset.rec === String(open);
        tr.classList.toggle('open', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
    });
}

/* Panel sa dá zavrieť aj bez nás — tlačidlom v jeho hlavičke, Escom alebo
   `dropRecPanel()` pri prepnutí obrazovky — a bez notifikácie by v tabuľke
   svietil riadok bez otvoreného detailu.

   Do 28. 8. 2026 to dorovnával pár vlastných listenerov na `#rec-panel-close`
   a na Esc, so `setTimeout 0`, pretože synchronné čítanie v tej istej obsluhe
   videlo panel ešte otvorený. Bola to obchádzka: nechytala tretiu cestu
   (prepnutie obrazovky) a druhá obrazovka si ju musela napísať znova. Preto
   `recpanel.js` odteraz zavretie OHLASUJE a tu stačí povedať, čo pri ňom robiť.

   Registruje sa raz; druhá registrácia by prvú prepísala (`Map` podľa menného
   priestoru), takže opakované volanie nič nepokazí. */
let closeWatch = false;
function watchPanelClose() {
    if (closeWatch) return;
    closeWatch = true;
    onRecPanelClose('rozhodnutia', () => {
        // Prepnutie obrazovky panel tiež zatvára; vtedy tabuľka Rozhodnutí na
        // obrazovke nie je a jej prekreslenie by bolo práca do prázdna.
        if (document.body.dataset.screen !== 'rozhodnutia') return;
        markOpenRow();
    });
}

/* Id z adresy sa spotrebuje aj vtedy, keď riadok v aktuálnom filtri NIE JE:
   druhý pokus by ho hľadal v tých istých dátach a `roo` by v adrese strašilo
   naveky. Keď sa nenašlo, kľúč z adresy odchádza — adresa nemá sľubovať
   otvorený detail, ktorý sa neotvoril. */
function consumePendingOpen() {
    if (pendingOpenId == null) return;
    const dec = decisionsState.all.find((d) => d.id === pendingOpenId);
    pendingOpenId = null;
    if (dec) { openDecisionPanel(dec); return; }
    writeUrl({ roo: null }, 'replace');
}

/* ---------- ozbrojené mazanie ----------
   Prvý klik sa spýta, druhý do 3 s maže. Ten istý vzor ako `#node-delete`
   (controls.js) a `.act-skip` (kontrola.js); natívny `confirm()` sa v tejto
   appke nepoužíva, lebo vytrhne človeka z obrazovky a nedá sa ním zobraziť, ČO
   sa maže.

   Je to `export`, lebo ten istý vzor potrebuje aj obrazovka Smernica. Správne
   miesto je `util.js` medzi ostatnými UI primitívami — ten ale vlastní iná
   session, tak zatiaľ býva tu (obrazovky sa v tomto grafe bežne importujú
   navzájom, napr. `originBadge` z dnes.js). */
export function armDelete(btn, question, onConfirm) {
    if (!btn) return;
    if (btn.dataset.armed === '1') {
        disarmDelete(btn);
        onConfirm();
        return;
    }
    // Ozbrojené smie byť naraz jediné tlačidlo: dve otvorené otázky vedľa seba
    // znamenajú, že druhý klik potvrdí niečo iné, než na čo sa človek pýtal.
    document.querySelectorAll('button[data-armed="1"]').forEach(disarmDelete);
    btn.dataset.armed = '1';
    /* Odkladame si UZOL kresby, nie jej meno. Do 28. 8. 2026 sa sem ukladal
       `btn.textContent`, teda ligatura - po prechode na inline SVG je to prazdny
       retazec a tlacidlo by sa po odzbrojeni uz nikdy nevratilo k svojej ikone.
       Uzol vrati presne tu ikonu, ktora tam bola, bez tabulky mien. */
    btn._armIcon = btn.querySelector('svg.ic');
    if (btn._armIcon) btn._armIcon.remove();
    btn.classList.add('armed');
    btn.textContent = question;
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmDelete(btn); }, 3000);
}

export function disarmDelete(btn) {
    if (!btn) return;
    clearTimeout(btn._disarm);
    btn.dataset.armed = '0';
    btn.classList.remove('armed');
    btn.textContent = '';
    if (btn._armIcon) { btn.insertBefore(btn._armIcon, btn.firstChild); btn._armIcon = null; }
}

export function wireDecisions(body) {
    const toggle = $('dec-add-toggle');
    if (toggle) toggle.onclick = () => { decisionsState.adding = !decisionsState.adding; renderDecisionsView(); if (decisionsState.adding) { const t = $('dec-text'); if (t) t.focus(); } };

    const manage = $('dec-manage');
    if (manage) manage.onclick = () => { decisionsState.managing = !decisionsState.managing; renderDecisionsView(); };

    const saveBtn = $('dec-save');
    if (saveBtn) saveBtn.onclick = () => saveDecision(saveBtn);

    /* Hľadanie ide na server, tak sa nesmie pýtať na každé písmeno. 250 ms je
       kratšie než rozmyslenie ďalšieho znaku a dlhšie než rýchle písanie;
       `decisionsState.seq` navyše zahodí odpoveď, ktorú predbehla novšia. */
    const search = $('dec-search');
    if (search) {
        search.oninput = () => {
            decisionsState.q = search.value || '';
            clearTimeout(decisionsState.qTimer);
            decisionsState.qTimer = setTimeout(refreshDecisionList, 250);
        };
        search.onkeydown = (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            clearTimeout(decisionsState.qTimer);
            refreshDecisionList();
        };
    }

    body.querySelectorAll('.dtl-filter [data-year]').forEach((c) => {
        c.onclick = () => {
            decisionsState.year = c.dataset.year || null;
            syncDecChips(body, 'year');
            refreshDecisionList();
        };
    });
    body.querySelectorAll('.dtl-filter [data-area]').forEach((c) => {
        c.onclick = () => {
            decisionsState.areaId = c.dataset.area ? +c.dataset.area : null;
            syncDecChips(body, 'area');
            refreshDecisionList();
        };
    });
}

/* Aktívny čip sa prekliká hneď, dáta dobehnú o request neskôr. Prekresliť kvôli
   tomu celú lištu nejde — bolo by v nej pole hľadania, do ktorého sa práve píše. */
export function syncDecChips(body, kind) {
    const attr = kind === 'year' ? 'data-year' : 'data-area';
    const want = kind === 'year'
        ? (decisionsState.year === null ? '' : decisionsState.year)
        : (decisionsState.areaId === null ? '' : String(decisionsState.areaId));
    body.querySelectorAll('.dtl-filter [' + attr + ']').forEach((c) => {
        const on = (c.getAttribute(attr) || '') === want;
        c.classList.toggle('active', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/* Dokresba po tabuľke. Otvorenie riadka aj triedenie vešia `renderTable()`,
   sem patria dve veci, ktoré o rozhodnutiach vedieť musia: priznaný rez textu
   a kôš. */
export function wireDecisionList(list) {
    /* REZ, KTORÝ SA NEPRIZNÁVA, JE LOŽ — a od 28. 8. 2026 ho priznáva `titleFrom`
       priamo v definícii stĺpca. Dovtedy to bol ťah po hotovej kresbe, teda druhý
       prechod nad tým istým DOM, ktorý sa pri novom stĺpci ľahko zabudne. */

    list.querySelectorAll('.dec-del').forEach((btn) => {
        btn.onclick = (e) => {
            /* Riadok pod tlačidlom otvára detail (`renderTable` vešia `onclick`
               na `<tr>`), takže bez zastavenia by jediný klik mazal AJ otváral. */
            e.stopPropagation();
            armDelete(btn, 'Zmazať?', () => deleteDecision(btn, +btn.dataset.id));
        };
        // To isté klávesnicou: `<tr>` má vlastnú obsluhu Enter/Space.
        btn.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
    });
}

export async function deleteDecision(btn, id) {
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/decisions/' + id, { method: 'DELETE' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
                return;
            }
            /* Zmazané rozhodnutie nesmie zostať otvorené v paneli: detail by
               ukazoval záznam, ktorý už nikde nie je, a `roo` v adrese by ho po
               obnovení hľadal. */
            if (recOpenId('rozhodnutia') != null && String(recOpenId('rozhodnutia')) === String(id)) closeRecPanel();
            /* Markdown zrkadlo zostáva na disku — kontrolér ho zámerne nereže
               (vyrezať riadok zo súboru v mozgu je nevratný zásah). Keď rozhodnutie
               zrkadlo malo, treba to povedať, inak sa človek dozvie o zvyšku až
               pri ďalšom čítaní súboru. */
            showToast(j.source_file
                ? 'Rozhodnutie zmazané — zápis v ' + j.source_file + ' zostáva'
                : 'Rozhodnutie zmazané', null, 'success');
            // Počty aj osi sa mazaním menia, takže tu ide celé načítanie, nie zoznam.
            renderDecisions();
        } catch (e) {
            showToast('Nepodarilo sa zmazať', null, 'error');
        }
    }, 'Maže sa…');
}

/* Uloženie rozhodnutia do pamäte. „Uloženie", nie „zápis": zápis je tool Charóna,
   ktorý zaparkuje na dvojfázovej bráne (docs/BRAND-HADES.md §1). Toto je bežná
   akcia človeka a bránou neprechádza. */
export async function saveDecision(btn) {
    const text = ($('dec-text').value || '').trim();
    // Validácia inline pri poli (J2) — fokus tam už aj tak ide.
    if (!text) { inlineOk($('dec-text'), 'Napíš text rozhodnutia'); $('dec-text').focus(); return; }
    const reason = ($('dec-reason').value || '').trim();
    const areaVal = $('dec-area').value;
    const dateVal = $('dec-date').value;
    const payload = { text };
    if (reason) payload.reason = reason;
    if (areaVal) payload.area = areaVal;
    if (dateVal) payload.decided_on = dateVal;

    await busy(btn, async () => {
        try {
            const res = await fetch('/api/decisions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) {
                showToast(j.message || j.error || 'Uloženie sa nepodarilo', null, 'error');
                return;
            }
            decisionsState.adding = false;
            showToast('Rozhodnutie uložené', null, 'success');
            renderDecisions();
        } catch (e) {
            showToast('Uloženie sa nepodarilo', null, 'error');
        }
    }, 'Ukladá sa…');
}
