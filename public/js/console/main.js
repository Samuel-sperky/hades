/* ===========================================================================
   Charón — bootstrap.

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
import { $, $$, el } from './dom.js';
import { json, setLockedHandler } from './http.js';
import {
    announce, clearView, paintJump, paintStats, pushNotice, renderEmpty, renderThread, wireStream,
} from './render.js';
import { wireRun } from './run.js';
import { wireComposer, paintSend } from './composer.js';
import { wireSlash, closePalette } from './slash.js';
import { wireModels, paintModels } from './models.js';
import { emptyBox, errorBox } from './empty.js';
import { wirePalette } from './palette.js';
import { wireReader } from './reader.js';
import {
    clearThreadFilter, renderThreadFilters, setThreadQuery, threadFilter, threadPass,
} from './threadfilter.js';
import { iconSwap } from '../shared/icons.js';
import { iconSvg } from '../shared/icons.js';

export { C };
export { renderEmpty };

/** Tmavá je default, rovnako ako v grafe — tému nesie ten istý kľúč. */
function applyTheme() {
    const name = localStorage.getItem('hades.theme') || 'dark';
    document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
}

/* ---------- bočný panel vlákien ---------- */

/* Stav zoznamu je vlastná premenná a nie odvodenina z `C.threads.length`: prázdne
   pole počas fetchu a prázdne pole po odpovedi vyzerajú rovnako, ale človeku
   hovoria dve úplne odlišné veci. Predtým nemal panel ani jeden z týchto stavov —
   počas načítania bol prázdny, pri nula vláknach tiež a chyba fetchu skončila len
   v toku správ, takže zoznam ticho ukazoval staré dáta ako čerstvé. */
let listState = 'loading';   // 'loading' | 'ready' | 'error'

/* Rozpísané premenovanie musí prežiť prekreslenie: `loadThreads()` beží po každom
   ťahu a bez uloženej rozpísanej hodnoty by titulok zmizol uprostred písania. */
let renaming = null;         // { uuid, value, focused }

/* Lišta filtrov je PRVÝM DIEŤAŤOM `#thread-list`, nie samostatným pásom medzi
   `.rail-find` a zoznamom — a je to obmedzenie, nie voľba: samostatný pás by
   potreboval vlastné `padding` a `border-bottom` v `console.css`, ktorý tento
   agent nevlastní, a inline štýly si appka zakázala. Cena je pomenovaná: lišta
   skroluje so zoznamom. `#thread-filters` s `position: sticky` v `console.css`
   je správna oprava a je nahlásená v reporte. */
function filterBar(list) {
    const bar = el('div');
    bar.id = 'thread-filters';
    list.append(bar);
    renderThreadFilters(bar, C.threads, renderThreadList);
}

/** Riadky v bočnom paneli. Titulok je prvá veta človeka, nie výmysel modelu. */
export function renderThreadList() {
    const list = $('#thread-list');
    if (!list) return;

    list.innerHTML = '';
    list.setAttribute('aria-busy', listState === 'loading' ? 'true' : 'false');

    if (listState === 'loading' && !C.threads.length) {
        list.append(el('p', 'sr-only', 'Vlákna sa načítavajú…'), skeletonRows());

        return;
    }

    filterBar(list);

    /* CHYBA MÁ DVE PODOBY A ROZDIEL JE VECNÝ, nie kozmetický:

       · zoznam je prázdny → zlyhala PLOCHA, takže `.empty--error` s vlastným
         predmetom („Zoznam vlákien sa nepodarilo načítať") a jednou akciou;
       · zoznam už riadky má → zlyhala len OBNOVA. Riadky sa NEZAHADZUJÚ (staré
         vlákna sú stále platné odkazy) a `.empty` nad nimi by bola lož: plocha
         obsah má. Vtedy je to jednoriadkové priznanie, že zoznam je starý —
         presne tá „akcia bez viditeľnej zmeny", ktorú manuál §8 posiela inline
         k pôvodu. Sú to teda dva stavy jedného slovníka, nie dva slovníky. */
    if (listState === 'error' && C.threads.length) list.append(staleNote());

    if (!C.threads.length) {
        list.append(listState === 'error'
            ? errorBox('zoznam vlákien', () => loadThreads())
            : emptyNote());

        return;
    }

    const rows = C.threads.filter(threadPass);

    if (!rows.length) {
        list.append(filterEmptyNote());

        return;
    }

    rows.forEach((t) => list.append(threadRow(t)));

    if (renaming) focusRename(list);
}

function threadRow(t) {
    const row = el('div', 'thread-row');
    row.dataset.uuid = t.uuid;

    // Premenovanie berie celý riadok: políčko vedľa titulku by v 260 px paneli
    // nemalo kam.
    if (renaming?.uuid === t.uuid) {
        row.append(renameField(t));

        return row;
    }

    const open = el('button', 'tr-open');
    open.type = 'button';
    if (C.thread?.uuid === t.uuid) {
        open.setAttribute('aria-current', 'true');
        row.classList.add('on');
    }

    const when = t.last_message_at ? new Date(t.last_message_at).toLocaleString('sk-SK', {
        day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
    }) : 'nezačaté';

    open.append(el('span', 'ttl', t.title || 'Nové vlákno'), el('span', 'when', when));
    open.addEventListener('click', () => {
        document.body.classList.remove('rail-open');
        openThread(t.uuid);
    });

    const rename = actionBtn('pencil', 'Premenovať vlákno');
    rename.addEventListener('click', (event) => {
        event.stopPropagation();
        startRename(t.uuid);
    });

    const remove = actionBtn('trash', 'Zmazať vlákno');
    remove.classList.add('act-del');
    remove.addEventListener('click', (event) => {
        event.stopPropagation();
        armDelete(remove, t.uuid);
    });

    const acts = el('span', 'tr-acts');
    acts.append(rename, remove);
    row.append(open, acts);

    return row;
}

/** Ikonové tlačidlo riadku. Kresbu nesie <svg> zo sady; `armDelete` ju odoberie
    a nahradí otázkou, `disarm` ju vráti cez `iconSwap`. */
function actionBtn(icon, label) {
    const btn = el('button', 'tr-act');
    btn.append(iconSvg(icon));
    btn.type = 'button';
    btn.title = label;
    btn.setAttribute('aria-label', label);

    return btn;
}

/* ---------- mazanie (armed-confirm) ---------- */

/* Ten istý vzor ako fronta Kontroly (`armKontrolaAction` v
   public/js/mind/screens/kontrola.js): prvý klik tlačidlo ozbrojí, druhý do troch
   sekúnd maže. Natívny `confirm()` sem nejde — blokuje vlákno prehliadača aj
   rozbehnutý prúd behu a vyzerá ako dialóg cudzej appky. */
function disarm(btn) {
    clearTimeout(btn._disarm);
    btn.classList.remove('armed');
    /* `iconSwap` zahodi textove uzly prvku a vlozi kresbu. Priame
       `textContent = 'trash'` by na <svg> nezobrazilo NIC a vynimku by nevydalo. */
    iconSwap(btn, 'trash');
    btn.title = 'Zmazať vlákno';
    btn.setAttribute('aria-label', 'Zmazať vlákno');
}

function armDelete(btn, uuid) {
    if (btn.classList.contains('armed')) {
        disarm(btn);
        deleteThread(uuid);

        return;
    }

    // Ozbrojené môže byť naraz len jedno tlačidlo — dve „Naozaj zmazať?" vedľa
    // seba by sa dali potvrdiť omylom.
    $$('#thread-list .tr-act.armed').forEach(disarm);

    btn.classList.add('armed');
    // Ozbrojeny stav nesie text, nie kresbu.
    const ic = btn.querySelector('svg.ic');
    if (ic) ic.remove();
    btn.textContent = 'Naozaj zmazať?';
    btn.title = 'Potvrď druhým kliknutím';
    btn.setAttribute('aria-label', 'Naozaj zmazať vlákno? Potvrď druhým kliknutím.');
    btn._disarm = setTimeout(() => { if (btn.isConnected) disarm(btn); }, 3000);
}

/** Zmazanie je nevratné — správy aj tool cally idú s vláknom (cascadeOnDelete). */
export async function deleteThread(uuid) {
    // Beh v mazanom vlákne by dostreamoval do niečoho, čo už neexistuje.
    if (C.running && C.thread?.uuid === uuid) document.dispatchEvent(new CustomEvent('console:stop'));

    const done = await json(`/api/console/threads/${uuid}`, { method: 'DELETE' });

    // Chybu ohlásil `json()` do toku správ; riadok musí zostať, kým vlákno žije.
    if (!done) return;

    C.threads = C.threads.filter((t) => t.uuid !== uuid);

    if (C.thread?.uuid !== uuid) {
        renderThreadList();
        announce('Vlákno je zmazané.');

        return;
    }

    // Zmazané AKTÍVNE vlákno: UI nesmie zostať visieť na neexistujúcom uuid —
    // URL by po obnove stránky skončila na 404 a hlavička by ukazovala titulok
    // niečoho, čo v DB nie je.
    C.thread = null;
    C.awaiting = null;
    C.stats = null;
    C.step = null;

    const next = C.threads.find(threadPass) || C.threads[0];

    if (next) {
        await openThread(next.uuid);
    } else {
        history.pushState({}, '', '/console');
        const title = $('#thread-title');
        if (title) title.textContent = 'Charón';
        const auto = $('#auto-accept');
        if (auto) auto.checked = false;
        renderEmpty();
        renderThreadList();
        paintModels();
    }

    paintStats();
    paintSend();
    announce('Vlákno je zmazané.');
}

/* ---------- premenovanie ---------- */

function startRename(uuid) {
    const t = C.threads.find((x) => x.uuid === uuid);
    if (!t) return;

    renaming = { uuid, value: t.title || '', focused: false };
    renderThreadList();
}

function stopRename() {
    // Poradie je dôležité: `renaming` sa nuluje PRED prekreslením, aby blur
    // odstráneného políčka nespustil uloženie toho, čo človek práve zahodil.
    renaming = null;
    renderThreadList();
}

function renameField(t) {
    const form = el('form', 'tr-rename');
    const input = el('input', 'tr-input');
    input.type = 'text';
    input.value = renaming.value;
    input.maxLength = 200;   // ten istý strop, aký validuje ThreadController
    input.setAttribute('aria-label', 'Nový názov vlákna');
    input.placeholder = 'Názov vlákna';

    input.addEventListener('input', () => { if (renaming) renaming.value = input.value; });

    input.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        // Bez zastavenia by to isté Esc pod políčkom zastavilo rozbehnutý beh.
        event.preventDefault();
        event.stopPropagation();
        stopRename();
    });

    // Odchod z políčka je potvrdenie, nie zahodenie: klik vedľa je bežnejší než
    // Enter a zahodiť po ňom prepísaný názov by bola strata bez varovania.
    input.addEventListener('blur', () => {
        if (renaming?.uuid === t.uuid) saveRename(t.uuid, input.value);
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        saveRename(t.uuid, input.value);
    });

    form.append(input);

    return form;
}

function focusRename(list) {
    const input = list.querySelector('.tr-input');
    if (!input || !renaming) return;

    input.focus();

    // Označiť celý text má zmysel raz — pri ďalších prekresleniach (`loadThreads()`
    // po ťahu) by to zmazalo rozpísanú zmenu prvým stlačeným klávesom.
    if (!renaming.focused) {
        input.select();
        renaming.focused = true;
    }
}

async function saveRename(uuid, raw) {
    const title = String(raw ?? '').replace(/\s+/gu, ' ').trim().slice(0, 200);
    const row = C.threads.find((t) => t.uuid === uuid);
    const before = row?.title || '';

    renaming = null;

    // Prázdny názov sa neukladá: backend ho vezme ako `null` a v paneli by sa
    // vlákno nedalo od ostatných rozoznať.
    if (title === '' || title === before) {
        renderThreadList();

        return;
    }

    const data = await json(`/api/console/threads/${uuid}`, { method: 'PATCH', body: { title } });

    if (!data) {
        renderThreadList();

        return;
    }

    if (row) row.title = data.title;

    if (C.thread?.uuid === uuid) {
        C.thread.title = data.title;
        const head = $('#thread-title');
        if (head) head.textContent = data.title;
    }

    renderThreadList();
    announce('Vlákno je premenované.');
}

/* ---------- stavy zoznamu ---------- */

/* Kostra namiesto prázdna: `/api/console/threads` ide cez ten istý PHP worker ako
   beh, takže počas rozbehnutého ťahu môže odpovedať sekundy. */
function skeletonRows() {
    const box = el('div', 'rail-skeleton');
    box.setAttribute('aria-hidden', 'true');

    for (let i = 0; i < 4; i++) box.append(el('span', 'sk-row'));

    return box;
}

/* Prázdny stav UČÍ: čo to je · prečo je prázdne · JEDNA akcia. Slovník je
   spoločný pre celú appku (`.empty` + `.empty .title` + `.empty .hint` +
   `.empty .empty-act` v `mind.css`); tento súbor si ho už neskladá sám. */
function emptyNote() {
    return emptyBox({
        icon: 'send',
        title: 'Zatiaľ žiadne vlákna',
        hint: 'Napíš úlohu dole — vlákno vznikne samo.',
        action: { label: 'Nové vlákno', on: () => newThread() },
    });
}

/* Prázdno spôsobené FILTROM, nie neexistenciou dát. `.empty--filter` vlastnú
   kresbu zámerne nemá (manuál §8: prázdny stav si nevymýšľa novú farbu), takže
   sa od základu líši textom a svojou jednou akciou.

   Text priznáva, KTORÝ filter to spôsobil — pri zapnutom čipe modelu je „nič
   nenájdené" bez tej informácie hádanka: hľadané slovo v paneli vidieť, zapnutý
   čip po odskrolovaní zoznamu nie. */
function filterEmptyNote() {
    const f = threadFilter();
    const bits = [];

    if (f.q !== '') bits.push(`hľadanému „${f.q}"`);
    if (f.model !== '') bits.push('zapnutému filtru modelu');

    return emptyBox({
        mod: 'filter',
        icon: 'magnifier-off',
        title: 'Filtru nezodpovedá žiadne vlákno',
        hint: `Žiadne z ${C.threads.length} vlákien nezodpovedá ${bits.join(' a ')}.`,
        action: {
            label: 'Zrušiť filter',
            on: () => {
                clearThreadFilter();
                const find = $('#thread-find');
                if (find) find.value = '';
                renderThreadList();
                find?.focus();
            },
        },
    });
}

/* Neúspešná OBNOVA nad zoznamom, ktorý riadky má. Nie `.empty` — plocha obsah
   má; je to jednoriadkové priznanie so svojou jednou akciou.
   `.rail-error` / `.rail-msg` / `.rail-retry` sú kresby, ktoré `console.css` už
   nesie, takže sa tu nič nové nezavádza. */
function staleNote() {
    const box = el('div', 'rail-error');
    box.append(el('p', 'rail-msg', 'Zoznam vlákien sa nepodarilo obnoviť — dole je posledný známy stav.'));

    const retry = el('button', 'rail-retry', 'Skúsiť znova');
    retry.type = 'button';
    retry.addEventListener('click', () => loadThreads());
    box.append(retry);

    return box;
}

export async function loadThreads() {
    // Kostra sa ukáže LEN keď panel nemá čo ukázať. `loadThreads()` beží aj po
    // každom ťahu a preblikávať vtedy hotový zoznam na kostru by bolo horšie než
    // nechať na obrazovke to, čo platí.
    if (!C.threads.length) {
        listState = 'loading';
        renderThreadList();
    }

    const data = await json('/api/console/threads');

    if (!data?.threads) {
        listState = 'error';
        renderThreadList();

        return;
    }

    listState = 'ready';
    C.threads = data.threads;
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
        // Server práve odpovedal, takže prípadné hlásenie o nenačítanom zozname
        // už neplatí — inak by nad novým vláknom svietila stará chyba.
        listState = 'ready';
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

    // Hľadanie je čisto klientské nad už načítanými riadkami: `/api/console/threads`
    // vracia najviac 100 vlákien, takže druhý okruh na server by tu nič nepridal.
    $('#thread-find')?.addEventListener('input', (event) => {
        setThreadQuery(event.target.value);
        renderThreadList();
    });

    $('#thread-find')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        // Esc vyprázdni hľadanie. Bez zastavenia propagácie by to isté Esc
        // dobehlo na dokument a zastavilo rozbehnutý beh.
        event.stopPropagation();
        event.target.value = '';
        setThreadQuery('');
        renderThreadList();
    });

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
    wirePalette();
    wireReader();
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
