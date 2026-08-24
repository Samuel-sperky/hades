/* ===========================================================================
   Charón — dok nad plátnom grafu.

   Konverzačná plocha Charóna priamo nad sieťou vedomia: ten istý agentový beh
   ako plná konzola (/console), ten istý dvojfázový NDJSON protokol a — čo je
   podstata — tá istá dvojfázová brána zápisov. Zápisový nástroj zaparkuje,
   ťah skončí BEZ rámca `end` a beh sa obnoví výhradne z /api/console/decide.
   Inej cesty k modelu niet: mechaniku prúdu drží public/js/shared/runclient.js,
   dok si len kreslí vlastnú view vrstvu nad mind.css / charon.css.

   Dok beží na malom profile nástrojov `graph` (čítanie pamäte + navigácia grafu
   + mind_learn za bránou) — pozri docs/sprint-2026-08-21/ROZHRANIE-PROFILY-A-DOK.md.

   PRAVIDLO VLNY 4 (kritérium §5/7): tento súbor NESMIE vyžiadať ani jeden rAF
   frame (statický dôkaz greppuje reťazec r-A-F v tomto adresári a musí byť
   prázdny). Plátno kreslí len na obrazovke Graf (graphActive()); dok je nad
   plátnom, ale beh, ktorý prežije prepnutie obrazovky, nesmie mimo Grafu vyvolať
   frame. Prekresľovanie streamovaného markdownu preto ide setTimeout(fn, 33):
   pri ~9 tok/s pritečie token raz za ~111 ms, takže 33 ms okno je jemnejšie než
   prílet dát a nič sa vizuálne nestratí.

   Exporty sú hoistované `export function` (graf modulov má cykly a arrow v
   `const` by pri cykle spadla na ReferenceError).
   =========================================================================== */

import { S } from './state.js';
import { go } from './sim.js';
import { createRunClient } from '../shared/runclient.js';
import {
    argsSummary, decisionLabel, diffHtml, iconFor, looksLikeDiff, writeAsk, writeTarget,
} from '../shared/gate.js';
import { renderMarkdown } from '../shared/markdown.js';
import { cleanStop, costLabel, stopNote } from '../shared/runstate.js';

/* Profil nástrojov doku. Malý zámerne — dok je nad grafom, nie nad repozitárom
   (§1.2 kontraktu). Backend neznámy profil ODMIETNE, nesanitizuje. */
const PROFILE = 'graph';

/* Strop kontextu na KLIENTOVI. Server má vlastný, tvrdší strop (8 uzlov /
   2400 znakov / 300 znakov na popis, ContextBlock, §2.3) a on rozhoduje, čo
   modelu naozaj pošle — klient posiela IBA id, nikdy text (model má zápisové
   tooly, takže podstrčený popis uzla je bezpečnostné riziko). Tento strop drží
   množinu čipov, aby kontext nenatiekol bez hranice už v UI. Rovná sa
   serverovému počtu uzlov, aby čipy nesľubovali viac, než sa odošle. */
const CTX_MAX_NODES = 8;

/* Koľko riadkov výsledku nástroja sa vidí bez rozbalenia. */
const PEEK_LINES = 6;

const CTX_KEY = 'hades.charonCtx';
const THREAD_KEY = 'hades.charonThread';

/* Stav doku. Jedna inštancia na stránke — na rozdiel od runclientu, ktorý je
   bezstavový a dostáva toto vrecko zvonka. Kľúče abort/awaiting/step/stats/t0
   mutuje runclient; zvyšok patrí doku. */
const D = {
    thread: null,      // uuid vlákna doku (perzistované)
    running: false,
    sending: false,
    abort: null,
    awaiting: null,    // { id, name } — beh zaparkovaný na rozhodnutí
    step: null,        // { n, of }
    stats: null,       // { tokens_in, tokens_out, tokens_per_second }
    t0: 0,
    turn: null,        // { raw, bubble }
    follow: true,
};

let ticker = 0;
let painting = 0;

/* ---------- drobné DOM pomôcky (bez závislosti na util.js grafu) ---------- */

function $(id) {
    return document.getElementById(id);
}

function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;

    return node;
}

function num(value, digits = 1) {
    const n = Number(value) || 0;

    return n.toLocaleString('sk-SK', { maximumFractionDigits: digits });
}

function stream() {
    return $('charon-stream');
}

/* ---------- request: 6-riadkový obal nad guardovaným fetchom ----------

   installFetchGuard() (main.js) už obalil window.fetch a pridáva CSRF hlavičku
   aj hlásenie 401/419. Dok teda nepotrebuje vlastný http modul — len JSON telo
   a Response, ktorej telo si runclient číta sám. */
async function request(url, { method = 'GET', body, signal } = {}) {
    const headers = {};
    if (method !== 'GET' && method !== 'HEAD' && body !== undefined) headers['Content-Type'] = 'application/json';

    return fetch(url, {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

/* ---------- klient behu (zdieľaná mechanika) ---------- */

const client = createRunClient({
    request,
    state: D,
    view: {
        onStart(frame) {
            beginTurn();
            paintStatus();
        },

        onDelta(text) {
            appendDelta(text);
        },

        onTool(frame) {
            closeBubble();
            pushBlock(toolCard(frame));
        },

        onToolResult(frame, name) {
            markResult(frame);
            // graph_focus je klientský efekt: model vyriešil cieľ, dok ho zaostrí
            // na plátne. Meno prišlo z runclientu (Map<id, name>), nie z DOM-u.
            if (name === 'graph_focus' && frame.status === 'done') applyFocus(frame.result);
            waitStart();
        },

        onPermission(frame) {
            closeBubble();
            pushBlock(permissionCard(frame));
            paintStatus();
            // Ohlási sa ZÁPIS, nie meno nástroja — tá istá veta, akú povie konzola.
            announce(writeAsk(frame));
        },

        onStep() {
            paintStatus();
        },

        onEnd(frame) {
            noteStop(frame.stop_reason);
            announce(endAnnounce(frame));
        },

        onError(text, fromFrame) {
            pushError(text);
            if (fromFrame) announce('Beh zlyhal.');
        },

        onNotice(text) {
            pushNotice(text);
        },

        onThreadState(frame) {
            // Vypnutá brána (Povoliť vždy) je bezpečnostne relevantná zmena —
            // patrí do toku správ, nielen do skrytého stavu.
            if (typeof frame.auto_accept !== 'boolean') return;
            if (frame.auto_accept) {
                closeBubble();
                pushNotice('Zápisy sa v tomto vlákne už nepýtajú — brána je vypnutá.');
                announce('Zápisy sa v tomto vlákne už nepýtajú.');
            }
        },

        onRunningChange: setRunning,

        onSettled() {
            endTurn();
            paintStatus();
            scrollIfFollowing();
        },
    },
});

/* ---------- verejné API (pre header tlačidlo aj pre agenta fázy 2) ---------- */

/** Je dok otvorený? Používa ho aj Esc kaskáda v shortcuts.js (fáza 2). */
export function charonOpen() {
    return !!$('charon')?.classList.contains('open');
}

export function openCharon() {
    const dock = $('charon');
    if (!dock) return;

    dock.classList.add('open');
    $('charon-toggle')?.setAttribute('aria-expanded', 'true');
    renderContextChips();
    // Prázdny stav pri prvom otvorení, aby dok nebol nemá plocha.
    if (stream() && !stream().children.length) renderEmpty();
    $('charon-input')?.focus();
}

export function closeCharon() {
    const dock = $('charon');
    if (!dock) return;

    dock.classList.remove('open');
    $('charon-toggle')?.setAttribute('aria-expanded', 'false');
}

export function toggleCharon() {
    if (charonOpen()) closeCharon();
    else openCharon();
}

/* ---------- štart ---------- */

/**
 * Naviaže dok. Volá sa raz pri štarte stránky z main.js (po installFetchGuard,
 * aby window.fetch pridával CSRF) — nahradil niekdajšie setupPrompt() mŕtveho
 * chatu (A9). Samostatný bootstrap skript v mind.blade.php zanikol.
 */
export function setupCharon() {
    loadContext();

    // Perzistované vlákno doku — beh naň naväzuje, aby história prežila reload.
    try {
        D.thread = localStorage.getItem(THREAD_KEY) || null;
    } catch (e) { /* nedostupné úložisko — dok si vlákno založí pri prvom ťahu */ }

    const form = $('charon-form');
    const input = $('charon-input');

    if (form) {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            send(input ? input.value : '');
        });
    }

    if (input) {
        // Enter odosiela, Shift+Enter je nový riadok.
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(input.value);
            }
        });
        input.addEventListener('input', () => autoGrow(input));
    }

    // #charon-send je type="submit" — odoslanie rieši `submit` na #charon-form,
    // druhý click listener by odoslal dvakrát.
    $('charon-stop')?.addEventListener('click', stopRun);
    $('charon-toggle')?.addEventListener('click', toggleCharon);
    $('charon-close')?.addEventListener('click', closeCharon);

    // Producent kontextu v paneli uzla: „Priložiť do rozhovoru".
    $('node-charon')?.addEventListener('click', () => {
        if (!S.selected) return;
        toggleContext(S.selected.id, S.selected.label);
    });

    // Čipy kontextu: × odoberá jeden, „Vyčistiť" všetky. Delegované, lebo čipy
    // sa prekresľujú.
    $('charon-ctx')?.addEventListener('click', (event) => {
        const x = event.target.closest('.ctx-x');
        if (x) {
            removeContext(+x.closest('.ctx-chip').dataset.id);

            return;
        }
        if (event.target.closest('.ctx-clear')) clearContext();
    });

    // Esc vnútri doku ho zavrie (nad zaparkovaným zápisom rozhoduje karta sama,
    // stopPropagation na nej to sem nepustí). stopPropagation, aby Esc nezrušil
    // aj filter grafu — kaskádu na Grafe vlastní shortcuts.js.
    $('charon')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (D.awaiting) return;   // karta povolenia si Esc rieši sama
        event.stopPropagation();
        closeCharon();
    });

    // Tok sleduje spodok, kým človek neodíde nahor. Rast obsahu skrolovaciu
    // udalosť nevyvolá (mení sa scrollHeight, nie scrollTop), takže sem sa dostane
    // len skutočné skrolovanie človekom — follow sa nevypne pri prílete tokenu.
    stream()?.addEventListener('scroll', () => {
        D.follow = distanceFromBottom(stream()) <= FOLLOW_SLACK;
    }, { passive: true });

    renderContextChips();
    syncNodeButton();
}

/* ---------- odoslanie ťahu ---------- */

async function send(text) {
    const message = String(text ?? '').trim();
    if (message === '') return;

    if (D.running) {
        pushNotice('Beh ešte beží — počkaj, kým dobehne, alebo ho zastav. Text zostáva napísaný.');
        announce('Beh ešte beží. Správa neodišla.');

        return;
    }

    if (D.awaiting) {
        pushNotice('Najprv rozhodni o čakajúcom zápise — Povoliť alebo Zamietnuť.');
        pendingCard()?.focus();

        return;
    }

    const input = $('charon-input');
    if (input) {
        input.value = '';
        autoGrow(input);
    }

    D.sending = true;

    try {
        pushUser(message);

        const thread = await ensureThread();
        if (!thread) {
            pushError('Vlákno sa nepodarilo založiť — správa neodišla.');

            return;
        }

        const body = { thread, message, profile: PROFILE };

        // Kontext: iba id vybraných uzlov (mŕtve preskoč), capnuté. Text skladá
        // server (ContextBlock) — klient nikdy neposiela popis uzla.
        const ids = contextIds();
        if (ids.length) body.context_node_ids = ids;

        await client.startRun(body);
    } finally {
        D.sending = false;
    }
}

/** Rozhodnutie o zápise beh nekončí — dostreamuje ho tá istá rúra. */
async function resumeAfterDecision(id, decision) {
    if (!D.thread) return;

    D.awaiting = null;

    await client.resumeDecision({ thread: D.thread, call: id, decision });
}

function stopRun() {
    if (!D.running) return;
    client.stop();
}

/**
 * Vlákno doku musí existovať pred prvým ťahom. Perzistuje sa, aby história
 * prežila reload; keď server hlási, že vlákno neexistuje (zmazané), založí sa
 * nové a id sa prepíše. Zakladá sa cez ten istý endpoint ako konzola —
 * dok NEMÁ druhú cestu k modelu.
 */
async function ensureThread() {
    if (D.thread) return D.thread;

    try {
        const res = await request('/api/console/threads', { method: 'POST', body: {} });
        if (!res.ok) return null;

        const data = await res.json();
        D.thread = data.uuid;
        try { localStorage.setItem(THREAD_KEY, D.thread); } catch (e) { /* úložisko plné */ }

        return D.thread;
    } catch (e) {
        return null;
    }
}

/* ---------- graph_focus → filter grafu ---------- */

/**
 * Vykoná fokus na plátne. `nav` je PRESNE argument go() (server ho tak posiela,
 * klient nič neprekladá). go() je FILTER: nemení pozície, nevymieňa scénu, zvyšok
 * stmavne a Esc ho zruší. Prekreslenie si rieši go() sám a je strážené
 * graphActive() — mimo Grafu teda nevyžiada ani jeden rAF frame. Žiadne draw()/
 * kickSim()/buildSim() tu preto nie je.
 *
 * Pri nečitateľnom rámci ticho nič — jeden pokazený tool result nesmie zlomiť
 * beh (to isté pravidlo ako parseNdjsonLine).
 */
function applyFocus(result) {
    let parsed;

    try {
        parsed = JSON.parse(String(result ?? ''));
    } catch (e) {
        return;
    }

    if (parsed && parsed.nav) go(parsed.nav);
}

/* ---------- kontext vybraných uzlov ---------- */

function loadContext() {
    if (!(S.charonCtx instanceof Set)) S.charonCtx = new Set();

    try {
        const raw = JSON.parse(localStorage.getItem(CTX_KEY) || '[]');
        if (Array.isArray(raw)) raw.forEach((id) => S.charonCtx.add(+id));
    } catch (e) { /* poškodený kontext — prázdny */ }
}

function persistContext() {
    try {
        localStorage.setItem(CTX_KEY, JSON.stringify([...S.charonCtx]));
    } catch (e) { /* úložisko plné — čipy žijú aspoň do reloadu */ }
}

/** Živé id kontextu (mŕtve uzly preskočené), capnuté na strop. */
function contextIds() {
    const live = [...S.charonCtx].filter((id) => S.byId?.has(id));

    // Mŕtve id sa pri tej príležitosti vyčistia z množiny aj z úložiska.
    if (live.length !== S.charonCtx.size) {
        S.charonCtx = new Set(live);
        persistContext();
    }

    return live.slice(0, CTX_MAX_NODES);
}

function toggleContext(id, label) {
    id = +id;
    if (S.charonCtx.has(id)) {
        S.charonCtx.delete(id);
    } else if (S.charonCtx.size >= CTX_MAX_NODES) {
        pushNotice(`Kontext má strop ${CTX_MAX_NODES} uzlov. Odober niektorý, ak chceš pridať ďalší.`);

        return;
    } else {
        S.charonCtx.add(id);
    }

    persistContext();
    renderContextChips();
    syncNodeButton();
}

function removeContext(id) {
    S.charonCtx.delete(+id);
    persistContext();
    renderContextChips();
    syncNodeButton();
}

function clearContext() {
    S.charonCtx.clear();
    persistContext();
    renderContextChips();
    syncNodeButton();
}

/* ---------- A8: verejné API kontextu pre packBtn a čítačku (pack.js) ----------

   Kontext doku je JEDINÝ mechanizmus „daj kontext Claude Code" (kontrakt R-6,
   nález A8). Tlačidlá „Do balíka" na obrazovkách Dnes / Denník / Knižnica aj v
   čítačke plnia cez tieto exporty priamo tento kontext — bývalý „Balík pre
   Claude Code" (S.pack) aj jeho zásuvka so schránkou zanikli. Von sa poznatok
   dostane rozhovorom s Charónom nad tým istým kontextom. */

/** Je uzol v kontexte doku? (číta ho pack.js pre stav tlačidiel „Do balíka") */
export function contextHas(id) {
    return S.charonCtx instanceof Set && S.charonCtx.has(+id);
}

/**
 * Prepne členstvo uzla v kontexte doku (add/remove). Pri PRIDANÍ, keď je dok
 * zavretý, ho otvorí a naplní (kontrakt B4: „packBtn ho vtedy nech otvorí a
 * naplní"). Druhý parameter `label` je len kvôli symetrii s volajúcimi —
 * popisky čipov skladá renderContextChips z S.byId. Vracia { on, full }.
 */
export function attachToContext(id, label) {   // eslint-disable-line no-unused-vars
    if (!(S.charonCtx instanceof Set)) S.charonCtx = new Set();
    id = +id;

    let result;
    if (S.charonCtx.has(id)) {
        S.charonCtx.delete(id);
        result = { on: false };
    } else if (S.charonCtx.size >= CTX_MAX_NODES) {
        result = { on: false, full: true };
    } else {
        S.charonCtx.add(id);
        result = { on: true };
    }

    persistContext();
    renderContextChips();
    syncNodeButton();

    if (result.on && !charonOpen()) openCharon();

    return result;
}

/** Zosúladí externé tlačidlá kontextu (#node-charon + .pack-btn) so stavom —
    volá ho panels.js cez pack.js `updatePackUi()` pri výbere uzla. */
export function refreshContextButtons() {
    syncNodeButton();
    syncPackButtons();
}

/** Čipy nad composerom — štítky uzlov v kontexte. HTML tried je zdieľané s
    pôvodným chatom (.ctx-chip/.ctx-label/.ctx-x/.ctx-clear žijú v mind.css). */
function renderContextChips() {
    const row = $('charon-ctx');
    if (!row) return;

    const ids = [...S.charonCtx].filter((id) => S.byId?.has(id));
    if (ids.length !== S.charonCtx.size) {
        S.charonCtx = new Set(ids);
        persistContext();
    }

    if (!ids.length) {
        row.classList.add('hidden');
        row.innerHTML = '';
        syncPackButtons();

        return;
    }

    row.classList.remove('hidden');
    row.innerHTML = ids.map((id) => {
        const n = S.byId.get(id);

        return '<span class="ctx-chip" data-id="' + id + '">'
            + '<span class="ctx-label">' + escapeAttr(n.label) + '</span>'
            + '<button type="button" class="ctx-x ms" title="Odobrať z kontextu" aria-label="Odobrať z kontextu">close</button>'
            + '</span>';
    }).join('')
        + '<button type="button" class="ctx-clear" title="Vyčistiť kontext">Vyčistiť</button>';

    syncPackButtons();
}

/** Zosúladí tlačidlo #node-charon so stavom kontextu pre práve vybraný uzol. */
function syncNodeButton() {
    const btn = $('node-charon');
    if (!btn) return;

    const on = !!(S.selected && S.charonCtx.has(+S.selected.id));
    btn.classList.toggle('in-context', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = on ? 'V rozhovore — klikni pre odobratie' : 'Priložiť do rozhovoru';
}

/** Zosúladí riadkové tlačidlá „Do balíka" (.pack-btn, packBtn v pack.js) so
    stavom kontextu doku — po A8 sú to producenti toho istého kontextu, takže
    ich stav sa mení aj keď človek odoberie čip priamo v doku. Trieda `in-pack`
    a štýly ostávajú z pack.js; mení sa len význam (kontext, nie balík). */
function syncPackButtons() {
    document.querySelectorAll('.pack-btn[data-pack-id]').forEach((b) => {
        const on = contextHas(b.dataset.packId);
        b.classList.toggle('in-pack', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.title = on ? 'V rozhovore — klikni pre odobratie' : 'Priložiť do rozhovoru';
    });
}

function escapeAttr(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

/* ---------- tok správ ---------- */

function appendBlock(node) {
    const box = stream();
    if (!box) return node;

    box.querySelector('.charon-empty')?.remove();

    if (waitNode?.isConnected) box.insertBefore(node, waitNode);
    else box.append(node);

    scrollIfFollowing();

    return node;
}

function pushBlock(node) {
    return appendBlock(node);
}

function pushUser(text) {
    const box = el('div', 'charon-msg charon-msg--user');
    box.append(el('span', 'charon-who', 'Ty'));
    box.append(el('div', 'charon-bubble', text));

    return appendBlock(box);
}

function pushNotice(text) {
    const box = el('div', 'charon-msg charon-msg--system');
    box.append(el('span', 'charon-who', 'Charón'));
    box.append(el('div', 'charon-bubble', text));

    return appendBlock(box);
}

function pushError(text) {
    const box = el('div', 'charon-msg charon-msg--error');
    const who = el('span', 'charon-who');
    const mark = el('span', 'ms', 'error');
    mark.setAttribute('aria-hidden', 'true');
    who.append(mark, el('span', null, 'Chyba'));
    box.append(who);
    box.append(el('div', 'charon-bubble', text));

    return appendBlock(box);
}

function renderEmpty() {
    const box = stream();
    if (!box) return;

    box.innerHTML = '';
    waitNode = null;

    const empty = el('div', 'charon-empty');
    empty.append(el('p', 'charon-empty-title', 'Charón nad grafom'));
    empty.append(el('p', null,
        'Opýtaj sa na vedomie a Charón ho prehľadá. Vybrané uzly (čipy nižšie) '
        + 'idú do otázky ako kontext a odpoveď vie graf zaostriť.'));
    box.append(empty);
}

/* ---------- čakanie na prvý token ---------- */

let waitNode = null;

function waitStart() {
    const box = stream();
    if (!box || waitNode?.isConnected) return;

    box.querySelector('.charon-empty')?.remove();

    const wrap = el('div', 'charon-msg charon-msg--assistant charon-thinking');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.append(el('span', 'charon-who', 'Charón'));

    const bubble = el('div', 'charon-bubble');
    const dots = el('span', 'charon-dots');
    for (let i = 0; i < 3; i++) dots.append(el('span', 'charon-dot'));
    bubble.append(dots, el('span', 'charon-note', 'Odpoveď sa pripravuje…'));

    wrap.append(bubble);
    box.append(wrap);
    waitNode = wrap;
    scrollIfFollowing();
}

function waitStop() {
    waitNode?.remove();
    waitNode = null;
}

/* ---------- streamovaná odpoveď ---------- */

function beginTurn() {
    D.turn = { raw: '', bubble: null };
    stream()?.setAttribute('aria-busy', 'true');
    waitStart();
}

function appendDelta(text) {
    if (!D.turn) beginTurn();
    waitStop();

    if (!D.turn.bubble) {
        const wrap = el('div', 'charon-msg charon-msg--assistant');
        wrap.append(el('span', 'charon-who', 'Charón'));
        const bubble = el('div', 'charon-bubble charon-md');
        wrap.append(bubble);
        appendBlock(wrap);
        D.turn.bubble = bubble;
        D.turn.raw = '';
    }

    D.turn.raw += String(text ?? '');
    schedulePaint();
}

/* Markdown sa prekresľuje raz za 33 ms cez setTimeout — NIE rAF. Dôvod je
   v hlavičke súboru (kritérium §5/7): beh, ktorý prežije prepnutie obrazovky
   z Grafu, nesmie mimo Grafu vyžiadať frame. Na skrytej karte by sa rAF ani
   nespustil, takže setTimeout je tu navyše aj funkčne správnejší. */
function schedulePaint() {
    if (painting) return;

    painting = setTimeout(() => {
        painting = 0;
        paintTurn();
    }, 33);
}

function paintTurn() {
    if (!D.turn?.bubble) return;

    D.turn.bubble.innerHTML = renderMarkdown(D.turn.raw);
    scrollIfFollowing();
}

function closeBubble() {
    if (!D.turn) return;

    paintTurn();
    D.turn.bubble = null;
    D.turn.raw = '';
}

function endTurn() {
    if (painting) {
        clearTimeout(painting);
        painting = 0;
    }

    waitStop();
    paintTurn();
    stream()?.setAttribute('aria-busy', 'false');
    D.turn = null;
}

/* ---------- karty nástrojov ---------- */

function toolCard(frame) {
    const card = el('div', 'charon-tool running');
    card.dataset.id = frame.id;
    if (frame.write) card.classList.add('write');

    const head = el('button', 'charon-tc-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');

    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');

    head.append(el('span', 'charon-tc-caret', ''));
    head.append(mark);
    head.append(el('span', 'charon-tc-name', frame.name || 'nástroj'));
    head.append(el('span', 'charon-tc-args', argsSummary(frame.arguments)));
    head.append(el('span', 'charon-tc-state', 'beží…'));

    const body = el('div', 'charon-tc-body hidden');
    head.addEventListener('click', () => toggleBody(card));
    card.append(head, body);

    return card;
}

function markResult(frame, root = document) {
    const call = {
        status: frame.status,
        result: frame.result,
        error: frame.error,
        duration_ms: frame.duration_ms,
    };

    const card = root.querySelector(`.charon-tool[data-id="${frame.id}"]`);
    if (card) {
        fillResult(card, call);

        return card;
    }

    // Povolený/zamietnutý zápis prichádza pod id karty potvrdenia — rámec `tool`
    // preň nepríde. Bez tejto vetvy sa výsledok jediného kroku, na ktorý človek
    // klikol, ticho zahodí.
    const perm = root.querySelector(`.charon-perm[data-id="${frame.id}"]`);
    if (perm) {
        const made = toolCard({ id: frame.id, name: perm.dataset.name, arguments: perm.hadesArgs, write: true });
        perm.after(made);
        fillResult(made, call);

        return made;
    }

    // Ani karta, ani potvrdenie (napr. auto-povolenie): výsledok sa vykreslí aj
    // tak — ticho zahodený je najhorší.
    const orphan = toolCard({ id: frame.id, name: frame.name || 'nástroj', arguments: frame.arguments });
    pushBlock(orphan);
    fillResult(orphan, call);

    return orphan;
}

function normalizeStatus(status) {
    return status === 'failed' ? 'error' : (status || 'done');
}

function fillResult(card, call) {
    const status = normalizeStatus(call.status);
    const state = card.querySelector('.charon-tc-state');
    const body = card.querySelector('.charon-tc-body');
    const head = card.querySelector('.charon-tc-head');

    card.classList.remove('running', 'waiting');
    card.classList.add(status);
    if (status === 'error') card.classList.remove('done');

    const text = status === 'error' ? (call.error || call.result || 'Nástroj zlyhal.') : (call.result ?? '');
    const lines = String(text).split(/\r?\n/);
    const label = [];

    if (status === 'denied') label.push('zamietnuté');
    else if (status === 'error') label.push('chyba');
    else if (String(text).trim() === '') label.push('bez výstupu');
    else label.push(`${num(lines.length, 0)} ${plural(lines.length)}`);

    if (call.duration_ms) label.push(duration(call.duration_ms));
    state.textContent = label.join(' · ');

    body.innerHTML = '';

    if (String(text).trim() === '') {
        body.classList.add('hidden');
        head.setAttribute('aria-expanded', 'false');

        return;
    }

    const pre = el('pre', 'charon-tc-result');
    if (looksLikeDiff(text)) {
        pre.classList.add('diff');
        pre.innerHTML = diffHtml(text);
    } else {
        pre.textContent = text;
    }

    const long = lines.length > PEEK_LINES || String(text).length > PEEK_LINES * 90;
    if (long) pre.classList.add('clamped');
    body.append(pre);

    if (long) {
        const more = el('button', 'charon-tc-more', 'rozbaliť');
        more.type = 'button';
        more.addEventListener('click', () => {
            const clamped = pre.classList.toggle('clamped');
            more.textContent = clamped ? 'rozbaliť' : 'zbaliť';
            scrollIfFollowing();
        });
        body.append(more);
    }

    body.classList.remove('hidden');
    head.setAttribute('aria-expanded', 'true');
    scrollIfFollowing();
}

function toggleBody(card) {
    const body = card.querySelector('.charon-tc-body');
    const head = card.querySelector('.charon-tc-head');
    if (!body.children.length) return;

    const hidden = body.classList.toggle('hidden');
    head.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    scrollIfFollowing();
}

function duration(ms) {
    return ms < 950 ? `${num(ms, 0)} ms` : `${num(ms / 1000)} s`;
}

function plural(count) {
    if (count === 1) return 'riadok';

    return count >= 2 && count <= 4 ? 'riadky' : 'riadkov';
}

/* ---------- potvrdenie zápisu (dvojfázová brána) ---------- */

/**
 * Srdce Charóna: zápis sa nestane, kým človek neklikne. Karta si berie fokus,
 * aby Enter/Esc fungovali bez mierenia myšou. Toto je tá istá brána ako
 * v konzole — dok ju nemôže obísť, lebo beží na tej istej rúre.
 */
function permissionCard(frame) {
    const card = el('div', 'charon-perm');
    card.dataset.id = frame.id;
    card.dataset.name = frame.name || '';
    card.hadesArgs = frame.arguments;
    card.hadesPreview = frame.preview;
    card.tabIndex = -1;
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', `${writeTarget(frame.name, frame.arguments, frame.preview)} — čaká na povolenie`);

    const head = el('div', 'charon-perm-head');
    const mark = el('span', 'ms', iconFor(frame.name));
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark);
    head.append(el('strong', 'charon-perm-name', frame.name || 'nástroj'));
    head.append(el('span', 'charon-perm-args', argsSummary(frame.arguments)));
    card.append(head);

    card.append(el('p', 'charon-perm-ask', 'Toto je zápis. Pustím ho?'));

    const preview = String(frame.preview ?? '');
    if (preview.trim() !== '') {
        const box = el('pre', 'charon-perm-preview');
        if (looksLikeDiff(preview)) {
            box.classList.add('diff');
            box.innerHTML = diffHtml(preview);
        } else {
            box.textContent = preview;
        }
        card.append(box);
    } else if (frame.arguments) {
        const box = el('pre', 'charon-perm-preview');
        box.textContent = JSON.stringify(frame.arguments, null, 2);
        card.append(box);
    }

    const actions = el('div', 'charon-perm-actions');
    [
        ['allow', 'Povoliť', 'Enter', 'primary'],
        ['allow_always', 'Povoliť vždy', '', 'ghost'],
        ['deny', 'Zamietnuť', 'Esc', 'danger'],
    ].forEach(([decision, text, key, cls]) => {
        const btn = el('button', `charon-perm-btn ${cls}`);
        btn.type = 'button';
        btn.dataset.dec = decision;
        btn.append(el('span', null, text));
        if (key) btn.append(el('kbd', null, key));
        btn.addEventListener('click', () => decide(card, decision));
        actions.append(btn);
    });
    card.append(actions);

    card.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            decide(card, 'deny');

            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            if (event.target.closest('button')) return;
            event.preventDefault();
            event.stopPropagation();
            decide(card, 'allow');
        }
    });

    // Fokus po vložení do DOM. setTimeout, nie rAF (kritérium §5/7): element
    // ešte nemusí byť pripojený, keď kartu skladáme.
    setTimeout(() => {
        if (card.isConnected && !card.classList.contains('decided')) card.focus();
    }, 0);

    return card;
}

function decide(card, decision) {
    if (card.classList.contains('decided')) return;

    const hadFocus = card.contains(document.activeElement);

    card.classList.add('decided');
    card.classList.add(decision === 'deny' ? 'denied' : 'allowed');
    card.querySelectorAll('button').forEach((btn) => { btn.disabled = true; });

    const done = el('p', 'charon-perm-done', decisionLabel(decision) || decision);
    card.querySelector('.charon-perm-actions').replaceWith(done);

    if (hadFocus) card.focus();

    announce(`${decisionLabel(decision) || decision}. ${writeTarget(card.dataset.name, card.hadesArgs, card.hadesPreview)}.`);

    resumeAfterDecision(Number(card.dataset.id), decision);
}

function pendingCard(root = document) {
    return root.querySelector('.charon-perm:not(.decided)');
}

/* ---------- stav behu v UI ---------- */

function setRunning(on, parked = false) {
    D.running = on;

    $('charon-send')?.classList.toggle('hidden', on);
    $('charon-stop')?.classList.toggle('hidden', !on);
    $('charon-send')?.toggleAttribute('disabled', parked);
    $('charon')?.classList.toggle('parked', parked);

    clearInterval(ticker);
    ticker = 0;
    if (on) ticker = setInterval(paintStatus, 1000);

    paintStatus();
}

function paintStatus() {
    const out = $('charon-status');
    if (!out) return;

    const bits = [];
    if (D.awaiting) bits.push('čaká na rozhodnutie');
    else if (D.running) bits.push(`${Math.max(0, Math.round((Date.now() - D.t0) / 1000))} s`);

    if (D.step) bits.push(`krok ${D.step.n}/${D.step.of}`);

    if (!D.running) {
        const cost = costLabel(D.stats, num);
        if (cost !== '') bits.push(cost);
    }

    out.textContent = bits.join(' · ');
}

function announce(text) {
    const live = $('charon-announce');
    if (live) live.textContent = text;
}

function noteStop(reason) {
    const note = stopNote(reason);
    if (note === '') return;

    closeBubble();
    pushNotice(note);
}

function endAnnounce(frame) {
    const bits = [cleanStop(frame.stop_reason) ? 'Odpoveď dokončená' : 'Beh prerušený'];
    if (frame.tokens_out) bits.push(`${num(frame.tokens_out, 0)} tokenov`);

    return `${bits.join(', ')}.`;
}

/* ---------- skrolovanie ---------- */

const FOLLOW_SLACK = 64;

function distanceFromBottom(node) {
    return node.scrollHeight - node.scrollTop - node.clientHeight;
}

function scrollIfFollowing() {
    const box = stream();
    if (box && D.follow) box.scrollTop = box.scrollHeight;
}

/* ---------- composer ---------- */

function autoGrow(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
