/* JEDEN stav pre tri režimy chatu (rozhodnutie 82).

   Quickbar, fullscreen overlay a obrazovka „Chat" sú tri pohľady na tento
   objekt — prepnutie režimu nesmie zhodiť konverzáciu ani rozpísaný draft,
   takže žiadny režim si nedrží vlastnú kópiu správ.

   Kontext uzlov zostáva v core/state/chat.js (`S.chatContext`), ktorý vlastní
   integrátor — tu ho iba čítame. */

import { store } from '../core/store.js';

export const MODES = ['quickbar', 'overlay', 'screen'];

/** Zrkadlo poslednej konverzácie v localStorage — história prežije reload aj
    keď backend (P5) ešte nestojí. Server je zdroj pravdy, keď odpovedá. */
const MIRROR_KEY = 'chatMirror';
const MIRROR_LIMIT = 60;

export const chatState = {
    mode: 'quickbar',
    conversationId: null,
    title: null,
    messages: [],        // { id, role, content, model, ms, tokPerS, citations, degraded, error, pending }
    draft: '',
    streaming: false,
    model: null,         // null = server rozhodne
    threads: [],
    remote: true,        // false = perzistencia beží len lokálne
    queued: 0,           // koľko správ čaká, kým dobehne aktuálny stream
};

let seq = 0;

export function nextLocalId() {
    seq += 1;
    return 'l' + Date.now().toString(36) + seq.toString(36);
}

export function persistDraft() {
    store.setRaw('chatDraft', chatState.draft || '');
}

export function persistMirror() {
    try {
        store.set(MIRROR_KEY, {
            conversationId: chatState.conversationId,
            title: chatState.title,
            // systémové poznámky (chyby, potvrdenia príkazov) sú UI šum —
            // do zrkadla nepatria, aby reload nezobrazil staré hlásenia
            messages: chatState.messages
                .filter((m) => m.role === 'user' || m.role === 'assistant')
                .slice(-MIRROR_LIMIT).map((m) => ({
                id: m.id, role: m.role, content: m.content,
                model: m.model || null, ms: m.ms || null, tokPerS: m.tokPerS || null,
                citations: m.citations || null, degraded: !!m.degraded, error: !!m.error,
            })),
        });
    } catch (e) { /* plné úložisko — zrkadlo nie je kritické */ }
}

export function loadChatState() {
    const mode = store.raw('chatMode');
    chatState.mode = MODES.includes(mode) ? mode : 'quickbar';
    chatState.draft = store.raw('chatDraft', '') || '';
    chatState.model = store.raw('chatModel') || null;

    const mirror = store.get(MIRROR_KEY, null);
    if (mirror && Array.isArray(mirror.messages)) {
        chatState.conversationId = mirror.conversationId ?? null;
        chatState.title = mirror.title ?? null;
        chatState.messages = mirror.messages.filter((m) => m && m.role && typeof m.content === 'string');
    }
    return chatState;
}

export function setMode(mode) {
    if (!MODES.includes(mode)) return chatState.mode;
    chatState.mode = mode;
    store.setRaw('chatMode', mode);
    return mode;
}

export function setModel(model) {
    chatState.model = model || null;
    if (model) store.setRaw('chatModel', model); else store.del('chatModel');
}

export function pushMessage(msg) {
    const m = { id: msg.id || nextLocalId(), ...msg };
    chatState.messages.push(m);
    persistMirror();
    return m;
}

export function replaceMessages(list) {
    chatState.messages = Array.isArray(list) ? list.slice() : [];
    persistMirror();
}

export function newConversation() {
    chatState.conversationId = null;
    chatState.title = null;
    chatState.messages = [];
    persistMirror();
}

/** Posledná používateľská správa — vstup pre „Regenerovať". */
export function lastUserMessage() {
    for (let i = chatState.messages.length - 1; i >= 0; i -= 1) {
        if (chatState.messages[i].role === 'user') return chatState.messages[i];
    }
    return null;
}

/** História pre backend: bez pending/chybových bublín, posledných 12 správ. */
export function historyForSend() {
    return chatState.messages
        .filter((m) => !m.pending && !m.error && (m.role === 'user' || m.role === 'assistant'))
        .slice(-12)
        .map((m) => ({ role: m.role, content: m.content }));
}
