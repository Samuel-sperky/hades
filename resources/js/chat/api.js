/* Chatový klient. Všetko ide cez core/api.js (zamknuté rozhranie #1) — žiadny
   raw fetch, takže 401/429/503/offline/timeout dostanú vlastnú hlášku a nikdy
   neskončia ako „Hades mlčí".

   Streamovanie stojí na SSE kontrakte #17: POST /api/chat/stream
   { message, conversation_id, context_node_ids, model? } → eventy
   token · meta · citations · done · error.

   Perzistencia stojí na schéme #18 (conversations + messages). Server je P5;
   kým endpointy nestoja, každé volanie tu padne na ApiError a controller
   prepne na lokálne zrkadlo — appka funguje ďalej. */

import { ApiError, apiGet, apiSend, apiStream } from '../core/api.js';

export const CHAT_STREAM_PATH = '/api/chat/stream';
export const CHAT_PATH = '/api/chat';
export const CONV_PATH = '/api/chat/conversations';

/* Timeouty podľa rozhodnutia 124 */
export const TIMEOUTS = {
    firstTokenMs: 90_000,
    totalMs: 300_000,
    idleMs: 30_000,
    plainMs: 120_000,
};

/** ApiError.code → slovenská hláška. Prázdny stav nie je odpoveď. */
export function chatErrorMessage(err) {
    const code = err instanceof ApiError ? err.code : 'server';
    switch (code) {
        case 'unauthorized': return 'Vedomie ťa nepustilo dovnútra (401). Skontroluj prihlásenie.';
        case 'rate_limited': return 'Priveľa otázok za minútu (429). Skús to o chvíľu.';
        case 'unavailable':  return 'Model je práve nedostupný (503). Odpovedám z pamäte, keď to pôjde.';
        case 'timeout':      return 'Odpoveď neprišla v časovom limite. Skús to znova.';
        case 'aborted':      return 'Zastavené.';
        case 'offline':      return 'Si offline — vedomie je len na tomto stroji, ale server neodpovedá.';
        case 'bad_request':  return 'Túto správu server neprijal (' + (err.status || 400) + ').';
        default:             return 'Spojenie s vedomím zlyhalo (' + (err.status || 'sieť') + ').';
    }
}

function streamBody({ message, conversationId, contextNodeIds, model, history }) {
    const body = {
        message,
        conversation_id: conversationId ?? null,
        context_node_ids: Array.isArray(contextNodeIds) ? contextNodeIds : [],
    };
    if (model) body.model = model;
    if (history && history.length) body.history = history;
    return body;
}

/** Streamovaná odpoveď. Vracia { done, abort } presne ako apiStream (#1).
    Watchdogy (prvý token / ticho v strede streamu) sú nad rámec #1, preto sú tu. */
export function streamChat(req, handlers = {}) {
    const {
        onToken, onMeta, onCitations, onDone, onError,
    } = handlers;

    let firstToken = false;
    let watchdog = null;
    let stopped = false;

    const ctrl = { abort: () => {} };
    const fail = (code, message) => {
        if (stopped) return;
        stopped = true;
        clearTimeout(watchdog);
        ctrl.abort();
        if (onError) onError(new ApiError({ status: 0, code, message }));
    };
    const arm = (ms, code, message) => {
        clearTimeout(watchdog);
        if (stopped) return;
        watchdog = setTimeout(() => fail(code, message), ms);
    };

    arm(TIMEOUTS.firstTokenMs, 'timeout', 'Prvý token neprišel');

    const stream = apiStream(CHAT_STREAM_PATH, streamBody(req), {
        timeoutMs: TIMEOUTS.totalMs,
        onToken: (t) => {
            if (stopped) return;
            firstToken = true;
            arm(TIMEOUTS.idleMs, 'timeout', 'Stream utíchol');
            if (onToken) onToken(t);
        },
        onMeta: (meta) => {
            if (stopped) return;
            if (!firstToken) arm(TIMEOUTS.firstTokenMs, 'timeout', 'Prvý token neprišel');
            if (onMeta) onMeta(meta);
        },
        onCitations: (c) => { if (!stopped && onCitations) onCitations(c); },
        onDone: (result) => {
            if (stopped) return;
            stopped = true;
            clearTimeout(watchdog);
            if (onDone) onDone(result || {});
        },
        onError: (err) => {
            if (stopped) return;
            stopped = true;
            clearTimeout(watchdog);
            if (onError) onError(err);
        },
    });
    ctrl.abort = stream.abort;

    // apiStream nerozpoznáva SSE event `error` (viď patch v reporte P6) —
    // stream, ktorý skončí bez `done`, preto vyhodnotíme ako chybu sami.
    const done = stream.done.then(() => {
        if (stopped) return;
        stopped = true;
        clearTimeout(watchdog);
        if (onError) {
            onError(new ApiError({
                status: 0,
                code: firstToken ? 'server' : 'unavailable',
                message: 'Stream sa skončil bez ukončovacieho eventu',
            }));
        }
    });

    return {
        done,
        abort: () => { stopped = true; clearTimeout(watchdog); stream.abort(); },
    };
}

/** Nestreamovaná odpoveď — fallback, keď SSE nie je k dispozícii. */
export function sendChat(req, opts = {}) {
    return apiSend('POST', CHAT_PATH, {
        ...streamBody(req),
        history: req.history || [],
    }, { timeoutMs: TIMEOUTS.plainMs, ...opts });
}

/* ---------- perzistencia konverzácií (#18) ---------- */

export function listConversations(opts = {}) {
    return apiGet(CONV_PATH, { timeoutMs: 10_000, ...opts });
}

export function fetchConversation(id, opts = {}) {
    return apiGet(CONV_PATH + '/' + encodeURIComponent(id), { timeoutMs: 10_000, ...opts });
}

export function createConversation(title = null, opts = {}) {
    return apiSend('POST', CONV_PATH, title ? { title } : {}, { timeoutMs: 10_000, ...opts });
}

export function renameConversation(id, title, opts = {}) {
    // Server registruje premenovanie ako PUT (routes/chat.php) — PATCH by skončil na 405.
    return apiSend('PUT', CONV_PATH + '/' + encodeURIComponent(id), { title }, { timeoutMs: 10_000, ...opts });
}

/** Tolerantné čítanie zoznamu vlákien — server smie vrátiť pole aj obálku. */
export function normalizeThreads(payload) {
    const raw = Array.isArray(payload) ? payload
        : (payload && (payload.conversations || payload.data)) || [];
    if (!Array.isArray(raw)) return [];
    return raw.filter((c) => c && c.id != null).map((c) => ({
        id: c.id,
        title: c.title || 'Bez názvu',
        lastMessageAt: c.last_message_at || c.updated_at || null,
        count: c.message_count ?? c.messages_count ?? null,
    }));
}

/** Tolerantné čítanie správ jedného vlákna. */
export function normalizeMessages(payload) {
    const raw = Array.isArray(payload) ? payload
        : (payload && (payload.messages || payload.data)) || [];
    if (!Array.isArray(raw)) return [];
    return raw.filter((m) => m && m.role && typeof m.content === 'string').map((m) => ({
        id: m.id ?? null,
        role: m.role,
        content: m.content,
        model: m.model || null,
        ms: m.ms ?? null,
        tokPerS: m.tok_per_s ?? m.tokPerS ?? null,
        citations: m.cited_node_ids || m.citations || null,
        degraded: !!(m.meta && m.meta.degraded),
    }));
}
