import { CERT_META, certBadge } from '../certainty.js';
import { clearLocal } from '../filters.js';
import { setRailBadge } from '../rail.js';
import { openNodeDetail, openNodeFromAnywhere } from '../screens.js';
import { originBadge } from './dnes.js';
import { closeRecPanel, onRecPanelClose, openRecPanel, recOpenId } from '../recpanel.js';
import { S } from '../state.js';
import { ASC, DESC, moreRow, renderSavedFilters, renderTable, sortRows } from '../table.js';
import { showToast, showUndoToast } from '../toasts.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, busy, deferSkeleton, esc, getJson, plainBlock, plainInline, plainText, renderEmpty, renderError, renderFilterEmpty, timeAgo, typeName } from '../util.js';
import { iconMarkup, iconSwap } from '../../shared/icons.js';

/* ---------- obrazovka Kontrola (/api/review/queue) — verify/review fronta ----------
   Fronta needs_review uzlov, klávesnica j/k/Enter/v/r/Delete (len na tejto
   obrazovke, viď setupShortcuts). Akcie: Overiť (verify), Vyriešiť
   (resolve-review), Preskočiť (lokálne, s undo), Delete (zmazať uzol).
   Rail badge cez setRailBadge.

   TABUĽKA (`table.js`) + PRAVÝ PANEL (`recpanel.js`) od 31. 8. 2026, predtým
   mriežka kariet `.queue*`. Je to VEDOMÉ RIZIKO a treba ho pomenovať, nie
   zamlčať: Runy a Rozhodnutia sú archívy, kde človek POROVNÁVA stĺpce, kým
   Kontrola je FRONTA NA ROZHODOVANIE, kde sa každý riadok čítá sám za seba.
   Tabuľka pre porovnávanie vyhráva, pre čítanie jedného riadka prehráva: kartu
   nesie dvojriadkový zalomený text (`-webkit-line-clamp: 2`, ~72 znakov na
   riadok), cela tabuľky je JEDNORIADKOVÁ s výpustkou. Pri prechode sa teda
   časť kontextu z plochy stráca a nesie ju `title` na cele a panel.

   Čo z toho vyplýva pre návrh, a čo sa preto NESMIE zmeniť:

   1. AKCIE ZOSTÁVAJÚ V RIADKU (stĺpec `_act`). Fronta, ktorej rozhodnutie
      vyžaduje najprv otvoriť panel, je horšia než karta — pri stovke uzlov je
      to stovka otvorení. Panel je na kontext, nie na akciu.
   2. STĹPEC `label` NESIE AJ POPIS („label — popis"), presne ako karta. Label
      stojí prvý, takže výpustka odsekáva popis, nie identifikátor riadka; celý
      text nesie `titleFrom`.
   3. PRVÝ STĹPEC JE ISTOTA, nie čas. Vo fronte na rozhodovanie je „pasca"
      dôvod, prečo riadok otvoriť, a `created_at` len poradie v ktorom prišiel.

   FILTRE SÚ SERVEROVÉ a to je celý dôvod, prečo tu vôbec sú. Fronta má strop na
   jednu stránku (`KontrolaScreen::DEFAULT_LIMIT`), takže filtrovať načítanú
   stovku v prehliadači by znamenalo prehľadávať práve tú časť fronty, ktorú už
   aj tak vidno — a zvyšok by ostal neviditeľný ďalej. Osi filtra (`counts`,
   `areas`) počíta server nad CELOU frontou, nie nad stránkou, takže čipy hovoria
   o práci, ktorá čaká, nie o tej, ktorá sa zmestila.

   TRIEDENIE JE KLIENTSKE a je to priznaný kompromis, nie omyl: `/api/review/queue`
   radí `created_at DESC` a `sort`/`dir` parameter nemá. Tabuľka teda radí OKNO,
   ktoré prišlo — „prvá pasca" je prvá pasca zo stovky najnovších, nie z celej
   fronty. Nie je to však slepá ulica: istota, typ aj oblasť sa filtrujú NA
   SERVERI, takže „ukáž pasce" sa dá povedať čipom a vtedy je zoradenie nad
   celou množinou (kým `matching <= shown`, čo hlási `moreRow`). Serverový
   `sort` je zmena mimo tohto súboru. Radenie IDE DO ADRESY (`kok`/`kod`) — je to
   pohľad na dáta, takže odkaz na „frontu podľa istoty" musí byť zdieľateľný,
   presne ako `ruk`/`rud` v Runoch.

   GRAF SA NA KONTROLE ZÁMERNE NEKRESLÍ a je to rozhodnutie, nie prázdne miesto.
   Fronta má tri číselné osi (`by_type`, `by_certainty`, `areas`) a všetky tri sú
   UŽ VIDIEŤ — nesú ich filtračné čipy s počtom, ktoré sú navyše OVLÁDANIE, nie
   obrázok. Donut nad tými istými troma číslami by bol druhá kresba jednej pravdy
   a klikať by sa v ňom nedalo. Meranie, ktoré tvar na graf má, na tejto obrazovke
   jedno je — záťaž tried odpadu — a kreslí ho sekcia Hygiena (`.dbar`, šírka
   z `burden`). `HadesCharts.*` sa preň nepoužíva zámerne: je to jeden vodorovný
   bar na riadok, nie os s mierkou. Sila × vek uzla (kandidát na `scatter`) patrí
   nad CELÚ sieť, nie nad frontu: `/api/review/queue` posiela len `needs_review`
   podmnožinu, takže by graf odpovedal na inú otázku, než akú fronta kladie. */

/* Strop jednej stránky. Musí sedieť s `KontrolaScreen::DEFAULT_LIMIT` — je to
   to isté číslo na dvoch stranách drôtu a nesie ho aj popisok „Ďalších N". */
const KONTROLA_PAGE = 100;

/* Tvrdý strop servera (`KontrolaScreen::MAX_LIMIT`). Nad ním sa `limit` orezáva,
   takže tlačidlo „Ďalších N" by od tohto miesta nespravilo nič — a tlačidlo,
   ktoré nič nespraví, je horšie než žiadne. Poznámka to preto povie slovom. */
const KONTROLA_MAX = 500;

/* Boot z URL (slovník §6): `kot` typ · `koc` istota · `koa` oblasť · `kol` strop ·
   `koo` otvorený uzol v paneli · `kok`/`kod` radenie tabuľky · `q` hľadanie.
   Číta sa pri načítaní modulu, teda
   pred prvým dopytom — odkaz tak pošle na server rovno ten filter, ktorý v ňom
   stojí, a nie dvojicu dopytov.

   `q` je spoločný kľúč a jeho význam určuje `s`, preto podmienka na obrazovku.
   Hodnoty sa NEVALIDUJÚ proti zoznamu typov ani oblastí: to robí server svojou
   odpoveďou a `pruneKontrolaFilters()` nad ňou. Druhá kópia zoznamu tu by sa raz
   rozišla s tou serverovou a filter by sa zhodil za zlý dôvod.

   `koo` UŽ V SLOVNÍKU JE (`urlstate.js`, pribudlo 31. 8. 2026 spolu s `kno`/`smo`)
   a je to zmerané: klik na riadok pripíše `&koo=<id>`. Komentár tu do 2. 9. 2026
   tvrdil, že kľúč chýba — to bolo tvrdenie z čias, keď chýbal, nie stav.

   `kok`/`kod` (radenie) sú posledná dvojica tejto obrazovky, ktorá do slovníka
   ešte len patrí. Kým tam nie sú, `writeUrl()` ich TICHO ZAHODÍ
   (`if (!e) continue`): tabuľka sa zoradí, ale adresa to nenesie a `urlValue('kok')`
   vráti null, čo je presne „predvolené radenie". Zmerané: po kliku na hlavičku
   Istota má `<th>` `aria-sort="ascending"` a riadky sú preradené, ale
   `location.search` zostal `?s=kontrola` — čiže dôkaz, že chýba slovník, nie kód.
   Presné riadky do `DICT` odchádzajú v reporte tejto vlny.

   Jeden dôsledok tej medzery treba poznať, aby sa nehľadal ako chyba: `registerUrlApply`
   číta radenie z adresy, takže kým kľúč v slovníku nie je, Späť/Dopredu ho vráti
   na default aj vtedy, keď si ho človek prekliknutím zmenil. Po doplnení slovníka
   to prestane — vtedy adresa nesie kľúč a Späť dosadí to, čo v nej stojí. Na tejto
   obrazovke to je aj tak okrajové: filtre aj radenie píšu `replace`, takže história
   sa tu tvorí len prepnutím obrazovky. */
const BOOT_MINE = readUrl().s === 'kontrola';
const bootKey = (k) => (BOOT_MINE ? urlValue(k) : null) || '';

/* Strop je jediná os s číselnou doménou, takže ju treba ohradiť tu: `kol` z cudzej
   ruky môže byť `999999` a jediné, čo by sa stalo, je najväčšia stránka, akú
   server dovolí. Násobky 100 od 100 do KONTROLA_MAX — presne to, čo vie vyrobiť
   tlačidlo „Ďalších N". */
function clampKontrolaLimit(value) {
    const raw = parseInt(value == null ? '' : String(value), 10);
    if (!Number.isFinite(raw)) return KONTROLA_PAGE;
    const steps = Math.round(raw / KONTROLA_PAGE);
    return Math.min(KONTROLA_MAX, Math.max(KONTROLA_PAGE, steps * KONTROLA_PAGE));
}

/* Radenie z adresy. Zoznam je zrkadlo stĺpcov, ktoré sa naozaj dajú zoradiť
   (`kontrolaColumns()` bez `akcie`), a `created_at` v ňom zámerne NIE JE: je to
   default, a kľúč s hodnotou rovnou defaultu sa do adresy nepíše. Neznámy kľúč
   padá na default namiesto toho, aby zhodil kresbu — adresa je cudzí vstup a na
   rozdiel od Runov ho tu nechytí server (radí sa u klienta, žiadnych 422). */
const KONTROLA_SORTS = ['certainty', 'label', 'type', 'area', 'origin'];

function bootSortKey() {
    const k = bootKey('kok');
    return KONTROLA_SORTS.indexOf(k) >= 0 ? k : 'created_at';
}

export const kontrolaState = {
    items: [], idx: 0, total: 0,
    /* `total` je celá fronta (nesie ho rail a je zámerne nefiltrovaný),
       `matching` je počet uzlov vyhovujúcich filtru, `shown` je to, čo naozaj
       prišlo v poslednej odpovedi. Bez všetkých troch sa nedá povedať ani
       „zobrazených 100 zo 140", ani či má zmysel ponúkať ďalšiu stránku. */
    matching: 0, shown: 0, limit: clampKontrolaLimit(bootKey('kol')),
    counts: {}, areas: [],
    f: { type: bootKey('kot'), certainty: bootKey('koc'), area: bootKey('koa'), q: bootKey('q') },
    /* Východzie triedenie je to, v ktorom fronta prišla zo servera
       (`created_at DESC`). Keby sa líšilo, prvé vykreslenie by riadky preusporiadalo
       bez toho, aby o to niekto požiadal — a `moreRow` by dopĺňal do stredu.

       Adresa ten default PREBÍJA (`kok`/`kod`), a je to zámer: odkaz „fronta podľa
       istoty" má po otvorení ukázať frontu podľa istoty, nie ju najprv nakresliť
       podľa času. Poradie `items` je pritom poradie riadkov (viď `rerenderKontrola`),
       takže j/k idú po tom, čo je vidieť. */
    sortKey: bootSortKey(), sortDir: bootKey('kod') === 'asc' ? ASC : DESC,
    /* `open` NIE JE stav panelu, je to JEDNORAZOVÉ prianie z adresy („otvor mi
       tento uzol"), ktoré `applyKontrolaOpenWish()` spotrebuje a zahodí. Stav
       panelu vlastní `recpanel.js` (`recOpenId('kontrola')`), pretože zavrieť sa
       dá aj jeho krížikom a Escom, o ktorých táto obrazovka nevie nič. */
    open: bootKey('koo') || null,
};

/* Späť / Dopredu: adresa je vstup, fronta sa jej podriadi. Strop sa berie tou
   istou ohradou ako pri boote — kľúč z histórie nemá väčšie práva než kľúč
   z odkazu. Pole hľadania prekresľuje `ensureKontrolaShell()` z `f.q`, takže mu
   stačí stav.

   Keď sa zmenil LEN `koo`, nový dopyt netreba: otvorenie panelu je poloha
   čitateľa, nie filter (rovnako ako `ruo` v Runoch). */
registerUrlApply('kontrola', (url) => {
    if (url.s !== 'kontrola') return;
    const f = kontrolaState.f;
    const next = { type: url.kot || '', certainty: url.koc || '', area: url.koa || '', q: url.q || '' };
    const nextLimit = clampKontrolaLimit(url.kol);
    const nextOpen = url.koo || null;
    /* Radenie sa z histórie dosadzuje BEZ nového dopytu: server ho nepozná
       (`/api/review/queue` parameter `sort` nemá), takže je to prehádzanie už
       načítaného okna — poloha čitateľa, nie filter. Ten istý dôvod ako `koo`. */
    const nextSortKey = KONTROLA_SORTS.indexOf(url.kok || '') >= 0 ? url.kok : 'created_at';
    const nextSortDir = url.kod === 'asc' ? ASC : DESC;
    const sortSame = nextSortKey === kontrolaState.sortKey && nextSortDir === kontrolaState.sortDir;
    const same = next.type === f.type && next.certainty === f.certainty
        && next.area === f.area && next.q === f.q && nextLimit === kontrolaState.limit;
    if (same && sortSame && String(nextOpen) === String(recOpenId('kontrola'))) return;
    kontrolaState.f = next;
    kontrolaState.limit = nextLimit;
    kontrolaState.open = nextOpen;
    kontrolaState.sortKey = nextSortKey;
    kontrolaState.sortDir = nextSortDir;
    /* Toolbar sa prestavuje len pri zmene OSÍ (inak by zmizlo pole, do ktorého sa
       práve píše), takže po Späť v ňom zostane starý výraz — dosaď ho ručne. */
    const qEl = $('kontrola-q');
    if (qEl) qEl.value = next.q;
    if (document.body.dataset.screen !== 'kontrola') return;
    if (!same) { renderKontrola(true); return; }
    // Zmenilo sa LEN radenie: prekresli tabuľku, dopyt netreba.
    if (!sortSame) rerenderKontrola(false);
    applyKontrolaOpenWish();
});

// Poradové číslo dotazu — hľadanie je debouncované, ale nie serializované, takže
// pomalšia STARŠIA odpoveď dokáže prepísať novšiu (rovnaká pasca ako v Knižnici).
let kontrolaSeq = 0;
let kontrolaQTimer = null;

export function kontrolaFiltersActive() {
    const f = kontrolaState.f;
    return !!(f.type || f.certainty || f.area || f.q);
}

/* Zruší všetky štyri osi filtra naraz — akcia prázdneho stavu `.empty--filter`.
   Strop ide späť na prvú stránku (rovnako ako pri každej inej zmene filtra) a
   pole hľadania sa vyprázdni ručne: toolbar prekreslenie PREŽIJE (stavia sa len
   pri zmene osí), takže by v ňom inak zostal výraz, ktorý už nefiltruje. */
function clearKontrolaFilters() {
    clearTimeout(kontrolaQTimer);
    kontrolaState.f = { type: '', certainty: '', area: '', q: '' };
    kontrolaState.limit = KONTROLA_PAGE;
    const q = $('kontrola-q');
    if (q) q.value = '';
    renderKontrola(true);
}

function kontrolaQuery() {
    const f = kontrolaState.f;
    const p = new URLSearchParams();
    if (f.type) p.set('type', f.type);
    if (f.certainty) p.set('certainty', f.certainty);
    if (f.area) p.set('area', f.area);
    if (f.q) p.set('q', f.q);
    p.set('limit', String(kontrolaState.limit));
    return '?' + p.toString();
}

/* Adresný riadok NIE JE dopyt na server a toto je to miesto, kde je vidieť, že sú
   to dve veci: `kontrolaQuery()` vyššie skládá `?type=&certainty=&area=&q=&limit=`
   pre `/api/review/queue` a nesie `limit` VŽDY, pretože endpoint ho potrebuje.
   Tu ide do adresy `kot/koc/koa/kol/q` a `kol` sa pri predvolenej stránke
   VYNECHÁVA. Ani jedno z toho nie je preklad druhého.

   `koo` tu ZÁMERNE nie je: ten píše a maže `recpanel.js` pri otvorení a zavretí
   panelu. Keby ho písala aj obrazovka, zavretý panel by si pri najbližšom
   prekreslení vrátil svoj kľúč do adresy. */
function syncKontrolaUrl() {
    const f = kontrolaState.f;
    writeUrl({
        kot: f.type || null,
        koc: f.certainty || null,
        koa: f.area || null,
        kol: kontrolaState.limit > KONTROLA_PAGE ? String(kontrolaState.limit) : null,
        q: f.q || null,
        /* Radenie ide do adresy spolu s filtrom, ale DEFAULT SA NEPÍŠE: `created_at`
           zostupne je poradie, v ktorom fronta prišla zo servera, takže `?s=kontrola`
           samo znamená „najnovšie zhora" a kľúč s hodnotou defaultu by bol v odkaze
           šum. Ten istý zápis má `sortKontrola()` — je to jedno pravidlo použité na
           dvoch miestach, nie dva rôzne preklady. */
        kok: kontrolaState.sortKey === 'created_at' ? null : kontrolaState.sortKey,
        kod: kontrolaState.sortDir === ASC ? 'asc' : null,
    }, 'replace');
}

/* `soft` = prekreslenie vyvolané filtrom alebo tlačidlom „Ďalších N".
   Toolbar vtedy ostáva stáť: je v ňom <input>, do ktorého sa práve píše, a
   načítavacia značka cez celé telo obrazovky by ho aj s kurzorom vyhodila. */
export async function renderKontrola(soft) {
    const body = $('kontrola-body');
    if (!body) return;
    const seq = ++kontrolaSeq;
    const list = $('kontrola-list');
    /* SOFT prekreslenie nechá starý obsah STÁŤ a povie to len `aria-busy`.
       Skeleton (ani dýchajúci znak) tu byť nesmie: `soft` je filtrovanie a
       „Ďalších N" nad UŽ VYKRESLENOU tabuľkou, takže kostra by zmazala presne
       to, čo má človek pred očami — to je regresia, nie zlepšenie.
       Prvé načítanie kostru dostane, a v tvare tabuľky. */
    const softList = soft && list ? list : null;
    if (softList) softList.setAttribute('aria-busy', 'true');
    const cancelSkeleton = softList ? null : deferSkeleton(body, 'table');
    try {
        const d = await getJson('/api/review/queue' + kontrolaQuery());
        if (cancelSkeleton) cancelSkeleton();
        if (softList) softList.setAttribute('aria-busy', 'false');
        if (seq !== kontrolaSeq) return;                // medzitým prišiel novší dotaz
        kontrolaState.items = d.queue || [];
        // `total` je serverové číslo a nesie ho rail. Fallback na `items.length`
        // tu bol tichá lož: fronta má strop 100, takže pri 140 čakajúcich uzloch
        // by rail hlásil 100. Server ho posiela vždy (App\Serializers\Screen\
        // KontrolaScreen) a je zámerne NEfiltrovaný.
        kontrolaState.total = d.total || 0;
        const c = d.counts || {};
        kontrolaState.counts = c;
        kontrolaState.areas = d.areas || [];
        // Fallback na `total` drží obrazovku funkčnú aj proti staršiemu serveru,
        // ktorý `matching` ešte nepozná — vtedy len nevie o skrytom zvyšku.
        kontrolaState.matching = c.matching != null ? c.matching : kontrolaState.total;
        kontrolaState.shown = c.shown != null ? c.shown : kontrolaState.items.length;
        if (d.limit) kontrolaState.limit = d.limit;
        // Zapnutý filter bez čipu je pasca — a pozná sa až z novej osi, teda tu.
        if (pruneKontrolaFilters()) { renderKontrola(true); return; }
        /* Panel otvorený na uzle, ktorý v novej odpovedi nie je (overil ho niekto
           iný, filter ho odrezal), je tá istá pasca ako filter bez dát: panel by
           tvrdil niečo, čo v tabuľke nie je vidieť. Zatvára sa cez
           `closeRecPanel()`, aby z adresy odišiel aj `koo`. */
        const openId = recOpenId('kontrola');
        if (openId != null && !hasKontrolaItem(openId)) closeRecPanel();
        /* Až tu je filter orezaný o osi, ktoré v odpovedi nemajú čip, takže do
           adresy ide pravda, ktorou sa obrazovka naozaj riadi. Keby URL vynucovala
           filter NAD prune logikou, `?kot=<neexistujuci-typ>` by nechal obrazovku
           trvalo prázdnu bez čipu, ktorým sa to zruší — presne ten stav, proti
           ktorému prune vznikol.

           `f.q` sa nepruneuje vôbec (výraz bez zásahu je legitímny stav), takže
           ide do adresy tak, ako ho človek napísal. Strop je zámerne v URL: bez
           neho by odkaz na 300 položiek otvoril stovku a tlačidlo „Ďalších N"
           by človek klikal odznova. */
        syncKontrolaUrl();
        kontrolaState.idx = 0;
        // pri `soft` je fokus tam, kde ho človek nechal (čip alebo hľadanie) — nebrať ho
        rerenderKontrola(!soft && canTakeKontrolaFocus());
        // Prianie z adresy sa spotrebuje AŽ PO vykreslení tabuľky: bez riadkov sa
        // nedá povedať, či ten uzol vo fronte vôbec je.
        applyKontrolaOpenWish();
        // Hygiena sa dotiahne AŽ POTOM a raz za načítanie stránky: je to prechod
        // celou sieťou (uzly + hrany), nie dopyt, takže by inak fronta čakala na
        // niečo, čo s ňou nesúvisí. Filtrovanie fronty ju nespúšťa znovu.
        loadHygiena(false);
    } catch (e) {
        if (cancelSkeleton) cancelSkeleton();
        if (softList) softList.setAttribute('aria-busy', 'false');
        if (seq !== kontrolaSeq) return;
        /* Cieľ chyby má DVA tvary a je to nutnosť, nie štýl: pri filtrovaní ide
           chyba do zoznamu, aby ostal toolbar — inak by sa zlý filter nedal ani
           zrušiť. Pri prvom načítaní berie chyba celé telo, pretože toolbar ešte
           neexistuje.
           `retry` nesie ten istý `soft`, teda mieri tam, odkiaľ prišla; číta
           `kontrolaState`, nie DOM, ktorý práve zmizol. */
        renderError(softList || body, 'frontu', () => renderKontrola(soft));
    }
}

function hasKontrolaItem(id) {
    return kontrolaState.items.some((n) => String(n.id) === String(id));
}

/* Prvé vykreslenie fronty označilo prvú položku vizuálne, ale fokus prehliadača tam
   nebol, kým človek nestlačil j/k — Tab preto začínal odznova od hlavičky a čítač
   obrazovky o výbere nevedel. Fokus si ale nemôžeme vziať vždy: `/api/review/queue`
   beží stovky ms a človek medzitým môže byť úplne inde (písať do hľadania, otvoriť
   paletu). Berieme ho len tam, kde oň nikto iný nestojí: prázdny fokus, tlačidlo
   railu, ktorým sa sem prišlo, alebo už niečo vnútri tejto obrazovky. */
function canTakeKontrolaFocus() {
    const a = document.activeElement;
    if (!a || a === document.body || a === document.documentElement) return true;
    if (a.id === 'dest-kontrola') return true;
    return !!(a.closest && a.closest('#screen-kontrola'));
}

/* moveFocus=true — prekreslenie po AKCII (overiť / vyriešiť / preskočiť / zmazať).
   `renderTable()` vymení celý `innerHTML`, takže fokus by inak zostal na <body>
   presne v tom okamihu, keď človek pokračuje v práci s frontou. */
export function rerenderKontrola(moveFocus) {
    const body = $('kontrola-body');
    if (!body) return;
    setRailBadge('kontrola', kontrolaState.total);
    ensureKontrolaShell(body);
    syncKontrolaFilter();
    renderKontrolaSaved();
    // Musí to byť TU, nie za tabuľkou: pri prázdnej fronte sa nižšie vracia
    // skoro, a sekcia hygieny by po prestavbe shellu zostala prázdna práve vtedy,
    // keď je jediné, čo obrazovka ešte má čo povedať.
    renderHygiena();
    const list = $('kontrola-list');
    const hints = $('kontrola-hints');
    const items = kontrolaState.items;
    if (!items.length) {
        /* Pás klávesových skratiek nad prázdnou frontou by učil ovládanie niečoho,
           čo tam nie je. Skrýva ho `.hidden` (`display: none !important`), nie
           inline `style` — rozmer ani viditeľnosť napísané v JS sú pre CSSOM
           neviditeľné a žiadna asercia ich nenájde. */
        if (hints) hints.classList.add('hidden');
        /* Prázdno POD filtrom je iná veta než prázdna fronta — a musí ísť do
           tabuľky, nie cez celé telo: keby zmizol toolbar, filter, ktorý všetko
           odrezal, by sa nedal zrušiť ničím okrem prechodu na inú obrazovku.
           `renderTable()` má vlastný `empty`, ale ten vie povedať jednu vetu bez
           akcie — tu sú dve príčiny prázdna a každá má vlastnú vetu aj akciu. */
        if (kontrolaFiltersActive()) {
            renderFilterEmpty(list, 'Filtru nevyhovuje ani jeden uzol',
                'Zruš filter a uvidíš celú frontu.', clearKontrolaFilters);
        } else {
            renderEmpty(list, 'check-list', 'Fronta na overenie je prázdna',
                'Nové poznatky sem prídu po ďalšej session.');
        }
        return;
    }
    if (hints) hints.classList.remove('hidden');
    kontrolaState.idx = Math.max(0, Math.min(kontrolaState.idx, items.length - 1));

    /* PORADIE `items` JE PORADIE RIADKOV a musí ním zostať. `kontrolaState.idx`
       je index do `items` a čítajú ho klávesy j/k/v/r/Delete v `shortcuts.js`
       (`items[idx]`), takže keby tabuľka kreslila inak zoradenú kópiu, „v" by
       overilo iný uzol, než na ktorý sa človek pozerá. Preto sa triedi POLE
       SAMOTNÉ, nie jeho kópia pre kresbu. `sortRows` je stabilný, takže
       opakovaný render s tým istým kľúčom poradie nemení. */
    const cols = kontrolaColumns();
    kontrolaState.items = sortRows(items, kontrolaState.sortKey, kontrolaState.sortDir, cols);

    renderTable(list, cols, {
        rows: kontrolaState.items,
        sortKey: kontrolaState.sortKey,
        sortDir: kontrolaState.sortDir,
        onSort: sortKontrola,
        onOpen: openKontrolaPanel,
        openId: recOpenId('kontrola'),
        idKey: 'id',
        caption: 'Fronta na overenie',
    });
    renderKontrolaMore(list);
    wireKontrola(list);
    watchKontrolaPanelClose();
    /* Klávesový kurzor sa musí obnoviť po KAŽDOM prekreslení, nie len po akcii:
       `renderTable()` stavia riadky nanovo, takže `.selected` z predchádzajúcej
       kresby s nimi zmizne — a `idx` by ukazoval na riadok, ktorý nie je označený.
       Predchodca (`queueItemHtml`) si triedu písal priamo do markupu; spoločná
       tabuľka o cudzej triede vedieť nemá, tak sa dopisuje tu. Fokus a scroll sa
       pri tom ale NEBERÚ (to je `markKontrolaSelected(true)`): pri filtrovaní je
       fokus v poli hľadania a scroll patrí človeku. */
    if (moveFocus) markKontrolaSelected(true);
    else paintKontrolaCursor();
}

/* Toolbar a tabuľka sú dva samostatné bloky, nie jeden innerHTML. Hľadanie je
   <input> a každé prekreslenie fronty (overiť, vyriešiť, preskočiť, nová
   odpoveď) by ho aj s kurzorom vymenilo za nový prázdny.

   Toolbar sa preto stavia len keď sa zmenia OSI. Tie počíta server nad celou
   frontou, nie nad filtrom (viď `KontrolaScreen::base()`), takže klikanie do
   filtra ani písanie do hľadania nimi nehýbe — a input prežije. */
let kontrolaAxisSig = null;

function kontrolaAxisSignature() {
    const c = kontrolaState.counts || {};
    return JSON.stringify([c.by_type || {}, c.by_certainty || {},
        kontrolaState.areas.map((a) => [a.slug, a.count])]);
}

function ensureKontrolaShell(body) {
    const sig = kontrolaAxisSignature();
    if ($('kontrola-list') && kontrolaAxisSig === sig) return;
    kontrolaAxisSig = sig;
    /* Pás skratiek je odteraz v SHELLI, nie v tele tabuľky: `renderTable()`
       prepisuje `innerHTML` kontejnera, takže by ho zmazalo každé prekreslenie
       a musel by sa dokresľovať ťahom po hotovej tabuľke.

       Hygiena je tretí blok tej istej obrazovky a stojí POD frontou: fronta je
       práca, hygiena je stav. `aria-live` je tu preto, že obsah dobehne sám
       (meranie beží sekundy) — bez neho by čítačka o výsledku nevedela.

       Odstup hygieny je ODTERAZ V CSS (`#kontrola-hygiene { margin-top: var(--gutter) }`
       v `mind.css`) a inline `style` odtiaľto odišiel — dovtedy tu bol a komentár
       ho priznával ako dlh. Rozmer napísaný v JS je pre CSSOM neviditeľný, takže
       žiadna asercia ho nenájde; po presune ho hlási stylesheet a `margin-top`
       zostal ten istý (zmerané: 20 px pred aj po).

       `#kontrola-saved` je lišta uložených filtrov a stojí MEDZI čipmi a tabuľkou:
       ukladá sa pohľad zložený z čipov a hľadania, takže patrí k nim — a keď filter
       nič nenájde, prázdny stav ide do `#kontrola-list`, takže lišta zostane
       dosiahnuteľná práve vtedy, keď ju človek potrebuje najviac (vzor `runy.js`). */
    body.innerHTML = '<div id="kontrola-filter"></div><div id="kontrola-saved"></div>'
        + '<div id="kontrola-list"></div>'
        + '<div id="kontrola-hints">' + kontrolaHintsHtml() + '</div>'
        + '<div class="dash-card" id="kontrola-hygiene" aria-live="polite"></div>';
    $('kontrola-filter').innerHTML = kontrolaFilterHtml();
    wireKontrolaFilter();
    wireKontrolaEnterGuard($('kontrola-list'));
}

/* ENTER SA NESMIE DOSTAŤ NA WINDOW. `shortcuts.js` má pre `Enter` na tejto
   obrazovke `openNodeDetail()` a jeho listener je na window, takže bez zastavenia
   by klávesnica otvorila prekrytie uzla a myš pravý panel — dve pravdy o jednej
   akcii.

   Je to `addEventListener` na KONTEJNERI, a preto sa vešia práve tu, v jedinom
   mieste, kde ten kontejner vzniká. `#kontrola-list` prekreslenie PREŽIJE (mení
   sa len jeho `innerHTML`), takže volanie z `wireKontrola()` by pri každej akcii
   pridalo ďalší listener — po dvadsiatich overeniach dvadsať kópií tej istej
   obsluhy.

   BEZ `preventDefault`: `renderTable()` si ho na riadku robí sám a nad tlačidlami
   akcií Enter patrí tlačidlu. Ostatné klávesy (j/k/v/r/Delete) prejsť MUSIA —
   obsluhuje ich `shortcuts.js` na window a fokus je pri práci s frontou práve
   tu, v tabuľke. */
function wireKontrolaEnterGuard(list) {
    if (!list) return;
    list.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.stopPropagation();
    });
}

/* Filtračný čip hovorí tým istým jazykom ako v Denníku a v Rozhodnutiach:
   popisok + počet v .chip-n. Je to zámerne vlastná kópia trojriadkového helperu
   a nie import z `rozhodnutia.js` — cudzí súbor prepisuje iná vlna a väzba naň
   by kvôli trom riadkom rozbila obrazovku, ktorá s Rozhodnutiami nesúvisí. */
function kfChip(label, active, attrs, n) {
    // `aria-pressed` je povinné: bez neho nesie zapnutý filter LEN farba a čítačka
    // o ňom nevie nič. Vzor je `runy.js` (chip()) — ten istý atribút, nie druhý
    // mechanizmus. Aktívny stav sa dopĺňa aj v syncKontrolaFilter(), inak by sa
    // trieda a atribút po prekliku rozišli.
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label) + (n == null ? '' : '<span class="chip-n">' + n + '</span>') + '</button>';
}

// Len hodnoty, ktoré serializér naozaj prijíma — čip pre `bez istoty` by sa
// tváril ako filter a server by ho ticho zahodil (viď KontrolaScreen::active()).
const KF_TYPES = ['core', 'skill', 'project', 'memory'];
const KF_CERTS = ['overene', 'hypoteza', 'pasca'];

function kontrolaFilterHtml() {
    const f = kontrolaState.f;
    const c = kontrolaState.counts || {};
    const total = c.total != null ? c.total : kontrolaState.total;
    const rows = [];

    // Rad sa vypisuje len keď je z čoho vyberať — jediná hodnota nie je filter,
    // len šum (rovnaké pravidlo ako `years.length > 1` v Rozhodnutiach).
    const byType = c.by_type || {};
    const types = KF_TYPES.filter((t) => byType[t]);
    if (types.length > 1) {
        rows.push(kfChip('Všetky typy', !f.type, 'data-kf="type" data-val=""', total)
            + types.map((t) => kfChip(typeName(t), f.type === t,
                'data-kf="type" data-val="' + t + '"', byType[t])).join(''));
    }

    const byCert = c.by_certainty || {};
    const certs = KF_CERTS.filter((k) => byCert[k]);
    if (certs.length > 1) {
        rows.push(kfChip('Každá istota', !f.certainty, 'data-kf="certainty" data-val=""', total)
            + certs.map((k) => kfChip(CERT_META[k][1], f.certainty === k,
                'data-kf="certainty" data-val="' + k + '"', byCert[k])).join(''));
    }

    const areas = kontrolaState.areas || [];
    if (areas.length > 1) {
        rows.push(kfChip('Všetky oblasti', !f.area, 'data-kf="area" data-val=""', total)
            + areas.map((a) => kfChip(a.name, f.area === a.slug,
                'data-kf="area" data-val="' + esc(a.slug) + '"', a.count)).join(''));
    }

    /* Posledný rad je hľadanie. Priznanie počtu a tlačidlo ďalšej stránky sa
       odtiaľ 31. 8. 2026 PRESUNULI pod tabuľku do `moreRow()` (`table.js`) —
       jeden jazyk s Runami a Rozhodnutiami. Nechať ich aj tu by znamenalo dve
       tlačidlá „ďalej" a dve rôzne vety o tom istom počte.

       Rozmery sú inline a obe čísla sú nutnosť: základný štýl vstupov je
       `width:100%`, takže bez `width:auto` pole vytlačí zvyšok riadku — a bez
       `flex:0 1` narastie cez celý riadok. `type="search"` zámerne NIE: dal by
       polu natívny modrý krížik, ktorý s akcentom nemá nič spoločné, a
       `#library-search` ho tiež nemá. */
    rows.push('<input id="kontrola-q" value="' + esc(f.q) + '"'
        + ' placeholder="Hľadať vo fronte…" autocomplete="off" aria-label="Hľadať vo fronte"'
        + ' maxlength="200">');

    return rows.map((r) => '<div class="dtl-filter">' + r + '</div>').join('');
}

/* Čo sa mení bez prestavby toolbaru: aktívny čip. Preto sú to triedy a atribúty,
   nie nový innerHTML. */
function syncKontrolaFilter() {
    const wrap = $('kontrola-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-kf]').forEach((el) => {
        const on = (kontrolaState.f[el.dataset.kf] || '') === el.dataset.val;
        el.classList.toggle('active', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
}

/* ---------- uložené filtre (`hades.filters.kontrola`) ----------

   MECHANIKA JE JEDNA a žije v `shared/filters.js` (re-export cez `table.js`, tak
   ako ju berú Runy, Rozhodnutia a Denník). Druhá sa tu nepíše: `localStorage`,
   `try/catch` na každom prístupe (zamknuté úložisko v privátnom okne) aj strop
   dvanástich mien sú tam.

   PREČO TU VÔBEC SÚ: fronta má štyri osi a všetky štyri sú serverové, takže
   „pasce v oblasti X" je dopyt, ktorý sa opakuje a odklikať ho treba trikrát.
   To je presne pohľad, ktorý sa má dať uložiť — a filter je pohľad na dáta, nie
   dáta, preto `localStorage` a nie DB.

   Lišta sa prekresľuje z `rerenderKontrola()`, teda aj po každom rozhodnutí vo
   fronte. Je to bezpečné a nie je to zbytočné: `<input>` v nej nie je (ten je
   v toolbare, ktorý prekreslenie prežíva), a menovka „Uložiť: …" sa musí meniť
   so filtrom — inak by ponúkala uloženie pohľadu, ktorý už nie je nasadený. */
function renderKontrolaSaved() {
    renderSavedFilters($('kontrola-saved'), 'kontrola', {
        onApply: applyKontrolaSavedFilter,
        current: currentKontrolaFilter,
    });
}

/* `null` = nie je čo uložiť, a vtedy `renderSavedFilters()` tlačidlo vôbec
   nevykreslí. Uložiť stav bez filtra by znamenalo uložiť „celú frontu", teda
   pohľad, ktorý sa dosiahne aj bez uloženia.

   MENO SI FILTER SKLÁDA SÁM, nedáva ho dialóg (natívny `prompt()` by bol jediné
   modálne okno v appke). Skládá sa z toho, ČO ČLOVEK VIDÍ na čipoch, nie zo
   surových kľúčov: „Pasca · Skill · Vývoj & kód · „docker"" a nie
   „pasca · skill · vyvoj-kod". Je to ten istý dôvod ako `sortValue` pri stĺpcoch —
   uložený pohľad sa hľadá očami. Oblasť má v stave SLUG a v mene NÁZOV, ktorý
   dáva server (`kontrolaState.areas`); keď v odpovedi nie je, ostáva slug —
   výmysel by bol horší než technické slovo. */
function currentKontrolaFilter() {
    if (!kontrolaFiltersActive()) return null;
    const f = kontrolaState.f;
    const bits = [];
    if (f.certainty) bits.push((CERT_META[f.certainty] || [])[1] || f.certainty);
    if (f.type) bits.push(typeName(f.type));
    if (f.area) {
        const hit = (kontrolaState.areas || []).find((a) => a.slug === f.area);
        bits.push(hit ? hit.name : f.area);
    }
    if (f.q) bits.push('„' + f.q + '"');
    return {
        name: bits.join(' · '),
        /* Do stavu ide LEN os filtra. Strop (`kol`) ani radenie (`kok`/`kod`) v ňom
           zámerne nie sú: uložený pohľad je „ktoré uzly", nie „koľko ich načítaj
           a v akom poradí". Strop sa pri nasadení vracia na prvú stránku, tak ako
           pri každej inej zmene filtra. */
        state: { type: f.type, certainty: f.certainty, area: f.area, q: f.q },
    };
}

/* Nasadenie je VIDITEĽNÁ ZMENA PLOCHY, takže sa NEHLÁSI (politika notifikácií
   §8): čipy sa prepnú, tabuľka sa prekreslí, priznanie počtu sa zmení. Zlyhanie
   dopytu ohlási `renderKontrola()` svojím chybovým stavom.

   Pole hľadania sa dosadzuje RUČNE z toho istého dôvodu ako po Späť: toolbar sa
   prestavuje len pri zmene osí, takže by v ňom zostal výraz, ktorý už nefiltruje.
   Debounce sa ruší — inak by dobehol so starým obsahom poľa a prepísal práve
   nasadený `q`. */
function applyKontrolaSavedFilter(state) {
    const s = state || {};
    clearTimeout(kontrolaQTimer);
    kontrolaState.f = {
        type: s.type || '', certainty: s.certainty || '', area: s.area || '', q: s.q || '',
    };
    kontrolaState.limit = KONTROLA_PAGE;
    const q = $('kontrola-q');
    if (q) q.value = kontrolaState.f.q;
    renderKontrola(true);
}

/* Filter, ktorý po novom načítaní nemá vo svojej osi čip, je pasca: rady sa
   vypisujú len keď je z čoho vyberať, takže po overení posledného uzla daného
   typu by filter ostal zapnutý BEZ čipu, ktorým sa zruší — a fronta by vyzerala
   trvalo prázdna. Rozhodnutia to isté robia v `pruneDecisionFilters`.
   Vracia true, keď sa niečo zhodilo a treba sa spýtať znova. */
function pruneKontrolaFilters() {
    const c = kontrolaState.counts || {};
    const f = kontrolaState.f;
    let changed = false;
    // podmienka MUSÍ byť tá istá ako v kontrolaFilterHtml (rad len pri > 1 voľbe)
    const drop = (key, options) => {
        if (f[key] && !(options.length > 1 && options.indexOf(f[key]) >= 0)) {
            f[key] = '';
            changed = true;
        }
    };
    drop('type', KF_TYPES.filter((t) => (c.by_type || {})[t]));
    drop('certainty', KF_CERTS.filter((k) => (c.by_certainty || {})[k]));
    drop('area', (kontrolaState.areas || []).map((a) => a.slug));
    return changed;
}

/* „Ďalších N" (G3) pod tabuľkou. Celok je `matching` — počet uzlov, ktoré
   vyhovujú FILTRU bez stropu, teda serverové číslo, nie dopočet z `items.length`.
   Práve preto sa tu smie kresliť: `moreRow()` mlčí, keď celok nie je známy, a tu
   známy je vždy (bez filtra je `matching` z definície `total`).

   Nad tvrdým stropom servera (500) sa tlačidlo NEKRESLÍ — nemohlo by priniesť
   ďalší riadok. Zostáva veta, ktorá to priznáva; „ticho" by na tom mieste
   znamenalo, že zoznam skončil, a to nie je pravda. */
function renderKontrolaMore(list) {
    if (!list) return;
    /* ZVYŠOK SA POČÍTA ZO `shown` (čo prišlo zo servera), NIE z `items.length`:
       preskočenie je lokálne a zmenšuje zoznam bez toho, aby na serveri pribudlo
       čo dotiahnuť. Keby tu stálo `items.length`, tri preskočenia by vyrobili
       tlačidlo „Ďalších 3", ktoré by tie isté tri uzly priniesli späť. */
    const rest = kontrolaState.matching - kontrolaState.shown;

    if (rest <= 0) {
        /* Server nemá čo pridať, takže sa kreslí len PRIZNANIE POČTU — a to musí
           hovoriť o tom, čo je na ploche, teda `items.length`. Po lokálnom
           preskočení je riadkov menej než server poslal (zmerané: 3 riadky,
           `shown` 4) a „všetkých 4" nad tromi riadkami je lož o jeden.
           `onMore` sa v tejto vetve nikdy nevyvolá — `moreRow` tlačidlo kreslí
           len keď `shown < total`. */
        const n = kontrolaState.items.length;
        moreRow(list, n, n, () => {});
        return;
    }

    if (kontrolaState.shown >= KONTROLA_MAX) {
        /* Nad tvrdým stropom servera by tlačidlo nemohlo priniesť ďalší riadok
           a tlačidlo, ktoré nič nespraví, je horšie než žiadne (to isté pravidlo
           má `renderMore()` v Runoch). Ticho by tu ale znamenalo, že zoznam
           skončil — a to nie je pravda, preto veta. Kresba je `.rec-more` /
           `.rec-more-n`, teda tá istá, akú by nasadil `moreRow`. */
        const wrap = document.createElement('div');
        wrap.className = 'rec-more';
        const n = document.createElement('span');
        n.className = 'rec-more-n';
        n.textContent = 'Zobrazených ' + kontrolaState.items.length + ' zo '
            + kontrolaState.matching + ' — ďalej už len filtrom';
        wrap.appendChild(n);
        list.appendChild(wrap);
        return;
    }

    moreRow(list, kontrolaState.shown, kontrolaState.matching, () => {
        kontrolaState.limit = Math.min(KONTROLA_MAX, kontrolaState.limit + KONTROLA_PAGE);
        renderKontrola(true);
    });
}

function wireKontrolaFilter() {
    const wrap = $('kontrola-filter');
    if (!wrap) return;
    wrap.querySelectorAll('[data-kf]').forEach((el) => {
        el.onclick = () => {
            const key = el.dataset.kf;
            if ((kontrolaState.f[key] || '') === el.dataset.val) return;
            kontrolaState.f[key] = el.dataset.val;
            // nový filter = nová fronta, takže strop ide späť na prvú stránku
            kontrolaState.limit = KONTROLA_PAGE;
            renderKontrola(true);
        };
    });
    const q = $('kontrola-q');
    if (q) {
        q.oninput = () => {
            clearTimeout(kontrolaQTimer);
            // 220 ms ako v Knižnici — dopyt nesmie odísť na každý znak
            kontrolaQTimer = setTimeout(() => {
                const val = (q.value || '').trim();
                if (val === kontrolaState.f.q) return;
                kontrolaState.f.q = val;
                kontrolaState.limit = KONTROLA_PAGE;
                renderKontrola(true);
            }, 220);
        };
    }
}

/* ---------- stĺpce ----------

   Poradie: Istota · Poznatok · Typ · Oblasť · Pôvod · Kedy · Akcie.

   ISTOTA STOJÍ PRVÁ a je to jediný rozdiel od Runov, ktorý nesie význam:
   v archíve behov je prvý stĺpec Stav („čo sa s tým stalo"), vo fronte na
   rozhodovanie je prvý stĺpec dôvod, prečo riadok otvoriť. „Pasca" je práca,
   „hypotéza" je práca inej váhy a „bez istoty" je práca tretej váhy.

   POZNATOK je hlavný identifikátor riadka a jediný stĺpec bez `width` — pri
   `table-layout: fixed` mu tak pripadne celý zvyšok šírky.

   ŠÍRKY SÚ V PERCENTÁCH všade, kde obsah rastie s oknom, a v `rem` len tam, kde
   nerastie (stĺpec akcií nesú tri tlačidlá po 32 px). Dôvod je zaplatený
   v Runoch: pri samých `rem` dal súčet 656 px a v 502 px širokom obsahu zostalo
   na hlavný identifikátor 0 px. `min(7.5rem, 22%)` je pasca tiež — percento
   vnútri `min()` prehliadač v `table-layout: fixed` ZAHODÍ.

   `sortValue` je tam, kde sa ZOBRAZENÁ hodnota porovnať nedá. V tejto tabuľke
   to je väčšina stĺpcov a každý z iného dôvodu — viď komentáre pri nich.

   EXPORTOVANÉ ZÁMERNE, hoci ich nikto neimportuje: kľúč triedenia stĺpca Istota
   je poradie váhy, ktoré sa na živých dátach nemusí dať zmerať (dnes je celá
   fronta „bez istoty", takže obe smery kliku dajú tú istú kresbu). Merací harness
   si preto vezme TÚTO definíciu a preženie ňou vlastné riadky — nie kópiu formuly,
   ktorá by po zmene kódu merala samu seba. */
export function kontrolaColumns() {
    return [
        {
            key: 'certainty', label: 'Istota', width: '11%',
            cell: (n) => certBadge(n.certainty || 'bez'),
            /* Poradie VÁHY, nie abecedy ani surového kľúča. Abecedne by vyšlo
               „hypoteza, overene, pasca" a po slovensky „Bez istoty, Hypotéza,
               Overené, Pasca" — ani jedno nie je poradie, v akom sa fronta
               rozhoduje. Prvým klikom sa má ukázať to najnaliehavejšie, preto je
               `pasca` index 0 a smer prvého kliku je ASC (viď `sortKontrola`). */
            sortValue: (n) => {
                const i = CERT_ORDER.indexOf(n.certainty || 'bez');
                return i < 0 ? CERT_ORDER.length : i;
            },
        },
        {
            key: 'label', label: 'Poznatok',
            /* Cela nesie LABEL + POPIS, presne ako karta pred prechodom na
               tabuľku. Label je prvý, takže výpustka odsekáva popis a nikdy
               identifikátor riadka; `<b>` ho oddelí aj vtedy, keď je popis dlhý.

               `plainText` na popis a `plainInline` na label: oba prichádzajú
               z markdownu (ten istý zdroj ako snippety v Denníku), takže bez toho
               by v tabuľke svietilo „**Čo:** …". `plainText` navyše zlepí riadky,
               čo je pre jednoriadkovú celu podmienka, nie kozmetika. */
            cell: (n) => {
                const desc = plainText(n.description);
                return '<b>' + esc(plainInline(n.label)) + '</b>'
                    + (desc ? ' — ' + esc(desc) : '');
            },
            /* Radí sa podľa TOHO, ČO JE VIDIEŤ: surový label nesie `backticky`
               a `**`, takže by sa tie riadky zoradili inde, než kam ich oko na
               obrazovke čaká. Popis do kľúča nepatrí — radí sa podľa poznatku. */
            sortValue: (n) => plainInline(n.label || ''),
            /* REZ SA PRIZNÁVA. Cela je `overflow: hidden` s výpustkou a reže sa
               takmer vždy (popis má stovky znakov), takže bez `title` by sa
               kontext nedal prečítať bez otvorenia panelu — a to je práve to,
               čo z tabuľky vo fronte robí horšiu plochu než karta. */
            titleFrom: (n) => {
                const desc = plainText(n.description);
                return plainInline(n.label || '') + (desc ? ' — ' + desc : '');
            },
        },
        {
            key: 'type', label: 'Typ', width: '9%',
            cell: (n) => esc(typeName(n.type)),
            /* Radí sa podľa SLOVENSKÉHO názvu, nie surového kľúča: `memory`,
               `project`, `skill` je iné poradie než „poznatok, projekt, skill",
               a človek radí podľa toho, čo číta. `localeCompare('sk')` v
               `sortRows` je tu podmienka — bez neho by „Č" skončilo za „Z". */
            sortValue: (n) => typeName(n.type),
        },
        {
            key: 'area', label: 'Oblasť', width: '14%',
            /* Názov oblasti dáva SERVER (kľúč `area` v `KontrolaScreen::rows()`).
               Dopočítať ho z grafového payloadu (`S.areas`) by znamenalo, že
               obrazovka závisí od toho, či je graf načítaný — chyba, ktorú si
               Rozhodnutia už raz zaplatili.

               Bez oblasti je pomlčka, ale `sortValue` sa nedopĺňa: `sortRows`
               posiela prázdne hodnoty vždy na konec, pretože „nič" nie je
               najmenšia hodnota. Pomlčka ako `sortValue` by ich zaradila medzi
               oblasti (za „Obchod", pred „Osobné"). */
            cell: (n) => (n.area ? esc(n.area) : '—'),
            titleFrom: (n) => n.area || '',
        },
        {
            key: 'origin', label: 'Pôvod', width: '10%',
            /* Ten istý odznak ako na Dnes, v Denníku a v Rozhodnutiach — pôvod je
               jedna vec a má v celej appke jednu kresbu. `sortValue` netreba:
               surové kľúče (`brain` / `session`) majú to isté abecedné poradie
               ako zobrazené slová („playbook" / „session"), takže druhá kópia
               menoslovia by tu vznikla pre nulový rozdiel. */
            cell: (n) => originBadge(n.origin),
        },
        {
            key: 'created_at', label: 'Kedy', width: '8%',
            cell: (n) => {
                const when = timeAgo(n.created_at);
                if (!when) return '—';
                return '<span title="' + esc(whenTitle(n.created_at)) + '">' + esc(when) + '</span>';
            },
            /* ISO zo servera nesie OFFSET (`+02:00` v lete, `+01:00` v zime),
               takže jeho abecedné poradie nie je chronologické na hranici času.
               Normalizácia na UTC dá pevný tvar rovnakej dĺžky, kde abecedné
               poradie chronologické JE — a to je dôvod, prečo tento stĺpec
               nemusí byť `num`. Zobrazené „pred 3 d" je text bez dátumu. */
            sortValue: (n) => (n.created_at ? new Date(n.created_at).toISOString() : null),
        },
        {
            /* AKCIE ZOSTÁVAJÚ V RIADKU. Fronta, v ktorej treba na rozhodnutie
               najprv otvoriť panel, je pri stovke uzlov stovka otvorení — to je
               horšie než karta, ktorú tabuľka nahradila. Panel je na kontext.

               Šírka je v `rem`, nie v percentách: obsah cely sú tri tlačidlá
               s pevnými 32 px a percento by ich pri úzkom okne odseklo. Dorovnaná
               je na OZBROJENÝ stav („Preskočiť?"), nie na tri ikony — pri šírke
               podľa ikon sa ozbrojené tlačidlo do cely nevojde (to isté meranie
               ako pri koši v Rozhodnutiach).

               `sortable: false`: stĺpec bez hodnoty sa zoradiť nedá a `aria-sort`
               by na ňom bol stav, ktorý neexistuje. */
            key: 'akcie', label: 'Akcie', sortable: false, width: '11.5rem',
            cell: () => actionsCellHtml(),
        },
    ];
}

/* Poradie váhy pre stĺpec Istota. Je to konštanta pri stĺpci, nie odvodenina
   z `CERT_META` — poradie kľúčov v objekte je poradie kresby odznakov, nie
   poradie naliehavosti, a spoliehať sa na iteráciu objektu by bola väzba, ktorá
   sa ticho rozíde. */
const CERT_ORDER = ['pasca', 'hypoteza', 'bez', 'overene'];

function actionsCellHtml() {
    return '<div class="queue-actions">'
        + '<button type="button" class="act-verify" data-act="verify" title="Overiť (v)" aria-label="Overiť">' + iconMarkup('shield-check') + '</button>'
        + '<button type="button" class="act-resolve" data-act="resolve" title="Vyriešiť (r)" aria-label="Vyriešiť">' + iconMarkup('check-double') + '</button>'
        + '<button type="button" class="act-skip" data-act="skip" title="Preskočiť (Delete zmaže uzol)" aria-label="Preskočiť">' + iconMarkup('skip') + '</button>'
        + '</div>';
}

/* Presný čas do `title` stĺpca Kedy. Relatívny čas („pred 3 d") je v tabuľke
   čitateľnejší, ale sám neodpovie na otázku „ktorý deň to bolo". Deň sa tu
   dopočítava z `created_at` v zóne prehliadača a je to slovo, nie údaj —
   `/api/review/queue` kľúč `day` (na rozdiel od `/api/runs`) neposiela. */
function whenTitle(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('sk', {
        day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

/* Prvý klik na stĺpec nasadí smer, ktorý má pre stĺpec zmysel: čas od
   najnovšieho (zostupne), slová od A (vzostupne) a ISTOTA OD NAJNALIEHAVEJŠEJ
   (vzostupne v poradí váhy — `pasca` je index 0). Druhý klik obracia.
   TRIEDENIE IDE DO ADRESY (`kok`/`kod`) — pohľad na dáta má byť zdieľateľný.
   Zápis je `replace`, nie `push`: preklikanie štyroch stĺpcov by inak nechalo
   v histórii štyri kroky späť. Dopyt sa NEPOSIELA, radí sa načítané okno. */
function sortKontrola(key) {
    if (kontrolaState.sortKey === key) {
        kontrolaState.sortDir = kontrolaState.sortDir === ASC ? DESC : ASC;
    } else {
        kontrolaState.sortKey = key;
        kontrolaState.sortDir = key === 'created_at' ? DESC : ASC;
    }
    writeUrl({
        kok: kontrolaState.sortKey === 'created_at' ? null : kontrolaState.sortKey,
        kod: kontrolaState.sortDir === ASC ? 'asc' : null,
    }, 'replace');
    rerenderKontrola(false);
    /* Prekreslenie zahodilo `<th>` aj s tlačidlom, na ktoré človek práve klikol,
       takže fokus by spadol na `<body>` a Tab by začal od začiatku dokumentu.
       Vraciame ho na to isté tlačidlo v novej kresbe (vzor `rozhodnutia.js`). */
    const again = document.querySelector('#kontrola-list .rec-sort[data-sort="' + key + '"]');
    if (again) again.focus();
}

export function kontrolaHintsHtml() {
    const kh = (keys, label) => '<span class="kh">'
        + keys.map((k) => '<kbd>' + esc(k) + '</kbd>').join('') + ' ' + esc(label) + '</span>';
    return '<div class="kbd-hints">'
        + kh(['j', 'k'], 'posun')
        + kh(['Enter'], 'detail')
        + kh(['v'], 'overiť')
        + kh(['r'], 'vyriešiť')
        + kh(['Del'], 'zmazať uzol')
        + kh(['Esc'], 'zavrieť detail')
        + '</div>';
}

export function kontrolaNodeRef(id) {
    const n = kontrolaState.items.find((x) => x.id === id);
    return n ? { id: n.id, label: n.label, type: n.type, area_id: n.area_id } : { id };
}

/* Tlačidlo akcie v riadku. Adresuje sa `data-rec` (to píše `renderTable`), nie
   vlastným `data-id` — riadok tabuľky má jeden identifikátor a druhý atribút
   s tou istou hodnotou by bol miesto, kde sa dá rozísť. */
export function kontrolaBtn(id, act) {
    return document.querySelector('#kontrola-list .rec-row[data-rec="' + id + '"] .act-' + act);
}

export function wireKontrola(list) {
    /* Obsluha akcií riadka. Enter pre celú tabuľku zastavuje
       `wireKontrolaEnterGuard()` na kontejneri (vešia sa raz, viď tam).

       KLÁVESOVÁ AKTIVÁCIA TLAČIDLA SA MUSÍ ZASTAVIŤ NA TLAČIDLE. `renderTable()`
       vešia na `<tr>` obsluhu Enter/Space, ktorá volá `preventDefault()` BEZ
       kontroly cieľa — takže Enter nad „Overiť" by natívny klik potlačil a namiesto
       overenia by otvoril panel. Zastavenie na tlačidle spraví, že sa obsluha
       riadka nespustí vôbec; natívna aktivácia `stopPropagation` prežije. To isté
       robí `rozhodnutia.js` pri koši. */
    const stopKeys = (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };

    list.querySelectorAll('.rec-row[data-rec]').forEach((tr, i) => {
        const id = +tr.dataset.rec;
        /* Fokus a `idx` musia byť jedna vec. Riadok nesie tri <button>-y s normálnym
           tabindexom, takže Tab-om sa dá stáť na tlačidlách tretej položky — kým `idx`
           ostával na nule, lebo ten sa menil len cez j/k a mousedown. Kláves `v` potom
           overil PRVÚ položku: ticho a na nesprávnom uzle. `focusin` bublá, takže jeden
           listener na riadku pokryje aj jeho tlačidlá. */
        tr.addEventListener('mousedown', () => { kontrolaState.idx = i; markKontrolaSelected(); });
        tr.addEventListener('focusin', () => {
            if (kontrolaState.idx === i) return;
            kontrolaState.idx = i;
            // bez `true`: fokus už je tam, kam ho človek dal — dorovnáva sa len výber
            markKontrolaSelected();
        });

        /* Riadok pod tlačidlom otvára panel (`renderTable` vešia `onclick` na
           `<tr>`), takže bez zastavenia by jediný klik rozhodoval AJ otváral. */
        const v = tr.querySelector('.act-verify');
        if (v) {
            v.onclick = (e) => { e.stopPropagation(); kontrolaState.idx = i; kontrolaVerify(id); };
            v.onkeydown = stopKeys;
        }
        const r = tr.querySelector('.act-resolve');
        if (r) {
            r.onclick = (e) => { e.stopPropagation(); kontrolaState.idx = i; kontrolaResolve(id); };
            r.onkeydown = stopKeys;
        }
        const s = tr.querySelector('.act-skip');
        if (s) {
            s.onclick = (e) => { e.stopPropagation(); kontrolaState.idx = i; armKontrolaAction(s, id, 'skip'); };
            s.onkeydown = stopKeys;
        }
    });
}

/* focus=true presunie aj skutočný fokus prehliadača na zvolený riadok
   (`renderTable` dáva každému `<tr>` `tabIndex = 0`). Bez toho zostal fokus po
   každej akcii na <body>: klávesy j/k/v/r fungovali (listener je na window), ale
   čítač obrazovky ani prstenec fokusu nemali čo sledovať a Tab začínal odznova.

   Trieda `.selected` nesie KLÁVESOVÝ KURZOR a je to iný stav než `aria-current`
   (ten nesie „tento riadok je otvorený v paneli") — j/k prechádza frontou aj
   vtedy, keď panel nie je otvorený vôbec. Kresba `.rec-table .rec-row.selected`
   v `mind.css` UŽ EXISTUJE (podfarbenie `--accent-softer` + vnútorný obrys, 0-3-0,
   teda silnejšia než `.rec-row:hover`); komentár tu do 2. 9. 2026 tvrdil, že ju
   treba doplniť, a bolo to tvrdenie z čias, keď chýbala. Zmerané: vybraný riadok
   sa odlišuje pozadím aj bez fokusu, teda aj po myšacom presune výberu. */
function paintKontrolaCursor() {
    const rows = document.querySelectorAll('#kontrola-list .rec-row');
    rows.forEach((el, i) => el.classList.toggle('selected', i === kontrolaState.idx));
    return rows;
}

export function markKontrolaSelected(focus) {
    const rows = paintKontrolaCursor();
    const cur = rows[kontrolaState.idx];
    if (!cur) return;
    if (focus) cur.focus({ preventScroll: true });
    cur.scrollIntoView({ block: 'nearest' });
}

export function kontrolaMove(delta) {
    if (!kontrolaState.items.length) return;
    const n = kontrolaState.items.length;
    kontrolaState.idx = (kontrolaState.idx + delta + n) % n;
    markKontrolaSelected(true);
}

/* Odober položku z fronty. `serverTotal` je nová dĺžka fronty, ako ju ohlásil
   server (`queue_total` v odpovedi na verify / resolve-review) — nie odhad.

   Predtým sa tu počítadlo v raile dopočítavalo (`total - 1`). To je správne len
   vtedy, keď je táto session jediný pisateľ; pri paralelnom `mind_learn` z inej
   AI alebo pri mutácii, ktorá zhodí viac než jeden uzol, rail lhal až do ďalšieho
   načítania obrazovky. Server to vie povedať presne za jednu `COUNT(*)`. */
export function removeKontrolaItem(id, serverTotal) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    kontrolaState.items.splice(i, 1);
    if (typeof serverTotal === 'number') kontrolaState.total = Math.max(0, serverTotal);
    /* Uzol opustil frontu naozaj, nielen tento zoznam — takže o jeden klesol aj
       počet vyhovujúcich filtru a o jeden je menej toho, čo by ešte prišlo. Bez
       filtra je `matching` z definície `total`, takže sa dorovná zo servera a
       nedopočítava sa. „−1" je tu dokázateľné z toho istého dôvodu ako pri
       mazaní: konkrétny uzol vypadne z fronty presne raz. */
    kontrolaState.matching = kontrolaFiltersActive()
        ? Math.max(kontrolaState.items.length, kontrolaState.matching - 1)
        : kontrolaState.total;
    kontrolaState.shown = Math.max(kontrolaState.items.length, kontrolaState.shown - 1);
    if (kontrolaState.idx > i) kontrolaState.idx--;
    /* Rozhodnutý uzol nesmie zostať otvorený v paneli: detail by ukazoval záznam,
       ktorý vo fronte už nie je, a `koo` v adrese by ho po obnovení hľadal. */
    const openId = recOpenId('kontrola');
    if (openId != null && String(openId) === String(id)) closeRecPanel();
    rerenderKontrola(true);
}

export async function kontrolaVerify(id) {
    const btn = kontrolaBtn(id, 'verify') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/verify', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Overenie zlyhalo', null, 'error'); return; }
            removeKontrolaItem(id, j.queue_total);
            /* Bez výhrady sa NEHLÁSI NIČ (kontrakt J2): riadok z frontu zmizne
               a počítadlo klesne, takže tá zmena JE potvrdenie. Toast „Overené"
               nad prázdnym miestom, kde riadok bol, hovoril to isté dvakrát.
               Preto tu nie je ani `inlineOk()` — ten je pre akciu, ktorá plochu
               NEZMENÍ, a rozhodnutie vo fronte ju mení vždy.
               S výhradou toast ZOSTÁVA — tú v prekreslení nevidno a je to jediná
               cesta, ako sa k nej človek dostane. `warn` a nie `success`: uzol
               je overený, ale niečo si ešte žiada pozornosť. */
            const warns = j.warnings || [];
            if (warns.length) showToast('Overené — ' + warns[0], null, 'warn');
        } catch (e) { showToast('Overenie zlyhalo', null, 'error'); }
    }, '…');
}

export async function kontrolaResolve(id) {
    const btn = kontrolaBtn(id, 'resolve') || document.createElement('button');
    await busy(btn, async () => {
        try {
            const res = await fetch('/api/nodes/' + id + '/resolve-review', { method: 'POST' });
            const j = await res.json().catch(() => ({}));
            if (!res.ok) { showToast(j.message || j.error || 'Akcia zlyhala', null, 'error'); return; }
            // Bez hlásenia — riadok odišiel z frontu, to je potvrdenie (J2).
            removeKontrolaItem(id, j.queue_total);
        } catch (e) { showToast('Akcia zlyhala', null, 'error'); }
    }, '…');
}

// Armed-inline (žiadny natívny confirm): 1. akcia ozbrojí tlačidlo, 2. potvrdí.
// kind='skip' (lokálne preskočenie + undo) alebo 'delete' (DELETE uzla).
export function disarmKontrolaBtn(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    // `iconSwap` zahodi textove uzly a vlozi kresbu; `textContent` by na <svg>
    // nezobrazilo nic a vynimku by nevydalo.
    iconSwap(btn, 'skip');
    delete btn.dataset.armKind;
}

export function armKontrolaAction(btn, id, kind) {
    if (!btn) return;
    if (btn.classList.contains('armed') && btn.dataset.armKind === kind) {
        disarmKontrolaBtn(btn);
        if (kind === 'delete') kontrolaDelete(id); else kontrolaSkip(id);
        return;
    }
    document.querySelectorAll('#kontrola-body .act-skip.armed').forEach(disarmKontrolaBtn);
    btn.classList.add('armed');
    // Ozbrojeny stav nesie otazku textom, nie kresbu.
    const ic = btn.querySelector('svg.ic');
    if (ic) ic.remove();
    btn.dataset.armKind = kind;
    /* Otázka je KRÁTKA („Zmazať?", nie „Zmazať uzol?"): cela tabuľky je
       `overflow: hidden` s výpustkou, takže dlhšia otázka sa odsekne — a odseknuté
       potvrdenie je horšie než žiadne. Ten istý dôvod ako pri koši v Rozhodnutiach.
       Rozlíšenie oboch stavov nesie práve tento text, takže sa nesmú zliať. */
    btn.textContent = kind === 'delete' ? 'Zmazať?' : 'Preskočiť?';
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarmKontrolaBtn(btn); }, 3000);
}

export function kontrolaSkip(id) {
    const i = kontrolaState.items.findIndex((n) => n.id === id);
    if (i < 0) return;
    const [removed] = kontrolaState.items.splice(i, 1);
    if (kontrolaState.idx > i || kontrolaState.idx >= kontrolaState.items.length) {
        kontrolaState.idx = Math.max(0, kontrolaState.idx - (kontrolaState.idx > i ? 1 : 0));
    }
    const openId = recOpenId('kontrola');
    if (openId != null && String(openId) === String(id)) closeRecPanel();
    rerenderKontrola(true);
    // preskočenie je len lokálne (uzol ostáva v serverovej fronte) → total badge nemeníme
    showUndoToast('Preskočené', () => {
        kontrolaState.items.splice(Math.min(i, kontrolaState.items.length), 0, removed);
        kontrolaState.idx = i;
        rerenderKontrola(true);
    });
}

export async function kontrolaDelete(id) {
    const node = kontrolaState.items.find((n) => n.id === id);
    try {
        const res = await fetch('/api/nodes/' + id, { method: 'DELETE' });
        if (!res.ok) {
            const j = await res.json().catch(() => ({}));
            showToast(j.message || 'Nepodarilo sa zmazať', null, 'error');
            return;
        }
        // dorovnaj aj graf, ak je uzol načítaný (rovnako ako node-panel delete)
        if (node && S.byId.has(id)) {
            S.nodes = S.nodes.filter((m) => m.id !== id);
            S.edges = S.edges.filter((e) => e.source.id !== id && e.target.id !== id);
            S.byId.delete(id);
            if (S.local && S.local.rootId === id) clearLocal();
        }
        // JEDINÉ miesto, kde sa dĺžka fronty dopočítava. `DELETE /api/nodes/{id}`
        // je zdieľaný s grafom a o fronte kontroly nehovorí nič — a zmazaný uzol
        // z nej vypadne presne raz, takže „−1" je tu dokázateľné, nie odhad.
        removeKontrolaItem(id, Math.max(0, kontrolaState.total - 1));
        /* Mazanie hlási AJ TAK, hoci riadok zmizol — a je to výnimka z pravidla
           J2 s dôvodom: je to jediná NEVRATNÁ akcia v tejto fronte. „Zmizol
           riadok" je pri overení potvrdenie, pri mazaní je to to isté, čo by
           človek videl po omyle. Toast je tu doklad o tom, čo sa stalo, nie
           potvrdenie, že sa to podarilo. Vrátiť sa nedá (server uzol zmazal),
           preto NIE showUndoToast — sľúbené vrátenie, ktoré neexistuje, je
           horšie než žiadne. */
        showToast('Uzol zmazaný', null, 'success');
    } catch (e) {
        showToast('Nepodarilo sa zmazať', null, 'error');
    }
}

/* ---------- detail v pravom paneli (G6) ----------

   Panel nesie CELÝ popis, značky a zdroj — teda presne to, čo sa do
   jednoriadkovej cely nezmestilo. AKCIE V ŇOM ZÁMERNE NIE SÚ: rozhoduje sa
   z riadka (stĺpec Akcie), pretože fronta, ktorá si na každé rozhodnutie
   vyžiada otvorenie panelu, je pri stovke uzlov stovka otvorení. Panel je
   miesto, kde si človek prečíta, ČO ide rozhodnúť; rozhodne tam, kde stojí.

   `updateRecPanel()` sa NEVOLÁ a je to zámer: nič sa nedopočítava zo servera.
   Popis, značky, oblasť aj zdroj prišli v tom istom riadku ako tabuľka
   (`Node::toApi()`), takže druhé kreslenie by prepísalo to isté HTML. */
function openKontrolaPanel(n) {
    if (!n) return;
    /* Druhý klik na otvorený riadok zatvára. Panel má vlastný krížik aj Esc,
       takže to nie je jediná cesta von — ale riadok nesie `aria-current="true"`,
       takže je to cesta, ktorú človek na tom mieste hľadá. */
    const openId = recOpenId('kontrola');
    if (openId != null && String(openId) === String(n.id)) {
        closeRecPanel();
        markOpenKontrolaRow();
        return;
    }
    openRecPanel({
        ns: 'kontrola',
        id: n.id,
        urlKey: 'koo',
        title: kontrolaPanelTitle(n),
        html: kontrolaDetailHtml(n),
    });
    wireKontrolaPanel();
    markOpenKontrolaRow();
    watchKontrolaPanelClose();
}

/* Meno panelu je KRÁTKY label. Nadpis panelu je jednoriadkový s výpustkou
   (`.dock-head h2`), takže dlhý label sa odseká aj tak — ale v polovici slova.
   Rez na hranici slova je čitateľnejší a celý label stojí hneď pod nadpisom,
   takže sa rezom nič nestráca. Vzor je `decTitle()` v Rozhodnutiach. */
function kontrolaPanelTitle(n) {
    const s = plainInline(n.label || '');
    if (!s) return 'Uzol #' + n.id;
    if (s.length <= 72) return s;
    const cut = s.slice(0, 72);
    const sp = cut.lastIndexOf(' ');
    return (sp > 40 ? cut.slice(0, sp) : cut).trim() + '…';
}

function kontrolaDetailHtml(n) {
    /* `plainBlock` na popis, nie `plainText`: `.rec-final` má
       `white-space: pre-wrap`, takže odseky sú v ňom nositeľom štruktúry — a to
       je celý dôvod, prečo panel existuje. `.rec-final` je z rodiny detailu
       záznamu, nie „finálna odpoveď"; je to jediná existujúca kresba pre tichý
       viacodsekový text a nová trieda v CSS podľa zadania vzniknúť nemá. */
    const desc = plainBlock(n.description || '');
    const tags = Array.isArray(n.tags) ? n.tags : [];

    let h = '<p>' + certBadge(n.certainty || 'bez') + ' ' + originBadge(n.origin)
        + ' <span class="meta-chip">' + esc(typeName(n.type)) + '</span>'
        + (n.area ? ' <span class="tag">' + esc(n.area) + '</span>' : '')
        + (n.created_at ? ' <span class="meta-chip" title="' + esc(whenTitle(n.created_at)) + '">'
            + esc(timeAgo(n.created_at)) + '</span>' : '')
        + '</p>';

    h += '<h3>Poznatok</h3><p>' + esc(plainInline(n.label || '')) + '</p>';
    // Nadpis „Popis" má LEN uzol, ktorý popis naozaj nesie. Prázdna sekcia by
    // tvrdila, že popis zapísaný je a len ho nevidno — a „uzol bez popisu" je
    // pritom vlastná trieda nálezu Hygieny.
    if (desc) h += '<h3>Popis</h3><div class="rec-final">' + esc(desc) + '</div>';
    if (tags.length) {
        h += '<h3>Značky</h3><p>'
            + tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join(' ') + '</p>';
    }
    if (n.source_file) {
        // Pri `origin=brain` je zrkadlo v `.md` zdroj pravdy, takže cesta k nemu
        // je informácia, nie technický detail.
        h += '<h3>Zdroj</h3><p><span class="tag muted">' + esc(n.source_file) + '</span></p>';
    }
    /* Dve cesty k uzlu, dva rôzne úmysly — a je to ten istý rozdiel, aký si
       obrazovka už raz pomenovala pri Hygiene. „Prečítať" je čítačka markdownu
       na mieste (`openNodeDetail`, prekrytie nad touto obrazovkou, fronta
       zostáva). „Opraviť" je premenovanie alebo presun do oblasti, a to je panel
       v Grafe (`openNodeFromAnywhere`, prepne obrazovku). */
    h += '<h3>Uzol #' + n.id + '</h3><p>'
        + '<button type="button" class="chip ko-read" data-node="' + n.id + '">'
        + iconMarkup('book') + 'Prečítať celý uzol</button> '
        + '<button type="button" class="chip ko-fix" data-node="' + n.id + '">'
        + iconMarkup('hub') + 'Opraviť v grafe</button>'
        + '</p>';
    return h;
}

/* Akcie panelu sa vešajú až po vykreslení: `openRecPanel` berie hotové HTML
   a o fronte nevie nič — je to spoločný panel s Runami a Rozhodnutiami a vedieť
   to ani nemá. */
function wireKontrolaPanel() {
    const box = $('rec-panel-body');
    if (!box) return;
    const read = box.querySelector('.ko-read');
    if (read) read.onclick = () => openNodeDetail(kontrolaNodeRef(+read.dataset.node));
    const fix = box.querySelector('.ko-fix');
    if (fix) fix.onclick = () => openNodeFromAnywhere(kontrolaNodeRef(+fix.dataset.node));
}

/* Otvorený riadok nesie stav v `aria-current` (odtiaľ ho číta aj CSS), takže sa
   po otvorení a po zavretí panelu musí prepnúť. NIE prekreslením tabuľky:
   `renderTable()` prepíše `innerHTML`, takže by kliknutý riadok zmizol z DOM —
   a `recpanel.js` si pri otvorení odložil `document.activeElement`, aby po
   zavretí vrátil fokus. Odložený odpojený `<tr>` má `isConnected === false`,
   takže by sa fokus po Esc nevrátil nikam. Dva atribúty na riadok sú to isté
   za nulovú cenu. */
function markOpenKontrolaRow() {
    const open = recOpenId('kontrola');
    document.querySelectorAll('#kontrola-list .rec-row').forEach((tr) => {
        const on = open != null && tr.dataset.rec === String(open);
        tr.classList.toggle('open', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
    });
}

/* Panel sa zatvára TROMI cestami, o ktorých táto obrazovka nevie: jeho krížik,
   Esc obslúžený v `recpanel.js` a `dropRecPanel()` pri prepnutí obrazovky. Bez
   ohlásenia by po Escu zostal riadok s `aria-current="true"` a s akcentovým
   pruhom — čítačka aj oko by tvrdili, že detail je otvorený, hoci nie je.

   Sledovať DÔSLEDOK (`MutationObserver` nad triedou panelu) je chyba, ktorú
   tento repo už raz zaplatil: nechytá tretiu cestu a ďalší panel si observer
   musí napísať znova. Preto `onRecPanelClose()`.

   Registruje sa RAZ: druhá registrácia by prvú prepísala (`Map` podľa menného
   priestoru), takže opakované volanie nič nepokazí — ale zbytočne. */
let kontrolaCloseWired = false;

function watchKontrolaPanelClose() {
    if (kontrolaCloseWired) return;
    kontrolaCloseWired = true;
    onRecPanelClose('kontrola', () => {
        // Prepnutie obrazovky panel tiež zatvára; vtedy tabuľka Kontroly na
        // obrazovke nie je a jej prekreslenie by bolo práca do prázdna.
        if (document.body.dataset.screen !== 'kontrola') return;
        markOpenKontrolaRow();
    });
}

/* Spotrebovanie priania z adresy. Beží po každom vykreslení tabuľky a po
   Späť/Dopredu; `kontrolaState.open` sa hneď nuluje, aby prianie platilo RAZ.
   Bez toho by kliknutie na filtračný čip po zavretí panelu panel znova otvorilo —
   stav by mal dvoch vlastníkov a vyhral by ten zastaraný.

   Keď uzol z adresy vo fronte nie je, kľúč odchádza: adresa nemá sľubovať
   otvorený detail, ktorý sa neotvoril. */
function applyKontrolaOpenWish() {
    const want = kontrolaState.open;
    kontrolaState.open = null;
    const cur = recOpenId('kontrola');
    if (!want) {
        // Späť na adresu bez `koo`: panel má zmiznúť. `closeRecPanel()` počas
        // aplikovania histórie do adresy nezapíše (stráž `applying` v urlstate).
        if (cur != null) { closeRecPanel(); markOpenKontrolaRow(); }
        return;
    }
    if (String(cur) === String(want)) return;
    const row = kontrolaState.items.find((n) => String(n.id) === String(want));
    if (row) { openKontrolaPanel(row); return; }
    writeUrl({ koo: null }, 'replace');
}

/* ---------- sekcia Hygiena (/api/hygiene) — nález A3 ------------------------
   Odpad v pamäti videla doteraz LEN AI: `mind_hygiene` existoval, ale grep nad
   `public/js/mind/` a `mind.blade.php` nedal ani jeden zásah. Sekcia sedí na
   Kontrole zámerne — fronta na overenie a hygiena hovoria o tom istom: čo
   v pamäti čaká na rozhodnutie človeka. Novú obrazovku kontrakt zmrazil.

   DÁTA POČÍTA SERVER (App\Serializers\Screen\HygienaScreen — ten istý serializér
   kŕmi `mind_hygiene`, drží to `ScreenParityTest`). Tu sú len SLOVÁ a vizuál:
   slovenské popisky tried, veta o prahoch, „pred 3 min" a šírka baru.

   NIČ SA TU NEMAŽE. Recall odpad označí a zaradí za čisté uzly; oprava je
   premenovanie alebo presun uzla, takže klik na uzol vedie do jeho detailu —
   existujúcou cestou (`openNodeFromAnywhere`), nie novým zápisovým endpointom.
   Prechod fronty na tabuľku na tom nemení nič: sekcia zostáva kartová, pretože
   nález nie je záznam v rade, ale meranie s barom. */

/* Popisky tried odpadu. Sú tu, a nie v serializéri, podľa pravidla dvojitej
   plochy: počty a skupiny sú dáta, POPISKY sú slová. Plocha AI dostáva kľúč
   triedy (`raw-prompt`), nie slovenskú vetu — tá by v odpovedi pre model bola
   len šum. Kľúče musia sedieť s `MindHygiene::CLASSES`; neznámy kľúč sa vypíše
   ako je, aby nová trieda odpadu z UI radšej trčala než potichu zmizla. */
const HYG_NAMES = {
    'raw-prompt': 'Surová veta ako label',
    markdown: 'Markdown v labeli',
    'tag-sprawl': 'Rozlezené tagy',
    duplicate: 'Kandidát na duplicitu',
    slug: 'Strojový slug',
    oversized: 'Prerastený popis',
    misfiled: 'Zle zaradený uzol',
    stub: 'Uzol bez popisu',
    orphan: 'Sirota bez hrán',
};

/* `attempted` nie je to isté ako `loaded`: automatické načítanie sa smie stať
   RAZ, aj keď zlyhá. Bez toho by každá zmena filtra fronty spustila ďalší pokus
   o meranie celej siete — a pri nedostupnom endpointe by to bol útok na vlastný
   server, spustený klikaním do filtra. Opakovanie je vedomé, cez tlačidlo. */
export const hygienaState = { loading: false, loaded: false, attempted: false, error: false, data: null };

function hygName(key) {
    return HYG_NAMES[key] || String(key || '');
}

/* Meranie prechádza celú sieť, takže sa ťahá raz za načítanie stránky. `force`
   je tlačidlo „Zmerať znovu" — po overení alebo zmazaní uzlov je správa stará. */
export async function loadHygiena(force) {
    if (hygienaState.loading) return;
    if (hygienaState.attempted && !force) return;
    hygienaState.attempted = true;
    hygienaState.loading = true;
    hygienaState.error = false;
    renderHygiena();
    try {
        hygienaState.data = await getJson('/api/hygiene');
        hygienaState.loaded = true;
    } catch (e) {
        hygienaState.error = true;
    } finally {
        hygienaState.loading = false;
        renderHygiena();
    }
}

/* Posledný vykreslený obsah. `renderHygiena()` beží po KAŽDEJ akcii vo fronte
   (overiť, vyriešiť, preskočiť), ale správa o hygiene sa tým nemení — a keby sme
   do `aria-live` regiónu prepísali ten istý text, čítačka by ho po každom
   overení prečítala znova. Prázdny kontejner znamená, že shell sa práve
   prestavil, a vtedy sa kreslí vždy. */
let hygRendered = '';

/* Chybový stav nekreslí STRING, ale `renderError()` — jeden komponent pre celú
   appku — takže cache posledného obsahu preň potrebuje značku. `\x00` v HTML
   vzniknúť nemôže, takže sa so žiadnou kresbou nezhodne. */
const HYG_ERROR = '\x00hygiena-error';

/* FOKUSOVÝ DLH SEKCIE. `renderHygiena()` prepíše telo karty za jednu akciu aj
   DVAKRÁT (meranie → výsledok) a v tom prvom prepise je jediný ovládač zakázaný:
   `focus()` na `disabled` tlačidle NEROBÍ NIČ — zmerané, `activeElement` spadol na
   `<body>`. Dlh sa preto nesie v module a nie v premennej jedného behu, inak by sa
   stratil presne pred prepisom, po ktorom prichádza chyba a jej JEDINÁ akcia.
   Nuluje sa až vtedy, keď fokus naozaj sedí v karte, nie keď sa oň požiadalo. */
let hygFocusOwed = false;

/* Ktorý ovládač držal fokus. Vracia ZNAČKU, nie prvok — prvok prepis zahodí.
   `act` je akcia chybového stavu (`.empty-act`) a jej ekvivalentom po úspešnom
   meraní je tlačidlo v hlavičke: je to tá istá vec („zmeraj znovu") v inej
   kresbe, takže sa fokus vracia tam, a nie na začiatok dokumentu. */
function hygFocusMark(el) {
    const a = document.activeElement;
    if (!a || !el.contains(a)) return '';
    if (a.classList && a.classList.contains('empty-act')) return 'act';
    if (a.dataset && a.dataset.hyg) return 'hyg:' + a.dataset.hyg;
    return a.id || '';
}

/* Vracia, či fokus po pokuse naozaj sedí v karte — `disabled` cieľ ho neprijme
   a tichý `false` je jediné, čo drží dlh ďalej. */
function hygRestoreFocus(el, mark) {
    if (!mark) return false;
    let t = null;
    if (mark === 'act') t = el.querySelector('.empty-act') || el.querySelector('#hygiena-refresh');
    else if (mark.startsWith('hyg:')) t = el.querySelector('[data-hyg="' + mark.slice(4) + '"]');
    else t = el.querySelector('#' + mark);
    if (!t || t.disabled) return false;
    t.focus();
    return el.contains(document.activeElement);
}

export function renderHygiena() {
    const el = $('kontrola-hygiene');
    if (!el) return;
    const html = hygienaState.error ? HYG_ERROR : hygienaHtml();
    if (el.innerHTML !== '' && html === hygRendered) return;
    /* Fokus musí prežiť prepis. „Zmerať znovu" je vnútri prepisovaného tela, takže
       kliknutie klávesnicou zničí práve ten prvok, ktorý fokus drží — a meranie
       trvá sekundy, takže by človek zostal na `<body>` a druhý render (po dobehnutí)
       by ho tam nechal. Je to tá istá trieda nálezu ako P3 (fokus po rozhodnutí
       o zápise), len na inej obrazovke. Vzor je `runy.js`: zapamätaj, prekresli,
       vráť — len s dlhom v module, viď `hygFocusOwed`. */
    const mark = hygFocusMark(el);
    if (mark) hygFocusOwed = true;
    hygRendered = html;
    el.setAttribute('aria-busy', hygienaState.loading ? 'true' : 'false');
    if (html === HYG_ERROR) {
        /* CHYBA MÁ JEDEN KOMPONENT A VLASTNÝ PREDMET (manuál §8). Do 2. 9. 2026
           tu stálo `<p class="dash-note">Hygienu sa nepodarilo zmerať.</p>`: veta
           bez ikony, bez roly v strome prístupnosti a s akciou schovanou v hlavičke
           karty ako „Zmerať znovu" — teda tretí chybový vzor v appke, ktorá má
           jeden. Zvyšok Kontroly hovorí `renderError(list, 'frontu', …)` a Hygiena
           hovorila niečím iným o tej istej poruche.

           `renderError()` prepíše CELÚ kartu vrátane hlavičky, a to je zámer:
           hlavička nesie druhé tlačidlo tej istej akcie a dve cesty k jednému
           „skús to znova" sú horšie než jedna. Predmet („hygienu") skládá helper,
           takže veta znie ako na ostatných obrazovkách, a serif je v chybe
           zakázaný — o to sa stará `.empty--error`, nie tento súbor. */
        renderError(el, 'hygienu', () => loadHygiena(true));
        /* Fokus zničil prepis rovnako ako pri úspešnej kresbe, len cieľ je iný:
           tlačidlo v hlavičke tu už nie je a jediná akcia je `.empty-act`. Bez
           tohto riadka je jediná cesta z chyby dosiahnuteľná len myšou — zmerané:
           po klávesovom „Zmerať znovu" bol `activeElement` `<body>`. */
        if (hygFocusOwed && hygRestoreFocus(el, 'act')) hygFocusOwed = false;
        return;
    }
    el.innerHTML = html;
    wireHygiena(el);
    /* `mark || 'act'`: keď fokus medzitým spadol na `<body>` (zakázané tlačidlo
       počas merania), značka je prázdna, ale dlh trvá — a ekvivalent akcie je
       v hlavičke. Bez tej náhrady by sa fokus po dobehnutí merania nevrátil. */
    if (hygFocusOwed && hygRestoreFocus(el, mark || 'act')) hygFocusOwed = false;
}

function hygienaHtml() {
    const d = hygienaState.data;
    const head = '<div class="dash-head">'
        + '<span class="dash-title">Hygiena pamäti</span>'
        + '<button type="button" class="chip" id="hygiena-refresh"'
        + (hygienaState.loading ? ' disabled' : '')
        + '>' + (hygienaState.loaded || hygienaState.error ? 'Zmerať znovu' : 'Zmerať') + '</button>'
        + '</div>';

    if (hygienaState.loading) {
        // Neosobne (docs/BRAND-HADES.md §1) — dovtedy tu bolo jediné „ja" tejto sekcie.
        return head + '<p class="dash-note">Prechádza sa celá sieť, chvíľu to trvá.</p>';
    }
    if (!d) {
        return head + '<p class="dash-note">Ešte nezmerané.</p>';
    }

    const classes = d.classes || [];
    const rows = [hygSummaryHtml(d)];

    if (!classes.length) {
        rows.push('<p class="dash-note">Žiadny nález — v pamäti nie je čo čistiť.</p>');
        return head + rows.join('');
    }

    /* Bar nesie ZÁŤAŽ (váha × počet), nie počet: sto sirôt stojí AI menej než
       dvadsať useknutých promptov, ktoré číta ako poznatky. Serializér posiela
       `burden`, šírku v percentách počítame tu — to je vizuál, nie dáta. */
    const max = classes.reduce((m, c) => Math.max(m, c.burden || 0), 0) || 1;
    classes.forEach((c) => rows.push(hygClassHtml(c, max)));

    if ((d.worst || []).length) rows.push(hygWorstHtml(d.worst));
    rows.push('<p class="dash-note">Nič sa tu nemaže. Klikni na uzol a oprav ho '
        + 'v detaile — premenovaním alebo presunom do správnej oblasti.</p>');

    return head + rows.join('');
}

function hygSummaryHtml(d) {
    const t = d.thresholds || {};
    const bits = [(d.dirty_nodes || 0) + ' z ' + (d.nodes || 0) + ' uzlov má nález'];
    if (t.desc_chars) bits.push('popis nad ' + t.desc_chars + ' znakov');
    if (t.tag_cap) bits.push('tagov nad ' + t.tag_cap);
    if (d.generated_at) bits.push('zmerané pred ' + timeAgo(d.generated_at));
    return '<p class="dash-note">' + esc(bits.join(' · ')) + '</p>';
}

function hygClassHtml(c, max) {
    const w = Math.max(2, Math.round(100 * (c.burden || 0) / max));
    return '<div class="dbar">'
        + '<div class="dbar-head">'
        + '<span class="db-name">' + esc(hygName(c.class)) + '</span>'
        + '<span class="db-n">' + (c.count || 0) + ' · váha ' + (c.weight || 0) + '</span>'
        + '</div>'
        + '<div class="dbar-track"><div class="dbar-fill" style="width:' + w + '%"></div></div>'
        + hygChipsHtml(c.example_nodes || [], (n) => n.note)
        + '</div>';
}

function hygWorstHtml(worst) {
    return '<div class="dbar">'
        + '<div class="dbar-head"><span class="db-name">Najdrahšie uzly</span>'
        + '<span class="db-n">rozhodni prvé</span></div>'
        + hygChipsHtml(worst, (n) => (n.classes || []).map(hygName).join(' + '))
        + '</div>';
}

/* Rad uzlov ako čipy. `tail` je to, čo o uzle povie server: nález pri triede
   („12 tagov (strop recallu je 8)"), zoznam tried pri najdrahších. */
function hygChipsHtml(nodes, tail) {
    if (!nodes.length) return '';
    return '<div class="dtl-filter">' + nodes.map((n) => {
        const t = tail(n);
        /* Prázdne polia sa v titulku VYNECHÁVAJÚ, nedopĺňajú sa vetou. Riadok
           najdrahších uzlov nesie len id, label a triedy (tak ako plocha AI),
           takže „bez oblasti" by tam nebol nález, ale výmysel — a práve pri
           triede „zle zaradený uzol" by ten výmysel znel ako dôkaz. */
        const meta = [n.type ? typeName(n.type) : '', n.area || ''].filter(Boolean).join(' · ');
        /* Label sa NEČISTÍ cez plainInline, na rozdiel od fronty a Denníka:
           trieda „markdown v labeli" je práve o tom, že v labeli je „#" a „**".
           Odstrániť ich tu by znamenalo schovať presne ten nález, ktorý sekcia
           hlási — človek by videl čistý text a nechápal, čo má opravovať. */
        return '<button type="button" class="chip" data-hyg="' + n.id + '"'
            + (meta ? ' title="' + esc(meta) + '"' : '') + '>'
            + esc(n.label || ('#' + n.id))
            + (t ? '<span class="chip-n">' + esc(t) + '</span>' : '')
            + '</button>';
    }).join('') + '</div>';
}

/* Uzol pre detail. Ref sa skladá z už načítanej správy, nie z data atribútov:
   label môže obsahovať čokoľvek (to je celá pointa triedy „surová veta ako
   label") a prelievať ho cez HTML atribút a späť je cesta, na ktorej sa dá
   stratiť znak. */
function hygNodeRef(id) {
    const d = hygienaState.data;
    if (!d) return { id };
    const pools = (d.classes || []).map((c) => c.example_nodes || []).concat([d.worst || []]);
    for (const pool of pools) {
        const hit = pool.find((n) => n.id === id);
        if (hit) return { id: hit.id, label: hit.label, type: hit.type };
    }
    return { id };
}

function wireHygiena(el) {
    const refresh = el.querySelector('#hygiena-refresh');
    if (refresh) refresh.onclick = () => loadHygiena(true);
    el.querySelectorAll('[data-hyg]').forEach((btn) => {
        const id = +btn.dataset.hyg;
        btn.onclick = () => openNodeFromAnywhere(hygNodeRef(id));
        /* Enter na tomto čipe by inak zhltla klávesová fronta Kontroly:
           `shortcuts.js` počúva na window a pre `Enter` otvára VYBRANÝ uzol fronty,
           aj s `preventDefault()` — klik by sa nikdy neuskutočnil a otvoril by sa
           cudzí uzol. Listener je na window (bublanie), stačí ho zastaviť tu. */
        btn.onkeydown = (e) => {
            if (e.key === 'Enter') e.stopPropagation();
        };
    });
}
