/* ===========================================================================
   Charón — klient jedného behu (dvojfázový NDJSON protokol).

   Jediná implementácia protokolu, ktorý zdieľa plná konzola (public/js/console/)
   aj dok Charóna nad grafom. Beh je jeden POST, ktorého telo tečie ako
   newline-delimited JSON. Nie SSE zámerne — EventSource nedokáže poslať CSRF
   hlavičku, takže by endpoint musel opustiť chránený okruh (§8.11
   docs/BEZPECNOST.md). fetch + ReadableStream to zvládne aj s CSRF a podporuje
   abort.

   Dve pravidlá protokolu, na ktorých tu všetko stojí:
     • ťah končí PRESNE jedným rámcom `end` alebo `error`;
     • rámec `permission` ťah ukončí BEZ `end` — beh je zaparkovaný a `/decide`
       ho rozbehne a dostreamuje zvyšok. Preto sa parkovanie nesmie tváriť ako
       koniec: `state.awaiting` drží, že sa ešte nič neskončilo.

   FRONT ZADANÍ (nález A18) leží NAD protokolom a je čisto klientsky: server
   o ňom nevie a nevznikol preň žiadny nový rámec. Písanie počas behu bolo do
   25. 8. 2026 tichý no-op — správa sa nedala zaradiť a človek nevedel, či
   zabrala, pričom pri modeli na ~9 tok/s je napísať si ďalší krok dopredu tá
   najprirodzenejšia vec. Front je preto VIDITEĽNÝ (`onQueueChange`) a
   ZRUŠITEĽNÝ (`cancelQueued`, `clearQueue`), a drží ho jedno pravidlo:
   **zaparkovaný zápis front NEPRESKOČÍ** — kým `state.awaiting` niečo drží,
   front stojí. Nie je to pohodlie, ale tá istá brána: druhá správa poslaná
   okolo nerozhodnutého zápisu by z dvojfázového povolenia urobila obchádzku.

   Front je opt-in a nemá vlastnú cestu k modelu: zaradené zadanie odchádza tým
   istým `runStream(RUN_URL, …)` ako `startRun`. Volajúci, ktorý `enqueue`
   nezavolá, sa chová presne ako predtým — front zostáva prázdny a runStream sa
   ho ani nepýta.

   createRunClient je hoistovaná `export function`, aby sa smela objaviť v cykle.
   Importuje len transport zo susedného shared/ndjson.js (leaf, bez cyklu).
   =========================================================================== */

import { readNdjson, firstErrorMessage } from './ndjson.js';

const RUN_URL = '/api/console/run';
const DECIDE_URL = '/api/console/decide';

/**
 * Klient jedného behu. Vracia objekt uzáverov, nie triedu.
 *
 * `request(url, { method, body, signal })` → Response: dodáva volajúci (konzola
 *   má vlastný http.js s CSRF a hlásením zamknutého okruhu; dok si postaví
 *   6-riadkový obal nad guardovaný `fetch`). Telo si klient číta sám.
 * `state` je vrecko stavu, ktoré si drží volajúci (konzola má `C`). Klient píše
 *   a číta kľúče: `abort`, `awaiting`, `step`, `stats`, `t0`. Prečo nie stav
 *   v module: dok a konzola sú dve inštancie tej istej mechaniky, nie dve kópie
 *   — modulový stav by z nich urobil singleton.
 * `view` sú spätné volania; každé smie chýbať. Mená sedia na rámce protokolu:
 *   onStart(frame), onDelta(text), onStep(frame), onTool(frame),
 *   onToolResult(frame, name), onPermission(frame), onEnd(frame),
 *   onError(text, fromFrame), onNotice(text), onThreadState(frame),
 *   onRunningChange(on, parked), onSettled(), onAfter(),
 *   onQueueChange(items, held), onQueueSend(item).
 *   `onToolResult` dostáva aj MENO nástroja z rámca `tool` — klient si drží
 *   Map<id, name>, takže dok nemusí meno dohľadávať v DOM podľa data-id.
 *   `onError(text, fromFrame)`: fromFrame=true iba pri rámci `error` v prúde
 *   (tam konzola hlási aj do čítačky); transportné chyby ho nemajú.
 *   `onQueueChange(items, held)` sa volá pri KAŽDEJ zmene frontu (zaradenie,
 *   zrušenie, odoslanie): `items` je kópia frontu, `held` hovorí, že front
 *   práve stojí (beh tečie, alebo čaká nerozhodnutý zápis). `onQueueSend(item)`
 *   príde tesne pred tým, než zaradené zadanie odíde na server — plocha si
 *   vtedy presunie správu z poradia do toku.
 */
export function createRunClient({ request, state, view } = {}) {
    const v = view || {};
    const toolNames = new Map();

    /* ---------- front zadaní (nález A18) ----------------------------------
       Stav frontu žije v uzávere, nie v module — z tých istých dôvodov, pre
       ktoré je tu `state` zvonka: dok, konzola a chat sú tri inštancie tej istej
       mechaniky, a modulový front by z nich urobil jedno spoločné poradie, do
       ktorého by jedna plocha zaradila správu a odoslala ju druhá.

       `streaming` je vlastný príznak, a nie čítanie `state.abort`: `state`
       vlastní volajúci a mutuje si ho sám (konzola napr. nuluje `awaiting` pred
       `/decide`), takže vzájomné vylúčenie dvoch ťahov by viselo na cudzom
       kľúči. Posledné slovo má aj tak server — `RunController::run` druhý ťah
       v tom istom vlákne odmietne. */
    const queue = [];
    let queueSeq = 0;
    let streaming = false;
    let flushTimer = 0;

    function call(name, ...args) {
        const fn = v[name];

        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /* ---------- front zadaní: mechanika ---------------------------------- */

    /** Kópia frontu pre plochu — vnútro si volajúci mutovať nesmie. */
    function queueSnapshot() {
        return queue.map((item) => ({ id: item.id, body: { ...item.body } }));
    }

    /**
     * Stojí front? Dva dôvody a druhý je bezpečnostný:
     *
     *  • `streaming` — beh práve tečie, druhý ťah v tom istom vlákne by aj tak
     *    server odmietol (`RunController::run` drží exkluzivitu vlákna);
     *  • `state.awaiting` — beh je ZAPARKOVANÝ na rozhodnutí človeka. Front sa
     *    tu zastaví, aj keď prúd už netečie a odoslať by technicky šlo. Správa
     *    poslaná teraz by obišla dvojfázovú bránu presne v okamihu, keď brána
     *    robí svoju prácu, a modelu by dala druhé zadanie ešte pred tým, než sa
     *    o jeho prvom zápise rozhodlo. Server to odmietne tiež (a je to jeho
     *    posledné slovo), ale front sa oň nesmie opierať: odmietnutá správa by
     *    z poradia vypadla ako chyba, ktorú človek nevyžiadal.
     */
    function isQueueHeld() {
        return streaming || !!state.awaiting;
    }

    function announceQueue() {
        call('onQueueChange', queueSnapshot(), isQueueHeld());
    }

    /**
     * Odoslanie zaradeného zadania sa plánuje ako MAKROtask (`setTimeout` 0),
     * nie mikrotask a nie rovno v `finally`: volajúci má za `await startRun()`
     * vlastný dobeh (konzola tam napr. pustí `C.sending = false`) a ten musí
     * skončiť skôr, než sa rozbehne ďalší ťah. Jeden časovač naraz — inak by
     * dva zdroje spustenia (dobeh behu a `enqueue`) naplánovali dva.
     */
    function scheduleFlush() {
        if (flushTimer) return;

        flushTimer = setTimeout(() => {
            flushTimer = 0;
            flushQueue();
        }, 0);
    }

    function flushQueue() {
        if (isQueueHeld() || queue.length === 0) return;

        const item = queue.shift();

        announceQueue();
        call('onQueueSend', { id: item.id, body: { ...item.body } });

        // Tá istá rúra ako `startRun` — front nie je druhá cesta k modelu.
        // Sľub tu nikto nečaká (spustil ho časovač, nie klik), takže výnimku zo
        // spätného volania plochy treba zachytiť: nezachytené odmietnutie by
        // skončilo len v konzole prehliadača a zvyšok poradia by ostal ticho
        // stáť, lebo `scheduleFlush()` na konci `runStream` by sa nevykonal.
        runStream(RUN_URL, item.body).catch((error) => {
            call('onError', `Zaradená správa neodišla: ${error?.message || 'neznáma chyba'}`);

            if (queue.length > 0) scheduleFlush();
        });
    }

    /**
     * Veta k odmietnutému behu. Backend aj pri 422 posiela TEN ISTÝ NDJSON rámec
     * `error` a jeho text hovorí, čo sa naozaj stalo. Generická veta zostáva ako
     * záloha, keď telo chýba alebo sa nedá naparsovať.
     */
    async function refusalText(res) {
        const fallback = `Beh sa nepodarilo spustiť (HTTP ${res.status}).`;

        let text = '';

        try {
            text = await res.text();
        } catch {
            return fallback;
        }

        return firstErrorMessage(text, fallback);
    }

    /** Vracia true, ak parsovaný riadok bol koncovým rámcom ťahu. */
    function onFrame(parsed) {
        if (parsed.error) {
            call('onError', parsed.error);

            return false;
        }

        return dispatch(parsed.frame);
    }

    /**
     * Rámec → volanie. Stav vlákna sa premieta AŽ PO ňom: koncové rámce `/decide`
     * nesú aj `auto_accept` a hlásenie o vypnutej bráne má prekryť rutinné
     * „Odpoveď dokončená", nie naopak.
     */
    function dispatch(frame) {
        const closing = route(frame);

        call('onThreadState', frame);

        return closing;
    }

    function route(frame) {
        switch (frame.t) {
            case 'start':
                call('onStart', frame);

                return false;

            case 'delta':
                call('onDelta', frame.text);

                return false;

            case 'tool':
                if (frame.id != null) toolNames.set(frame.id, frame.name);
                call('onTool', frame);

                return false;

            case 'tool_result':
                call('onToolResult', frame, toolNames.get(frame.id));

                return false;

            case 'permission':
                // Stav sa nastaví PRED view: rámec `permission` ťah končí a klient
                // z `state.awaiting` v `finally` rozhoduje, že sa ešte nič neskončilo.
                state.awaiting = { id: frame.id, name: frame.name };
                call('onPermission', frame);

                return true;

            case 'step':
                state.step = { n: frame.n, of: frame.of };
                call('onStep', frame);

                return false;

            case 'end':
                // Kľúče sa menujú PRESNE ako v logu behov (`runs`) a v payloade
                // vlákna — jeden skladač ceny číta ten istý reťazec z oboch zdrojov.
                state.stats = {
                    tokens_in: frame.tokens_in,
                    tokens_out: frame.tokens_out,
                    tokens_per_second: frame.tokens_per_second,
                };
                state.step = null;
                call('onEnd', frame);

                return true;

            case 'error':
                call('onError', frame.message || 'Beh zlyhal.', true);

                return true;

            default:
                // Neznámy typ rámca sa ticho ignoruje: protokol sa má dať rozširovať
                // bez toho, aby starší klient spadol.
                return false;
        }
    }

    async function runStream(url, body) {
        streaming = true;
        state.abort = new AbortController();
        state.stats = null;
        state.step = null;
        state.t0 = Date.now();
        call('onRunningChange', true, false);

        let closed = false;   // videli sme end / error / permission?

        try {
            const res = await request(url, { method: 'POST', body, signal: state.abort.signal });

            if (!res.ok) {
                // 401/419 už ohlásil transport (http.js) do toku správ, druhé
                // hlásenie by len zdvojilo tú istú vetu.
                if (res.status !== 401 && res.status !== 419) {
                    call('onError', await refusalText(res));
                }
                closed = true;

                return;
            }

            if (!res.body) {
                call('onError', 'Prehliadač nevrátil telo odpovede — beh sa nedá čítať.');
                closed = true;

                return;
            }

            closed = await readNdjson(res.body.getReader(), onFrame);
        } catch (error) {
            if (error?.name === 'AbortError') {
                closed = true;
                call('onNotice', 'Beh zastavený. Čo prišlo, zostáva.');
            } else {
                call('onError', `Spojenie s behom sa prerušilo: ${error?.message || 'neznáma chyba'}`);
                closed = true;
            }
        } finally {
            // Ako PRVÉ, pred spätnými volaniami: keby niektoré z nich vyhodilo
            // výnimku, front by inak zostal navždy v stave „beh tečie".
            streaming = false;
            state.abort = null;

            // Krok sa nuluje TU a nie v case `end`: pri Stope (aj pri spadnutom
            // serveri) rámec `end` nikdy nepríde, takže hlavička by ostávala navždy
            // na „krok 1/12" nad ničím. Zaparkovaný beh je jediná výnimka — tam
            // krok stále platí, beh len čaká na rozhodnutie.
            if (!state.awaiting) state.step = null;

            call('onRunningChange', false, !!state.awaiting);
            call('onSettled');
        }

        if (!closed && !state.awaiting) {
            // Prúd skončil bez `end` aj bez `error` — server spadol alebo ho niekto
            // zrezal. Mlčať by znamenalo nechať plochu vyzerať, že ešte myslí.
            call('onError', 'Beh sa skončil bez odpovede — server prúd zavrel uprostred.');
        }

        call('onAfter');

        // Dobehnutý beh je jediné miesto, kde sa front rozbieha sám. Podmienka
        // na prázdny front tu je zámerne: plocha, ktorá front nepoužíva, nemá
        // po každom behu naplánovať ani časovač.
        //
        // Platí to aj pre beh ZASTAVENÝ človekom a pre beh, ktorý zlyhal —
        // „Stop" zastaví beh, front neruší. Plocha, ktorá chce Stopu dať aj
        // význam „a zabudni poradie", zavolá `clearQueue()`; ticho zahodiť
        // napísanú správu by klient sám nemal. Zaparkovaný beh je výnimka, ktorú
        // drží `isQueueHeld()`.
        if (queue.length > 0) scheduleFlush();
    }

    return {
        /** Spustí nový ťah: POST /api/console/run + prúd. */
        startRun(body) {
            return runStream(RUN_URL, body);
        },
        /** Dostreamuje zaparkovaný beh po rozhodnutí: POST /api/console/decide + prúd. */
        resumeDecision(body) {
            return runStream(DECIDE_URL, body);
        },
        /**
         * Zastaví bežiaci prúd. Text, ktorý už prišiel, ZOSTÁVA.
         *
         * Front tým nezaniká — viď koniec `runStream`.
         */
        stop() {
            if (state.abort) state.abort.abort();
        },

        /* ---------- front zadaní: rozhranie plochy ------------------------ */

        /**
         * Zaradí zadanie do frontu a vráti jeho `id` (kľúč pre `cancelQueued`).
         *
         * Zaradiť sa dá vždy, aj keď nič nebeží — vtedy zadanie odíde samo
         * hneď, ako sa vráti riadenie. Plocha tak nemusí zápasiť s otázkou, či
         * beh medzitým dobehol: jediná cesta odoslania správy môže ísť cez
         * `enqueue` a poradie zostane zachované.
         *
         * `id` je rastúce číslo a nie index: index sa pri odoslaní prvej položky
         * posunie a „zruš druhú v poradí" by zrušilo tretiu.
         */
        enqueue(body) {
            const item = { id: ++queueSeq, body };

            queue.push(item);
            announceQueue();

            if (!isQueueHeld()) scheduleFlush();

            return item.id;
        },

        /** Zruší jedno zaradené zadanie. `false` = také v poradí už nie je. */
        cancelQueued(id) {
            const at = queue.findIndex((item) => item.id === id);

            if (at < 0) return false;

            queue.splice(at, 1);
            announceQueue();

            return true;
        },

        /** Zruší celé poradie a vráti, koľko zadaní z neho vypadlo. */
        clearQueue() {
            const dropped = queue.length;

            if (dropped === 0) return 0;

            queue.length = 0;
            announceQueue();

            return dropped;
        },

        /** Čo v poradí stojí — kópia, v poradí odoslania. */
        queued() {
            return queueSnapshot();
        },

        /** Stojí front? (beh tečie, alebo čaká nerozhodnutý zápis) */
        queueHeld() {
            return isQueueHeld();
        },
    };
}
