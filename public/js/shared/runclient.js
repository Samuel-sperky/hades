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
 *   onRunningChange(on, parked), onSettled(), onAfter().
 *   `onToolResult` dostáva aj MENO nástroja z rámca `tool` — klient si drží
 *   Map<id, name>, takže dok nemusí meno dohľadávať v DOM podľa data-id.
 *   `onError(text, fromFrame)`: fromFrame=true iba pri rámci `error` v prúde
 *   (tam konzola hlási aj do čítačky); transportné chyby ho nemajú.
 */
export function createRunClient({ request, state, view } = {}) {
    const v = view || {};
    const toolNames = new Map();

    function call(name, ...args) {
        const fn = v[name];

        return typeof fn === 'function' ? fn(...args) : undefined;
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
        /** Zastaví bežiaci prúd. Text, ktorý už prišiel, ZOSTÁVA. */
        stop() {
            if (state.abort) state.abort.abort();
        },
    };
}
