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
   =========================================================================== */

import { C } from './state.js';
import { $, num } from './dom.js';
import { request } from './http.js';
import { ensureThread, loadThreads } from './main.js';
import {
    appendDelta, beginTurn, closeBubble, endTurn, paintStats, pushBlock,
    pushError, pushNotice, pushUser, announce, scrollIfFollowing, waitStart,
} from './render.js';
import { markResult, permissionCard, pendingCard, decidePending, toolCard } from './tools.js';

let ticker = 0;

export function wireRun() {
    document.addEventListener('console:send', (event) => { sendTurn(event.detail?.text || ''); });
    document.addEventListener('console:stop', stopRun);
    document.addEventListener('console:decide', (event) => {
        resumeAfterDecision(event.detail.id, event.detail.decision);
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

    if (C.running || C.booting) return;

    if (C.awaiting) {
        pushNotice('Najprv rozhodni o čakajúcom zápise — Povoliť alebo Zamietnuť.');
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

        await stream('/api/console/run', body);
    } finally {
        C.sending = false;
    }
}

/** Rozhodnutie o zápise beh nekončí — dostreamuje ho tá istá rúra. */
async function resumeAfterDecision(id, decision) {
    if (!C.thread) return;

    C.awaiting = null;

    await stream('/api/console/decide', {
        thread: C.thread.uuid,
        call: id,
        decision,
    });
}

export function stopRun() {
    if (!C.running || !C.abort) return;

    // Text, ktorý už prišiel, ZOSTÁVA. Stratiť odpoveď preto, že ju človek prestal
    // čítať, je horšie než nedokončená odpoveď.
    C.abort.abort();
}

/* ---------- samotný prúd ---------- */

async function stream(url, body) {
    C.abort = new AbortController();
    C.stats = null;
    C.step = null;
    C.t0 = Date.now();
    setRunning(true);

    let closed = false;   // videli sme end / error / permission?

    try {
        const res = await request(url, { method: 'POST', body, signal: C.abort.signal });

        if (!res.ok) {
            // 401/419 už ohlásil http.js do toku správ, druhé hlásenie by len
            // zdvojilo tú istú vetu.
            if (res.status !== 401 && res.status !== 419) {
                pushError(await refusalText(res));
            }
            closed = true;

            return;
        }

        if (!res.body) {
            pushError('Prehliadač nevrátil telo odpovede — beh sa nedá čítať.');
            closed = true;

            return;
        }

        closed = await consume(res.body.getReader());
    } catch (error) {
        if (error?.name === 'AbortError') {
            closed = true;
            pushNotice('Beh zastavený. Čo prišlo, zostáva.');
        } else {
            pushError(`Spojenie s behom sa prerušilo: ${error?.message || 'neznáma chyba'}`);
            closed = true;
        }
    } finally {
        C.abort = null;
        setRunning(false, !!C.awaiting);

        endTurn();
        paintStats();
        scrollIfFollowing();
    }

    if (!closed && !C.awaiting) {
        // Prúd skončil bez `end` aj bez `error` — server spadol alebo ho niekto
        // zrezal. Mlčať by znamenalo nechať konzolu vyzerať, že ešte myslí.
        pushError('Beh sa skončil bez odpovede — server prúd zavrel uprostred.');
    }

    if (C.thread) loadThreads();
}

/**
 * Veta k odmietnutému behu. Backend aj pri 422 posiela TEN ISTÝ NDJSON rámec
 * `error` (viď RunController::refuse) a jeho text hovorí, čo sa naozaj stalo —
 * „Vlákno čaká na rozhodnutie o zápise…", „Také vlákno neexistuje." Predtým sa
 * telo vôbec nečítalo a človek dostal len číslo stavu, teda presne tú
 * informáciu, s ktorou sa nedá nič spraviť. Generická veta zostáva ako záloha,
 * keď telo chýba alebo sa nedá naparsovať.
 */
async function refusalText(res) {
    const fallback = `Beh sa nepodarilo spustiť (HTTP ${res.status}).`;

    let text = '';

    try {
        text = await res.text();
    } catch {
        return fallback;
    }

    // Telo je NDJSON ako celý zvyšok protokolu — rámcov môže byť aj viac,
    // hľadá sa prvý `error`.
    for (const line of text.split('\n')) {
        const raw = line.trim();
        if (raw === '') continue;

        let frame;

        try {
            frame = JSON.parse(raw);
        } catch {
            continue;
        }

        if (frame?.t === 'error' && frame.message) return String(frame.message);
    }

    return fallback;
}

/**
 * Čítanie prúdu. Buffer je tu povinný z dvoch dôvodov a oba sú overiteľné:
 *   1. jeden JSON objekt sa MÔŽE rozdeliť medzi dva chunky, takže naivné
 *      `split('\n')` nad jedným chunkom by na hranici hodilo SyntaxError;
 *   2. `TextDecoder` s `{ stream: true }` drží aj rozdelený viacbajtový znak —
 *      bez toho by sa slovenská diakritika na hranici chunku rozsypala na „�".
 * Vracia true, ak prúd riadne skončil rámcom end/error/permission.
 */
async function consume(reader) {
    const decoder = new TextDecoder();
    let buffer = '';
    let closed = false;

    for (;;) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let cut = buffer.indexOf('\n');

        while (cut >= 0) {
            const line = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 1);
            if (handleLine(line)) closed = true;
            cut = buffer.indexOf('\n');
        }
    }

    // Posledný riadok nemusí mať koncový newline — a decoder treba dorovnať.
    buffer += decoder.decode();
    if (handleLine(buffer)) closed = true;

    return closed;
}

/** Vracia true, ak riadok bol koncovým rámcom ťahu. */
function handleLine(line) {
    const text = line.trim();
    if (text === '') return false;

    let frame;

    try {
        frame = JSON.parse(text);
    } catch {
        // Nečitateľný riadok neukončí ťah — protokol ho zakazuje, ale keby prišiel,
        // stratiť zvyšok odpovede kvôli jednému rámcu by bola horšia chyba.
        pushError('Nečitateľný rámec z behu (preskočený).');

        return false;
    }

    return dispatch(frame);
}

/**
 * Rámec → obrazovka. Stav vlákna sa premieta AŽ PO ňom: koncové rámce `/decide`
 * nesú aj `auto_accept` a hlásenie o vypnutej bráne má prekryť rutinné „Odpoveď
 * dokončená" v `#run-announce`, nie naopak.
 */
function dispatch(frame) {
    const closing = route(frame);

    applyThreadState(frame);

    return closing;
}

function route(frame) {
    switch (frame.t) {
        case 'start':
            beginTurn(frame);
            paintStats();

            return false;

        case 'delta':
            appendDelta(frame.text);
            paintStats();

            return false;

        case 'tool':
            // Karta ukončí rozpracovanú bublinu, aby text po nástroji začal novú.
            closeBubble();
            pushBlock(toolCard(frame));

            return false;

        case 'tool_result':
            markResult(frame);
            // Nástroj dobehol a model premýšľa znova. Toto ticho je rovnako dlhé
            // ako to pred prvým tokenom, takže si žiada ten istý signál.
            waitStart();

            return false;

        case 'permission':
            closeBubble();
            C.awaiting = { id: frame.id, name: frame.name };
            pushBlock(permissionCard(frame));
            // Stav sa musí prekresliť HNEĎ: rámec `permission` ťah končí, tikanie
            // sekúnd dobehne až v `finally`, a do vtedy by hlavička tvrdila, že
            // model ešte píše.
            paintStats();
            announce(`Nástroj ${frame.name} čaká na povolenie.`);

            return true;

        case 'step':
            C.step = { n: frame.n, of: frame.of };
            paintStats();

            return false;

        case 'end':
            C.stats = {
                tokens_in: frame.tokens_in,
                tokens_out: frame.tokens_out,
                tps: frame.tokens_per_second,
            };
            C.step = null;
            noteStop(frame.stop_reason);
            announce(endAnnounce(frame));

            return true;

        case 'error':
            pushError(frame.message || 'Beh zlyhal.');
            announce('Beh zlyhal.');

            return true;

        default:
            // Neznámy typ rámca sa ticho ignoruje: protokol sa má dať rozširovať
            // bez toho, aby starší klient spadol.
            return false;
    }
}

function endAnnounce(frame) {
    const bits = [cleanStop(frame.stop_reason) ? 'Odpoveď dokončená' : 'Beh prerušený'];

    if (frame.tokens_out) bits.push(`${num(frame.tokens_out, 0)} tokenov`);
    if (frame.tokens_per_second) bits.push(`${num(frame.tokens_per_second)} tokenov za sekundu`);

    return `${bits.join(', ')}.`;
}

/**
 * Dôvody, po ktorých je odpoveď naozaj celá. Všetko ostatné, čo môže v rámci
 * `end` prísť, znamená zrezaný ťah: `max_steps` posiela AgentRunner po dosiahnutí
 * stropu kôl, `max_tokens` hlási model, ktorý minul okno, a Ollama si vyhradzuje
 * právo poslať vlastný `done_reason`, ktorý sa prekladom nestratí.
 */
const CLEAN_STOP = ['end_turn', 'stop_sequence'];

const STOP_NOTE = {
    max_steps: 'Beh narazil na strop krokov — úloha mohla zostať nedokončená. Pokračovať sa dá ďalšou správou.',
    max_tokens: 'Model minul okno odpovede — text je zrezaný, nie dokončený. Pokračovať sa dá ďalšou správou.',
};

function cleanStop(reason) {
    return CLEAN_STOP.includes(String(reason || 'end_turn'));
}

/**
 * Neriadne ukončený ťah vyzeral v toku PRESNE ako dokončená odpoveď: klient
 * z rámca `end` čítal len tokeny a `stop_reason` zahadzoval. Človek tak nemal
 * ako rozoznať odpoveď od behu zrezaného na dvanástom kroku.
 */
function noteStop(reason) {
    if (cleanStop(reason)) return;

    const stop = String(reason || '');

    // Karta / bublina sa uzavrie sama až v `finally`; bez tohto by poznámka
    // pristála doprostred rozpísaného odseku modelu.
    closeBubble();
    pushNotice(STOP_NOTE[stop] || `Beh sa skončil neriadne (${stop}) — úloha mohla zostať nedokončená.`);
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
        pushNotice('Zápisy sa v tomto vlákne už nepýtajú — brána je vypnutá. Vrátiť sa dá políčkom „Auto-povoliť zápisy" v hlavičke.');
        announce('Zápisy sa v tomto vlákne už nepýtajú.');
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
