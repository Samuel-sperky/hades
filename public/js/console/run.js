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
import { writeAsk } from '../shared/gate.js';
import { cleanStop, stopNote } from '../shared/runstate.js';
import { createRunClient } from '../shared/runclient.js';

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

        await client.startRun(body);
    } finally {
        C.sending = false;
    }
}

/** Rozhodnutie o zápise beh nekončí — dostreamuje ho tá istá rúra. */
async function resumeAfterDecision(id, decision) {
    if (!C.thread) return;

    C.awaiting = null;

    await client.resumeDecision({
        thread: C.thread.uuid,
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
