/* ===========================================================================
   Charón — agentový beh (NDJSON stream).

   Beh je jeden POST, ktorého telo tečie ako newline-delimited JSON: jeden objekt
   na riadok, `t` je diskriminátor. Nie SSE zámerne — EventSource nedokáže poslať
   CSRF hlavičku, takže by endpoint musel opustiť chránený okruh (§8.11
   docs/BEZPECNOST.md). fetch + ReadableStream to zvládne aj s CSRF a navyše
   podporuje abort.

   Dve pravidlá protokolu, na ktorých tu všetko stojí:
     • ťah končí PRESNE jedným rámcom `end` alebo `error`;
     • rámec `permission` ťah ukončí BEZ `end` — beh je zaparkovaný a `/decide`
       ho rozbehne a dostreamuje zvyšok. Preto sa parkovanie nesmie tváriť ako
       koniec: `C.awaiting` drží, že sa ešte nič neskončilo.

   Samotná mechanika prúdu (fetch, ReadableStream, parsovanie NDJSON, abort,
   dvojfázová brána) sa vo vlne 4 presťahovala do public/js/shared/runclient.js
   a shared/ndjson.js — dok Charóna nad grafom beží na tej istej, aby nemali dve
   kópie. Tu zostáva LEN konzolová view vrstva: čo sa kde nakreslí, ohlási a ako
   sa prepne composer. Klient volá tieto callbacky a mutuje `C`.

   PODAGENTI (`spawn_agent`). Tretie pravidlo protokolu: ťah končí aj rámcom
   `agent_wait` — vtedy zápis drží PODAGENT na svojom vlákne a `/decide` ide NAŇ.
   Rámce dieťaťa prichádzajú v obálke `{t:'agent', run, frame}` a kreslia sa do
   jeho vlastného rámca v toku (`.agent-run`), nikdy medzi kroky rodiča: inak by
   človek nevedel, komu povoľuje zápis. Sekcia PODAGENTI nižšie je zámerne
   AGREGÁT (profil, kroky, nástroje, cena) a nie druhá kresba priebehu — plný
   strom s hodinami má `/chat` (`public/js/chat/agents.js`), konzola je technická
   plocha a nesie z neho to, čo o zápise rozhoduje.
   =========================================================================== */

import { C } from './state.js';
import { $, el, num } from './dom.js';
import { request } from './http.js';
import { ensureThread, loadThreads } from './main.js';
import {
    appendDelta, beginTurn, closeBubble, endTurn, paintStats, pushBlock,
    pushError, pushNotice, pushUser, announce, scrollIfFollowing, waitStart,
} from './render.js';
import { markResult, permissionCard, pendingCard, decidePending, toolCard } from './tools.js';
import { writeAsk } from '../shared/gate.js';
import { cleanStop, costLabel, stopNote } from '../shared/runstate.js';
import { createRunClient } from '../shared/runclient.js';
import { iconSvg } from '../shared/icons.js';
import {
    agentErrorText, agentFootText, agentMetaText, agentStartAnnounce, agentWaitAnnounce, agentWaitCard,
} from '../shared/agents.js';

let ticker = 0;

/* Jeden klient behu pre celú konzolu. Mechanika (fetch + ReadableStream + CSRF
   + abort, dvojfázová brána, parsovanie NDJSON) žije v public/js/shared/ — dok
   Charóna nad grafom beží na tej istej, aby nemali dve kópie. `view` sú
   konzolové spätné volania: klient nevie nič o `#send`, `#stop` ani o toku
   správ, to všetko zostáva tu. Klient mutuje `C` (abort, awaiting, step, stats,
   t0); `C.thread`/`C.running` ostávajú v réžii tohto modulu. */
const client = createRunClient({
    request,
    state: C,
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

        onToolResult(frame) {
            markResult(frame);
            // Nástroj dobehol a model premýšľa znova. Toto ticho je rovnako dlhé
            // ako to pred prvým tokenom, takže si žiada ten istý signál.
            waitStart();
        },

        onPermission(frame) {
            closeBubble();
            pushBlock(permissionCard(frame));
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

        /* Podagenti. `onAgent*` volá `route()` v runclient.js — bez týchto štyroch
           callbackov beh s podagentom prežil, ale zaparkované dieťa sa v UI
           neukázalo (otvorený bod §7 kontraktu). */

        onAgentStart(frame) {
            // Text rodiča pred delegovaním sa uzavrie: rámec podagenta je vlastný
            // blok a nemá vyrásť doprostred rozpísaného odseku.
            closeBubble();
            // `ensureAgent`, nie `openAgent`: rámec, ktorý v toku už stojí, sa
            // druhý raz nekreslí. Jeden podbeh = jedno uuid = jeden rámec.
            ensureAgent(frame.run, frame);
            announce(agentStartAnnounce(frame));
        },

        onAgent(frame) {
            childFrame(String(frame.run || ''), frame.frame || {});
        },

        onAgentEnd(frame) {
            closeAgent(frame);
            paintStats();
        },

        onAgentWait(frame) {
            // POSLEDNÝ rámec ťahu rodiča — `end` už nepríde. `C.awaiting` (vrátane
            // `thread` podagenta) nastavil klient PRED týmto volaním; tu sa len
            // kreslí, aby o jednom stave nepísali dvaja.
            closeBubble();
            markAgentWait(frame);
            paintStats();
            announce(agentWaitAnnounce(frame));
        },

        onEnd(frame) {
            noteStop(frame.stop_reason);
            announce(endAnnounce(frame));
        },

        onError(text, fromFrame) {
            // 401/419 už ohlásil http.js do toku správ; transportné chyby prídu
            // s prázdnym `fromFrame` a hlásia sa len do toku. Rámec `error` z prúdu
            // ide aj do čítačky.
            pushError(text);
            if (fromFrame) announce('Beh zlyhal.');
        },

        onNotice(text) {
            pushNotice(text);
        },

        onThreadState: applyThreadState,
        onRunningChange: setRunning,

        onSettled() {
            endTurn();
            paintStats();
            scrollIfFollowing();
        },

        onAfter() {
            if (C.thread) loadThreads();
        },
    },
});

/* ---------------------------------------------------------------------------
   PODAGENTI

   Jeden rámec v toku na jeden podbeh. Čo je v ňom: profil, kroky, počet
   nástrojov, karty jeho nástrojov, jeho text a — to podstatné — karta brány jeho
   zápisu. Čo v ňom NIE JE: hodiny s rozpadom čakania na človeka (to je strom
   v `/chat`), a nič z toho sa nekreslí do toku rodiča.

   Texty (ohlásenia, veta o chýbajúcom náhľade), meta zlomok a argumenty karty
   brány z rámca `agent_wait` žijú v `public/js/shared/agents.js` — dok Charóna
   nad grafom hovorí o podagentovi tie isté vety. Zostáva tu KRESLENIE: konzola
   je technická plocha a nesie celý priebeh dieťaťa, dok len pás a kartu.
   --------------------------------------------------------------------------- */

/**
 * Rámce podagentov aktuálneho vlákna: uuid podbehu → jeho rámec v toku.
 *
 * Príznak „zaparkované" tu nie je a netreba ho: jediný zdroj pravdy o tom, či
 * rámec ešte platí, je `box.isConnected`. Obnova vlákna (`renderThread`) tok
 * vyprázdni, takže odpojený rámec znamená „kresli nový".
 */
const agents = new Map();

/** Mená nástrojov PODAGENTA podľa id volania — `tool_result` nesie len id. */
const childTools = new Map();

/** Rámec podbehu, ktorý je ešte v dokumente, alebo `null`. */
function agentEntry(run) {
    const key = String(run || '');

    if (key === '') return null;

    const found = agents.get(key);

    if (found && found.box.isConnected) return found;
    // Odpojený rámec (obnova vlákna tok vyprázdnila) — záznam by ďalej držal mŕtvy
    // DOM podbehu, ktorý už nikto neuvidí.
    if (found) agents.delete(key);

    return null;
}

/** Nový rámec podbehu v toku (rámec `agent_start`). */
function openAgent(frame) {
    const key = String(frame.run || '');
    const box = el('div', 'agent-run');

    if (key !== '') box.dataset.run = key;

    const head = el('div', 'agent-head');
    const mark = iconSvg('hub');

    // `hub` a nie `account_tree` (ktorým strom kreslí `/chat`): `hub` je v subsete
    // Material Symbols overený meraním šírky glyfu (CLAUDE.md, sekcia Ikony),
    // `account_tree` overený nie je — a ikona, ktorá v subsete nie je, sa vykreslí
    // ako vlastné ligatúrové meno.
    mark.setAttribute('aria-hidden', 'true');
    head.append(mark, el('strong', 'agent-title', 'Podagent'));

    const meta = el('span', 'agent-meta');

    head.append(meta);
    box.append(head);

    if (frame.task) box.append(el('p', 'agent-task', frame.task));

    const body = el('div', 'agent-body');

    box.append(body);
    pushBlock(box);

    const entry = {
        box,
        body,
        meta,
        thread: String(frame.thread || ''),
        profile: String(frame.profile || ''),
        steps: 0,
        of: Number(frame.max_steps) || 0,
        tools: 0,
        say: null,
    };

    agents.set(key, entry);
    paintMeta(entry);

    return entry;
}

/**
 * Rámec podbehu existuje, aj keď `agent_start` neprišiel.
 *
 * Prečo to treba: keď dieťa zaparkuje, ťah skončí a obnova ide cez
 * `POST /api/console/decide` na vlákno podagenta. V tom prúde prídu jeho ďalšie
 * rámce zabalené, ale `agent_start` už nie — vznikol v predošlom requeste.
 *
 * Bez uuid podbehu vracia `null`: rámec, ktorý sa nedá priradiť, nesmie skončiť
 * v rámci niekoho iného ani v prázdnom rámci „bez mena".
 */
function ensureAgent(run, seed = {}) {
    if (String(run || '') === '') return null;

    return agentEntry(run) || openAgent({ run, ...seed });
}

/**
 * Kroky a nástroje podbehu. Zlomok skladá `agentMetaText()` v shared/agents.js
 * (dok nad grafom ho hlási rovnako); tu zostáva len zápis do DOM.
 */
function paintMeta(entry) {
    entry.meta.textContent = agentMetaText(entry, num);
}

/**
 * Jeden ROZBALENÝ rámec dieťaťa. Kreslí sa do jeho rámca, nie do toku rodiča.
 *
 * `C.step` sa tu ZÁMERNE nemení: hlavička hovorí o ťahu, ktorý človek poslal, a
 * „krok 2/4" dieťaťa by v nej vyzeral ako krok rodiča. Kroky dieťaťa sú v jeho
 * rámci, kde je pri nich napísané, čie sú.
 */
function childFrame(run, frame) {
    const entry = ensureAgent(run);

    if (!entry) return;

    switch (frame.t) {
        case 'start':
            // Nový segment dieťaťa (po rozhodnutí) začína nový odsek jeho textu.
            entry.say = null;
            break;

        case 'delta':
            childSay(entry, frame.text);
            break;

        case 'step':
            entry.steps = Math.max(entry.steps, Number(frame.n) || 0);
            if (!entry.of) entry.of = Number(frame.of) || 0;
            paintMeta(entry);
            break;

        case 'tool':
            entry.tools += 1;
            if (frame.id != null) childTools.set(frame.id, frame.name);
            entry.body.append(toolCard(frame));
            paintMeta(entry);
            scrollIfFollowing();
            break;

        case 'tool_result': {
            // Meno pre osirotený výsledok si držíme sami: `Map<id, name>` v klientovi
            // pozná mená RODIČA (rámce dieťaťa idú v obálke, takže cez `route()`
            // nechodia).
            const name = frame.name || childTools.get(frame.id) || '';

            markResult(name === '' ? frame : { ...frame, name }, entry.body);
            break;
        }

        case 'permission':
            // Karta brány dieťaťa a jediná karta k tomuto zápisu. Náhľad sa berie
            // TU: rámec `agent_wait`, ktorý príde hneď za ním, nesie len meno
            // nástroja.
            entry.box.classList.add('is-waiting');
            entry.body.append(permissionCard(frame, { thread: entry.thread }));
            scrollIfFollowing();
            announce(writeAsk(frame));
            break;

        case 'end': {
            // Cenu a kroky podbehu hlási `agent_end`; z rámca `end` dieťaťa má
            // zmysel len neriadny konec (napr. strop krokov), o ktorom by inak
            // nebolo v toku ani slovo.
            const note = stopNote(frame.stop_reason);

            if (note !== '') entry.body.append(el('p', 'agent-note', note));
            entry.say = null;
            break;
        }

        case 'error':
            entry.box.classList.add('is-failed');
            entry.body.append(el('p', 'agent-error', agentErrorText(frame)));
            break;

        default:
            // Neznámy typ rámca sa ticho ignoruje — protokol sa má dať rozširovať
            // bez toho, aby staršia plocha spadla.
            break;
    }
}

/**
 * Text dieťaťa. Ako HOLÝ TEXT, nie markdown: je to zhrnutie pre rodiča, ktorý ho
 * v svojej odpovedi povie znova, a druhá markdownová rúra vnútri vnoreného rámca
 * by pridala kód aj réžiu prekresľovania za informáciu, ktorú tok o riadok nižšie
 * povie lepšie. `textContent` je tu zároveň jediná správna voľba: je to výstup
 * modelu, teda nedôveryhodný vstup.
 */
function childSay(entry, text) {
    if (!entry.say) {
        entry.say = el('p', 'agent-say');
        entry.body.append(entry.say);
    }

    entry.say.textContent += String(text ?? '');
    scrollIfFollowing();
}

/**
 * Podagent zaparkoval na zápise (rámec `agent_wait`).
 *
 * Karta už zvyčajne stojí — vnorený rámec `permission` prišiel tesne pred týmto.
 * Keď nie, poskladá ju `agentWaitCard()`: rámec nesie `child_call` a meno
 * nástroja, ale nie náhľad, takže sa to na nej PRIZNÁ. Rozhodnutie, ktoré sa nedá
 * urobiť, je horšie než rozhodnutie bez diffu — beh by inak čakal navždy.
 *
 * Vlákno sa dopĺňa aj karte, ktorá už stojí. Je to bezpečnostné: vnorený
 * `permission` vzniká skôr a vlákno podagenta nenesie, takže karta môže stáť bez
 * `data-thread` — a `/decide` ide práve naň. Do 26. 8. 2026 sa aktualizoval len
 * `entry.thread`, čím bola jedinou obranou záloha v `C.awaiting`, teda stav, ktorý
 * medzitým môže prepísať ďalší rámec. Rozhodnutie MUSÍ ísť na vlákno PODAGENTA.
 */
function markAgentWait(frame) {
    const entry = ensureAgent(frame.run, { thread: frame.thread });

    if (!entry) return;

    if (frame.thread) entry.thread = String(frame.thread);
    entry.box.classList.add('is-waiting');

    const seed = agentWaitCard(frame);

    if (!seed) return;

    const standing = entry.body.querySelector(`.perm-card[data-id="${seed.id}"]`);

    if (standing) {
        if (!standing.dataset.thread && entry.thread) standing.dataset.thread = entry.thread;

        return;
    }

    entry.body.append(permissionCard(seed, { thread: entry.thread }));
}

/** Uzavrie rámec podbehu a doplní jeho cenu (rámec `agent_end`). */
function closeAgent(frame) {
    const entry = ensureAgent(frame.run);

    if (!entry) return;

    entry.box.classList.remove('is-waiting');
    entry.box.classList.add('is-closed');
    entry.say = null;

    if (frame.steps) entry.steps = Number(frame.steps) || entry.steps;
    if (frame.tool_calls) entry.tools = Number(frame.tool_calls) || entry.tools;
    paintMeta(entry);

    const cost = costLabel({ tokens_in: frame.tokens_in, tokens_out: frame.tokens_out }, num);

    entry.body.append(el('p', 'agent-foot', agentFootText(cost, frame.status)));
    scrollIfFollowing();
}

/**
 * Zaparkovaný zápis podagenta PO OBNOVE STRÁNKY (`awaiting_agent` v payloade
 * vlákna).
 *
 * Prečo to nestačí nechať na obnovu toku: payload hlási v `awaiting`
 * `pendingToolCall()` TOHTO vlákna, čo je pri zaparkovanom dieťati `spawn_agent`
 * call RODIČA — čítací tool, ktorý kartu brány nemá mať vôbec. Karta nad ním
 * ponúka „Povoliť vždy", ktoré by vypnulo bránu celého rodičovského vlákna, a
 * „Povoliť", ktoré zápis dieťaťa nepovolí (tool len znova zaparkuje). Zápis, na
 * ktorý sa naozaj čaká, je v `awaiting_agent` a rozhodnutie patrí vláknu DIEŤAŤA.
 *
 * Kartu rodiča preto nahradí rámec podbehu s kartou dieťaťa — dve karty nad
 * jedným zápisom by boli dve pravdy o jednej bráne. Je to strážené: keď kartu
 * pre `awaiting_agent.id` už niekto nakreslil, táto funkcia nerobí nič.
 */
function restoreAgentWait(data) {
    const parked = data?.awaiting_agent;

    if (!parked || parked.id == null || !parked.thread) return;
    if (document.querySelector(`.perm-card[data-id="${parked.id}"]`)) return;

    if (data.awaiting != null) {
        document.querySelector(`.perm-card[data-id="${data.awaiting}"]`)?.remove();
    }

    const entry = openAgent({ run: parked.run, thread: parked.thread });

    entry.box.classList.add('is-waiting');
    entry.body.append(el('p', 'agent-note', 'Podagent čaká na rozhodnutie o zápise z predošlého behu.'));
    entry.body.append(permissionCard(parked, { thread: parked.thread }));

    // Stav sa prepíše na zápis, o ktorom sa naozaj rozhoduje: `main.js` doňho
    // uložil `awaiting`, teda `spawn_agent` call rodiča, a globálne Esc aj kontrola
    // pred odoslaním by potom hovorili o cudzom volaní.
    C.awaiting = { id: parked.id, name: parked.name || '', thread: parked.thread };
    paintStats();
    announce(writeAsk(parked));
}

export function wireRun() {
    document.addEventListener('console:send', (event) => { sendTurn(event.detail?.text || ''); });
    document.addEventListener('console:stop', stopRun);
    document.addEventListener('console:decide', (event) => {
        resumeAfterDecision(
            event.detail.id,
            event.detail.decision,
            event.detail.thread,
            event.detail.agent,
        );
    });

    // Iné vlákno je iná konverzácia — rámce podagentov predošlého vlákna z toku
    // zmizli s `renderThread`, takže mapa musí ísť s nimi. A hneď za tým: keď
    // otvorené vlákno drží zaparkovaný zápis podagenta, karta musí byť tá jeho.
    document.addEventListener('console:thread', (event) => {
        agents.clear();
        childTools.clear();
        restoreAgentWait(event.detail);
    });

    // Globálne Esc: počas behu zastaví, nad zaparkovaným zápisom zamietne. Karta
    // si vlastné Esc zastavuje sama (stopPropagation), takže sa nerozhodne dvakrát.
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (C.awaiting && pendingCard()) {
            event.preventDefault();
            decidePending('deny');
        } else if (C.running) {
            event.preventDefault();
            stopRun();
        }
    });
}

/** Odošle ťah. Vlákno vznikne ticho, ak človek prišiel na /console bez uuid. */
export async function sendTurn(text) {
    const message = String(text ?? '').trim();
    if (message === '') return;

    if (C.booting) return;

    // Písanie počas behu bolo do 20. 8. 2026 TICHÝ no-op: `#send` nie je
    // `disabled` (je len skrytý), takže Enter neurobil nič a neoznámil nič —
    // pri modeli na 9 tok/s je pritom napísať si ďalší krok dopredu tá
    // najprirodzenejšia vec. Front správ tu ZÁMERNE nie je: bola by to nová
    // funkcia so stavom, ktorá má vzniknúť až s logom behov, aby sa zaradená
    // správa dala aj zaznamenať. Text v poli zostáva — odoslať sa dá po behu.
    if (C.running) {
        pushNotice('Beh ešte beží — zastav ho klávesou Esc, alebo počkaj, kým dobehne. Text zostáva napísaný.');
        announce('Beh ešte beží. Správa neodišla.');

        return;
    }

    if (C.awaiting) {
        pushNotice('Najprv rozhodni o čakajúcom zápise — Povoliť alebo Zamietnuť.');
        pendingCard()?.focus();

        return;
    }

    const prompt = $('#prompt');

    if (prompt) {
        prompt.value = '';
        prompt.style.height = 'auto';
    }

    // Príznak sa zapína PRED bublinou aj pred založením vlákna: `newThread()`
    // rozbehnuté klikom na „Nové vlákno" môže dobehnúť práve teraz a bez tohto
    // by prázdnym stavom prepísalo tok aj s otázkou, ktorá do neho ide o riadok
    // nižšie.
    C.sending = true;

    try {
        // Bublina ide do toku PRED založením vlákna: pri modeli na 9 tok/s je jediná
        // vec, ktorá musí byť okamžitá, potvrdenie, že správa odišla.
        pushUser(message);

        const thread = await ensureThread();

        if (!thread) {
            pushError('Vlákno sa nepodarilo založiť — správa neodišla.');

            return;
        }

        // Titulok je prvá veta človeka; backend ho uloží, ale panel ho má mať hneď.
        if (!C.thread.title || C.thread.title === 'Nové vlákno') {
            C.thread.title = message.replace(/\s+/gu, ' ').slice(0, 60);
            $('#thread-title').textContent = C.thread.title;
            const row = C.threads.find((t) => t.uuid === C.thread.uuid);
            if (row) row.title = C.thread.title;
        }

        const body = { thread: C.thread.uuid, message };
        const model = $('#model-select')?.value;
        if (model) body.model = model;

        await client.startRun(body);
    } finally {
        C.sending = false;
    }
}

/**
 * Rozhodnutie o zápise beh nekončí — dostreamuje ho tá istá rúra.
 *
 * `thread` z karty má PREDNOSŤ pred otvoreným vláknom: pri zápise podagenta je
 * cieľom jeho vlastné vlákno (`agent_wait.thread`) a karta ho nesie od chvíle,
 * kedy vznikla. `C.awaiting` je len záloha pre kartu z obnovy — a čítá sa PRED
 * vynulovaním, inak by cieľ zmizol práve v okamihu, keď ho treba.
 *
 * Karta podagenta bez známeho vlákna sa NEODOŠLE. Tichý fallback na otvorené
 * vlákno by rozhodnutie doručil cudziemu behu.
 */
async function resumeAfterDecision(id, decision, thread = null, agent = false) {
    const target = thread || C.awaiting?.thread || (agent ? null : C.thread?.uuid);

    if (!target) {
        pushError(agent
            ? 'Rozhodnutie sa nedá odoslať — nie je známe vlákno podagenta, ktorému patrí.'
            : 'Rozhodnutie sa nedá odoslať — nie je známe vlákno, ktorému patrí.');

        return;
    }

    C.awaiting = null;

    await client.resumeDecision({
        thread: target,
        call: id,
        decision,
    });
}

export function stopRun() {
    if (!C.running || !C.abort) return;

    // Text, ktorý už prišiel, ZOSTÁVA. Stratiť odpoveď preto, že ju človek prestal
    // čítať, je horšie než nedokončená odpoveď.
    client.stop();
}

function endAnnounce(frame) {
    const bits = [cleanStop(frame.stop_reason) ? 'Odpoveď dokončená' : 'Beh prerušený'];

    if (frame.tokens_out) bits.push(`${num(frame.tokens_out, 0)} tokenov`);
    if (frame.tokens_per_second) bits.push(`${num(frame.tokens_per_second)} tokenov za sekundu`);

    return `${bits.join(', ')}.`;
}

/**
 * Neriadne ukončený ťah vyzeral v toku PRESNE ako dokončená odpoveď: klient
 * z rámca `end` čítal len tokeny a `stop_reason` zahadzoval. Človek tak nemal
 * ako rozoznať odpoveď od behu zrezaného na dvanástom kroku.
 *
 * Text vety NIE JE tu, ale v `runstate.js`: tú istú vetu musí po obnove stránky
 * povedať aj log behov, a dve kópie by sa rozišli.
 */
function noteStop(reason) {
    const note = stopNote(reason);
    if (note === '') return;

    // Karta / bublina sa uzavrie sama až v `finally`; bez tohto by poznámka
    // pristála doprostred rozpísaného odseku modelu.
    closeBubble();
    pushNotice(note);
}

/**
 * Premietne stav brány zápisov z koncového rámca `/decide` do `C.thread` aj do
 * políčka v hlavičke.
 *
 * Predtým sa `#auto-accept` nastavovalo LEN pri otvorení vlákna a pri ručnom
 * prepnutí, takže po kliknutí na „Povoliť vždy" ostalo odškrtnuté, hoci backend
 * bránu pre celé vlákno práve vypol — a ďalšie zápisy už išli bez pýtania.
 *
 * Vypnutá brána je bezpečnostne relevantná zmena stavu, takže ide aj do toku
 * správ: políčko v hlavičke je pri odpovedi, ktorá práve beží, to posledné,
 * čoho si človek všimne, a v histórii vlákna by po ňom nezostalo nič.
 */
function applyThreadState(frame) {
    if (typeof frame.auto_accept !== 'boolean') return;

    const before = !!C.thread?.auto_accept;

    if (C.thread) C.thread.auto_accept = frame.auto_accept;

    const box = $('#auto-accept');
    if (box) box.checked = frame.auto_accept;

    if (frame.auto_accept && !before) {
        closeBubble();
        pushNotice('Zápisy sa v tomto vlákne už nepýtajú — brána je vypnutá. Vrátiť sa dá políčkom „Auto-povoliť zápisy" v hlavičke.');
        announce('Zápisy sa v tomto vlákne už nepýtajú.');
    }
}

/* ---------- stav behu v UI ---------- */

/**
 * Počas behu je zo Send Stop. `parked` = beh čaká na rozhodnutie: Stop je vtedy
 * na nič (nič netečie), ale odosielať sa tiež nesmie, kým sa nerozhodne.
 */
function setRunning(on, parked = false) {
    C.running = on;

    $('#send')?.classList.toggle('hidden', on);
    $('#stop')?.classList.toggle('hidden', !on);
    $('#send')?.toggleAttribute('disabled', parked);
    $('#composer')?.classList.toggle('parked', parked);

    clearInterval(ticker);
    ticker = 0;

    // Sekundy tikajú len počas behu. Pri modeli na 9 tok/s je pohyb v hlavičke
    // jediné, čo človeku hovorí, že sa niečo deje — a naopak, tikať do prázdna
    // po skončení behu by bolo klamstvo.
    if (on) ticker = setInterval(paintStats, 1000);

    paintStats();
}
