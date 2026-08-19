/* ===========================================================================
   Konzola vedomia — bootstrap.

   Natívne ES moduly bez build stepu, rovnako ako graf (vite sa v tomto projekte
   na frontend nikdy nepúšťal). Pravidlo projektu platí: exportuj hoistované
   `export function`, nikdy `export const foo = () => {}` — run.js aj slash.js
   importujú funkcie ODTIAĽTO a main.js importuje ich, takže cyklus je v grafe
   naozaj a hoisting je jediné, čo ho drží pri živote.

   Rozdelenie súborov:
     state.js     zdieľaný objekt C (jediný zdroj pravdy)
     http.js      fetch s CSRF + hlásenie zamknutého okruhu
     main.js      štart, vlákna, bočný panel
     render.js    tok správ, markdown bubliny, skrolovanie, obnova vlákna
     run.js       NDJSON beh agenta, rámce, Stop
     tools.js     karty nástrojov, diffy, potvrdzovanie zápisov
     composer.js  písanie a odoslanie
     slash.js     paleta príkazov
     models.js    prepínač modelu
     markdown.js  minimálny bezpečný markdown
     dom.js       drobné pomôcky
   =========================================================================== */

import { C } from './state.js';
import { $ } from './dom.js';
import { json, setLockedHandler } from './http.js';
import {
    clearView, paintJump, paintStats, pushNotice, renderEmpty, renderThread, wireStream,
} from './render.js';
import { wireRun } from './run.js';
import { wireComposer, paintSend } from './composer.js';
import { wireSlash, closePalette } from './slash.js';
import { wireModels, paintModels } from './models.js';

export { C };
export { renderEmpty };

/** Tmavá je default, rovnako ako v grafe — tému nesie ten istý kľúč. */
function applyTheme() {
    const name = localStorage.getItem('hades.theme') || 'dark';
    document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
}

/** Riadky v bočnom paneli. Titulok je prvá veta človeka, nie výmysel modelu. */
export function renderThreadList() {
    const list = $('#thread-list');
    if (!list) return;

    list.innerHTML = '';

    C.threads.forEach((t) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'thread-row';
        row.dataset.uuid = t.uuid;
        if (C.thread?.uuid === t.uuid) row.setAttribute('aria-current', 'true');

        const when = t.last_message_at ? new Date(t.last_message_at).toLocaleString('sk-SK', {
            day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
        }) : 'nezačaté';

        row.innerHTML = '<span class="ttl"></span><span class="when"></span>';
        row.querySelector('.ttl').textContent = t.title || 'Nové vlákno';
        row.querySelector('.when').textContent = when;

        row.addEventListener('click', () => {
            document.body.classList.remove('rail-open');
            openThread(t.uuid);
        });
        list.append(row);
    });
}

export async function loadThreads() {
    const data = await json('/api/console/threads');
    C.threads = data?.threads ?? C.threads;
    renderThreadList();
}

/** Otvorí vlákno a prepíše URL, aby sa dalo poslať odkazom. */
export async function openThread(uuid) {
    if (C.thread?.uuid === uuid && C.running) return;

    // Prepnutie vlákna počas behu by nechalo prúd kresliť do cudzieho toku.
    if (C.running) document.dispatchEvent(new CustomEvent('console:stop'));

    const data = await json(`/api/console/threads/${uuid}`);
    if (!data) return;

    C.thread = data;
    if (location.pathname !== `/console/${uuid}`) history.pushState({}, '', `/console/${uuid}`);
    $('#thread-title').textContent = data.title;
    $('#auto-accept').checked = !!data.auto_accept;
    renderThreadList();
    paintModels();
    renderThread(data);
    if (data.awaiting) C.awaiting = { id: data.awaiting, name: '' };
    paintStats();
    paintSend();

    // Udalosť zostáva pre prípadných ďalších odberateľov; kreslenie ide priamo,
    // aby sa poradie (najprv stav, potom tok) nedalo rozhodiť poradím listenerov.
    document.dispatchEvent(new CustomEvent('console:thread', { detail: data }));
}

/** Rozbehnuté `POST /console/threads` — aby dva podnety nezaložili dve vlákna. */
let creating = null;

/**
 * Nové vlákno. `blank: false` znamená „vlákno vzniklo len preto, aby mal ťah kam
 * ísť" — vtedy sa tok správ NEPREKRESĽUJE na prázdny stav. Bez toho vznikol
 * závod: sendTurn si vlákno založí, `renderEmpty()` vyprázdni #stream a bublina,
 * do ktorej už tiekli tokeny, zostala odpojená od dokumentu. Odpoveď sa
 * skladala do prázdna a na obrazovke ostal prázdny stav.
 */
export async function newThread(options = {}) {
    if (C.running) document.dispatchEvent(new CustomEvent('console:stop'));

    // Rozbehnuté zakladanie sa ZDIEĽA. `POST /console/threads` beží na tomto
    // stroji ~2 s a človek za tú dobu stihne kliknúť na „Nové vlákno" a rovno
    // napísať správu: vznikli potom DVE vlákna, ťah odišiel do druhého, kým
    // panel ukazoval prvé — a v paneli po každom takom odoslaní zostalo prázdne
    // vlákno navyše.
    if (!creating) {
        creating = json('/api/console/threads', { method: 'POST', body: {} })
            .finally(() => { creating = null; });
    }

    const data = await creating;
    if (!data) return null;

    // Druhý volajúci dostane to isté vlákno; prijať ho dvakrát by zdvojilo riadok.
    if (C.thread?.uuid !== data.uuid) {
        C.thread = data;
        C.awaiting = null;
        C.stats = null;
        C.step = null;
        C.threads.unshift({
            uuid: data.uuid, title: data.title, model: data.model, last_message_at: null,
        });
        history.pushState({}, '', `/console/${data.uuid}`);
        $('#thread-title').textContent = data.title;
        $('#auto-accept').checked = !!data.auto_accept;
        renderThreadList();
        paintModels();
    }

    // Prázdny stav sa NESMIE vykresliť, keď medzitým začal odchádzať ťah. Kým sa
    // čakalo na odpoveď servera, `sendTurn` už mohol položiť do toku bublinu s
    // otázkou — `renderEmpty()` by ju zmazal a človek by po odoslaní videl
    // prázdnu konzolu s odpoveďou na otázku, ktorá na obrazovke nie je.
    if (options.blank !== false && !C.sending) renderEmpty();
    paintStats();
    $('#prompt')?.focus();

    return data;
}

/** Vlákno musí existovať pred prvým ťahom — /console bez uuid ho založí ticho. */
export async function ensureThread() {
    if (C.thread) return C.thread;

    return newThread({ blank: false });
}

function wireShell() {
    $('#new-thread')?.addEventListener('click', () => newThread());

    // Pod 860 px je panel vlákien skrytý — bez tohto prepínača by sa k histórii
    // na úzkom okne nedalo dostať vôbec.
    $('#rail-toggle')?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.body.classList.toggle('rail-open');
    });

    document.addEventListener('click', (event) => {
        if (!document.body.classList.contains('rail-open')) return;
        if (event.target.closest('#thread-rail, #rail-toggle')) return;
        document.body.classList.remove('rail-open');
    });

    $('#auto-accept')?.addEventListener('change', async (event) => {
        if (!C.thread) return;

        const data = await json(`/api/console/threads/${C.thread.uuid}`, {
            method: 'PATCH',
            body: { auto_accept: event.target.checked },
        });

        if (data) C.thread.auto_accept = data.auto_accept;
        else event.target.checked = !!C.thread.auto_accept;
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'n' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            newThread();
        }
    });

    // Tlačidlo späť v prehliadači má prepnúť vlákno, nie nechať na obrazovke cudzí tok.
    window.addEventListener('popstate', () => {
        const uuid = location.pathname.match(/^\/console\/([\w-]+)/)?.[1];
        if (uuid) openThread(uuid);
        else { C.thread = null; renderEmpty(); }
    });

    window.addEventListener('resize', paintJump);
}

async function init() {
    applyTheme();
    setLockedHandler(pushNotice);
    wireShell();
    wireStream();
    wireSlash();
    wireComposer();
    wireRun();
    closePalette();

    const fromUrl = document.querySelector('meta[name="console-thread"]')?.content || '';

    // Prázdny stav ide na plátno PRED sieťovými požiadavkami — je to prvá vec,
    // ktorú človek vidí, a nemá dôvod čakať na zoznam vlákien.
    if (!fromUrl) renderEmpty();

    await loadThreads();
    await wireModels();

    if (fromUrl) await openThread(fromUrl);

    C.booting = false;
    // Stav štartu je viditeľný aj v DOM: `#send` sa ako signál nedá použiť (je
    // zhasnutý aj preto, že je prázdna textarea) a overovací harness potrebuje
    // vedieť, kedy konzola prijíma ťahy.
    document.body.dataset.ready = '1';
    paintStats();
    paintSend();
    $('#prompt')?.focus();
}

init();

// clearView je verejné pre paletu (/clear) aj pre prípadné ladenie z konzoly.
export { clearView };
