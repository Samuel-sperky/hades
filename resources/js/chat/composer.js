/* Composer — JEDEN <textarea> pre všetky tri režimy.

   Celý blok `#chat-composer` sa pri prepnutí režimu fyzicky presúva do iného
   hosta (viď modes.js). Preto sa rozpísaný draft, kontextové čipy ani stav
   tlačidiel nemôžu stratiť — nie sú duplikované, je to ten istý DOM.

   Enter odosiela, Shift+Enter robí nový riadok (rozhodnutie 88). */

import { $ } from '../core/dom.js';
import { chatState, persistDraft } from './state.js';

const MAX_ROWS_PX = 160;

export const composerEl = () => $('chat-composer');
export const inputEl = () => $('prompt-input');

export function autoresize(el = inputEl()) {
    if (!el) return;
    // Prázdny composer má vždy presne jeden riadok: dlhý placeholder sa
    // v Chrome počíta do scrollHeight a lišta by v pokoji stála na dvoch.
    if (!el.value) {
        el.style.height = '';
        el.classList.remove('is-tall');
        return;
    }
    el.style.height = 'auto';
    const full = el.scrollHeight;
    el.style.height = Math.min(MAX_ROWS_PX, full) + 'px';
    el.classList.toggle('is-tall', full > MAX_ROWS_PX);
}

export function setDraft(text) {
    const el = inputEl();
    chatState.draft = text || '';
    if (el) { el.value = chatState.draft; autoresize(el); }
    persistDraft();
    syncSendState();
}

export function clearDraft() {
    setDraft('');
}

export function focusComposer(caretToEnd = true) {
    const el = inputEl();
    if (!el) return;
    el.focus();
    if (caretToEnd) {
        const n = el.value.length;
        try { el.setSelectionRange(n, n); } catch (e) { /* nepodstatné */ }
    }
}

/** Send/Stop sa nikdy nezobrazia naraz. */
export function syncSendState() {
    const form = $('prompt-form');
    const send = $('chat-send');
    const stop = $('chat-stop');
    if (!form) return;
    const hasText = (inputEl()?.value || '').trim().length > 0;
    form.classList.toggle('has-text', hasText);
    form.classList.toggle('is-streaming', chatState.streaming);
    if (send) send.classList.toggle('hidden', chatState.streaming);
    if (stop) stop.classList.toggle('hidden', !chatState.streaming);
}

export function setStreaming(on) {
    chatState.streaming = !!on;
    const el = inputEl();
    if (el) el.setAttribute('aria-busy', on ? 'true' : 'false');
    syncSendState();
}

/** Zbal quickbar. Volá to aj Escape kaskáda v shell/shortcuts.js (P9). */
export function collapsePrompt() {
    const bar = $('prompt');
    if (bar) bar.classList.remove('open');
    const log = $('chat-log');
    if (log && chatState.mode === 'quickbar') log.classList.add('hidden');
    const el = inputEl();
    if (el) el.blur();
}

export function openPrompt() {
    const bar = $('prompt');
    if (bar) bar.classList.add('open');
    const log = $('chat-log');
    if (log && log.children.length) log.classList.remove('hidden');
}

/**
 * Nadrôtuj composer.
 * @param {{onSubmit: Function, onStop: Function, onKeydown?: Function, onInput?: Function}} h
 */
export function setupComposer(h) {
    const form = $('prompt-form');
    const el = inputEl();
    if (!form || !el) return;

    el.value = chatState.draft || '';
    autoresize(el);
    syncSendState();

    el.addEventListener('input', () => {
        chatState.draft = el.value;
        persistDraft();
        autoresize(el);
        syncSendState();
        if (h.onInput) h.onInput(el);
    });

    el.addEventListener('focus', () => { if (chatState.mode === 'quickbar') openPrompt(); });

    el.addEventListener('keydown', (e) => {
        if (h.onKeydown && h.onKeydown(e) === true) return;   // autocomplete si vzalo klávesu
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            form.requestSubmit ? form.requestSubmit() : h.onSubmit();
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (chatState.streaming) return;
        h.onSubmit();
    });

    const stop = $('chat-stop');
    if (stop) stop.addEventListener('click', () => h.onStop());
}
