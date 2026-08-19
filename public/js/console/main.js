/* ===========================================================================
   Konzola vedomia — bootstrap.

   Natívne ES moduly bez build stepu, rovnako ako graf (vite sa v tomto projekte
   na frontend nikdy nepúšťal). Cyklické importy sa tu držia mimo, ale pravidlo
   projektu platí aj tak: exportuj hoistované `export function`, nikdy
   `export const foo = () => {}`.

   Rozdelenie súborov: main.js drží stav a štart, http.js sieť, render.js
   kreslenie toku, run.js agentový beh, tools.js karty toolov a potvrdzovanie.
   =========================================================================== */

import { json, setLockedHandler } from './http.js';

/** Zdieľaný stav konzoly — jediný zdroj pravdy, ako `S` v grafe. */
export const C = {
    thread: null,        // { uuid, title, messages, tool_calls, awaiting, … }
    threads: [],         // zoznam pre bočný panel
    running: false,      // beží ťah agenta?
    abort: null,         // AbortController aktuálneho behu
    models: [],          // čo je reálne stiahnuté
};

const $ = (sel) => document.querySelector(sel);

/** Tmavá je default, rovnako ako v grafe — tému nesie ten istý kľúč. */
function applyTheme() {
    const name = localStorage.getItem('hades.theme') || 'dark';
    document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
}

/** Hlásenie zamknutého okruhu ide do toku správ, nie do toastu. */
function showNotice(text) {
    const stream = $('#stream');
    if (!stream) return;

    const box = document.createElement('div');
    box.className = 'msg assistant';
    box.innerHTML = '<span class="who">Hades</span><div class="bubble"></div>';
    box.querySelector('.bubble').textContent = text;
    stream.append(box);
    stream.scrollTop = stream.scrollHeight;
}

/** Prázdny stav — hovorí, čo konzola vie, nie „žiadne dáta". */
export function renderEmpty() {
    const stream = $('#stream');
    if (!stream) return;

    stream.innerHTML = `
        <div class="empty-state">
            <h2>Konzola vedomia</h2>
            <p>Napíš úlohu. Konzola má prístup k celej pamäti (${C.threads.length ? '' : ''}uzly,
            hrany, oblasti, rozhodnutia) aj k súborom projektu — hľadá cez ripgrep,
            čítá, a zápisy ti ukáže ako diff, kým ich povolíš.</p>
        </div>`;
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

        row.innerHTML = `<span class="ttl"></span><span class="when"></span>`;
        row.querySelector('.ttl').textContent = t.title || 'Nové vlákno';
        row.querySelector('.when').textContent = when;

        row.addEventListener('click', () => openThread(t.uuid));
        list.append(row);
    });
}

export async function loadThreads() {
    const data = await json('/api/console/threads');
    C.threads = data?.threads ?? [];
    renderThreadList();
}

/** Otvorí vlákno a prepíše URL, aby sa dalo poslať odkazom. */
export async function openThread(uuid) {
    const data = await json(`/api/console/threads/${uuid}`);
    if (!data) return;

    C.thread = data;
    history.pushState({}, '', `/console/${uuid}`);
    $('#thread-title').textContent = data.title;
    $('#auto-accept').checked = !!data.auto_accept;
    renderThreadList();

    // Kreslenie histórie a agentový beh pribudnú v run.js/render.js.
    document.dispatchEvent(new CustomEvent('console:thread', { detail: data }));
}

async function newThread() {
    const data = await json('/api/console/threads', { method: 'POST', body: {} });
    if (!data) return;

    C.thread = data;
    C.threads.unshift({ uuid: data.uuid, title: data.title, last_message_at: null });
    history.pushState({}, '', `/console/${data.uuid}`);
    $('#thread-title').textContent = data.title;
    renderThreadList();
    renderEmpty();
}

function wireShell() {
    $('#new-thread')?.addEventListener('click', newThread);

    // Enter posiela, Shift+Enter zalomí — a textarea rastie s obsahom, aby sa
    // dlhšia úloha dala prečítať pred odoslaním.
    const prompt = $('#prompt');
    prompt?.addEventListener('input', () => {
        prompt.style.height = 'auto';
        prompt.style.height = `${prompt.scrollHeight}px`;
    });

    $('#composer')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = prompt.value.trim();
        if (text === '') return;
        // Beh drží run.js — ten si udalosť odchytí, keď je načítaný.
        document.dispatchEvent(new CustomEvent('console:send', { detail: { text } }));
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); newThread(); }
        if (e.key === 'Escape' && C.running) document.dispatchEvent(new CustomEvent('console:stop'));
    });
}

async function init() {
    applyTheme();
    setLockedHandler(showNotice);
    wireShell();

    await loadThreads();

    const fromUrl = document.querySelector('meta[name="console-thread"]')?.content || '';

    if (fromUrl) await openThread(fromUrl);
    else renderEmpty();
}

init();
