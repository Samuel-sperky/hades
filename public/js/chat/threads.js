/* ===========================================================================
   Chat — bočný panel: vlákna, projekty, hľadanie a export.

   ČO TENTO SÚBOR JE: obsah `#chat-thread-list` (zoznam vlákien, zložky
   projektov, výsledky hľadania) plus dve veci, ktoré do panela nesedia, ale
   patria k tej istej práci — odkaz na export v hlavičke a riadkové akcie.

   ČO TENTO SÚBOR NIE JE A NESMIE SA STAŤ: beh. Nepozná NDJSON, neposiela na
   `/api/console/run` ani na `/decide`. Vlákno otvára `loadThread()` z `./run.js`
   — teda tá istá cesta, akou ho otvára URL a `popstate`. Tri vstupy, jeden beh;
   druhý čítač histórie vlákna by bol druhá pravda o tom, čo v ňom je.

   DÁTA ZO SERVERA, SLOVÁ TU. Počty (`counts`), skupiny (`threads[]`,
   `projects[]`), zoradenie, kľúč dňa (`day`) a krátenie útržku prichádzajú
   z `ChatScreen` — tento súbor ich NEDOPOČÍTAVA. Popisok „dnes/včera", formát
   času, skloňovanie a text tlačidla sú slová a robia sa tu. Je to to isté
   pravidlo, ktoré audit 19. 8. 2026 vynútil na šiestich miestach: čip, ktorý si
   číslo dopočíta z načítanej stránky, sľubuje viac, než zoznam dá.

   KEĎ FETCH PADNE, PANEL TO POVIE. Žiadny prázdny zoznam namiesto chyby a
   žiadne zahodenie riadkov, ktoré už v paneli sú — staré vlákna sú stále platné
   odkazy a jedna neúspešná obnova z nich nerobí neplatné. Toto je pravidlo
   projektu, nie štýl.

   Všetko sú HOISTOVANÉ `export function`: graf modulov chatu je cyklický
   (`main → run → render`, a tento modul siaha do všetkých troch), a
   `export const foo = () => {}` v cykle spadne na `ReferenceError: Cannot
   access 'foo' before initialization`.

   IKONY sú z vlastnej sady `public/js/shared/icons.js` (inline SVG). Meno, ktoré
   sada nepozná, sa NEVYKRESLÍ ticho — `iconMarkup()` ho zapíše do
   `window.HADES._iconMiss` a nakreslí `ring`, takže chýbajúcu ikonu nájde merací
   harness, nie až používateľ. Meraním šírky glyfu sa už nič neoveruje: ligatúrový
   font je preč a s ním aj porucha, keď sa nevykreslená ikona ukázala ako svoje
   meno. Nasledujúci odsek o subsete je HISTÓRIA, nie dnešný stav:
   SÚ a nesmú sa tu objaviť — vykreslili by sa ako svoj ligatúrový názov.
   =========================================================================== */

import { el } from './render.js';
import { loadThread, request } from './run.js';
import { live, narrow, setPanel, syncPanelsToUrl } from './main.js';
/* Query string. `mind/urlstate.js` je JEDINÉ miesto v repe, ktoré ho číta aj
   píše (rozhodnutie 31); je to čistý modul nad `URLSearchParams` bez importu
   z `mind/`, takže `/chat` ním nestiahne graf. Debounce filtrov (220 ms) drží
   on sám — odtiaľto sa nedebouncuje druhý raz. */
import { urlValue, writeUrl } from '../mind/urlstate.js';
/* Slovník prázdnych stavov (`.empty` / `--error` / `--filter`). Kresba je
   v `mind.css`, ktorý sa na `/chat` načítava prvý; `./empty.js` skládá len
   markup, ktorý tá kresba pozná. `mind/util.js` sa importovať NEDÁ — ťahá celý
   graf, viď hlavička `empty.js`. */
import { emptyBlock, errorBlock, filterBlock } from './empty.js';
/* Obálka natívneho `<select>` so strieškou. Kresbu nesie `chat.css`; tu ide
   o štruktúru, ktorú `appearance: none` potrebuje a `select::after` nedá. */
import { dressSelect } from './selects.js';
import { iconMarkup, iconSvg } from '../shared/icons.js';

/* ---------------------------------------------------------------------------
   STAV

   Jedno vrecko, nie premenné rozsypané po súbore. Kreslenie je funkcia stavu:
   `paint()` prekreslí panel z `T` a nič si nepamätá v DOM. Výnimka je otvorený
   blok akcií riadku — ten sa prepína priamo na elemente (viď `actsToggle()`),
   pretože prekreslenie celého panela by pod rukou zhaslo fokus.
   --------------------------------------------------------------------------- */

const T = {
    /** Vlákna z `/api/console/threads` (najnovšie prvé, strop 100 na serveri). */
    threads: [],
    threadsState: 'idle',
    threadsError: '',

    /** Projekty z `/api/console/projects` — vrátane archivovaných, tie sú označené. */
    projects: [],
    projectsState: 'idle',
    projectsError: '',

    /** Vlákna projektu, načítané až pri rozbalení: uuid → { state, items }. */
    open: new Map(),

    /** uuid otvoreného vlákna — riadok ho nesie ako `aria-current`. */
    current: '',

    /** Rozpísaný dopyt. Kratší než `MIN_QUERY` znamená „nehľadá sa". */
    query: '',

    /** Filtre hľadania. `thread` / `project` sa nastavujú klikom na skupinu. */
    filters: { role: '', from: '', to: '', thread: '', project: '' },

    /** Strop výsledkov. Rastie tlačidlom, nikdy nad server `MAX_LIMIT`. */
    limit: 30,

    /** Odpoveď hľadania: { state, data, error }. */
    search: { state: 'idle', data: null, error: '' },

    /** Rozpísané premenovanie: { kind: 'thread'|'project', uuid, value }. */
    renaming: null,

    /** Zakladá sa nový projekt? Inline formulár v hlavičke sekcie. */
    newProject: false,
};

/** Ten istý strop ako `ChatScreen::MIN_QUERY` na serveri — kratší dopyt nájde všetko. */
const MIN_QUERY = 2;

/** `ChatScreen::MAX_LIMIT`. Nad tento strop server dopyt aj tak zreže. */
const MAX_LIMIT = 100;

/** Prírastok tlačidla „Zobraziť viac". Je to zároveň DEFAULT stropu, teda hodnota,
    ktorá sa z adresy vynecháva (`hl`). */
const LIMIT_STEP = 30;

/* Role, ktoré hľadanie pozná. Zoznam je tu preto, aby `?hr=` z cudzieho odkazu
   nemohlo nastaviť filter, ktorý server nepozná — orezaná pravda sa potom zapíše
   späť do adresy (viď `bootSearchFromUrl`). */
const ROLES = ['user', 'assistant'];

/* Krátke kľúče hľadania zo kanonického slovníka (`docs/BRAND-HADES.md` §10).
   `q` je zdieľaný kľúč voľného textu — na `/chat` znamená „hľadaj v histórii",
   na obrazovkách grafu niečo iné, a rozhoduje o tom kľúč `s`, ktorý `/chat` nemá. */
const URL_FILTER = { role: 'hr', from: 'ha', to: 'hb', thread: 'hn', project: 'hp' };

/** Prebehla už inicializácia? `bootThreads()` je idempotentné. */
let booted = false;

/* Sú listenery pripojené? `wireThreadsPanel()` sa volá DVAKRÁT — raz z `boot()`
   kostry, raz z `bootThreads()`. Obe cesty sú zámerné (poradie drôtovania nesmie
   rozhodovať), ale bez tejto stráže má každý listener dvojníka a jedna udalosť
   `chat:thread` znamená dve prekreslenia panela. */
let wired = false;

/** Časovač debounce hľadania. */
let findTimer = 0;

/** Časovač debounce obnovy zoznamu (beh sa vlákna dotkne po každom ťahu). */
let refreshTimer = 0;

/**
 * `AbortController` rozbehnutého hľadania.
 *
 * Bez neho platí odpoveď, ktorá dorazí posledná, a nie tá, ktorá patrí k tomu,
 * čo je v poli napísané: dopyt „vet" a „vetva" idú na server v tomto poradí,
 * ale vrátiť sa môžu v opačnom.
 */
let finding = null;

/* ---------------------------------------------------------------------------
   HTTP

   Tenká vrstva nad `request()` z `./run.js` — CSRF hlavička, 401/419 do toku
   správ. Vlastný `fetch` by bol druhá kópia tej istej hlavičky a tretia cesta
   k internému API.

   `json()` z `run.js` sa tu ZÁMERNE nepoužíva: on hlási každú chybu do toku
   konverzácie, čo je správne pre beh a nesprávne pre panel. Zlyhané načítanie
   zoznamu vlákien nie je udalosť konverzácie a patrí do panela, kde človek
   vidí, čoho sa týka.
   --------------------------------------------------------------------------- */

/**
 * Request, ktorý nikdy nevyhodí. Vracia `{ ok, status, data, message }`;
 * `message` je slovenská veta zo servera (validátory kontrolérov ju posielajú),
 * alebo prázdny reťazec.
 */
export async function api(url, opts) {
    try {
        const res = await request(url, opts);
        let data = null;

        try {
            data = await res.json();
        } catch {
            // 500 vracia HTML, 204 nevracia nič. Telo nie je parser problém.
            data = null;
        }

        return {
            ok: res.ok,
            status: res.status,
            data,
            message: typeof data?.message === 'string' ? data.message : '',
        };
    } catch (error) {
        if (error?.name === 'AbortError') return { ok: false, status: 0, data: null, message: '', aborted: true };

        return { ok: false, status: 0, data: null, message: 'Hades neodpovedal.' };
    }
}

/** Veta o chybe pre panel. Stav sa uvádza — „nepodarilo sa" bez čísla sa nedá vyšetriť. */
export function errorLine(res, what) {
    if (res.message) return res.message;
    if (res.status === 0) return `${what} — Hades neodpovedal.`;

    return `${what} (HTTP ${res.status}).`;
}

/* ---------------------------------------------------------------------------
   SLOVÁ

   Formát času, skloňovanie a popisky. Nič z toho nepatrí na server: „dnes"
   závisí od hodín prehliadača, kľúč dňa (`day` v odpovedi) od zóny servera —
   a práve preto je kľúč dáta a popisok slovo.
   --------------------------------------------------------------------------- */

/** 1 → `one`, 2–4 → `few`, ostatné → `many`. */
export function plural(count, one, few, many) {
    if (count === 1) return one;

    return count >= 2 && count <= 4 ? few : many;
}

/** Deň ako slovo: „dnes", „včera", inak `23. 8.` (a s rokom, keď nie je tento). */
export function dayWord(date) {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diff = Math.round((midnight - day) / 86400000);

    if (diff === 0) return 'dnes';
    if (diff === 1) return 'včera';

    return date.toLocaleDateString('sk-SK', date.getFullYear() === now.getFullYear()
        ? { day: 'numeric', month: 'numeric' }
        : { day: 'numeric', month: 'numeric', year: 'numeric' });
}

/** Okamih v riadku: „dnes 14:20". Prázdny čas je „nezačaté", nie prázdno. */
export function whenLabel(iso) {
    if (!iso) return 'nezačaté';

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';

    const time = date.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' });

    return `${dayWord(date)} ${time}`;
}

/** Rola v útržku hľadania. Tie isté mená, aké nesú bubliny v toku. */
export function roleWord(role) {
    if (role === 'user') return 'Ty';

    return role === 'assistant' ? 'Hades' : String(role || '');
}

/* ---------------------------------------------------------------------------
   ČO SERVER VIE

   `GET /api/console/threads` dnes vracia `uuid, title, provider, model,
   auto_accept, last_message_at` — teda **bez** `pinned` / `archived` /
   `project`. Pripnutie a archiváciu vlákna preto panel NEPONÚKA: tlačidlo,
   ktoré pošle `PATCH {pinned:true}`, by dostalo 200 a neurobilo nič (validátor
   `ThreadController::update` ten kľúč nepozná a Laravel neznáme kľúče ticho
   zahodí). Tichý no-op je horší než chýbajúca funkcia.

   Detekcia je na tvare odpovede, nie na verzii: keď riadky prídu s kľúčom
   `pinned`, server ich vie aj zapísať a akcie sa objavia samé. Presný diff
   kontroléra je v odovzdávacej poznámke tejto vlny.

   Projektu sa to netýka — `ProjectController::update` `pinned` aj `archived`
   prijíma a panel ich používa.
   --------------------------------------------------------------------------- */

/** Nesie zoznam vlákien príznaky pripnutia a archivácie? */
export function supportsThreadFlags() {
    return T.threads.some((row) => row !== null && typeof row === 'object' && 'pinned' in row);
}

/* ---------------------------------------------------------------------------
   ČO SI SMIE PREČÍTAŤ NIEKTO INÝ

   `T` je súkromný a má zostať — panel je jediný, kto ho mení. Paleta Ctrl+K ale
   potrebuje TIE ISTÉ vlákna a projekty, a keby si ich načítala vlastným fetchom,
   plocha by mala dva zoznamy toho istého a jeden z nich by bol po každom
   premenovaní zastaraný.

   Preto snímka, nie referencia: `slice()` vráti nové pole, takže volajúci ho
   nemôže preradiť ani doplniť a stav panela zostane jeho. Riadky sú tie isté
   objekty (kopírovať ich hlboko by bola cena za nič) — čítať ich smie, meniť
   nie.
   --------------------------------------------------------------------------- */

/** @returns {Array<object>} vlákna tak, ako ich má panel. Nikdy `null`. */
export function threadsSnapshot() {
    return T.threads.slice();
}

/** @returns {Array<object>} projekty vrátane archivovaných (tie nesú `archived`). */
export function projectsSnapshot() {
    return T.projects.slice();
}

/**
 * Ohlási, že keš je nová.
 *
 * Paleta môže byť otvorená prv, než dobehne `bootThreads()` (Ctrl+K je rýchlejší
 * než dva fetchy), a bez tejto udalosti by v nej stálo „Nič sa nenašlo" nad
 * zoznamom, ktorý o sekundu existuje. Udalosť, nie priame volanie: panel nemá
 * vedieť, že paleta existuje — tá istá úvaha ako `chat:submit` v `main.js`.
 */
function announceCache() {
    document.dispatchEvent(new CustomEvent('chat:threads-loaded', {
        detail: { threads: T.threads.length, projects: T.projects.length },
    }));
}

/* ---------------------------------------------------------------------------
   NAČÍTANIE
   --------------------------------------------------------------------------- */

export async function loadThreads() {
    T.threadsState = 'loading';
    paint();

    const res = await api('/api/console/threads');

    if (!res.ok) {
        T.threadsState = 'error';
        T.threadsError = errorLine(res, 'Zoznam vlákien sa nepodarilo načítať');
        paint();

        return;
    }

    T.threads = Array.isArray(res.data?.threads) ? res.data.threads : [];
    T.threadsState = 'ready';
    T.threadsError = '';
    paint();
    announceCache();
}

export async function loadProjects() {
    T.projectsState = 'loading';
    paint();

    const res = await api('/api/console/projects');

    if (!res.ok) {
        T.projectsState = 'error';
        T.projectsError = errorLine(res, 'Projekty sa nepodarilo načítať');
        paint();

        return;
    }

    T.projects = Array.isArray(res.data?.projects) ? res.data.projects : [];
    T.projectsState = 'ready';
    T.projectsError = '';
    paint();
    announceCache();
}

/**
 * Vlákna jedného projektu — až pri rozbalení.
 *
 * Zoznam vlákien totiž príslušnosť k projektu nenesie, takže zložka nie je
 * filter nad načítaným poľom, ale vlastné čítanie (`GET /console/projects/{uuid}`).
 * Je to jeden request na rozbalenú zložku, nie na každú — a odpoveď má `pinned`
 * aj `archived`, takže vnútri zložky panel o vlákne vie viac než v plochom
 * zozname. To nie je nedôslednosť, to je rozdiel medzi dvoma endpointmi.
 */
export async function loadProjectThreads(uuid) {
    T.open.set(uuid, { state: 'loading', items: T.open.get(uuid)?.items || [] });
    paint();

    const res = await api(`/api/console/projects/${uuid}`);

    if (!res.ok) {
        T.open.set(uuid, {
            state: 'error',
            items: T.open.get(uuid)?.items || [],
            error: errorLine(res, 'Vlákna projektu sa nepodarilo načítať'),
        });
        paint();

        return;
    }

    T.open.set(uuid, { state: 'ready', items: Array.isArray(res.data?.threads) ? res.data.threads : [] });
    paint();
}

/* ---------------------------------------------------------------------------
   HĽADANIE

   Fulltext v histórii naprieč vláknami (`GET /api/console/search`). Skupiny,
   počty aj útržky skládá server; tu sa z nich robia vety.
   --------------------------------------------------------------------------- */

/**
 * Hľadanie do adresy — sedem kľúčov jedným zápisom.
 *
 * `replaceState`, nie `pushState`: hľadanie nie je navigácia (rozhodnutie 10).
 * Keby každý znak v poli pridal záznam, `Naspäť` by sa prehrýzalo dopytom
 * spätne namiesto toho, aby vrátilo vlákno, z ktorého človek prišiel.
 *
 * Kľúče popisujú BEŽIACE hľadanie, teda orezanú pravdu: čo `runSearch()` naozaj
 * poslal na server. Default (`hl` = 30) sa vynecháva — zahodí ho `urlstate.js`,
 * ale `null` sem píšem aj tak, aby zámer stál v tomto súbore.
 */
export function syncSearchUrl() {
    const term = T.query.trim();

    writeUrl({
        q: term.length >= MIN_QUERY ? T.query : null,
        [URL_FILTER.role]: T.filters.role || null,
        [URL_FILTER.from]: T.filters.from || null,
        [URL_FILTER.to]: T.filters.to || null,
        [URL_FILTER.thread]: T.filters.thread || null,
        [URL_FILTER.project]: T.filters.project || null,
        hl: T.limit === LIMIT_STEP ? null : String(T.limit),
    }, 'replace');
}

/**
 * Stav hľadania z adresy — a späť do adresy orezaný.
 *
 * Poradie je záväzné: **URL → stav → orez → `replaceState` orezanej pravdy.**
 * URL NESMIE vynucovať filter, ktorý plocha nepozná: `?hr=nieco` by inak zúžilo
 * dopyt na rolu, ktorú server nemá, a hľadanie by vracalo prázdno bez čipu,
 * ktorým sa to ruší. Neznáma hodnota sa preto zahodí a adresa sa skráti.
 *
 * Dopyt kratší než `MIN_QUERY` hľadanie NESPUSTÍ — je to ten istý strop ako na
 * serveri a jednoznakový `?q=` by bol plný sken `console_messages`.
 */
export function bootSearchFromUrl() {
    const role = urlValue(URL_FILTER.role);
    const limit = parseInt(urlValue('hl'), 10);

    T.query = urlValue('q') || '';
    T.filters.role = ROLES.includes(role) ? role : '';
    T.filters.from = isDay(urlValue(URL_FILTER.from));
    T.filters.to = isDay(urlValue(URL_FILTER.to));
    T.filters.thread = urlValue(URL_FILTER.thread) || '';
    T.filters.project = urlValue(URL_FILTER.project) || '';
    T.limit = Number.isFinite(limit)
        ? Math.min(MAX_LIMIT, Math.max(LIMIT_STEP, limit))
        : LIMIT_STEP;

    const field = document.getElementById('chat-search');
    if (field) field.value = T.query;

    if (T.query.trim().length >= MIN_QUERY) runSearch();
    else syncSearchUrl();
}

/** `YYYY-MM-DD`, alebo `''`. Iný text nie je dátum a do filtra sa nedostane. */
function isDay(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
}

export function onQuery(text) {
    T.query = String(text ?? '');
    T.limit = LIMIT_STEP;

    // Nový dopyt ruší filtre na konkrétne vlákno a projekt: sú to zúženia
    // PREDOŠLÉHO zásahu a nechať ich visieť by znamenalo, že nový dopyt vracia
    // prázdno bez viditeľného dôvodu.
    T.filters.thread = '';
    T.filters.project = '';

    clearTimeout(findTimer);

    if (T.query.trim().length < MIN_QUERY) {
        finding?.abort();
        finding = null;
        T.search = { state: 'idle', data: null, error: '' };
        // Zrušené hľadanie zmizne aj z adresy — a s ním všetky jeho zúženia.
        // Kľúče `q`/`hr`/`ha`/`hb`/`hn`/`hp`/`hl` popisujú BEŽIACE hľadanie;
        // filter visiaci v adrese bez dopytu by po obnove nezúžil nič a človek by
        // nemal čo odkliknúť. Je to to isté rozhodnutie, ktoré nižšie ruší
        // `thread`/`project` pri každom novom dopyte.
        syncSearchUrl();
        paint();

        return;
    }

    // 250 ms: pri písaní „vetvenie" by bez debounce odišlo osem dopytov a každý
    // z nich je plný sken `console_messages` (`LOWER(content) LIKE`).
    findTimer = setTimeout(runSearch, 250);
}

export async function runSearch() {
    const term = T.query.trim();
    if (term.length < MIN_QUERY) return;

    /* JEDINÉ miesto zápisu hľadania do adresy. Filtre, skupiny aj „Zobraziť viac"
       idú cez `runSearch()`, takže sa adresa nemôže rozísť s tým, čo išlo na
       server — a nie je to päť volajúcich, ktorí by sa museli pamätať. */
    syncSearchUrl();

    finding?.abort();
    finding = new AbortController();

    T.search = { state: 'loading', data: T.search.data, error: '' };
    paint();

    const params = new URLSearchParams({ q: term, limit: String(T.limit) });

    ['role', 'from', 'to', 'thread', 'project'].forEach((key) => {
        if (T.filters[key]) params.set(key, T.filters[key]);
    });

    const res = await api(`/api/console/search?${params.toString()}`, { signal: finding.signal });

    // Zrušený dopyt nie je chyba a nesmie prepísať stav novšieho hľadania.
    if (res.aborted) return;

    finding = null;

    if (!res.ok) {
        T.search = { state: 'error', data: null, error: errorLine(res, 'Hľadanie zlyhalo') };
        paint();

        return;
    }

    T.search = { state: 'ready', data: res.data, error: '' };
    paint();
}

/* ---------------------------------------------------------------------------
   AKCIE NAD VLÁKNOM
   --------------------------------------------------------------------------- */

export async function openThreadRow(uuid) {
    // Na úzkom okne je panel prekryv nad konverzáciou: nechať ho otvorený by
    // znamenalo, že po kliknutí na vlákno človek vidí zoznam, nie vlákno.
    if (narrow()) setPanel('threads', false);

    await loadThread(uuid);
}

export async function renameThread(uuid, title) {
    const value = String(title ?? '').trim();
    if (value === '') return;

    const res = await api(`/api/console/threads/${uuid}`, { method: 'PATCH', body: { title: value } });

    T.renaming = null;

    if (!res.ok) {
        T.threadsError = errorLine(res, 'Premenovanie sa neuložilo');
        paint();

        return;
    }

    T.threadsError = '';
    patchRow(uuid, { title: res.data?.title ?? value });
    live(`Vlákno sa teraz volá ${res.data?.title ?? value}.`);
    paint();
}

export async function deleteThread(uuid) {
    const res = await api(`/api/console/threads/${uuid}`, { method: 'DELETE' });

    if (!res.ok) {
        T.threadsError = errorLine(res, 'Vlákno sa nepodarilo zmazať');
        paint();

        return;
    }

    T.threadsError = '';
    T.threads = T.threads.filter((row) => row.uuid !== uuid);
    T.open.forEach((entry, key) => {
        T.open.set(key, { ...entry, items: (entry.items || []).filter((row) => row.uuid !== uuid) });
    });

    live('Vlákno je zmazané.');

    // Zmazané OTVORENÉ vlákno: adresa aj hlavička by ukazovali niečo, čo v DB
    // nie je. Vlákna sa nedomýšľajú — plocha ide na `/chat`, teda na prázdny
    // stav, ktorý si `run.js` vykreslí sám cez `popstate`.
    if (T.current === uuid) {
        T.current = '';
        history.pushState({}, '', '/chat');
        // Celá adresa sa prepísala, takže s vláknom odišel aj query string —
        // vrátane `pt`/`pa`, ktoré o vlákne nie sú. Rozloženie sa preto dopíše
        // späť (`replace`, teda bez druhého záznamu v histórii).
        syncPanelsToUrl();
        window.dispatchEvent(new PopStateEvent('popstate'));
    }

    // Počty projektov sa zmazaním vlákna hýbu — sú zo servera, takže sa musia
    // prečítať znova, nie odhadnúť odčítaním jednotky.
    loadProjects();
    paint();
}

/** Pripnutie a archivácia vlákna. Volá sa len keď to server vie (viď `supportsThreadFlags`). */
export async function setThreadFlag(uuid, key, value) {
    const res = await api(`/api/console/threads/${uuid}`, { method: 'PATCH', body: { [key]: value } });

    if (!res.ok) {
        T.threadsError = errorLine(res, 'Zmenu sa nepodarilo uložiť');
        paint();

        return;
    }

    T.threadsError = '';
    patchRow(uuid, { [key]: value });
    live(threadFlagWord(key, value));
    paint();
}

function threadFlagWord(key, value) {
    if (key === 'pinned') return value ? 'Vlákno je pripnuté.' : 'Vlákno už nie je pripnuté.';

    return value ? 'Vlákno je v archíve.' : 'Vlákno je späť v zozname.';
}

/** Zaradenie vlákna do projektu. `''` znamená vyradiť — a to je iná route. */
export async function moveThread(uuid, project, fromProject) {
    if (project === '' && fromProject) {
        const res = await api(`/api/console/projects/${fromProject}/threads/${uuid}`, { method: 'DELETE' });

        if (!res.ok) {
            T.threadsError = errorLine(res, 'Vlákno sa nepodarilo vyradiť z projektu');
            paint();

            return;
        }

        T.threadsError = '';
        live('Vlákno je mimo projektu.');
    } else if (project !== '') {
        const res = await api(`/api/console/projects/${project}/threads`, { method: 'POST', body: { thread: uuid } });

        if (!res.ok) {
            T.threadsError = errorLine(res, 'Vlákno sa nepodarilo zaradiť do projektu');
            paint();

            return;
        }

        T.threadsError = '';
        live(`Vlákno je v projekte ${T.projects.find((p) => p.uuid === project)?.name || ''}.`);
    } else {
        return;
    }

    // Zložky, ktoré sú rozbalené, o presune ešte nevedia; počty projektov tiež.
    await loadProjects();
    await Promise.all([...T.open.keys()].map((key) => loadProjectThreads(key)));
}

/* ---------------------------------------------------------------------------
   AKCIE NAD PROJEKTOM
   --------------------------------------------------------------------------- */

export async function createProject(name) {
    const value = String(name ?? '').trim();
    if (value === '') return;

    const res = await api('/api/console/projects', { method: 'POST', body: { name: value } });

    T.newProject = false;

    if (!res.ok) {
        T.projectsError = errorLine(res, 'Projekt sa nepodarilo založiť');
        paint();

        return;
    }

    live(`Projekt ${value} je založený.`);
    await loadProjects();
}

export async function patchProject(uuid, body, word) {
    const res = await api(`/api/console/projects/${uuid}`, { method: 'PATCH', body });

    T.renaming = null;

    if (!res.ok) {
        T.projectsError = errorLine(res, 'Zmenu projektu sa nepodarilo uložiť');
        paint();

        return;
    }

    if (word) live(word);
    await loadProjects();
}

/**
 * Zmazanie projektu. Vlákna prežijú (cudzí kľúč je `nullOnDelete`) — a text
 * tlačidla to musí povedať, inak človek zmaže zložku v presvedčení, že s ňou
 * maže konverzácie, alebo naopak.
 */
export async function deleteProject(uuid) {
    const res = await api(`/api/console/projects/${uuid}`, { method: 'DELETE' });

    if (!res.ok) {
        T.projectsError = errorLine(res, 'Projekt sa nepodarilo zmazať');
        paint();

        return;
    }

    T.open.delete(uuid);
    live('Projekt je zmazaný, vlákna zostali.');
    await loadProjects();
}

/** Prepnutie rozbalenia zložky. Prvé rozbalenie načíta jej vlákna. */
export function toggleProject(uuid) {
    if (T.open.has(uuid)) {
        T.open.delete(uuid);
        paint();

        return;
    }

    loadProjectThreads(uuid);
}

/* ---------------------------------------------------------------------------
   KRESLENIE

   Panel sa prekresľuje celý z `T`. Je to zoznam desiatok riadkov, nie tok
   správ — inkrementálne záplaty by tu kupovali výkon, ktorý nikto nemeria, za
   riziko, že sa DOM a stav rozídu.
   --------------------------------------------------------------------------- */

export function panelHost() {
    return document.getElementById('chat-thread-list');
}

export function paint() {
    const host = panelHost();
    if (!host) return;

    host.replaceChildren();
    host.setAttribute('aria-busy', busy() ? 'true' : 'false');

    if (T.query.trim().length >= MIN_QUERY) {
        host.append(searchView());
    } else {
        host.append(browseView());
    }

    focusRename(host);
}

function busy() {
    return T.threadsState === 'loading' || T.projectsState === 'loading' || T.search.state === 'loading';
}

/* ---------- prehliadanie ---------- */

function browseView() {
    const frag = document.createDocumentFragment();

    frag.append(projectsSection());
    frag.append(threadsSection());

    const archived = supportsThreadFlags() ? T.threads.filter((row) => row.archived) : [];
    const boxes = T.projects.filter((p) => p.archived);

    if (archived.length || boxes.length) frag.append(archiveSection(boxes, archived));

    return frag;
}

function section(title, actions) {
    const box = el('section', 'ct-sec');
    const head = el('div', 'ct-sec-head');

    head.append(el('h3', 'ct-sec-title', title));
    if (actions) head.append(actions);
    box.append(head);

    return box;
}

function projectsSection() {
    const add = iconButton('plus', 'Nový projekt');
    add.classList.add('ct-sec-act');
    add.addEventListener('click', () => {
        T.newProject = !T.newProject;
        paint();
    });

    const box = section('Projekty', add);

    if (T.newProject) box.append(inlineForm('Názov projektu', '', (value) => createProject(value), () => {
        T.newProject = false;
        paint();
    }));

    const shelves = T.projects.filter((p) => !p.archived);

    /* CHYBA MÁ DVA TVARY a rozhoduje o nich to, či je čo stratiť.
       Keď v zozname UŽ NIEČO JE, hlásenie ide VEDĽA riadkov (`errorNote`) —
       stará odpoveď je stále platný odkaz a jedna neúspešná obnova z nej
       neplatnú nerobí. Keď je zoznam prázdny, zlyhala celá PLOCHA sekcie a
       patrí jej `.empty--error` s predmetom a jednou akciou; „Žiadny projekt"
       by tam bola lož (projekty môžu existovať, len sa nepriniesli). */
    if (T.projectsError) {
        if (!shelves.length) {
            box.append(errorBlock('projekty', T.projectsState === 'error' ? loadProjects : null, T.projectsError));

            return box;
        }

        box.append(errorNote(T.projectsError, T.projectsState === 'error' ? loadProjects : null));
    }

    if (!shelves.length && T.projectsState === 'ready') {
        box.append(emptyBlock(
            'box',
            'Žiadny projekt',
            'Zložka je miesto, kam sa vlákna dajú odložiť podľa témy.',
        ));

        return box;
    }

    shelves.forEach((project) => box.append(projectRow(project)));

    return box;
}

function threadsSection() {
    const box = section('Vlákna');

    const rows = supportsThreadFlags() ? T.threads.filter((row) => !row.archived) : T.threads;

    // Jedno hlásenie, nie dve: zlyhané načítanie a zlyhaná akcia píšu do toho
    // istého poľa a „Skúsiť znova" má zmysel len pri načítaní. Tvar sa volí ako
    // pri projektoch — prázdny zoznam znamená, že zlyhala celá plocha sekcie.
    if (T.threadsError) {
        if (!rows.length) {
            box.append(errorBlock('vlákna', T.threadsState === 'error' ? loadThreads : null, T.threadsError));

            return box;
        }

        box.append(errorNote(T.threadsError, T.threadsState === 'error' ? loadThreads : null));
    }

    if (T.threadsState === 'loading' && !T.threads.length) box.append(note('Vlákna sa načítavajú…'));

    if (!rows.length) {
        if (T.threadsState === 'ready') {
            box.append(emptyBlock(
                'send',
                'Žiadne vlákna',
                'Konverzácia vznikne prvou správou — začni ju tlačidlom Nové vlákno.',
            ));
        }

        return box;
    }

    rows.forEach((row) => box.append(threadRow(row)));

    // Server posiela najnovších 100. Keby ich bolo viac, panel to musí povedať —
    // ticho zrezaný zoznam vyzerá ako celý.
    if (rows.length >= 100) box.append(note('Zobrazených je 100 najnovších vlákien. Staršie nájdeš hľadaním.'));

    return box;
}

function archiveSection(projects, threads) {
    const box = section('Archív');

    box.append(note('Odložené zložky a vlákna. Nezmazané — len mimo cesty.'));
    projects.forEach((project) => box.append(projectRow(project)));
    threads.forEach((row) => box.append(threadRow(row)));

    return box;
}

/* ---------- riadok projektu ---------- */

function projectRow(project) {
    const row = el('div', 'ct-proj');
    row.dataset.uuid = project.uuid;

    if (T.renaming?.kind === 'project' && T.renaming.uuid === project.uuid) {
        row.append(inlineForm('Názov projektu', T.renaming.value, (value) => patchProject(
            project.uuid, { name: value }, `Projekt sa teraz volá ${value}.`,
        ), () => {
            T.renaming = null;
            paint();
        }));

        return row;
    }

    const opened = T.open.has(project.uuid);
    const head = el('div', 'ct-head');

    const open = el('button', 'ct-open');
    open.type = 'button';
    open.setAttribute('aria-expanded', opened ? 'true' : 'false');
    open.append(iconSvg('box', { cls: 'ct-ico' }));
    open.append(el('span', 'ct-ttl', project.name));

    // Počet je zo servera (`COUNT(*)` vedľa zoznamu) a znamená NEODLOŽENÉ vlákna
    // projektu — nie to, koľko ich má panel načítaných.
    open.append(el('span', 'ct-count', String(project.threads ?? 0)));
    if (project.pinned) open.append(el('span', 'ct-chip', 'pripnuté'));
    open.addEventListener('click', () => toggleProject(project.uuid));

    head.append(open, actsToggle(`Akcie projektu ${project.name}`));
    row.append(head);
    row.append(projectActs(project));

    if (opened) row.append(projectBody(project));

    return row;
}

function projectActs(project) {
    const acts = el('div', 'ct-acts');
    acts.hidden = true;

    acts.append(actButton('Premenovať', () => {
        T.renaming = { kind: 'project', uuid: project.uuid, value: project.name || '' };
        paint();
    }));

    acts.append(actButton(project.pinned ? 'Odopnúť' : 'Pripnúť', () => patchProject(
        project.uuid,
        { pinned: !project.pinned },
        project.pinned ? 'Projekt už nie je pripnutý.' : 'Projekt je pripnutý.',
    )));

    acts.append(actButton(project.archived ? 'Vrátiť z archívu' : 'Archivovať', () => patchProject(
        project.uuid,
        { archived: !project.archived },
        project.archived ? 'Projekt je späť v zozname.' : 'Projekt je v archíve.',
    )));

    acts.append(armedButton(
        'Zmazať zložku',
        'Naozaj? Vlákna zostanú',
        () => deleteProject(project.uuid),
    ));

    return acts;
}

function projectBody(project) {
    const body = el('div', 'ct-proj-body');
    const entry = T.open.get(project.uuid) || {};

    if (entry.state === 'loading' && !(entry.items || []).length) body.append(note('Načítava sa…'));
    if (entry.state === 'error') body.append(errorNote(entry.error, () => loadProjectThreads(project.uuid)));

    const items = entry.items || [];
    const rows = items.filter((row) => !row.archived);

    if (!rows.length && entry.state === 'ready') {
        body.append(note('Zložka je prázdna. Vlákno sa do nej presúva z jeho akcií.'));
    }

    rows.forEach((row) => body.append(threadRow(row, project.uuid)));

    return body;
}

/* ---------- riadok vlákna ---------- */

/**
 * @param {object} row  vlákno zo zoznamu alebo z detailu projektu
 * @param {string} [inProject]  uuid zložky, v ktorej riadok stojí — vtedy vie
 *   panel nabídnuť vyradenie, pretože `DELETE` route potrebuje OBE uuid.
 */
function threadRow(row, inProject = '') {
    const box = el('div', 'ct-row');
    box.dataset.uuid = row.uuid;

    if (T.renaming?.kind === 'thread' && T.renaming.uuid === row.uuid) {
        box.append(inlineForm('Názov vlákna', T.renaming.value, (value) => renameThread(row.uuid, value), () => {
            T.renaming = null;
            paint();
        }));

        return box;
    }

    const head = el('div', 'ct-head');
    const open = el('button', 'ct-open');
    open.type = 'button';

    if (T.current === row.uuid) {
        open.setAttribute('aria-current', 'true');
        box.classList.add('on');
    }

    open.append(el('span', 'ct-ttl', row.title || 'Nové vlákno'));
    open.append(el('span', 'ct-when', whenLabel(row.last_message_at)));
    if (row.pinned) open.append(el('span', 'ct-chip', 'pripnuté'));
    if (row.archived) open.append(el('span', 'ct-chip', 'archív'));
    open.addEventListener('click', () => openThreadRow(row.uuid));

    head.append(open, actsToggle(`Akcie vlákna ${row.title || 'Nové vlákno'}`));
    box.append(head);
    box.append(threadActs(row, inProject));

    return box;
}

function threadActs(row, inProject) {
    const acts = el('div', 'ct-acts');
    acts.hidden = true;

    acts.append(actButton('Premenovať', () => {
        T.renaming = { kind: 'thread', uuid: row.uuid, value: row.title === 'Nové vlákno' ? '' : (row.title || '') };
        paint();
    }));

    acts.append(projectPicker(row, inProject));

    // Pripnutie a archivácia vlákna len keď ich server naozaj ZAPÍŠE. Detail
    // projektu tie príznaky vracia aj dnes, takže vnútri zložky by sa dali
    // vykresliť — ale `PATCH` vlákna ich neprijíma, takže tlačidlo by nič
    // nezmenilo. Brána je o zápise, nie o tom, čo panel prečítal.
    if (supportsThreadFlags()) {
        acts.append(actButton(row.pinned ? 'Odopnúť' : 'Pripnúť', () => setThreadFlag(row.uuid, 'pinned', !row.pinned)));
        acts.append(actButton(row.archived ? 'Vrátiť z archívu' : 'Archivovať', () => setThreadFlag(row.uuid, 'archived', !row.archived)));
    }

    acts.append(exportLink(row.uuid, 'Exportovať'));
    acts.append(armedButton('Zmazať vlákno', 'Naozaj zmazať?', () => deleteThread(row.uuid)));

    return acts;
}

/**
 * Presun do zložky. `<select>`, nie vnorená ponuka: je to výber jednej hodnoty
 * z krátkeho zoznamu, teda presne to, na čo `<select>` je — a nepotrebuje
 * vlastné pozicovanie ani zachytávanie kliku mimo, ktoré by sa v paneli
 * s `overflow: hidden` aj tak zrezalo.
 *
 * OBAL SA KRESLÍ HNEĎ, `<select>` AŽ PRI ROZBALENÍ. Zmerané 31. 8. 2026: 94
 * riadkov vlákien znamenalo **94 natívnych `<select>`** v dokumente, hoci blok
 * akcií je `hidden` a človek vidí najviac jeden. Nie je to len cena za DOM —
 * každý z nich bol vlastný ovládač, ktorý si prehliadač musí ostylovať, a pri
 * 94 kusoch je to 94 miest, kde sa kresba môže rozísť. Prázdny `<label>` by
 * bola diera v layoute, preto obal ostáva a plní sa v `fillProjectPicker()`.
 */
function projectPicker(row, inProject) {
    const wrap = el('label', 'ct-move');

    /* Argumenty sú v datasete, nie v closure: blok akcií sa rozbaľuje
       `actsToggle()`, teda prvkom, ktorý o riadku nič nevie. Closure by sa musela
       držať v mape podľa uuid — a to je druhý stav vedľa DOM, ktorý sa pri
       prekreslení panela rozíde. */
    wrap.dataset.thread = row.uuid;
    wrap.dataset.inProject = inProject || '';

    return wrap;
}

/**
 * Doplní `<select>` do obalu, ktorý ho ešte nemá. Idempotentné.
 *
 * Volá to `actsToggle()` pri rozbalení. Zoznam projektov sa čítá v tom okamihu,
 * teda je vždy aktuálny — eager verzia ho zamrazila do stavu pri poslednom
 * prekreslení panela.
 *
 * @returns {HTMLSelectElement|null} nový `<select>`, alebo `null` keď už bol
 */
export function fillProjectPicker(wrap) {
    if (!wrap || wrap.querySelector('select')) return null;

    const row = { uuid: wrap.dataset.thread || '' };
    const inProject = wrap.dataset.inProject || '';
    const select = el('select', 'ct-move-sel');

    select.setAttribute('aria-label', 'Zaradiť vlákno do projektu');

    const placeholder = el('option', null, inProject ? 'Presunúť…' : 'Do projektu…');
    placeholder.value = '';
    placeholder.selected = true;
    select.append(placeholder);

    T.projects.filter((p) => !p.archived && p.uuid !== inProject).forEach((project) => {
        const option = el('option', null, project.name);
        option.value = project.uuid;
        select.append(option);
    });

    if (inProject) {
        const out = el('option', null, 'Vyradiť zo zložky');
        out.value = '--out';
        select.append(out);
    }

    select.addEventListener('change', () => {
        const value = select.value;
        select.value = '';

        if (value === '') return;

        moveThread(row.uuid, value === '--out' ? '' : value, inProject);
    });

    wrap.append(select);
    /* Obálka so strieškou. Robí sa TU a nie v CSS, pretože `appearance: none`
       zmaže natívnu striešku a `select::after` sa nevykreslí — dôvod je celý
       v hlavičke `./selects.js`. */
    dressSelect(select);

    return select;
}

/* ---------- výsledky hľadania ---------- */

function searchView() {
    const box = el('section', 'ct-sec ct-find');

    box.append(searchHead());

    /* Hľadanie nemá čo „nechať v zozname" — výsledok je celý obsah tejto sekcie,
       takže zlyhanie je vždy zlyhanie PLOCHY. Predmet je „históriu", nie
       „hľadanie": nenačítalo sa to, v čom sa hľadá. */
    if (T.search.state === 'error') {
        box.append(errorBlock('históriu', runSearch, T.search.error));

        return box;
    }

    if (T.search.state === 'loading' && !T.search.data) {
        box.append(note('Hľadanie v histórii…'));

        return box;
    }

    const data = T.search.data;
    if (!data) return box;

    box.append(countsLine(data));
    box.append(filterBar());

    const items = Array.isArray(data.items) ? data.items : [];

    /* PRÁZDNO Z ZÚŽENIA, nie z neexistencie dát — správy existujú, tento dopyt
       a tieto filtre ich len nechytili. Preto `.empty--filter` (vlastnú kresbu
       zámerne nemá, manuál §8) a JEDNA akcia.

       Akcia sa vyberá podľa toho, čo zúženie NAOZAJ je: keď je nasadený filter,
       zruší sa filter a dopyt zostane (človek hľadá to isté, len širšie); keď
       filter nasadený nie je, jediné zúženie je samotný dopyt. Tlačidlo, ktoré
       by rušilo filter, ktorý neexistuje, by nič neurobilo. */
    if (!items.length) {
        const narrowed = !!(T.filters.role || T.filters.from || T.filters.to
            || T.filters.thread || T.filters.project);

        box.append(narrowed
            ? filterBlock(
                `Dopytu „${data.query}" so zapnutými filtrami nezodpovedá žiadna správa.`,
                'Bez filtrov môže mať zásahy.',
                clearSearchFilters,
                'Zruš filtre',
            )
            : filterBlock(
                `Dopytu „${data.query}" nezodpovedá žiadna správa.`,
                'Hľadá sa v texte správ, nie v názvoch vlákien.',
                clearSearch,
                'Zruš hľadanie',
            ));

        return box;
    }

    if (Array.isArray(data.threads) && data.threads.length > 1) box.append(facets(data));

    items.forEach((item) => box.append(hitRow(item)));

    const counts = data.counts || {};

    if ((counts.shown ?? 0) < (counts.total ?? 0) && T.limit < MAX_LIMIT) {
        const more = el('button', 'ct-more', 'Zobraziť viac');
        more.type = 'button';
        more.addEventListener('click', () => {
            T.limit = Math.min(MAX_LIMIT, T.limit + LIMIT_STEP);
            runSearch();
        });
        box.append(more);
    }

    return box;
}

function searchHead() {
    const head = el('div', 'ct-sec-head');

    head.append(el('h3', 'ct-sec-title', 'Nájdené v histórii'));

    const clear = iconButton('x', 'Zrušiť hľadanie');
    clear.classList.add('ct-sec-act');
    clear.addEventListener('click', clearSearch);

    head.append(clear);

    return head;
}

/* ---------------------------------------------------------------------------
   ZRUŠENIE ZÚŽENIA — jedna implementácia na každý rozsah

   Tri prvky rušia zúženie (krížik v hlavičke sekcie, čip „Zrušiť zúženie",
   akcia prázdneho stavu `.empty--filter`) a bez týchto dvoch funkcií by mal
   každý svoju kópiu. Krížik ju do 31. 8. 2026 mal — a akcia prázdneho stavu by
   bola tretia, teda presne ten vzor, ktorý audit tejto appky opakovane našiel
   ako príčinu rozchodu dvoch ciest k jednej veci.
   --------------------------------------------------------------------------- */

/**
 * Zruší celé hľadanie: pole, dopyt aj filtre.
 *
 * Pole sa vyprázdňuje TU a nie cez `dispatchEvent('input')`: `onQuery('')` je
 * verejná cesta panela a je to tá istá, ktorou beží písanie — udalosť by ju
 * volala druhýkrát cez `main.js`.
 */
export function clearSearch() {
    const field = document.getElementById('chat-search');

    if (field) field.value = '';
    onQuery('');
    field?.focus();
}

/**
 * Zruší VŠETKÝCH PÄŤ filtrov, dopyt nechá.
 *
 * Toto je „hľadám to isté, len širšie". Nový dopyt sa neposiela cez `onQuery`,
 * pretože sa dopyt nemenil — beží sa `runSearch()` nad tým istým textom.
 */
export function clearSearchFilters() {
    T.filters.role = '';
    T.filters.from = '';
    T.filters.to = '';
    T.filters.thread = '';
    T.filters.project = '';
    runSearch();
}

/** Zruší len zúženie na skupinu (vlákno / projekt) — čip „Zrušiť zúženie". */
export function clearSearchFacets() {
    T.filters.thread = '';
    T.filters.project = '';
    runSearch();
}

/**
 * Vety o počte. Čísla sú zo servera: `total` je nad celým zásahom, `shown` nad
 * stránkou, `threads` nad celým zásahom. Práve preto sa tu nič nedopočítava
 * z `items.length` — to je presne tá tichá lož, ktorú audit našiel na Kontrole.
 */
function countsLine(data) {
    const counts = data.counts || {};
    const total = counts.total ?? 0;
    const shown = counts.shown ?? 0;
    const threads = counts.threads ?? 0;

    const bits = [`${total} ${plural(total, 'zásah', 'zásahy', 'zásahov')}`];

    bits.push(`v ${threads} ${plural(threads, 'vlákne', 'vláknach', 'vláknach')}`);
    if (shown < total) bits.push(`zobrazených ${shown}`);

    return el('p', 'ct-counts', bits.join(' · '));
}

function filterBar() {
    const bar = el('div', 'ct-filters');

    const role = el('select', 'ct-filter');
    role.setAttribute('aria-label', 'Filtrovať podľa autora');
    [['', 'Kdokoľvek'], ['user', 'Moje správy'], ['assistant', 'Odpovede Hadesa']].forEach(([value, label]) => {
        const option = el('option', null, label);
        option.value = value;
        option.selected = T.filters.role === value;
        role.append(option);
    });
    role.addEventListener('change', () => {
        T.filters.role = role.value;
        runSearch();
    });

    bar.append(role);
    // Ten istý dôvod ako u presunu do zložky — kresba potrebuje suseda, nie pseudo.
    dressSelect(role);
    bar.append(dateFilter('from', 'Od dátumu'));
    bar.append(dateFilter('to', 'Do dátumu'));

    // Zúženie na jedno vlákno alebo projekt sa nastavuje klikom na skupinu, ale
    // zrušiť sa musí dať aj vtedy, keď skupiny už v odpovedi nie sú (zúžený
    // zásah má jednu skupinu, takže sa `facets()` nevykreslia).
    if (T.filters.thread || T.filters.project) {
        const off = el('button', 'ct-chip-off', 'Zrušiť zúženie');
        off.type = 'button';
        off.addEventListener('click', clearSearchFacets);
        bar.append(off);
    }

    return bar;
}

function dateFilter(key, label) {
    const field = el('input', 'ct-filter');

    field.type = 'date';
    field.value = T.filters[key] || '';
    field.setAttribute('aria-label', label);
    field.title = label;
    field.addEventListener('change', () => {
        T.filters[key] = field.value;
        runSearch();
    });

    return field;
}

/** Skupiny zo servera — vlákna a projekty so zásahmi. Klik zúži dopyt. */
function facets(data) {
    const box = el('div', 'ct-facets');

    (data.projects || []).forEach((project) => {
        box.append(facetChip(
            `${project.name} · ${project.matches}`,
            T.filters.project === project.project,
            () => {
                T.filters.project = T.filters.project === project.project ? '' : project.project;
                T.filters.thread = '';
                runSearch();
            },
        ));
    });

    (data.threads || []).forEach((thread) => {
        box.append(facetChip(
            `${thread.title || 'Nové vlákno'} · ${thread.matches}`,
            T.filters.thread === thread.thread,
            () => {
                T.filters.thread = T.filters.thread === thread.thread ? '' : thread.thread;
                runSearch();
            },
        ));
    });

    return box;
}

function facetChip(text, on, onClick) {
    const chip = el('button', 'ct-facet', text);

    chip.type = 'button';
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.addEventListener('click', onClick);

    return chip;
}

/**
 * Jeden zásah. Útržok skrátil server (60 znakov pred zásahom, 140 za ním) —
 * krátenie v prehliadači by bola druhá implementácia toho istého textu, presne
 * ako smernica, ktorá sa skládala dvakrát a rozišla sa na 20 zo 48 riadkov.
 */
function hitRow(item) {
    const row = el('button', 'ct-hit');
    row.type = 'button';

    const top = el('span', 'ct-hit-top');

    top.append(el('span', 'ct-hit-ttl', item.thread_title || 'Nové vlákno'));
    top.append(el('span', 'ct-hit-who', roleWord(item.role)));
    top.append(el('span', 'ct-when', whenLabel(item.at)));
    row.append(top);

    if (item.project_name) row.append(el('span', 'ct-chip', item.project_name));
    if (item.archived) row.append(el('span', 'ct-chip', 'archív'));
    if ((item.matches ?? 0) > 1) row.append(el('span', 'ct-chip', `${item.matches}×`));

    row.append(el('span', 'ct-snip', item.snippet || ''));
    row.addEventListener('click', () => openThreadRow(item.thread));

    return row;
}

/* ---------------------------------------------------------------------------
   DROBNÉ PRVKY
   --------------------------------------------------------------------------- */

function note(text) {
    return el('p', 'ct-note', text);
}

/**
 * Chyba v paneli. Riadky, ktoré už v zozname sú, sa NEZAHADZUJÚ — stará
 * odpoveď je stále platný odkaz a jedna neúspešná obnova z nej neplatnú
 * nerobí. Preto sa hlásenie vkládá vedľa zoznamu, nie namiesto neho.
 */
function errorNote(text, retry) {
    const box = el('p', 'ct-note ct-err', text || 'Niečo sa nepodarilo.');

    if (retry) {
        const again = el('button', 'ct-retry', 'Skúsiť znova');
        again.type = 'button';
        again.addEventListener('click', () => retry());
        box.append(' ', again);
    }

    return box;
}

function iconButton(icon, label) {
    /* Kresbu vklada sada, nie textovy uzol: `el(tag, cls, text)` by na tlacidlo
       posadil meno symbolu ako TEXT a po odchode fontu by z neho bolo vidiet slovo. */
    const btn = el('button', 'ct-act');

    btn.append(iconSvg(icon));

    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);

    return btn;
}

/**
 * Prepínač bloku akcií riadku.
 *
 * Blok je INLINE pod riadkom, nie plávajúca ponuka: `#chat-threads` má
 * `overflow: hidden` a `#chat-thread-list` vlastný skrol, takže absolútne
 * pozicovaná ponuka by sa o tú hranu zrezala. Inline blok navyše nepotrebuje
 * zachytávanie kliku mimo ani počítanie polohy.
 */
function actsToggle(label) {
    const btn = iconButton('dots-menu', label);

    btn.classList.add('ct-more-act');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => {
        const acts = btn.closest('.ct-row, .ct-proj')?.querySelector(':scope > .ct-acts');
        if (!acts) return;

        const open = acts.hidden;

        // Naraz je otvorený jeden blok: dva zoznamy akcií nad sebou v 268 px
        // paneli sa nedajú prečítať a „Naozaj zmazať?" v oboch je pasca.
        panelHost()?.querySelectorAll('.ct-acts').forEach((node) => { node.hidden = true; });
        panelHost()?.querySelectorAll('.ct-more-act').forEach((node) => node.setAttribute('aria-expanded', 'false'));

        acts.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');

        /* `<select>` presunu vzniká TERAZ. Do 31. 8. 2026 ich dokument nesl 94
           naraz (jeden na riadok), hoci vidieť môže byť najviac jeden. Plní sa
           len otvorený blok — zatvorenie nič nemaže, druhé otvorenie je no-op. */
        if (open) acts.querySelectorAll('.ct-move').forEach((wrap) => fillProjectPicker(wrap));
    });

    return btn;
}

function actButton(label, onClick) {
    const btn = el('button', 'ct-act-btn', label);

    btn.type = 'button';
    btn.addEventListener('click', onClick);

    return btn;
}

/**
 * Nevratná akcia na dva kliky. Ten istý vzor ako fronta Kontroly a zoznam
 * vlákien konzoly: natívny `confirm()` blokuje vlákno prehliadača aj rozbehnutý
 * prúd behu a vyzerá ako dialóg cudzej appky.
 */
function armedButton(label, armedLabel, onConfirm) {
    const btn = el('button', 'ct-act-btn ct-del', label);
    btn.type = 'button';

    let timer = 0;

    const disarm = () => {
        clearTimeout(timer);
        btn.classList.remove('armed');
        btn.textContent = label;
    };

    btn.addEventListener('click', () => {
        if (btn.classList.contains('armed')) {
            disarm();
            onConfirm();

            return;
        }

        panelHost()?.querySelectorAll('.ct-del.armed').forEach((node) => node.dispatchEvent(new CustomEvent('ct:disarm')));

        btn.classList.add('armed');
        btn.textContent = armedLabel;
        timer = setTimeout(() => { if (btn.isConnected) disarm(); }, 3000);
    });

    btn.addEventListener('ct:disarm', disarm);

    return btn;
}

/**
 * Export. `<a>` a nie `fetch` + Blob: `GET /api/console/threads/{uuid}/export`
 * vracia `text/markdown` s hlavičkou `Content-Disposition: attachment`, takže
 * prehliadač uloží súbor s menom, ktoré zložil server (`ChatScreen::exportName`).
 * Skládať markdown ani meno súboru v prehliadači by bola druhá implementácia
 * jedného dokumentu — presne tá chyba, ktorú tento projekt platil šesťkrát.
 *
 * Odkaz je v guardovanom okruhu, ale je to GET, takže CSRF hlavičku nepotrebuje
 * a session cookie ide s navigáciou sama.
 */
export function exportLink(uuid, label) {
    const link = el('a', 'ct-act-btn ct-export', label);

    link.href = `/api/console/threads/${uuid}/export`;
    // `download` bez hodnoty ponechá meno zo `Content-Disposition` (rovnaký
    // pôvod), len potlačí pokus prehliadača markdown zobraziť.
    link.setAttribute('download', '');
    link.title = 'Stiahnuť vlákno ako markdown';

    return link;
}

/** Inline formulár na jeden text (premenovanie, nový projekt). */
function inlineForm(label, value, onSubmit, onCancel) {
    const form = el('form', 'ct-form');
    const field = el('input', 'ct-input');

    field.type = 'text';
    field.value = value;
    field.maxLength = 200;
    field.setAttribute('aria-label', label);
    field.placeholder = label;
    field.dataset.autofocus = 'true';

    form.append(field);

    const ok = iconButton('check', 'Uložiť');
    ok.type = 'submit';
    form.append(ok);

    const cancel = iconButton('x', 'Zrušiť');
    cancel.addEventListener('click', onCancel);
    form.append(cancel);

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        onSubmit(field.value);
    });

    // Esc ruší LEN toto pole a nesmie prebublať: globálny Esc v `main.js`
    // zastavuje beh a zatvára panel, čo nie je to, čo človek pri opravovaní
    // názvu očakáva.
    field.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        event.preventDefault();
        event.stopPropagation();
        onCancel();
    });

    return form;
}

/** Fokus do rozpísaného poľa. Kurzor na konci — nie vybraný celý názov. */
function focusRename(host) {
    const field = host.querySelector('[data-autofocus]');
    if (!field) return;

    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
}

/* ---------------------------------------------------------------------------
   HLAVIČKA — odkaz na export

   Injektuje sa do `.ch-right` z JS, nie do blade: `resources/views/chat.blade.php`
   drží iná koľaj tejto vlny. Keď sa raz presunie do šablóny, tento blok zmizne
   a `paintExport()` bude len prepisovať `href`.
   --------------------------------------------------------------------------- */

export function ensureExport() {
    const right = document.querySelector('#chat-header .ch-right');
    if (!right || document.getElementById('chat-export')) return;

    const link = exportLink('', 'Export');

    link.id = 'chat-export';
    link.className = 'ct-head-act';
    link.hidden = true;
    link.replaceChildren(iconSvg('file-text'), el('span', 'sr-only', 'Exportovať vlákno do markdownu'));
    link.title = 'Exportovať vlákno do markdownu';

    // Pred prepínačom artefaktu: ten je posledný v hlavičke zámerne (patrí
    // k panelu, ktorý je vpravo od neho).
    right.insertBefore(link, document.getElementById('chat-artifact-toggle'));
}

export function paintExport() {
    const link = document.getElementById('chat-export');
    if (!link) return;

    link.hidden = T.current === '';
    if (T.current !== '') link.href = `/api/console/threads/${T.current}/export`;
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE
   --------------------------------------------------------------------------- */

/** Prepíše jeden riadok v oboch zoznamoch, v ktorých môže stáť. */
function patchRow(uuid, patch) {
    T.threads = T.threads.map((row) => (row.uuid === uuid ? { ...row, ...patch } : row));
    T.open.forEach((entry, key) => {
        T.open.set(key, {
            ...entry,
            items: (entry.items || []).map((row) => (row.uuid === uuid ? { ...row, ...patch } : row)),
        });
    });
}

/**
 * Vlákno sa pohlo (dobehol ťah). Zoznam sa obnovuje s odkladom: `chat:thread`
 * príde pri každom otvorení a `chat:thread-touched` po každom ťahu, takže bez
 * debounce by jedna konverzácia znamenala request na každú odpoveď.
 */
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(loadThreads, 500);
}

export function wireThreadsPanel() {
    if (wired) return;
    wired = true;

    document.addEventListener('chat:search', (event) => { onQuery(event.detail?.query ?? ''); });

    document.addEventListener('chat:thread', (event) => {
        const uuid = event.detail?.uuid || '';
        const known = T.threads.some((row) => row.uuid === uuid);

        T.current = uuid;
        paintExport();

        // Titulok prvej správy vlákno pomenuje až na serveri; kým sa zoznam
        // neobnoví, riadok by nesol „Nové vlákno". Preto sa premietne to, čo
        // payload naozaj nesie.
        if (known) patchRow(uuid, { title: event.detail?.title || 'Nové vlákno' });

        paint();
        if (!known) scheduleRefresh();
    });

    document.addEventListener('chat:thread-touched', scheduleRefresh);

    // Adresa bez uuid znamená „žiadne otvorené vlákno" — bez tohto by odkaz na
    // export ukazoval na vlákno, ktoré už nie je na obrazovke.
    window.addEventListener('popstate', () => {
        if (/^\/chat\/?$/.test(location.pathname)) {
            T.current = '';
            paintExport();
            paint();
        }
    });
}

/** Idempotentné — na poradí drôtovania kostry nezávisí. */
export function bootThreads() {
    if (booted) return;
    booted = true;

    ensureExport();
    wireThreadsPanel();

    T.current = document.querySelector('meta[name="console-thread"]')?.content || '';
    paintExport();

    /* Hľadanie z adresy PRED načítaním zoznamov: `paint()` kreslí sekciu
       „Nájdené v histórii" zo stavu, takže keby sa dopyt čítal až po nich, panel
       by raz blikol bez nej. */
    bootSearchFromUrl();

    loadThreads();
    loadProjects();
}

/* Panel sa rozbehne sám a nezávisí na tom, či ho `main.js` importuje kvôli
   vedľajšiemu efektu, alebo zavolá `bootThreads()` v `boot()`. `chat:ready`
   príde, keď plocha stojí (panely a šírky sú nastavené); makrotask je záloha
   pre prípad, že sa modul načíta až po tej udalosti. `bootThreads()` je
   idempotentné, takže rýchlejšia z tých dvoch ciest vyhrá a druhá je no-op. */
document.addEventListener('chat:ready', bootThreads);
setTimeout(bootThreads, 0);
