/* Chat — orchestrátor. Jeden modul, tri režimy, jeden stav (rozhodnutie 82).

   Tok odoslania:
     1. `/príkaz` → commands.js, bez modelu, bez siete
     2. inak → SSE /api/chat/stream (#17) so watchdogmi a Stopom
     3. keď SSE nie je (404/503/starý server) → jednorazové POST /api/chat
     4. keď padne aj to → systémová správa s konkrétnou príčinou z ApiError

   Žiadny raw fetch: všetko ide cez core/api.js (#1), takže 401/429/503/offline
   majú vlastnú hlášku a nikdy neskončia ako „Hades mlčí". */

import { ApiError } from '../core/api.js';
import { bus } from '../core/bus.js';
import { $ } from '../core/dom.js';
import { EV } from '../core/events.js';
import { blip } from '../core/sound.js';
import { S } from '../core/state/index.js';
import { focusNode } from '../graph/camera.js';
import { isHub } from '../graph/geometry.js';
import { spawnPulse } from '../graph/pulses.js';
import { selectNode } from '../node/node-panel.js';
import { showToast } from '../shell/toasts.js';
import { chatErrorMessage, createConversation, sendChat, streamChat } from './api.js';
import { acKeydown, closeAc, refreshAc, registerAc } from './autocomplete.js';
import { handleCommand } from './commands.js';
import { clearDraft, focusComposer, setStreaming, setupComposer, syncSendState } from './composer.js';
import { chatContextIds, renderContextChips } from './context.js';
import { appendMessageRow, logHost, renderLog, rowFor, scrollLog } from './log.js';
import { finishStreamingRow, updateStreamingBubble } from './message.js';
import { applyMode, closeOverlay, openOverlay, openScreen, overlayOpen, registerModes } from './modes.js';
import { chatState, historyForSend, lastUserMessage, loadChatState, persistMirror, pushMessage } from './state.js';
import { renderSuggestCard } from './suggest.js';
import { loadThreads, renderThreads, selectThread, startNewThread, touchThread } from './threads.js';

let active = null;      // { abort } bežiaceho streamu
let streamingId = null; // id rastúcej bubliny
let sseBroken = false;  // server nemá /api/chat/stream → ďalej rovno nestreamovane

/* ---------- systémové správy ---------- */

function sys(text, isError = false) {
    const msg = pushMessage({ role: 'system', content: text, error: !!isError });
    appendMessageRow(msg);
    return msg;
}

/* ---------- odoslanie ---------- */

function coreNode() {
    return S.nodes.find((n) => n.type === 'core' && isHub(n)) || S.nodes.find((n) => n.type === 'core') || null;
}

/** Recallnuté uzly sa rozsvietia a dostanú pulz z jadra (rozhodnutie 97). */
function highlightCitations(ids) {
    const nodes = (ids || []).map((id) => S.byId.get(+id)).filter(Boolean);
    if (!nodes.length) return;
    bus.emit(EV.CHAT_CITED, { nodeIds: nodes.map((n) => n.id) });
    bus.emit(EV.GRAPH_HIGHLIGHT, { nodeIds: nodes.map((n) => n.id), pulseFromCore: true });
    const hub = coreNode();
    for (const n of nodes) {
        n.flash = 1;
        if (hub && hub !== n) spawnPulse(hub, n, { dim: 0.8 });
    }
}

async function ensureConversation() {
    if (chatState.conversationId != null || !chatState.remote) return chatState.conversationId;
    try {
        const payload = await createConversation();
        const conv = (payload && (payload.conversation || payload)) || {};
        if (conv.id != null) {
            chatState.conversationId = conv.id;
            chatState.title = conv.title || null;
        }
    } catch (err) {
        chatState.remote = false;   // P5 ešte nestojí — ideme lokálne, chat funguje
    }
    return chatState.conversationId;
}

function finish(msg, row) {
    persistMirror();
    const target = row || rowFor(msg.id);
    if (target) finishStreamingRow(target, msg);
    else renderLog();
    scrollLog();
    if (msg.citations && msg.citations.length) highlightCitations(msg.citations);
    streamingId = null;
    active = null;
    setStreaming(false);
    blip(660, 0.18, 0.035);          // tichý blip na dokončenie (rozhodnutie 99)
    touchThread(chatState.title);
}

function failWith(err, msg, row) {
    const aborted = err instanceof ApiError && err.code === 'aborted';
    const hadText = !!msg.content;
    if (!hadText) {
        // Prázdna bublina nikdy nezostane prázdna — nesie konkrétnu príčinu.
        msg.content = aborted ? 'Zastavené.' : chatErrorMessage(err);
        msg.degraded = !aborted;
    }
    const target = row || rowFor(msg.id);
    if (target) finishStreamingRow(target, msg);
    else renderLog();
    // Pri prerušenej odpovedi je príčina samostatná systémová správa, aby sa
    // rozpísaný text nestratil.
    if (!aborted && hadText) sys(chatErrorMessage(err), true);
    streamingId = null;
    active = null;
    setStreaming(false);
    persistMirror();
}

/** Nestreamovaná cesta — použije sa aj keď SSE endpoint neexistuje. */
async function sendPlain(req, msg, row) {
    try {
        const data = await sendChat(req);
        msg.content = data.reply || data.message || '';
        msg.model = (data.meta && data.meta.model) || data.model || null;
        msg.ms = (data.meta && data.meta.ms) || null;
        msg.tokPerS = (data.meta && (data.meta.tok_per_s ?? data.meta.tokPerS)) || null;
        msg.degraded = !!(data.meta && data.meta.degraded);
        msg.citations = data.citations || data.cited_node_ids || null;
        if (!msg.content) {
            msg.content = 'Z pamäte sa nedalo poskládať nič použiteľné. Skús otázku inak.';
            msg.degraded = true;
        }
        finish(msg, row);
        if (data.suggested_node) renderSuggestCard(data.suggested_node);
    } catch (err) {
        failWith(err, msg, row);
    }
}

async function runTurn(text) {
    const userMsg = pushMessage({ role: 'user', content: text });
    appendMessageRow(userMsg);

    const history = historyForSend().slice(0, -1);
    await ensureConversation();

    const req = {
        message: text,
        conversationId: chatState.conversationId,
        contextNodeIds: chatContextIds(),
        model: chatState.model,
        history,
    };

    const reply = pushMessage({ role: 'assistant', content: '' });
    streamingId = reply.id;
    setStreaming(true);
    const row = appendMessageRow(reply, { streaming: true });

    if (sseBroken) { await sendPlain(req, reply, row); return; }

    let gotToken = false;
    const stream = streamChat(req, {
        onToken: (t) => {
            gotToken = true;
            reply.content += t;
            updateStreamingBubble(rowFor(reply.id) || row, reply.content);
            scrollLog();
        },
        onMeta: (meta) => {
            if (!meta) return;
            reply.model = meta.model || reply.model;
            reply.ms = meta.ms ?? reply.ms;
            reply.tokPerS = (meta.tok_per_s ?? meta.tokPerS) ?? reply.tokPerS;
            reply.degraded = !!meta.degraded;
            if (meta.conversation_id != null) chatState.conversationId = meta.conversation_id;
            if (meta.title) chatState.title = meta.title;
        },
        onCitations: (c) => {
            reply.citations = Array.isArray(c) ? c : (c && (c.node_ids || c.nodes)) || null;
        },
        onDone: (result) => {
            if (result) {
                if (result.text && !reply.content) reply.content = result.text;
                reply.model = result.model || reply.model;
                reply.ms = result.ms ?? reply.ms;
                reply.tokPerS = (result.tok_per_s ?? result.tokPerS) ?? reply.tokPerS;
                if (result.citations) reply.citations = result.citations;
                if (result.conversation_id != null) chatState.conversationId = result.conversation_id;
                if (result.title) chatState.title = result.title;
                if (result.degraded != null) reply.degraded = !!result.degraded;
            }
            if (!reply.content) {
                reply.content = 'Odpoveď prišla prázdna. Skús otázku inak.';
                reply.degraded = true;
            }
            finish(reply, rowFor(reply.id) || row);
        },
        onError: (err) => {
            // Stream nedostupný a ešte nič neprišlo → skús nestreamovanú cestu.
            const fallback = !gotToken && err instanceof ApiError
                && ['unavailable', 'bad_request', 'server'].includes(err.code);
            if (fallback) {
                sseBroken = err.status === 404 || err.status === 405;
                sendPlain(req, reply, rowFor(reply.id) || row);
                return;
            }
            failWith(err, reply, rowFor(reply.id) || row);
        },
    });
    active = stream;
    await stream.done;
}

async function submit() {
    const input = $('prompt-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    if (chatState.streaming) {          // jeden stream naraz (rozhodnutie 126)
        showToast('Odpoveď ešte beží — počkaj alebo stlač Stop');
        return;
    }
    closeAc();
    clearDraft();

    if (text.startsWith('/')) {
        const cmdMsg = pushMessage({ role: 'user', content: text });
        appendMessageRow(cmdMsg);
        await handleCommand(text, sys);
        return;
    }
    await runTurn(text);
}

function stop() {
    if (active) active.abort();
    active = null;
    setStreaming(false);
    if (streamingId) {
        const msg = chatState.messages.find((m) => m.id === streamingId);
        if (msg) {
            if (!msg.content) msg.content = 'Zastavené.';
            finishStreamingRow(rowFor(msg.id), msg);
        }
        streamingId = null;
        persistMirror();
    }
}

async function regenerate() {
    if (chatState.streaming) return;
    const last = lastUserMessage();
    if (!last) return;
    // odrež všetko po poslednej používateľskej správe vrátane jej odpovede
    const idx = chatState.messages.lastIndexOf(last);
    chatState.messages = chatState.messages.slice(0, idx);
    persistMirror();
    renderLog();
    await runTurn(last.content);
}

/* ---------- akcie nad správami (data-chat-action, §4.7) ---------- */

function messageOf(el) {
    const row = el.closest('[data-msg-id]');
    if (!row) return null;
    return chatState.messages.find((m) => m.id === row.dataset.msgId) || null;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Skopírované');
    } catch (e) {
        showToast('Kopírovanie zablokoval prehliadač');
    }
}

function onLogClick(e) {
    const copyCode = e.target.closest('.md-copy');
    if (copyCode) {
        const pre = copyCode.parentElement?.querySelector('pre code');
        if (pre) copyText(pre.textContent);
        return;
    }
    const btn = e.target.closest('[data-chat-action]');
    if (!btn) return;
    const action = btn.dataset.chatAction;

    if (action === 'thread') {
        if (btn.dataset.thread === 'new') startNewThread();
        else if (btn.dataset.threadId) selectThread(btn.dataset.threadId);
        return;
    }
    if (action === 'cite') {
        const n = S.byId.get(+btn.dataset.nodeId);
        if (!n) return;
        if (overlayOpen()) closeOverlay();
        focusNode(n);
        selectNode(n);
        return;
    }
    const msg = messageOf(btn);
    if (!msg) return;
    if (action === 'copy') copyText(msg.content);
    else if (action === 'regen') regenerate();
    else if (action === 'remember') {
        renderSuggestCard({ label: msg.content.slice(0, 200), type: 'memory', description: msg.content });
    }
}

/* Chat sa registruje PRED `await loadGraph()` (boot poradie v app.js), takže pri
   prvom kreslení môže byť `S.byId` prázdne — citácie a kontextové čipy by zmizli.
   Správne riešenie je `bus.emit(EV.GRAPH_LOADED)` v graph/loader.js (event je
   v zamknutom katalógu #4, emit je patch pre integrátora — viď report P6).
   Kým ho tam nie je, dobehne to krátky ohraničený poll. */
function whenGraphReady(fn) {
    if (S.byId.size) { fn(); return; }
    const off = bus.once(EV.GRAPH_LOADED, () => { clearInterval(timer); fn(); });
    let tries = 0;
    const timer = setInterval(() => {
        tries += 1;
        if (S.byId.size) { clearInterval(timer); off(); fn(); return; }
        if (tries > 40) { clearInterval(timer); off(); }   // 6 s a dosť
    }, 150);
}

/* ---------- register ---------- */

export function register(root) {
    loadChatState();

    // Chat je zapnutý by default (rozhodnutie 84) — prepínač v Nastaveniach je
    // reziduum z čias, keď chat potreboval platený kľúč. Kým ho P9 neodstráni
    // z markupu, len ho skryjeme; trieda chat-on zostáva vždy zapnutá.
    document.body.classList.add('chat-on');
    const legacyToggle = root.querySelector('#chat-toggle');
    if (legacyToggle) {
        (legacyToggle.closest('.switch-row') || legacyToggle).hidden = true;
        legacyToggle.setAttribute('aria-checked', 'true');
    }

    setupComposer({
        onSubmit: submit,
        onStop: stop,
        onKeydown: (e) => acKeydown(e),
        onInput: (el) => refreshAc(el),
    });
    registerAc();
    registerModes();
    renderContextChips();
    syncSendState();

    // Delegácia klikov v každom hostovi (log aj vlákna) — markup sa prekresľuje,
    // takže sa viaže na kontejner, nie na tlačidlá.
    ['chat-log', 'chat-overlay-log', 'chat-screen-log',
        'chat-overlay-threads', 'chat-screen-threads'].forEach((id) => {
        const el = $(id);
        if (el) el.addEventListener('click', onLogClick);
    });

    const screenNew = $('chat-screen-new');
    if (screenNew) screenNew.addEventListener('click', startNewThread);
    const screenExport = $('chat-screen-export');
    if (screenExport) screenExport.addEventListener('click', () => handleCommand('/export', sys));
    const toScreen = $('chat-to-screen');
    if (toScreen) toScreen.addEventListener('click', () => { if (overlayOpen()) closeOverlay(); openScreen(); });

    renderLog(streamingId);
    renderThreads();
    loadThreads();

    // Až keď sieť existuje, majú citácie a čipy z čoho čerpať štítky uzlov.
    whenGraphReady(() => {
        renderContextChips();
        if (!chatState.streaming) renderLog(streamingId);
    });
}

/* Ladiaci povrch pre window.AURA — režim sa dá prepnúť aj z konzoly. */
export const chatDebug = {
    state: chatState, applyMode, openOverlay, openScreen, submit, stop, focusComposer,
    host: logHost,
};
