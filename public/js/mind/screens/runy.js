import { showToast } from '../toasts.js';
import { readUrl, registerUrlApply, urlValue, writeUrl } from '../urlstate.js';
import { $, deferSkeleton, esc, filterEmptyHtml, fmtNum, getJson, loadingHtml, plainInline, renderEmpty, renderError, timeAgo } from '../util.js';
import { ASC, DESC, moreRow, renderSavedFilters, renderTable } from '../table.js';
import { closeRecPanel, onRecPanelClose, openRecPanel, recOpenId, updateRecPanel } from '../recpanel.js';

/* ---------- obrazovka Runy (/api/runs) — čo konzola robila ----------
   TABUĽKA behov (kontrakt G1) s triedením, filtrami stav/model ako .chip
   v .dtl-filter a detailom v PRAVOM PANELI (G6), nie v rozbalenej karte.

   Prečo tabuľka: beh je päť čísel v rade (tokeny, trvanie, model, profil, stav)
   a karta sa na porovnávanie čísel nedá použiť — dve karty pod sebou majú svoje
   čísla v inom vodorovnom mieste. Karty tu boli do 28. 8. 2026 a spolu s nimi
   zmizlo aj ZOSKUPENIE PO DŇOCH (`.dtl-month`): hlavička dňa má význam len
   v zozname zoradenom podľa času, a tabuľka sa dá zoradiť podľa tokenov. Deň sa
   preto nestratil, presunul sa do `title` stĺpca Kedy — a stále je to serverový
   kľúč `day`, nie dopočet z `started_at` (hranicu dňa určuje zóna servera).

   DÁTA SÚ SERVEROVÉ. Obrazovka si nič nedopočítava: počty podľa stavu (`counts`),
   ponuka modelov (`models`) aj kľúč dňa (`day`) prichádzajú z
   `App\Serializers\Screen\RunsScreen` — tej istej triedy, z ktorej čerpá MCP tool
   `mind_runs`. Preto sa tu nesmie objaviť ani jedno `items.filter(...).length` na
   miesto, kde je číslo v odpovedi: presne tým sa Denník aj Kontrola dostali do
   stavu, že čip sľuboval číslo, ktoré zoznam nedal.

   Čo TU zostáva vizuálne, a je to tak správne: popisok dňa (dnes/včera/dátum),
   formát trvania a `timeAgo`. To sú slová, nie údaje.

   TRIEDENIE JE SERVEROVÉ (od 1. 9. 2026) a preto sa `sortRows()` z `table.js`
   TU UŽ NEVOLÁ. Do tejto vlny radila tabuľka OKNO, ktoré prišlo — „najdrahší
   beh" bol najdrahší z načítaných 50, nie z celej tabuľky. `/api/runs` má odteraz
   `sort`/`dir` (whitelist `RunsScreen::SORTS`, 11 kľúčov) a `filtered_total`,
   takže `query()` posiela radenie a obrazovka kreslí `d.items` V PORADÍ, V AKOM
   PRIŠLI. Druhé radenie nad tým istým poľom by bolo druhý zdroj pravdy: pri
   `status` by sa navyše LÍŠILO (server radí abecedne, `STATUS_ORDER` podľa
   významu), takže by hlavička hlásila jedno a riadky boli v inom poradí.

   DÔSLEDOK, ktorý treba poznať: radiť sa dá len podľa toho, čo je v tom
   whiteliste. `prompt` a `tool_profile` v ňom nie sú, takže ich hlavičky sú
   `sortable: false` — nie preto, že by sa nedali porovnať (`sortValue` na to
   bolo), ale preto, že klientske radenie okna by po tejto zmene bolo jediný
   stĺpec, ktorý hovorí o inej množine než ostatných päť. Radšej žiadne radenie
   než dve rôzne pravdy v jednej tabuľke.

   Zoradenie podľa STAVU je odteraz abecedné (server), nie podľa `STATUS_ORDER`.
   Je to zámerná výmena: poradie významu nad oknom 50 je pekná lož, abecedné
   zoskupenie nad celou tabuľkou je pravda. `STATUS_ORDER` zostáva poradím
   filtračných čipov, a filter podľa stavu je aj tak silnejší nástroj než
   radenie podľa neho. */

/* Boot z URL (slovník §6): `rus` stav · `rum` model · `ruo` otvorený beh ·
   `ruk` kľúč radenia · `rud` smer.
   Číta sa pri načítaní modulu, teda pred prvým `query()` — odkaz tak pošle na
   server rovno svoj filter.

   `ruo` je jediný kľúč obrazovky, ktorý nie je filter: je to poloha čitateľa
   v zozname. Preto ide do URL — odkaz na konkrétny beh je presne to, čo si človek
   posiela sám sebe. Detail sa doťahuje z `/api/runs/{uuid}` až po odpovedi
   zoznamu (nižšie), nie tu: bez zoznamu sa nedá povedať, či ten beh vôbec
   filtru vyhovuje. */
const BOOT_MINE = readUrl().s === 'runy';
const bootKey = (k) => (BOOT_MINE ? urlValue(k) : null) || null;

/* Strop, ktorý drží server (`RunsScreen::MAX_LIMIT`). Je tu zdvojený zámerne
   a vedome: validátor v `RunsController` nad 200 vracia 422, takže sa strop NEDÁ
   zistiť pokusom — a `limit` v odpovedi hlási len to, čo klient poslal. Bez tejto
   konštanty by „Ďalších 50" pri 200 riadkoch spôsobilo chybu, teda toast namiesto
   riadkov. */
const LIMIT_MAX = 200;
const LIMIT_STEP = 50;

/* Kľúče, podľa ktorých vie radiť SERVER (`RunsScreen::SORTS`). Zdvojené vedome,
   ten istý dôvod ako pri `LIMIT_MAX`: hlavička stĺpca sa musí rozhodnúť, či bude
   tlačidlom, ešte pred prvou odpoveďou — a odpoveď nesie len `sort`, teda kľúč,
   ktorý sa naozaj použil, nie zoznam možností. Kľúč, ktorý tu je a na serveri nie,
   by dal 422; kľúč, ktorý je na serveri a tu nie, je len nedostupné radenie.
   Preto sa tento zoznam smie líšiť len smerom „menej", nikdy „viac". */
const SERVER_SORTS = ['started_at', 'ended_at', 'duration_ms', 'tokens_in', 'tokens_out',
    'tokens_per_second', 'steps', 'tool_calls', 'status', 'model', 'source'];

/** Smer pre server. Stav drží ±1 (násobiteľ komparátora), dopyt slová. */
function dirWord(d) { return d === ASC ? 'asc' : 'desc'; }

/* Radenie z adresy. Neznámy kľúč sa zahodí na default — `ruk` môže prísť
   z odkazu, ktorý vznikol pred zmenou whitelistu, a poslať ho na server by
   znamenalo 422, teda chybový stav obrazovky namiesto tabuľky. */
function bootSortKey() {
    const k = bootKey('ruk');
    return k && SERVER_SORTS.includes(k) ? k : 'started_at';
}

export const runsState = {
    items: [], counts: {}, models: [],
    /* Počet riadkov, ktoré vyhovujú AKTUÁLNEMU filtru, nad celou tabuľkou
       (`filtered_total`). Je to tretie číslo vedľa `counts` (tie sú nad celou
       tabuľkou BEZ filtrov) a práve ono robí „N z M" pravdivým aj pri filtri
       podľa modelu — dovtedy sa tam počet nesmel ukázať vôbec. */
    filteredTotal: null,
    status: bootKey('rus'), model: bootKey('rum'),
    /* `open` NIE JE stav panelu — je to JEDNORAZOVÉ prianie z adresy („otvor mi
       tento beh"), ktoré `applyOpenWish()` spotrebuje a zahodí. Stav panelu
       vlastní `recpanel.js` (`recOpenId('runy')`), pretože zavrieť sa dá aj jeho
       vlastným krížikom a Escom, o ktorých táto obrazovka nevie nič. Keby tu
       zostala druhá pravda, najbližšie prekreslenie by zavretie panelu odvolalo. */
    open: bootKey('ruo'),
    /* Koľko riadkov si obrazovka vyžiadala. Do adresy NEIDE: slovník `urlstate.js`
       preň kľúč nemá a vymyslieť si ho tu by bol kľúč, ktorý nikto nevaliduje. */
    limit: LIMIT_STEP,
    /* Radenie IDE DO ADRESY (`ruk`/`rud`) — je to pohľad na dáta, ktorý sa dá
       poslať odkazom („pozri, toto bežalo najdlhšie"). Do uloženého filtra
       nejde: filter je to, čo sa pýtam servera o množine, radenie je poradie
       v nej. */
    sortKey: bootSortKey(),
    sortDir: bootKey('rud') === 'asc' ? ASC : DESC,
    details: new Map(),
};

/** Stav behu → slovo pre človeka. Beh, ktorý čaká na povolenie zápisu, NIE JE chyba. */
const STATUS_LABEL = {
    running: 'beží',
    waiting: 'čaká na povolenie',
    done: 'hotové',
    aborted: 'prerušené',
    failed: 'spadlo',
};

/* Poradie filtračných čipov je poradie, v akom to človek hľadá — nie abecedné.
   Kľúčom TRIEDENIA stĺpca Stav už NIE JE (do 1. 9. 2026 bol, cez `sortValue`):
   radí server a ten pozná `status`, nie tento zoznam. Dôvod výmeny je v hlavičke
   súboru; tu zostáva ako poradie čipov, kde nesie presne to, čo má — „ukáž mi
   najprv to, čo ma zaujíma". */
const STATUS_ORDER = ['running', 'waiting', 'failed', 'aborted', 'done'];

export async function renderRuns() {
    const body = $('runy-body');
    if (!body) return;
    // Skeleton v tvare obsahu (rad filtračných čipov + riadky tabuľky).
    const cancelSkeleton = deferSkeleton(body, 'table');
    try {
        const d = await getJson('/api/runs' + query());
        cancelSkeleton();
        runsState.items = d.items || [];
        runsState.counts = d.counts || {};
        runsState.models = d.models || [];
        /* `?? null` a nie `|| null`: nula je legitímny filtrovaný počet (filter,
           ktorý nič nezachytil) a `||` by ju nerozlíšil od chýbajúceho kľúča.
           `null` znamená „server ho nepovedal" a `renderMore()` vtedy mlčí. */
        runsState.filteredTotal = d.filtered_total ?? null;
        /* ECHO RADENIA, nie prianie klienta. Server whitelist nevaliduje výnimkou,
           ale tichým návratom na `started_at` (dôvod je v `RunsScreen`: MCP cesta
           bez validátora nesmie skončiť neurčitým `isError`), takže keby sa stav
           opravil sám z vlastného priania, hlavička by ukazovala šípku nad stĺpcom,
           podľa ktorého sa neradilo. Riadi sa tým, čo sa naozaj stalo. */
        if (d.sort && SERVER_SORTS.includes(d.sort)) runsState.sortKey = d.sort;
        if (d.dir === 'asc' || d.dir === 'desc') runsState.sortDir = d.dir === 'asc' ? ASC : DESC;
        // Strop berieme zo SERVERA: `RunsScreen` si ho stláča sám (`min(limit, MAX)`),
        // takže po jeho zásahu je pravdou odpoveď, nie prianie klienta.
        if (d.limit) runsState.limit = d.limit;
        pruneRunFilters();
        /* Panel otvorený na behu, ktorý filtru už nevyhovuje, je tá istá pasca ako
           filter bez dát: obsah panelu by tvrdil niečo, čo v zozname nie je vidieť.
           Zatvára sa až TU, po orezaní stavu, a cez `closeRecPanel()`, aby sa
           z adresy stratil aj `ruo`. */
        if (recOpenId('runy') && !hasRun(recOpenId('runy'))) closeRecPanel();
        /* Až tu je stav orezaný o to, čo v odpovedi neexistuje, takže do adresy ide
           pravda, ktorou sa obrazovka riadi — nie prianie z odkazu. `replace`:
           filter do histórie nepatrí (rozhodnutie 10). */
        syncRunsUrl();
        renderRunsView();
        // Otvorený beh z odkazu ešte nemá detail — dotiahne sa, akoby naň klikol
        // človek. Až PO `renderRunsView()`, aby zoznam nečakal na druhý request.
        applyOpenWish();
    } catch (e) {
        cancelSkeleton();
        renderError(body, 'behy', renderRuns);
    }
}

/** Filtre idú na server, nie do prehliadača — inak by počty v čipoch nesedeli s obsahom. */
function query() {
    const p = new URLSearchParams();
    if (runsState.status) p.set('status', runsState.status);
    if (runsState.model) p.set('model', runsState.model);
    /* Radenie posiela obrazovka VŽDY, aj default. Nie kvôli serveru (ten padá na
       `started_at desc` sám), ale kvôli sebe: keby sa default vynechával, dopyt na
       prvé načítanie a dopyt po dvoch klikoch „tam a späť" by sa líšili tvarom,
       nie obsahom — a v sieťovom logu by sa nedalo prečítať, čo obrazovka chcela. */
    p.set('sort', runsState.sortKey);
    p.set('dir', dirWord(runsState.sortDir));
    // `limit` posiela obrazovka vždy, aj default — „Ďalších 50" je inak jediné
    // miesto, ktoré by ho posielalo, a dopyt by sa medzi prvým a druhým načítaním
    // líšil viac než o počet riadkov.
    p.set('limit', String(Math.min(LIMIT_MAX, Math.max(1, runsState.limit || LIMIT_STEP))));
    const q = p.toString();
    return q ? '?' + q : '';
}

function hasRun(uuid) {
    return runsState.items.some((r) => r.uuid === uuid);
}

/* Filter, ktorý po znovunačítaní nemá čo ukázať, je pasca — rady čipov sa
   vypisujú len keď je z čoho vyberať, takže by obrazovka mohla ostať prázdna BEZ
   čipu, ktorým sa filter zruší. Rozhodnutia to riešia rovnako (pruneDecisionFilters). */
export function pruneRunFilters() {
    if (runsState.status && !(runsState.counts[runsState.status] > 0)) runsState.status = null;
    if (runsState.model && !runsState.models.includes(runsState.model)) runsState.model = null;
    /* Prianie z adresy, ktoré v odpovedi nemá riadok, je tá istá pasca o úroveň
       nižšie: `ruo` môže mieriť na beh, ktorý filtru nevyhovuje alebo už
       neexistuje. Zhodíme ho, a adresa sa tým skrátí. */
    if (runsState.open && !hasRun(runsState.open)) runsState.open = null;
}

/* Adresný riadok nie je dopyt: `query()` vyššie skladá `?status=&model=&limit=`
   pre `/api/runs`. Tu sú len kľúče, ktoré nesú polohu čitateľa —  a `ruo` medzi
   nimi ZÁMERNE nie je: ten píše a maže `recpanel.js` pri otvorení a zavretí
   panelu. Keby ho písala aj obrazovka, zavretý panel by si pri najbližšom
   prekreslení vrátil svoj kľúč do adresy. */
function syncRunsUrl() {
    writeUrl({
        rus: runsState.status || null,
        rum: runsState.model || null,
        /* Default sa v adrese neukazuje (`def` v slovníku ho vynechá), takže
           `?s=runy` znamená „najnovšie zhora" a `?s=runy&ruk=duration_ms` je
           odkaz na tabuľku zoradenú podľa trvania.

           POZOR, kým `urlstate.js` tie dva kľúče nemá v `DICT`: `writeUrl()`
           neznámy kľúč TICHO ZAHODÍ (`if (!e) continue`), takže radenie funguje,
           ale v adrese sa neobjaví a Späť/Dopredu ho vráti na default. Zmerané
           1. 9. 2026: `location.search` = '?s=runy' aj po kliknutí na hlavičku
           Trvanie. Presné riadky do slovníka sú v hlásení tejto vlny. */
        ruk: runsState.sortKey === 'started_at' ? null : runsState.sortKey,
        rud: runsState.sortDir === ASC ? 'asc' : null,
    }, 'replace');
}

/* Späť / Dopredu: adresa je vstup. Keď sa zmenil len `ruo`, netreba nový dopyt na
   zoznam — otvorenie panelu je poloha čitateľa, nie filter, a `renderRuns()` by
   kvôli nemu zbytočne znova volal `/api/runs`. */
registerUrlApply('runy', (url) => {
    if (url.s !== 'runy') return;
    const nextStatus = url.rus || null;
    const nextModel = url.rum || null;
    const nextOpen = url.ruo || null;
    /* Kľúč, ktorý v adrese NIE JE, znamená DEFAULT — nie „nechaj, ako je".
       Adresa je vstup, takže Späť na `?s=runy` má vrátiť aj poradie riadkov, nie
       len filtre. (Kým `ruk`/`rud` nie sú v slovníku, `url.ruk` je vždy
       `undefined`, takže sa radenie na Späť vráti na default. Je to viditeľný
       dôsledok chýbajúceho slovníka, nie druhá pravda v tomto súbore.) */
    const nextSortKey = url.ruk && SERVER_SORTS.includes(url.ruk) ? url.ruk : 'started_at';
    const nextSortDir = url.rud === 'asc' ? ASC : DESC;
    const queryChanged = nextStatus !== runsState.status || nextModel !== runsState.model
        || nextSortKey !== runsState.sortKey || nextSortDir !== runsState.sortDir;
    if (!queryChanged && nextOpen === recOpenId('runy')) return;
    runsState.status = nextStatus;
    runsState.model = nextModel;
    runsState.sortKey = nextSortKey;
    runsState.sortDir = nextSortDir;
    runsState.open = nextOpen;
    if (document.body.dataset.screen !== 'runy') return;
    if (queryChanged) { renderRuns(); return; }
    applyOpenWish();
});

/* Spotrebovanie priania z adresy. Beží po každom prekreslení zoznamu a po
   Späť/Dopredu; `runsState.open` sa hneď nuluje, aby prianie platilo RAZ. Bez
   toho by kliknutie na filtračný čip po zavretí panelu panel znova otvorilo —
   stav by mal dvoch vlastníkov a vyhral by ten zastaraný. */
function applyOpenWish() {
    const want = runsState.open;
    runsState.open = null;
    const cur = recOpenId('runy');
    if (!want) {
        // Späť na adresu bez `ruo`: panel má zmiznúť. `closeRecPanel()` počas
        // aplikovania histórie do adresy nezapíše (stráž `applying` v urlstate).
        if (cur) { closeRecPanel(); markOpenRow(null); }
        return;
    }
    if (cur === want) return;
    const row = runsState.items.find((r) => r.uuid === want);
    if (row) openRun(row);
}

function renderRunsView() {
    const body = $('runy-body');
    if (!body) return;

    /* Prázdna obrazovka BEZ filtra: konštatovanie + čo bude ďalej, bez akcie —
       beh sa nespúšťa odtiaľto, takže tlačidlo by nemalo kam viesť.

       Text hovorí „beh", nie „ťah": obrazovka vypisuje záznamy z `runs`, teda
       BEHY. Ťah je jedna výmena s modelom VNÚTRI behu a je vidieť až v paneli
       detailu (`.run-steps`). Pomenovania sú nezameniteľné — ťah, ktorý zaparkuje
       na bráne, nikdy nepošle rámec `end`, takže cena jeho prvého segmentu sa
       počíta inak než cena behu. */
    if (!runsState.items.length && !runsState.status && !runsState.model) {
        renderEmpty(
            body,
            'bolt',
            'Konzola ešte nič nebežala',
            'Otvor Charóna a zadaj úlohu — každý beh sa tu objaví so svojou cenou.',
        );
        return;
    }

    /* Jedna kostra pre všetky stavy: čipy, uložené filtre, tabuľka, priznanie
       počtu. Prázdno z filtra ide do `#runy-table` namiesto tabuľky, takže
       uložené filtre zostanú dosiahnuteľné aj vtedy, keď filter nič nenašiel —
       práve tam ich človek potrebuje najviac. */
    body.innerHTML = filtersHtml()
        + '<div id="runy-saved"></div>'
        + '<div id="runy-table"></div>'
        + '<div id="runy-more"></div>';

    wirePanelMirror();

    body.querySelectorAll('.chip[data-status]').forEach((c) => {
        c.onclick = () => {
            const v = c.dataset.status;
            runsState.status = runsState.status === v ? null : (v || null);
            renderRuns();
        };
    });
    body.querySelectorAll('.chip[data-model]').forEach((c) => {
        c.onclick = () => {
            const v = c.dataset.model;
            runsState.model = runsState.model === v ? null : (v || null);
            renderRuns();
        };
    });

    renderSavedFilters($('runy-saved'), 'runy', {
        onApply: (state) => {
            const s = state || {};
            runsState.status = s.status || null;
            runsState.model = s.model || null;
            /* Nasadenie filtra je viditeľná zmena plochy, takže sa NEHLÁSI —
               politika notifikácií tejto vlny. Zlyhanie dopytu ohlási `renderRuns()`
               svojím chybovým stavom. */
            renderRuns();
        },
        current: currentFilter,
    });

    if (!runsState.items.length) {
        /* Prázdno z filtra, nie `.rec-empty` z `renderTable()`: „tvoj filter to
           skryl" je iná správa než „zatiaľ žiadne záznamy" a má mať svoju jedinú
           akciu. Tú `renderTable()` ponúknuť nevie a ani nemá — je to komponent
           tabuľky, nie stavov plochy. */
        $('runy-table').innerHTML = emptyFiltered();
    } else {
        const columns = runColumns();
        renderTable($('runy-table'), columns, {
            /* `d.items` V PORADÍ ZO SERVERA. `sortRows()` tu ZÁMERNE nie je —
               dôvod je v hlavičke súboru: druhé radenie nad tým istým poľom by
               bolo druhý zdroj pravdy a pri `status` by dalo iné poradie, než
               hlási hlavička. */
            rows: runsState.items,
            sortKey: runsState.sortKey,
            sortDir: runsState.sortDir,
            onSort: sortBy,
            onOpen: openRun,
            openId: recOpenId('runy'),
            idKey: 'uuid',
            caption: 'Log behov konzoly',
        });
        renderMore();
    }

    /* Akcia prázdneho stavu z filtra. Tlačidlo tam je len vtedy, keď filter
       naozaj skrýva dáta: `pruneRunFilters()` vyššie zhodil stav bez počtu aj
       model, ktorý v ponuke nie je, takže čo prežilo, je platné. */
    const clearFilter = body.querySelector('.empty-act[data-act="clear-filter"]');
    if (clearFilter) {
        clearFilter.onclick = () => {
            runsState.status = null;
            runsState.model = null;
            renderRuns();
        };
    }
}

/* ---------- stĺpce ----------

   Poradie: Stav · Zadanie · Kedy · Model · Profil · Tokeny · Trvanie.
   Zadanie je HLAVNÝ IDENTIFIKÁTOR riadka, preto stojí hneď za stavom a je to
   jediný stĺpec bez `width` — pri `table-layout: fixed` mu tak pripadne celý
   zvyšok šírky. Keby stálo za číslami, čítalo by sa poslednou a riadok by sa
   identifikoval podľa modelu, teda podľa hodnoty, ktorú má polovica riadkov
   spoločnú.

   ŠÍRKY SÚ V PERCENTÁCH, nie v `rem`, a je to zaplatené meraním: pri `9rem + …`
   dal súčet 656 px a v 502 px širokom obsahu (rail rozbalený, úzke okno) zostalo
   na Zadanie **0 px** — hlavný identifikátor riadka zmizol celý. Percentá sa
   zmenšujú spolu s tabuľkou, takže zvyšok pre Zadanie je vždy 40 % šírky, nikdy
   nula. Dôsledok, s ktorým treba počítať: na úzkej ploche sa režú aj chrómové
   stĺpce, preto nesú `title`.

   `sortValue` TU UŽ NIE JE ani na jednom stĺpci a je to dôsledok serverového
   radenia, nie opomenutie: `sortRows()` sa nevolá, takže funkcia, ktorá by mu
   dodala porovnateľnú hodnotu, by bola mŕtvy kód. Práve preto, že sa zobrazené
   hodnoty porovnať nedajú („2 min" vs „45 s", „pred 3 d" bez dátumu), musí radiť
   ten, kto má surové čísla — teda `ORDER BY` nad celou tabuľkou.

   `sortable: false` je na `prompt` a `tool_profile`: `RunsScreen::SORTS` ich
   nemá, takže hlavička-tlačidlo by poslala `sort`, ktorý server odmietne (422 na
   ceste HTTP), a klientske dorovnanie by radilo len okno. */
function runColumns() {
    return [
        {
            key: 'status', label: 'Stav', width: '14%',
            cell: (r) => {
                const w = STATUS_LABEL[r.status] || r.status;
                return '<span class="badge" data-status="' + esc(r.status) + '" title="' + esc(w) + '">'
                    + esc(w) + '</span>';
            },
        },
        {
            key: 'prompt', label: 'Zadanie', sortable: false,
            /* `title` nesie ten istý text ako cela. Nie je to zdvojenie: cela sa
               reže s výpustkou (`.rec-table td` je nowrap + overflow hidden),
               takže bez `title` sa dlhšie zadanie nedá prečítať bez otvorenia
               panelu. Krátené je už zo servera na 160 znakov — obe plochy tak
               vidia ten istý text. */
            cell: (r) => {
                const p = plainInline(r.prompt || '(bez zadania)');
                return '<span title="' + esc(p) + '">' + esc(p) + '</span>';
            },
        },
        {
            key: 'started_at', label: 'Kedy', width: '8%',
            cell: (r) => {
                const when = timeAgo(r.started_at);
                if (!when) return '—';
                return '<span title="' + esc(whenTitle(r)) + '">' + esc(when) + '</span>';
            },
            /* Bez `sortValue`: chronologicky radí `ORDER BY started_at` na serveri,
               teda nad hodnotou v DB. Bývalá klientska cesta musela ISO najprv
               normalizovať na UTC (offset `+02:00` v lete vs `+01:00` v zime robí
               z abecedného poradia náhodu na hranici DST) — v SQL ten problém
               neexistuje, stĺpec je timestamp, nie text. */
        },
        {
            key: 'model', label: 'Model', width: '13%',
            cell: (r) => (r.model ? '<span title="' + esc(r.model) + '">' + esc(r.model) + '</span>' : '—'),
        },
        {
            // Profil nástrojov, s ktorým beh bežal (memory/files/graph/full). `null`
            // = beh z čias pred profilmi. Radiť sa podľa neho nedá: v serverovom
            // whiteliste nie je, a klientske radenie okna by tu bolo jediný stĺpec,
            // ktorý hovorí o inej množine než ostatné (viď hlavička súboru).
            key: 'tool_profile', label: 'Profil', width: '8%', sortable: false,
            cell: (r) => (r.tool_profile ? esc(r.tool_profile) : '—'),
        },
        {
            key: 'tokens_out', label: 'Tokeny', kind: 'num', width: '8%',
            cell: (r) => (r.tokens_out == null ? '—' : esc(fmtNum(r.tokens_out))),
        },
        {
            /* Trvanie je wall clock (obsahuje čas, kým sa človek rozhodoval o zápise),
               kým `tokens_per_second` je z generovacieho času. Sú to dva rôzne údaje
               a ani jeden nie je chyba — do tabuľky ide len trvanie, tok/s je v paneli
               vedľa ostatnej ceny behu a pomenovaný inak. */
            key: 'duration_ms', label: 'Trvanie', kind: 'num', width: '9%',
            cell: (r) => (r.duration_ms == null ? '—' : esc(dur(r.duration_ms))),
        },
    ];
}

/* Prvý klik na stĺpec: čísla a čas ZOSTUPNE, text vzostupne. Najdrahší beh
   a najnovší beh sú to, čo človek hľadá; „najstarší" chce až druhým klikom.

   `renderRuns()`, nie `renderRunsView()`: klik na hlavičku je odteraz NOVÝ DOPYT
   (`?sort=&dir=`), pretože radiť treba celú tabuľku, nie okno, ktoré už tu je.
   Zaplatené meraním 1. 9. 2026: pri `limit=3` dá klientske radenie okna prvý
   riadok 402 000 ms, serverové 1 000 000 ms — a druhé je naozaj najdlhší beh.

   Kľúč, ktorý server nepozná, sem nedôjde: hlavička takého stĺpca nie je
   tlačidlo (`sortable: false`). Stráž je tu aj tak — `onSort` chodí z `table.js`,
   teda z komponentu, ktorý o whiteliste nevie nič. */
function sortBy(key) {
    if (!SERVER_SORTS.includes(key)) return;
    if (runsState.sortKey === key) {
        runsState.sortDir = runsState.sortDir === ASC ? DESC : ASC;
    } else {
        const col = runColumns().find((c) => c.key === key) || {};
        runsState.sortKey = key;
        runsState.sortDir = (col.kind === 'num' || key === 'started_at') ? DESC : ASC;
    }
    /* `limit` sa NERESETUJE: dolistovaná dĺžka okna je poloha v zozname a tú klik
       na hlavičku nemení — kto si vyžiadal 150 riadkov, dostane 150 riadkov
       v novom poradí (jeden dopyt, `ORDER BY … LIMIT 150`). Zmenšiť okno na 50 by
       vyzeralo, akoby radenie časť riadkov zahodilo. Ten istý idióm majú
       filtračné čipy — tie `limit` tiež nechávajú stáť. */
    renderRuns();
}

/* „Ďalších 50" (G3).

   Celkový počet je odteraz `filtered_total` zo servera — počet riadkov PO filtri
   nad celou tabuľkou. Do 1. 9. 2026 sa musel hádať z `counts` (tie sú nad celou
   tabuľkou BEZ filtrov), takže pri filtri podľa modelu sa priznanie počtu
   NEKRESLILO vôbec: mlčať bolo lepšie než ukázať číslo pre inú množinu. Zmerané
   po zmene: `?model=qwen3:8b` → items 6, `filtered_total` 6, `counts.total` 13 —
   „6 z 6" je pravda, „6 z 13" by bola lož a to bol presne ten dôvod mlčať.

   `counts` zostávajú v čipoch a je to správne: tam nesú „koľko behov v tomto
   stave existuje", teda ponuku filtra, nie veľkosť aktuálneho výberu.

   Nad serverovým stropom (200) sa nekreslí nič — tlačidlo, ktoré nemôže
   priniesť ďalší riadok, je horšie než jeho absencia; ďalej sa dostane už len
   filtrom. */
function renderMore() {
    const box = $('runy-more');
    if (!box) return;
    box.innerHTML = '';
    const total = knownTotal();
    if (total == null) return;
    const shown = runsState.items.length;
    if (shown < total && shown >= LIMIT_MAX) return;
    moreRow(box, shown, total, () => {
        runsState.limit = Math.min(LIMIT_MAX, (runsState.limit || LIMIT_STEP) + LIMIT_STEP);
        renderRuns();
    });
}

/**
 * Celkový počet riadkov filtru, alebo `null` = server ho nepovedal.
 *
 * Fallback na `counts` je pre STARŠIU ODPOVEĎ (nasadenie, kde `/api/runs`
 * `filtered_total` ešte neposiela) a drží presne tú starú disciplínu: bez filtra
 * `counts.total`, pri filtri podľa stavu `counts[status]`, pri filtri podľa
 * modelu `null`. Nie je to druhá pravda — je to tá istá otázka zodpovedaná
 * horším zdrojom, keď lepší chýba.
 */
function knownTotal() {
    if (typeof runsState.filteredTotal === 'number') return runsState.filteredTotal;
    const c = runsState.counts || {};
    if (runsState.model) return null;
    if (runsState.status) return typeof c[runsState.status] === 'number' ? c[runsState.status] : null;
    return typeof c.total === 'number' ? c.total : null;
}

/* Uložený filter (G2). Meno si filter nesie sám — poskladané z aktívnych filtrov
   („beží · qwen3:8b"), pretože meno vymyslené z obsahu je presnejšie než meno
   napísané rukou o týždeň neskôr. `null` = nie je čo uložiť; ukladať „všetko"
   nemá zmysel, to je stav bez filtra.

   Do stavu ide `status` a `model`, NIE `limit` ani triedenie: filter je to, čo
   sa pýtam servera. Koľko riadkov som si dolistoval a podľa čoho som ich zoradil,
   je poloha v zozname, nie pohľad na dáta. */
function currentFilter() {
    const bits = [];
    if (runsState.status) bits.push(STATUS_LABEL[runsState.status] || runsState.status);
    if (runsState.model) bits.push(runsState.model);
    if (!bits.length) return null;
    return { name: bits.join(' · '), state: { status: runsState.status, model: runsState.model } };
}

function filtersHtml() {
    const c = runsState.counts;
    const total = c.total || 0;
    let out = '<div class="dtl-filter">';
    out += chip('Všetky', !runsState.status, 'data-status=""', total);

    STATUS_ORDER.forEach((s) => {
        if (!c[s]) return;
        out += chip(STATUS_LABEL[s], runsState.status === s, 'data-status="' + s + '"', c[s]);
    });
    out += '</div>';

    // Ponuka modelov má zmysel len keď je z čoho vyberať.
    if (runsState.models.length > 1) {
        out += '<div class="dtl-filter">';
        out += chip('Každý model', !runsState.model, 'data-model=""');
        runsState.models.forEach((m) => {
            out += chip(m, runsState.model === m, 'data-model="' + esc(m) + '"');
        });
        out += '</div>';
    }
    return out;
}

/* `aria-pressed` je povinné: čip je prepínač a bez neho nesie zapnutý stav LEN
   farba, takže čítačka o filtri nevie nič. `#legend-areas` to v tomto projekte
   robí správne už dnes — tu to bolo opomenutie. */
function chip(label, active, attrs, n) {
    return '<button type="button" class="chip' + (active ? ' active' : '') + '"'
        + ' aria-pressed="' + (active ? 'true' : 'false') + '" ' + attrs + '>'
        + esc(label)
        + (n != null ? '<span class="chip-n">' + fmtNum(n) + '</span>' : '')
        + '</button>';
}

/* Prázdno z filtra, nie tichý riadok v tabuľke: „tvoj filter to skryl" je iná
   správa než „nič tu nie je" a jej jediná akcia je zrušiť filter.

   `filterEmptyHtml` (reťazec) a nie `renderFilterEmpty`: listener sa pripája
   v `renderRunsView()`, spolu s ostatnými — podľa `data-act="clear-filter"`. */
function emptyFiltered() {
    return filterEmptyHtml('Tomuto filtru neodpovedá žiadny beh.',
        'Zruš filter a uvidíš celý log behov.');
}

/** Popisok dňa je slovo, nie údaj — kľúč `day` prišiel zo servera. */
function dayLabel(day) {
    if (!day) return 'bez dátumu';
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    if (day === iso(today)) return 'dnes';
    const y = new Date(today.getTime() - 86400000);
    if (day === iso(y)) return 'včera';
    const [yy, mm, dd] = day.split('-');
    return +dd + '. ' + +mm + '. ' + yy;
}

/* Presný čas do `title` stĺpca Kedy. Relatívny čas („pred 3 d") je v tabuľke
   čitateľnejší, ale sám neodpovie na otázku „ktorý deň to bolo" — a odkedy tabuľka
   nahradila hlavičky dní, nikde inde na obrazovke deň nie je. Deň berieme zo
   serverového kľúča `day` (hranicu určuje zóna servera), hodinu z `started_at`. */
function whenTitle(r) {
    if (!r.started_at) return dayLabel(r.day);
    const t = new Date(r.started_at).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' });
    return dayLabel(r.day) + ', ' + t;
}

/* RIADOK TABUĽKY NIE JE TLAČIDLO a nesmie ním byť — je to ten istý dôvod, ktorý
   tu do 28. 8. 2026 stál nad kartou behu.

   Karta bola `role="button" tabindex="0"` a bola to chyba v návrhu, nie preklep:
   vnorené `<button>` a `<a>` sú vnútri `role="button"` neplatné a prístupné meno
   karty vyšlo na 778 znakov — obsahovalo celý diff aj JSON argumentov, takže
   čítačka namiesto „otvoriť beh" prečítala celý obsah karty.

   Prechod na tabuľku ten dôvod nezrušil, len presunul. Riadok je `<tr>`, ktorému
   `table.js` dáva `tabindex` a obsluhu Enter/Space, ale ŽIADNU `role` — čítačka
   ho číta ako riadok tabuľky, teda „stĺpec Stav, riadok 3", a jeho prístupné meno
   je obsah ciel. Preto v riadku nie je ani diff, ani argumenty toolu, ani výsledok:
   všetko dlhé žije v paneli. Najdlhšia cela je Zadanie a to je krátené SERVEROM
   na 160 znakov, takže meno riadka má strop, ktorý sa nedá prekročiť obsahom behu.

   Panel je jediná dlhá plocha a má vlastné meno („Detail: <zadanie>"), ktoré mu
   dáva `openRecPanel` z `title` nižšie — krátené na 70 znakov, nie na 778. */
function openRun(r) {
    /* Druhý klik na otvorený riadok zatvára. Panel má vlastný krížik aj Esc,
       takže to nie je jediná cesta von — ale riadok nesie `aria-current="true"`,
       takže je to cesta, ktorú človek na tom mieste hľadá. */
    if (recOpenId('runy') === r.uuid) {
        closeRecPanel();
        markOpenRow(null);
        return;
    }

    const detail = runsState.details.get(r.uuid);
    openRecPanel({
        ns: 'runy',
        id: r.uuid,
        urlKey: 'ruo',
        title: clipLabel(plainInline(r.prompt || '(bez zadania)')),
        html: runPanelHtml(r, detail),
    });
    wireRunPanel();
    markOpenRow(r.uuid);
    if (!detail) loadRunDetail(r.uuid);
}

/* Zvýraznenie otvoreného riadka sa mení NA MIESTE, nie prekreslením tabuľky.
   `renderTable()` prepíše `innerHTML`, takže by kliknutý riadok zmizol z DOM —
   a `recpanel.js` si pri otvorení odložil `document.activeElement`, aby po zavretí
   vrátil fokus. Odložený odpojený `<tr>` má `isConnected === false`, takže by sa
   fokus po Esc nevrátil nikam a Tab by začínal od začiatku dokumentu.

   Riadok sa hľadá porovnaním `dataset`, nie selektorom: `CSS.escape` uvnútri
   uvedzovkovej hodnoty atribútu uuid začínajúce číslicou (`01a024b7-…`) zakóduje
   na `\30 1a024b7…` a selektor prestane nachádzať čokoľvek. */
/* Zrkadlo zvýraznenia riadka nad zavretím panelu.

   Panel sa zatvára aj cestami, o ktorých táto obrazovka nevie: jeho vlastný
   krížik, Esc obslúžený v `recpanel.js` a `dropRecPanel()` pri zmene obrazovky.
   Bez notifikácie zostal po Escu riadok s `aria-current="true"` a s akcentovým
   pruhom — čítačka aj oko by tvrdili, že detail je otvorený, hoci nie je
   (zmerané pred opravou: 1 riadok s `aria-current` pri zavretom paneli).

   Do 28. 8. 2026 to držal `MutationObserver` nad triedou panelu. Fungoval, ale
   sledoval DÔSLEDOK (či je panel vidieť) namiesto UDALOSTI, a druhý panel by si
   ten observer musel napísať znova — preto `recpanel.js` odteraz ohlasuje
   zavretie sám a obrazovka si len povie, čo pri ňom urobí.

   Registruje sa RAZ: druhá registrácia by tú prvú prepísala (`Map` podľa menného
   priestoru), takže opakovaný `wireRuns()` nič nepokazí — ale zbytočne. */
let mirrorWired = false;

function wirePanelMirror() {
    if (mirrorWired) return;
    mirrorWired = true;
    onRecPanelClose('runy', () => {
        // Prepnutie obrazovky panel tiež zatvára; vtedy už tabuľka Runov nie je
        // na obrazovke a jej prekreslenie by bolo práca do prázdna.
        if (document.body.dataset.screen !== 'runy') return;
        markOpenRow(null);
    });
}

function markOpenRow(uuid) {
    const table = $('runy-table');
    if (!table) return;
    table.querySelectorAll('.rec-row[data-rec]').forEach((tr) => {
        const on = uuid != null && tr.dataset.rec === uuid;
        tr.classList.toggle('open', on);
        if (on) tr.setAttribute('aria-current', 'true');
        else tr.removeAttribute('aria-current');
    });
}

/** Meno panelu má povedať, ČO otvoril — nie prečítať celý beh. */
function clipLabel(text) {
    return text.length > 70 ? text.slice(0, 69) + '…' : text;
}

/* ---------- telo pravého panelu ----------

   Panel nesie to, čo sa do riadka tabuľky nezmestilo, a to nie je len časová os
   krokov: `steps`, `tool_calls`, `tok/s` a chybová správa behu boli v karte
   a v tabuľke stĺpec nemajú. Keby zostali len tam, človek by po prechode na
   tabuľku videl MENEJ než AI (`mind_runs` ich posiela) — a to je presne ten
   rozchod plôch, ktorý má šprint rušiť, len obrátený. */
function runPanelHtml(r, detail) {
    const prompt = plainInline(r.prompt || '(bez zadania)');

    let out = '<div class="run-head">'
        + '<span class="badge" data-status="' + esc(r.status) + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span>'
        + '<span class="run-when">' + esc(timeAgo(r.started_at)) + '</span>'
        + (r.model ? '<span class="run-model">' + esc(r.model) + '</span>' : '')
        + (r.tool_profile ? '<span class="run-profile">' + esc(r.tool_profile) + '</span>' : '')
        + '</div>';

    out += '<p class="run-prompt">' + esc(prompt) + '</p>';
    out += costHtml(r);
    if (r.error) out += '<p class="run-error">' + esc(r.error) + '</p>';
    out += detailHtml(r, detail);
    return out;
}

/* Cena behu. Trvanie je wall clock (obsahuje čas, kým sa človek rozhodoval
   o zápise), tok/s je počítané z generovacieho času správ — sú to dva rôzne
   údaje a ani jeden nie je chyba. Preto sú vedľa seba a pomenované inak. */
function costHtml(r) {
    const bits = [];
    if (r.steps) bits.push(metric(r.steps, plural(r.steps, 'krok', 'kroky', 'krokov')));
    if (r.tool_calls) bits.push(metric(r.tool_calls, plural(r.tool_calls, 'tool', 'tooly', 'toolov')));
    if (r.tokens_out) bits.push(metric(fmtNum(r.tokens_out), plural(r.tokens_out, 'token', 'tokeny', 'tokenov')));
    if (r.tokens_per_second) bits.push(metric(r.tokens_per_second, 'tok/s'));
    if (r.duration_ms) bits.push(metric(dur(r.duration_ms), 'celkom'));
    if (!bits.length) return '';
    return '<div class="run-cost">' + bits.join('') + '</div>';
}

/* Slovenčina má TRI tvary, nie dva: 1 krok, 2-4 kroky, 5+ krokov. Binárne
   jednotné/množné číslo dá „3 krokov", čo je viditeľne zlé v každom riadku
   tabuľky — a UI texty sú slovenské, takže to nie je detail. */
function plural(n, one, few, many) {
    const abs = Math.abs(Math.round(n));
    if (abs === 1) return one;
    return abs >= 2 && abs <= 4 ? few : many;
}

function metric(value, unit) {
    return '<span class="run-metric"><b>' + esc(String(value)) + '</b> ' + esc(unit) + '</span>';
}

/* Nedeliteľná medzera medzi číslom a jednotkou je pravidlo, nie ozdoba: „2 min
   45 s" sa v stĺpci Trvanie nesmie zlomiť po čísle. */
function dur(ms) {
    if (ms < 1000) return ms + ' ms';
    const s = ms / 1000;
    if (s < 60) return (s < 10 ? s.toFixed(1) : Math.round(s)) + ' s';
    const m = Math.floor(s / 60);
    return m + ' min ' + Math.round(s - m * 60) + ' s';
}

/* Priebeh behu. `role="region"` a `aria-label` tu už NIE SÚ a je to správne:
   region je odteraz celý `#rec-panel`, ktorý si meno dopisuje z `title` záznamu
   („Detail: <zadanie>"). Druhý pojmenovaný region vnútri prvého by v zozname
   orientačných bodov len zdvojil ten istý obsah. */
function detailHtml(r, detail) {
    /* Načítavanie sa NEKRESLÍ ako prázdno. `emptyCardHtml` tu kedysi tvrdil, že
       v detaile nič nie je, hoci sa práve doťahoval — a text bol navyše v prvej
       osobe. Dýchajúci znak (nie skeleton): detail behu je rôzne dlhý zoznam
       krokov, takže nemá tvar, ktorý sa dá predkresliť. */
    if (!detail) return '<div class="run-detail">' + loadingHtml('Načítava sa beh…') + '</div>';

    let out = '<div class="run-detail">';

    if (r.stop_reason) {
        out += '<p class="run-stop">Ukončené: <b>' + esc(r.stop_reason) + '</b></p>';
    }

    out += '<ol class="run-steps">';
    (detail.timeline || []).forEach((e) => {
        out += e.kind === 'tool' ? toolStepHtml(e) : messageStepHtml(e);
    });
    out += '</ol>';

    out += '<div class="run-actions">';
    if (detail.thread) {
        out += '<a class="ghost" href="/console/' + esc(detail.thread) + '">Otvoriť vlákno</a>';
    }
    out += '<button type="button" class="ghost" data-rerun="' + esc(r.uuid) + '">Spustiť znovu</button>';
    out += '</div>';

    return out + '</div>';
}

/* Akcie panelu sa napájajú po KAŽDOM zápise do jeho tela — teda aj po
   `updateRecPanel()`. Telo je `innerHTML`, takže dobehnutý detail zahodí staré
   prvky aj s ich `onclick`om; bez druhého napojenia by „Spustiť znovu" fungovalo
   len pri behu, ktorý bol v cache. */
function wireRunPanel() {
    const box = $('rec-panel-body');
    if (!box) return;
    box.querySelectorAll('button[data-rerun]').forEach((b) => {
        b.onclick = () => rerun(b.dataset.rerun, b);
    });
}

function messageStepHtml(e) {
    const who = e.role === 'user' ? 'ty' : 'Charón';
    return '<li class="run-step" data-kind="message" data-role="' + esc(e.role) + '">'
        + '<span class="run-step-who">' + esc(who) + '</span>'
        + '<div class="run-step-text">' + esc(plainInline(e.text || '(bez textu)')) + '</div>'
        + '</li>';
}

/* Zamietnutý zápis je najdôležitejší záznam behu — preto má vlastný stav, nie
   len iný text. Náhľad (diff) sa ukazuje aj po zamietnutí: práve pri ňom človek
   najčastejšie chce vedieť, čo presne odmietol. */
function toolStepHtml(e) {
    const preview = e.preview || '';
    return '<li class="run-step" data-kind="tool" data-status="' + esc(e.status || '') + '">'
        + '<span class="run-step-who">' + esc(e.name || 'tool') + '</span>'
        + '<div class="run-step-text">'
        + '<span class="badge" data-status="' + esc(e.status || '') + '">' + esc(toolWord(e.status)) + '</span>'
        + (e.arguments ? '<code class="run-args">' + esc(JSON.stringify(e.arguments)) + '</code>' : '')
        + (e.error ? '<p class="run-error">' + esc(e.error) + '</p>' : '')
        + (preview ? '<pre class="run-diff">' + esc(preview) + '</pre>' : '')
        // Výsledok toolu serializér posiela obom plochám a platí za to strop 4000
        // znakov. Kým ho UI nekreslilo, človek videl MENEJ než AI — a to je presne
        // ten rozchod plôch, ktorý má tento šprint rušiť, len obrátený.
        + (e.result ? '<pre class="run-result">' + esc(e.result) + '</pre>' : '')
        + '</div>'
        + '</li>';
}

function toolWord(status) {
    return {
        done: 'vykonané', denied: 'zamietnuté', pending: 'čaká na rozhodnutie',
        failed: 'zlyhalo', running: 'beží',
    }[status] || (status || '—');
}

/* Dotiahnutie detailu je oddelené od `openRun()`, pretože panel má DVA spúšťače:
   klik na riadok a `ruo` z odkazu. Kópia tela fetchu v druhej ceste by znamenala
   dve miesta, kde sa cache `details` plní — a jedno z nich by sa raz prestalo
   držať strážcu „je ten beh ešte otvorený".

   Zlyhanie je TOAST s variantom `error`: dopočet nemá kde inde zlyhať viditeľne
   a panel by inak zostal navždy pri dýchajúcom znaku. Prázdna `timeline` v cache
   je zámerná — bez nej by každé prekreslenie skúšalo fetch znova. */
async function loadRunDetail(uuid) {
    if (runsState.details.has(uuid)) return;

    try {
        const d = await getJson('/api/runs/' + encodeURIComponent(uuid));
        runsState.details.set(uuid, d);
    } catch (e) {
        runsState.details.set(uuid, { timeline: [] });
        showToast('Detail behu sa nepodarilo načítať.', null, 'error');
    }
    // Kým dopočet bežal, človek mohol panel zavrieť alebo otvoriť iný beh.
    if (recOpenId('runy') !== uuid) return;
    const row = runsState.items.find((r) => r.uuid === uuid);
    if (!row) return;
    updateRecPanel(runPanelHtml(row, runsState.details.get(uuid)));
    wireRunPanel();
}

/* „Spustiť znovu" beh NESPÚŠŤA. Vyžiada si od servera zadanie, položí ho do
   schránky a otvorí vlákno — nový ťah tak ide bežnou cestou cez konzolu, teda
   cez dvojfázovú bránu. Druhá cesta k modelu, ktorá bránu obchádza, je presne to,
   čo tu nesmie vzniknúť; brána je jediné, čo stojí medzi lokálnym modelom a
   zápisom do pamäte. Predplnenie composera je jednoriadkový doplnok v konzole
   a zámerne tu naň nečakáme. */
async function rerun(uuid, btn) {
    btn.disabled = true;
    try {
        const res = await fetch('/api/runs/' + encodeURIComponent(uuid) + '/rerun', { method: 'POST' });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
            showToast(j.message || 'Beh sa nedá zopakovať.', null, 'warn');
            return;
        }
        try {
            await navigator.clipboard.writeText(j.prompt);
            showToast('Zadanie je v schránke, otváram vlákno.');
        } catch (e) {
            showToast('Vlákno otváram; zadanie skopíruj z detailu behu.', null, 'warn');
        }
        if (j.thread) window.location.href = '/console/' + j.thread;
    } finally {
        btn.disabled = false;
    }
}
