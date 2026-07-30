/* Vlákna (história) — zoznam konverzácií vľavo v overlayi aj na obrazovke Chat.

   Zdroj pravdy je backend (schéma #18, vlastník P5). Kým endpointy nestoja,
   `chatState.remote` klesne na false a zoznam ukáže jedinú lokálnu položku
   z localStorage zrkadla — chat funguje ďalej, len bez viacerých vlákien. */

import { $, esc, renderEmpty } from '../core/dom.js';
import { fetchConversation, listConversations, normalizeMessages, normalizeThreads } from './api.js';
import { renderLog } from './log.js';
import { chatState, newConversation, persistMirror, replaceMessages } from './state.js';

const HOSTS = { overlay: 'chat-overlay-threads', screen: 'chat-screen-threads' };

export function threadsHost() {
    return $(HOSTS[chatState.mode] || HOSTS.screen);
}

function fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
        ? d.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' });
}

export function renderThreads() {
    const host = threadsHost();
    if (!host) return;
    const rows = chatState.threads;
    const head = '<div class="th-head">'
        + '<span class="th-title">Vlákna</span>'
        + '<button type="button" class="th-new ms" data-chat-action="thread" data-thread="new"'
        + ' title="Nové vlákno" aria-label="Nové vlákno">add</button>'
        + '</div>';

    if (!rows.length) {
        host.innerHTML = head + '<div class="th-list"></div>';
        renderEmpty(host.querySelector('.th-list'), 'forum',
            chatState.remote ? 'Zatiaľ žiadne vlákna.' : 'História beží len lokálne.');
        return;
    }

    host.innerHTML = head + '<div class="th-list" role="list">' + rows.map((t) => {
        const active = String(t.id) === String(chatState.conversationId);
        return '<button type="button" role="listitem" class="th-row' + (active ? ' active' : '') + '"'
            + ' data-chat-action="thread" data-thread-id="' + esc(String(t.id)) + '"'
            + (active ? ' aria-current="true"' : '') + '>'
            + '<span class="th-label">' + esc(t.title) + '</span>'
            + '<span class="th-when">' + esc(fmtWhen(t.lastMessageAt)) + '</span>'
            + '</button>';
    }).join('') + '</div>';
}

/** Načítaj zoznam vlákien. Chyba nie je fatálna — prepneme na lokálny režim. */
export async function loadThreads() {
    try {
        const payload = await listConversations();
        chatState.threads = normalizeThreads(payload);
        chatState.remote = true;
    } catch (err) {
        chatState.remote = false;
        chatState.threads = chatState.messages.length
            ? [{ id: chatState.conversationId ?? 'local', title: chatState.title || 'Táto session', lastMessageAt: null, count: chatState.messages.length }]
            : [];
    }
    renderThreads();
    return chatState.threads;
}

export async function selectThread(id) {
    if (String(id) === String(chatState.conversationId)) return;
    if (!chatState.remote || id === 'local') { renderThreads(); return; }
    try {
        const payload = await fetchConversation(id);
        const conv = payload && payload.conversation ? payload.conversation : {};
        chatState.conversationId = conv.id ?? id;
        chatState.title = conv.title || null;
        replaceMessages(normalizeMessages(payload));
    } catch (err) {
        chatState.remote = false;
    }
    renderThreads();
    renderLog();
}

export function startNewThread() {
    newConversation();
    persistMirror();
    renderThreads();
    renderLog();
}

/** Po odoslaní správy posuň vlákno navrch (bez ďalšieho volania servera). */
export function touchThread(title) {
    const id = chatState.conversationId;
    if (id == null) return;
    const now = new Date().toISOString();
    const idx = chatState.threads.findIndex((t) => String(t.id) === String(id));
    if (idx === -1) {
        chatState.threads.unshift({ id, title: title || chatState.title || 'Nové vlákno', lastMessageAt: now, count: chatState.messages.length });
    } else {
        const t = chatState.threads[idx];
        if (title) t.title = title;
        t.lastMessageAt = now;
        t.count = chatState.messages.length;
        chatState.threads.splice(idx, 1);
        chatState.threads.unshift(t);
    }
    renderThreads();
}
