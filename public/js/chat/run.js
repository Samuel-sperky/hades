/* ===========================================================================
   Chat — beh.

   TRI VSTUPY, JEDEN BEH. Technická konzola `/console`, dok Charóna nad grafom a
   táto plocha idú všetky cez `public/js/shared/runclient.js` na
   `POST /api/console/run` a `POST /api/console/decide`. Tento súbor je view
   vrstva chatu nad tým klientom — nie druhá implementácia protokolu. Keď tu
   vznikne tretia cesta k modelu, je to chyba, nie funkcia (kontrakt §4).

   Čo drží klient (`shared/runclient.js`) a čo NEMÁ zmysel písať znova:
   fetch + `ReadableStream`, parsovanie NDJSON s bufferom na hranici chunkov,
   `AbortController`, front zadaní a pravidlo, že rámec `permission` ťah ukončí
   BEZ rámca `end`. Tento modul dodáva `request` (CSRF), vrecko stavu `R` a
   spätné volania, ktoré kreslia.

   DVOJFÁZOVÁ BRÁNA. Zápisový tool zaparkuje, ťah skončí bez `end` a jediná cesta
   ďalej je `/api/console/decide`. Pri podagentovi sa rozhodnutie posiela na
   vlákno PODAGENTA (`agent_wait.thread`), nie na to, ktoré má klient otvorené —
   preto ho karta brány nesie v `data-thread` a odovzdáva v udalosti.

   PODAGENTI A STARŠÍ KLIENT. `runclient.js` štyri nové typy rámcov (`agent_start`,
   `agent`, `agent_wait`, `agent_end`) vo svojom `route()` nepozná a jeho
   `default:` ich ticho ignoruje — protokol je tak rozšíriteľný bez toho, aby
   starší klient spadol. Ale `dispatch()` volá `onThreadState` na KAŽDOM rámci,
   takže sa dajú obslúžiť odtiaľ, bez zmeny zdieľaného modulu:

     · `agent_wait` nastaví `R.awaiting` ešte počas čítania prúdu, teda PRED
       `finally` v `runStream()`. Klient tam z `state.awaiting` rozhoduje, že sa
       ťah neskončil — takže `onRunningChange(false, true)` ohlási zaparkovanie
       a veta „beh sa skončil bez odpovede" sa nevypíše. Front zadaní sa o ten
       istý kľúč zastaví (`isQueueHeld()`), takže zaparkovaný zápis neprekročí.
     · vnorené `end` / `permission` dieťaťa sú v obálke `{t:'agent', frame}`,
       takže `route()` ich nikdy nevidí a ťah rodiča nekončia.

   Aj tak je čistejšie, aby tie štyri rámce poznal `route()` sám — presný diff
   je v odovzdávacej poznámke tejto vlny. Kým tam nie je, platí toto a je to
   funkčne rovnocenné.

   Všetko sú HOISTOVANÉ `export function` (`main.js` ↔ `run.js` ↔ `render.js` sú
   v cykle).
   =========================================================================== */

import { createRunClient } from '../shared/runclient.js';
import { writeAsk } from '../shared/gate.js';
import { cleanStop, costLabel } from '../shared/runstate.js';
import { syncPanelsToUrl } from './main.js';
import {
    announce, clearEmpty, live, setRunning, setStats, setTitle, threadFromUrl,
} from './main.js';
import {
    agentThreadOf, appendDelta, beginTurn, clearPrompt, closeAgent, closeBubble, decidePending,
    endTurn, ensureAgent, focusPending, focusPrompt, markAgentWait, markResult, noteStop, num,
    openAgent, pendingCard, permissionCard, pushBlock, pushError, pushNotice, pushUser,
    renderQueue, renderThread, resetStream, scrollIfFollowing, setParked, showEmpty, toolCard,
    turnChars, waitStart,
} from './render.js';

/* ---------------------------------------------------------------------------
   STAV

   Vrecko, nie modulové premenné rozsypané po súbore: `runclient.js` doňho píše
   `abort`, `awaiting`, `step`, `stats`, `t0` a číta z neho `awaiting`. Zvyšok
   (`thread`, `running`) je v réžii tohto modulu.
   --------------------------------------------------------------------------- */

const R = {
    /** Payload otvoreného vlákna z `/api/console/threads/{uuid}`, alebo null. */
    thread: null,
    /** Beží ťah? Píše to `onRunningChange`. */
    running: false,
    /** `{ id, name, thread }` zaparkovaného zápisu — `thread` je cieľ `/decide`. */
    awaiting: null,
    /** `{ n, of }` aktuálneho kroku. */
    step: null,
    /** Cena posledného dobehnutého ťahu. */
    stats: null,
    /** Začiatok behu (ms) — pre tikajúce sekundy v hlavičke. */
    t0: 0,
    /** `AbortController` bežiaceho prúdu; drží ho klient. */
    abort: null,
};

/** Tiká sekundy v hlavičke, kým beh beží. */
let ticker = 0;

/** Rozbehnuté `POST /api/console/threads` — aby dva podnety nezaložili dve vlákna. */
let creating = null;

/**
 * Rozhodnutie, ktoré prišlo skôr, než sa prúd zavrel.
 *
 * Rámec `permission` dieťaťa a `agent_wait` idú v prúde tesne za sebou a karta si
 * berie fokus hneď — teoreticky sa dá kliknúť ešte pred zavretím prúdu. Druhý
 * `runStream()` v tej chvíli by prepísal `state.abort` bežiaceho prúdu, takže sa
 * rozhodnutie odloží a odošle v `onSettled`.
 */
let queuedDecision = null;

/** Mená nástrojov PODAGENTA podľa id volania — `tool_result` nesie len id. */
const childTools = new Map();

/* ---------------------------------------------------------------------------
   HTTP

   Vlastný obal a nie import z `../console/http.js`: ten modul je konzolový a
   hlási chyby jej tokom správ. Interné `/api/*` sedia za `auth.ui` a
   `ValidateCsrfToken` (§3.3 docs/BEZPECNOST.md), takže každý non-GET request
   musí priniesť token z `<meta>`.
   --------------------------------------------------------------------------- */

function csrf() {
    return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

/**
 * Fetch s CSRF hlavičkou. Vracia `Response` — prúd behu si telo čítá sám, preto
 * sa tu odpoveď zámerne neparsuje na JSON.
 */
export async function request(url, { method = 'GET', body, signal } = {}) {
    const headers = new Headers();

    if (method !== 'GET' && method !== 'HEAD') {
        headers.set('X-CSRF-TOKEN', csrf());
        if (body !== undefined) headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    // Zamknutý okruh sa hlási DO TOKU a nie do toastu: v toku to človek naozaj
    // prečíta a zostane to tam aj po tom, čo sa prestane pozerať.
    if (res.status === 401) pushError('Hades je zamknutý — odomkni ho tokenom (?token=…).');
    else if (res.status === 419) pushError('Session vypršala — obnov stránku (F5).');

    return res;
}

/** Ten istý request, ale rovno ako JSON. Pri chybe vráti `null` a ohlási ju. */
export async function json(url, opts) {
    try {
        const res = await request(url, opts);

        if (!res.ok) {
            // Telo chyby je pre človeka, nie pre parser — 500 vracia HTML.
            if (res.status !== 401 && res.status !== 419) {
                pushError(`Požiadavka zlyhala (HTTP ${res.status}).`);
            }

            return null;
        }

        return await res.json();
    } catch (error) {
        if (error?.name !== 'AbortError') pushError('Sieťová chyba — Hades neodpovedal.');

        return null;
    }
}

/* ---------------------------------------------------------------------------
   KLIENT BEHU
   --------------------------------------------------------------------------- */

const client = createRunClient({
    request,
    state: R,
    view: {
        onStart(frame) {
            beginTurn(frame);
            paintStats();
        },

        onDelta(text) {
            appendDelta(text);
            paintStats();
        },

        onTool(frame) {
            // Karta ukončí rozpracovanú bublinu, aby text po nástroji začal novú.
            closeBubble();
            pushBlock(toolCard(frame));
        },

        onToolResult(frame, name) {
            markResult(frame, name);
            // Nástroj dobehol a model premýšľa znova. Toto ticho je rovnako dlhé
            // ako to pred prvým tokenom, takže si žiada ten istý signál.
            waitStart();
        },

        onPermission(frame) {
            closeBubble();
            pushBlock(permissionCard(frame, R.thread?.uuid));
            // Stav sa musí prekresliť HNEĎ: rámec `permission` ťah končí, tikanie
            // sekúnd dobehne až v `onSettled`, a do vtedy by hlavička tvrdila, že
            // model ešte píše.
            paintStats();
            // Ohlási sa ZÁPIS, nie nástroj — vetu skladá `writeAsk()` z tých
            // istých argumentov, aké vidí človek na karte.
            announce(writeAsk(frame));
        },

        onStep() {
            paintStats();
        },

        onEnd(frame) {
            noteStop(frame.stop_reason);
            announce(endAnnounce(frame));
        },

        onError(text, fromFrame) {
            // 401/419 už ohlásil `request()` do toku; transportné chyby prídu bez
            // `fromFrame` a hlásia sa len tam. Rámec `error` z prúdu ide aj do
            // čítačky — je to konec behu, nie poznámka.
            pushError(text);
            if (fromFrame) announce('Beh zlyhal.');
        },

        onNotice(text) {
            pushNotice(text);
        },

        /* Volá sa na KAŽDOM rámci — vrátane tých, ktoré `route()` nepozná. Preto
           sa tu obsluhujú podagenti (viď hlavička súboru). */
        onThreadState(frame) {
            if (agentFrame(frame)) return;

            applyThreadState(frame);
        },

        onRunningChange(on, parked) {
            R.running = on;

            setRunning(on);
            setParked(parked);

            clearInterval(ticker);
            ticker = 0;

            // Sekundy tikajú len počas behu. Pri modeli na ~8 tok/s je pohyb
            // v hlavičke jediné, čo človeku hovorí, že sa niečo deje — a naopak,
            // tikať do prázdna po skončení behu by bolo klamstvo.
            if (on) ticker = setInterval(paintStats, 1000);

            paintStats();
        },

        onSettled() {
            endTurn();
            paintStats();
            scrollIfFollowing();
            flushDecision();
        },

        onAfter() {
            // Zoznam vlákien vlastní iná koľaj tejto vlny; beh mu len povie, že
            // sa vlákno pohlo. Bez odberateľa je to no-op, nie chyba.
            if (R.thread) {
                document.dispatchEvent(new CustomEvent('chat:thread-touched', {
                    detail: { thread: R.thread.uuid },
                }));
            }
        },

        onQueueChange(items, held) {
            renderQueue(items, held);

            const count = Array.isArray(items) ? items.length : 0;

            if (count > 0) live(`V poradí ${count} ${count === 1 ? 'správa' : 'správy'}.`);
        },

        onQueueSend(item) {
            // Bublina s otázkou vzniká TU a nie pri odoslaní z composera: zaradená
            // aj okamžite odoslaná správa tak ide do toku tou istou cestou a
            // poradie v toku sedí s poradím, v akom správy naozaj odišli.
            pushUser(item.body?.message ?? '');
            renderQueue(client.queued(), client.queueHeld());
        },
    },
});

/* ---------------------------------------------------------------------------
   PODAGENTI
   --------------------------------------------------------------------------- */

/**
 * Rámce podagenta. Vracia `true`, keď rámec patril im — volajúci sa ho potom už
 * nepýtá na stav vlákna.
 */
function agentFrame(frame) {
    switch (frame.t) {
        case 'agent_start':
            // Text rodiča pred delegovaním sa uzavrie: rámec podagenta je vlastný
            // blok a nemá vyrásť doprostred rozpísaného odseku.
            closeBubble();
            openAgent(frame);
            announce(`Podagent začal pracovať s profilom ${frame.profile || 'bez profilu'}.`);

            return true;

        case 'agent':
            childFrame(String(frame.run || ''), frame.frame || {});

            return true;

        case 'agent_end':
            closeAgent(frame);
            paintStats();

            return true;

        case 'agent_wait':
            // POSLEDNÝ rámec ťahu rodiča. `R.awaiting` sa NEnastavuje tu:
            // od 25. 8. 2026 pozná `agent_wait` priamo `route()` v `runclient.js`
            // a nastaví ho ešte pred touto obsluhou (`state` je tento istý objekt
            // `R`). Dvaja pisatelia jedného stavu boli dve pravdy o tom, či sa ťah
            // skončil — a keby sa raz rozišli v tvare, front zadaní by prekročil
            // zaparkovaný zápis. Vlastníkom je zdieľaný klient.
            markAgentWait(frame);
            paintStats();

            return true;

        default:
            return false;
    }
}

/** Jeden rozbalený rámec dieťaťa. Kreslí sa do jeho rámca, nie do toku rodiča. */
function childFrame(run, frame) {
    ensureAgent(run);

    switch (frame.t) {
        case 'start':
            beginTurn(frame);
            break;

        case 'delta':
            appendDelta(frame.text);
            paintStats();
            break;

        case 'step':
            R.step = { n: frame.n, of: frame.of };
            paintStats();
            break;

        case 'tool':
            closeBubble();
            if (frame.id != null) childTools.set(frame.id, frame.name);
            pushBlock(toolCard(frame));
            break;

        case 'tool_result':
            markResult(frame, childTools.get(frame.id));
            waitStart();
            break;

        case 'permission':
            closeBubble();
            // Vlákno PODAGENTA — `/decide` ide naň. `agent_wait` ho pošle hneď za
            // týmto rámcom, ale karta ho musí poznať už teraz: berie si fokus
            // a človek na ňu môže kliknúť skôr, než prúd dobehne.
            pushBlock(permissionCard(frame, agentThreadOf(run)));
            paintStats();
            announce(writeAsk(frame));
            break;

        case 'end':
            noteStop(frame.stop_reason);
            endTurn();
            break;

        case 'error':
            pushError(frame.message || 'Podagent zlyhal.');
            break;

        default:
            // Neznámy typ rámca sa ticho ignoruje — protokol sa má dať rozširovať
            // bez toho, aby starší klient spadol.
            break;
    }
}

/* ---------------------------------------------------------------------------
   DRÔTOVANIE

   Kostra plochy (`main.js`) len OHLASUJE zámer človeka; vykonáva ho tento modul.
   --------------------------------------------------------------------------- */

/* Zoznam modelov plní SERVER (`GET /api/console/models`), nie markup: modely sa
   v Ollame pridávajú a odoberajú, takže zadrôtovaný zoznam by o týždeň ponúkal
   model, ktorý na stroji nie je.

   Zlyhanie je TICHÉ a je to zámer: prepínač modelu je pohodlie a bez neho ide
   beh na default z configu. Toast pri načítaní plochy by hlásil poruchu veci,
   ktorú človek ani nechcel použiť.

   Prvá voľba („Predvolený model") sa NEMAŽE — je to jediná cesta späť
   k defaultu servera po tom, čo si človek model raz vybral. */
export async function bootModelSelect() {
    const sel = document.getElementById('chat-model');
    if (!sel) return;
    let data;
    try {
        const res = await fetch('/api/console/models');
        if (!res.ok) return;
        data = await res.json();
    } catch (e) { return; }
    const models = Array.isArray(data && data.models) ? data.models : [];
    if (!models.length) return;
    for (const m of models) {
        if (!m || !m.id) continue;
        const o = document.createElement('option');
        o.value = String(m.id);
        /* Poskytovateľ patrí do popisku len keď ich je viac než jeden — inak je
           to na každej položke to isté slovo a v úzkom composeri zaberá miesto,
           ktoré potrebuje meno modelu. */
        const many = new Set(models.map((x) => x && x.provider).filter(Boolean)).size > 1;
        o.textContent = String(m.label || m.id) + (many && m.provider ? ' · ' + m.provider : '');
        sel.appendChild(o);
    }
}

export function wireRun() {
    document.addEventListener('chat:ready', (event) => { openInitial(event.detail?.thread || ''); });
    document.addEventListener('chat:submit', (event) => { submit(event.detail?.text || ''); });
    document.addEventListener('chat:stop', stopRun);
    document.addEventListener('chat:new-thread', () => { newThread(); });
    document.addEventListener('chat:decide', (event) => {
        decideWrite(event.detail?.id, event.detail?.decision, event.detail?.thread);
    });
    document.addEventListener('chat:queue-cancel', (event) => {
        if (client.cancelQueued(event.detail?.id)) live('Správa z poradia zrušená.');
    });

    // Esc v ZÁCHYTNEJ fáze, teda pred globálnym Esc v `main.js`: nad zaparkovaným
    // zápisom zamietne, počas behu zastaví. Bez `capture` by `main.js` na úzkom
    // okne tým istým stiskom zatvoril panel a rozhodnutie by prišlo naslepo.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (R.awaiting && pendingCard()) {
            event.preventDefault();
            event.stopPropagation();
            decidePending('deny');
        } else if (R.running) {
            event.preventDefault();
            event.stopPropagation();
            stopRun();
        }
    }, { capture: true });

    // Späť/dopredu v prehliadači. `/chat/<uuid>` je adresa vlákna, takže sa musí
    // dať prejsť histórii — bez tohto by tlačidlo Späť zmenilo URL a nechalo na
    // obrazovke cudzie vlákno.
    window.addEventListener('popstate', () => { openInitial(uuidFromPath()); });
}

function uuidFromPath() {
    return location.pathname.replace(/^\/chat\/?/, '').split('/')[0] || '';
}

/**
 * Prvé otvorenie plochy. `/chat/<uuid>` má načítať to vlákno; `/chat` bez uuid
 * NEZAKLADÁ vlákno dopredu — prázdne vlákno pri každom otvorení stránky by
 * zaplnilo panel konverzáciami, ktoré nikto nezačal. Vznikne ticho pri prvej
 * správe (`ensureThread`).
 */
async function openInitial(uuid) {
    const wanted = String(uuid || threadFromUrl() || '');

    if (wanted === '') {
        R.thread = null;
        R.awaiting = null;
        R.stats = null;
        R.step = null;
        resetStream();
        showEmpty();
        /* „Charón", nie „Chat" — to isté meno ako `<title>` a `og:title` v blade
           (manuál §9). Do 31. 8. 2026 tu stálo 'Chat', takže náhľad odkazu volal
           plochu jedným menom a stránka po dobehnutí JS druhým. Fallback
           v `setTitle()` je opravený tiež; tento riadok je ten, ktorý sa
           uplatní pri prázdnom vlákne. */
        setTitle('Charón');
        setParked(false);
        paintStats();

        return null;
    }

    return loadThread(wanted);
}

/** Vlákno zo servera — nikdy z localStorage. História v DB je jediný zdroj pravdy. */
export async function loadThread(uuid) {
    const data = await json(`/api/console/threads/${uuid}`);

    if (!data) {
        // Vlákno sa nedá načítať (zmazané, cudzie uuid). Prázdny stav je čestnejší
        // než tok predošlého vlákna pod novou adresou.
        resetStream();
        showEmpty();

        return null;
    }

    applyThread(data);

    return data;
}

function applyThread(data) {
    R.thread = data;
    R.awaiting = data.awaiting ? { id: data.awaiting, name: '', thread: data.uuid } : null;
    R.stats = lastRunCost(data.runs);
    R.step = null;

    setTitle(data.title);
    if (location.pathname !== `/chat/${data.uuid}`) history.pushState({}, '', `/chat/${data.uuid}`);
    /* Prepis celej adresy zahodi query string aj s klucmi, ktore o vlakne NIE SU
       (`pt`/`pa` rozlozenie, `b` vetva, sest klucov hladania v historii).
       Rozlozenie sa preto dopise spat cez `replace`, teda bez druheho zaznamu
       v historii — presne tak, ako to uz robi `threads.js` pri zavreti vlakna. */
    syncPanelsToUrl();

    renderThread(data);
    setParked(!!R.awaiting);
    paintStats();

    // Udalosť zostáva pre odberateľov (zoznam vlákien, panel artefaktu); kreslenie
    // ide priamo, aby sa poradie „najprv stav, potom tok" nedalo rozhodiť poradím
    // listenerov.
    document.dispatchEvent(new CustomEvent('chat:thread', { detail: data }));
}

/**
 * Nové vlákno.
 *
 * `blank: false` znamená „vlákno vzniklo len preto, aby mal ťah kam ísť" — vtedy
 * sa tok NEPREKRESĽUJE na prázdny stav. Bez toho vzniká závod: odoslanie si
 * vlákno založí a prázdny stav by prepísal tok aj s otázkou, ktorá do neho ide
 * o riadok nižšie.
 */
export async function newThread({ blank = true } = {}) {
    if (creating) return creating;

    creating = json('/api/console/threads', { method: 'POST', body: {} });

    let data;

    try {
        data = await creating;
    } finally {
        creating = null;
    }

    if (!data) {
        pushError('Vlákno sa nepodarilo založiť.');

        return null;
    }

    R.thread = data;
    R.awaiting = null;
    R.stats = null;
    R.step = null;

    history.pushState({}, '', `/chat/${data.uuid}`);
    /* Prepis celej adresy zahodi query string aj s klucmi, ktore o vlakne NIE SU
       (`pt`/`pa` rozlozenie, `b` vetva, sest klucov hladania v historii).
       Rozlozenie sa preto dopise spat cez `replace`, teda bez druheho zaznamu
       v historii — presne tak, ako to uz robi `threads.js` pri zavreti vlakna. */
    syncPanelsToUrl();
    setTitle(data.title);
    setParked(false);

    if (blank) {
        resetStream();
        showEmpty();
        clearPrompt();
        focusPrompt();
    }

    paintStats();
    document.dispatchEvent(new CustomEvent('chat:thread', { detail: data }));

    return data;
}

/** Vlákno musí existovať pred prvým ťahom — `/chat` bez uuid ho založí ticho. */
export async function ensureThread() {
    if (R.thread) return R.thread;

    return newThread({ blank: false });
}

/* ---------------------------------------------------------------------------
   ODOSLANIE

   JEDNA cesta: `client.enqueue()`. Aj keď nič nebeží — vtedy zadanie odíde samo,
   len čo sa vráti riadenie. Plocha tak nemusí zápasiť s otázkou, či beh medzitým
   dobehol, a poradie správ zostane zachované. Zaparkovaný zápis front NEPREKROČÍ:
   drží to `state.awaiting` v `runclient.js`, nie disciplína tohto súboru.
   --------------------------------------------------------------------------- */

export async function submit(text) {
    const message = String(text ?? '').trim();
    if (message === '') return;

    // Pole sa vyprázdni hneď: pri modeli na ~8 tok/s je jediná vec, ktorá musí byť
    // okamžitá, potvrdenie, že správa odišla.
    clearPrompt();
    clearEmpty();

    const thread = await ensureThread();

    if (!thread) {
        pushError('Vlákno sa nepodarilo založiť — správa neodišla.');

        return;
    }

    // Titulok je prvá veta človeka; server ho uloží, ale hlavička ho má mať hneď.
    if (!R.thread.title || R.thread.title === 'Nové vlákno') {
        R.thread.title = message.replace(/\s+/gu, ' ').slice(0, 60);
        setTitle(R.thread.title);
    }

    /* Profil ide s KAŽDÝM ťahom, nie raz na vlákno: server si ho síce perzistuje
       na `console_threads.tool_profile` (aby obnova zaparkovaného zápisu čítala
       sadu toolov zo servera, nie z klienta), ale výber v hlavičke je vlastnosť
       ĎALŠIEHO ťahu — človek môže jeden krok spustiť s orchestrátorom a ďalší
       s plnou sadou. Prázdna hodnota sa neposiela: `RunController` vtedy vezme
       default z configu. */
    const profile = document.getElementById('chat-profile')?.value || '';
    const body = { thread: thread.uuid, message };

    if (profile) body.profile = profile;

    /* MODEL ide s ťahom z toho istého dôvodu ako profil (H5): `RunController`
       ho prijíma na každý ťah, takže výber v composeri je vlastnosť ĎALŠIEHO
       ťahu — jeden krok sa dá pustiť na malom modeli a ďalší na veľkom.
       Prázdna hodnota sa NEPOSIELA: server vtedy vezme default z configu. */
    const model = document.getElementById('chat-model')?.value || '';
    if (model) body.model = model;

    client.enqueue(body);

    if (R.awaiting) {
        announce('Beh čaká na rozhodnutie o zápise. Správa stojí v poradí a odíde po ňom.');
        focusPending();
    } else if (R.running) {
        announce('Beh ešte beží. Správa stojí v poradí.');
    }
}

export function stopRun() {
    if (!R.running) return;

    // Text, ktorý už prišiel, ZOSTÁVA. Poradie sa Stopom neruší — „zastav beh"
    // nie je „zabudni, čo som napísal"; zrušiť sa dá každá správa v poradí
    // samostatne.
    client.stop();
}

/* ---------------------------------------------------------------------------
   ROZHODNUTIE O ZÁPISE
   --------------------------------------------------------------------------- */

/**
 * Rozhodnutie beh NEKONČÍ — dostreamuje ho tá istá rúra (`/api/console/decide`).
 *
 * `thread` z karty má prednosť pred stavom: pri zápise podagenta je cieľom JEHO
 * vlákno a karta ho nesie od chvíle, kedy vznikla. Stav je záloha pre kartu, ktorá
 * vznikla z histórie.
 */
async function decideWrite(id, decision, thread) {
    if (!Number.isFinite(Number(id)) || !decision) return;

    const target = thread || R.awaiting?.thread || R.thread?.uuid;

    if (!target) {
        pushError('Rozhodnutie sa nedá odoslať — nie je známe vlákno, ktorému patrí.');

        return;
    }

    // Prúd ešte netečie naprázdno: druhý `runStream()` by prepísal `state.abort`
    // toho bežiaceho. Odloží sa a odíde v `onSettled`.
    if (R.running) {
        queuedDecision = { id: Number(id), decision, thread: target };

        return;
    }

    R.awaiting = null;
    setParked(false);

    await client.resumeDecision({ thread: target, call: Number(id), decision });
}

function flushDecision() {
    if (!queuedDecision) return;

    const pending = queuedDecision;
    queuedDecision = null;

    // Makrotask, nie rovno tu: `onSettled` beží ešte vnútri `finally` bežiaceho
    // `runStream()`, takže druhý prúd musí začať až po jeho dobehu.
    setTimeout(() => { decideWrite(pending.id, pending.decision, pending.thread); }, 0);
}

/* ---------------------------------------------------------------------------
   STAV BEHU V HLAVIČKE
   --------------------------------------------------------------------------- */

/**
 * Riadok stavu behu. Pri ~8 tok/s je pohyb v ňom jediný dôkaz, že sa niečo deje.
 *
 * Toto je `setStats()` — cena a krok. Jedna veta o behu pre čítačku ide cez
 * `announce()`, stav plochy cez `live()`; nemiešajú sa, každý má vlastný región.
 */
export function paintStats() {
    const bits = [];

    if (R.awaiting) bits.push('čaká na rozhodnutie');
    else if (R.running) bits.push(`${Math.max(0, Math.round((Date.now() - R.t0) / 1000))} s`);

    if (R.step) bits.push(`krok ${R.step.n}/${R.step.of}`);

    const chars = turnChars();
    if (R.running && chars) bits.push(`${num(chars, 0)} znakov`);

    // Cena sa skládá tým istým `costLabel()` ako bublina odpovede — hlavička a tok
    // nesmú hovoriť to isté číslo dvoma tvarmi.
    if (!R.running) {
        const cost = costLabel(R.stats, num);
        if (cost !== '') bits.push(cost);
    }

    setStats(bits.join(' · '));
}

function endAnnounce(frame) {
    const bits = [cleanStop(frame.stop_reason) ? 'Odpoveď dokončená' : 'Beh prerušený'];

    if (frame.tokens_out) bits.push(`${num(frame.tokens_out, 0)} tokenov`);
    if (frame.tokens_per_second) bits.push(`${num(frame.tokens_per_second)} tokenov za sekundu`);

    return `${bits.join(', ')}.`;
}

/**
 * Cena posledného behu, ktorý v logu naozaj niečo stál. Ide sa od konca, nie od
 * `runs.at(-1)`: posledný riadok môže byť práve založený beh bez tokenov a
 * hlavička by po obnove stránky zhasla, hoci predchádzajúci ťah cenu má.
 */
function lastRunCost(runs) {
    const list = Array.isArray(runs) ? runs : [];

    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i]?.tokens_out) return list[i];
    }

    return null;
}

/**
 * Stav brány zápisov z koncového rámca `/decide`.
 *
 * Vypnutá brána je bezpečnostne relevantná zmena stavu, takže ide aj do toku
 * správ: políčko v hlavičke je pri odpovedi, ktorá práve beží, to posledné,
 * čoho si človek všimne, a v histórii vlákna by po ňom nezostalo nič.
 */
function applyThreadState(frame) {
    if (typeof frame.auto_accept !== 'boolean') return;

    const before = !!R.thread?.auto_accept;

    if (R.thread) R.thread.auto_accept = frame.auto_accept;

    if (frame.auto_accept && !before) {
        closeBubble();
        pushNotice('Zápisy sa v tomto vlákne už nepýtajú — brána je vypnutá.');
        announce('Zápisy sa v tomto vlákne už nepýtajú.');
    }
}
