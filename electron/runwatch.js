'use strict';

/**
 * Hades — desktop shell (sledovanie behov Charóna).
 *
 * Odpovedá na dve otázky, ktoré okno samo nevie povedať, keď je človek inde:
 * **dobehol beh?** a **spadol backend uprostred behu?**
 *
 * ─── Prečo sa to meria na sieti, a nie v DOM ────────────────────────────────
 *
 * Zaparkovaný zápis sa dnes chytá v DOM (`preload.js` sleduje `.perm-card`) —
 * je to stav stránky, nie správa z modelu. Dobehnutie behu sa TAK chytať nedá
 * spoľahlivo: beh sa dá spustiť z troch vstupov (graf/dok, `/console`, `/chat`),
 * každý má vlastné značky v DOM, a `/chat` sa práve teraz píše. Selektor by
 * uhádol jednu obrazovku a na druhej ticho mlčal.
 *
 * Na sieti je to naopak jediný fakt platný pre všetky tri vstupy: ťah je jeden
 * POST na `/api/console/run`, obnova zaparkovaného ťahu jeden POST na
 * `/api/console/decide` (kontrakt C-1: tretia cesta k modelu neexistuje, takže
 * tieto dve URL sú úplný zoznam). Prúd NDJSON je telo tejto odpovede, takže
 * **koniec requestu = koniec ťahu** a chyba requestu = ťah zomrel na sieti.
 *
 * ─── Čo to ZÁMERNE nevie ────────────────────────────────────────────────────
 *
 * `webRequest` nedáva telo odpovede, takže z requestu sa NEDÁ prečítať, či prúd
 * skončil rámcom `end` (dobehol) alebo `permission`/`agent_wait` (zaparkoval).
 * Rozdiel rozhoduje `main.js`: keď v tom okamihu drží zaparkovaný zápis
 * (`hades:pending-write` z preloadu), notifikácia „dobehol" sa nepošle, pretože
 * o čakaní už notifikoval tray. Tento modul len hlási holé fakty a nič netvrdí
 * o obsahu prúdu.
 *
 * ─── Pozor na jedno pravidlo `webRequest` ───────────────────────────────────
 *
 * Na každú udalosť `webRequest` môže byť pripojený LEN JEDEN poslúchač; druhý
 * ten prvý nahradí. `onBeforeSendHeaders` je obsadený injekciou UI tokenu
 * (`main.js`) — keby sa sem pripojil druhý, token by prestal chodiť a appka by
 * skončila na 401. Preto sa tu používajú výhradne udalosti, ktoré nikto iný
 * nemá, a navyše tie NEBLOKUJÚCE (`onSendHeaders`, `onCompleted`,
 * `onErrorOccurred`): nemajú `callback`, takže nepridávajú latenciu ani jednému
 * requestu okna.
 */

/** Cesty, ktoré nesú ťah modelu. Iné API requesty sa ignorujú. */
const RUN_PATHS = new Set(['/api/console/run', '/api/console/decide']);

/** Chyba, ktorá znamená „človek zastavil beh" alebo odchod zo stránky — nie výpadok. */
const ABORTED = 'net::ERR_ABORTED';

/**
 * @param {object} deps
 * @param {import('electron').Session} deps.session  Session okna (rovnaká, v ktorej žije injekcia tokenu).
 * @param {string} deps.origin                       Vlastný origin backendu (vrátane portu).
 * @param {(info: object) => void} [deps.onStart]    Ťah začal (`kind`: 'run' | 'decide').
 * @param {(info: object) => void} [deps.onFinish]   Ťah skončil bez chyby (`ms` = wall clock).
 * @param {(info: object) => void} [deps.onFail]     Ťah zomrel: sieťová chyba alebo HTTP >= 400.
 * @param {(info: object) => void} [deps.onAbort]    Ťah prerušil človek (zastavenie, odchod).
 */
function createRunWatcher(deps) {
    const { session, origin, onStart, onFinish, onFail, onAbort } = deps;

    /** Rozbehnuté ťahy: id requestu → { kind, startedAt }. */
    const inflight = new Map();

    let installed = false;

    /** Je toto POST na jednu z dvoch ciest k modelu na NAŠOM origine? */
    function runKind(details) {
        if (details.method !== 'POST') {
            return null;
        }

        let url;

        try {
            url = new URL(details.url);
        } catch {
            return null;
        }

        // Origin sa porovnáva presne, vrátane portu — na loopbacku beží aj Ollama,
        // Reverb a iné appky a ich requesty nás nezaujímajú.
        if (url.origin !== origin || !RUN_PATHS.has(url.pathname)) {
            return null;
        }

        return url.pathname === '/api/console/decide' ? 'decide' : 'run';
    }

    /** Vyzvedni rozbehnutý ťah a doplň, ako dlho bežal. */
    function take(details) {
        const entry = inflight.get(details.id);

        if (!entry) {
            return null;
        }

        inflight.delete(details.id);

        return { kind: entry.kind, ms: Date.now() - entry.startedAt, active: inflight.size };
    }

    function emit(handler, info) {
        if (typeof handler === 'function') {
            handler(info);
        }
    }

    function install() {
        if (installed) {
            return;
        }

        installed = true;

        // Filter sa nezadáva vzorom `urls`: Chromium match patterny neriešia port
        // spoľahlivo (rovnaký dôvod je napísaný pri injekcii tokenu v `main.js`).
        // Udalosti sú neblokujúce, takže prejsť si všetky requesty nič nestojí.
        session.webRequest.onSendHeaders((details) => {
            const kind = runKind(details);

            if (kind === null || inflight.has(details.id)) {
                return;
            }

            inflight.set(details.id, { kind, startedAt: Date.now() });
            emit(onStart, { kind, active: inflight.size });
        });

        session.webRequest.onCompleted((details) => {
            const info = take(details);

            if (!info) {
                return;
            }

            const status = Number(details.statusCode) || 0;

            if (status >= 400) {
                emit(onFail, { ...info, status, reason: 'http' });

                return;
            }

            emit(onFinish, { ...info, status });
        });

        session.webRequest.onErrorOccurred((details) => {
            const info = take(details);

            if (!info) {
                return;
            }

            const error = String(details.error || '');

            // Zastavenie behu človekom aj odchod zo stránky vyzerajú na sieti
            // rovnako (ABORTED). Ani jedno nie je výpadok a ani jedno si nezaslúži
            // notifikáciu — beh zastavil ten, komu by prišla.
            if (error === ABORTED) {
                emit(onAbort, { ...info, error });

                return;
            }

            emit(onFail, { ...info, error, reason: 'network' });
        });
    }

    return {
        install,

        /** Beží práve nejaký ťah? Používa to offline cesta: pás hovorí inak počas behu. */
        isRunning() {
            return inflight.size > 0;
        },

        /** Zabudni rozbehnuté ťahy (zavretie okna) — inak by ich `take` už nikdy nespáril. */
        reset() {
            inflight.clear();
        },
    };
}

module.exports = { createRunWatcher, RUN_PATHS };
