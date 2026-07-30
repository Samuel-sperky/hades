/* Single HTTP client for the whole frontend: res.ok checking, timeout, abort,
   guarded JSON parse and one retry for 5xx GETs. Every failure is an ApiError,
   so no caller ever inspects res.ok again.

   W0 note: this module is introduced with its locked signature and unit tests.
   Rewiring the ~26 existing raw fetch() call sites is per-package W2 work —
   doing it here would change runtime behaviour, which W0 forbids. */

const DEFAULT_TIMEOUT = 15_000;

/** @typedef {'unauthorized'|'rate_limited'|'unavailable'|'timeout'|'aborted'|'offline'|'server'|'bad_request'} ApiErrorCode */

export class ApiError extends Error {
    constructor({ status = 0, code = 'server', message = 'Request failed', body = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.body = body;
    }
}

export function codeForStatus(status) {
    if (status === 401 || status === 403) return 'unauthorized';
    if (status === 429) return 'rate_limited';
    if (status === 503 || status === 502 || status === 504) return 'unavailable';
    if (status >= 500) return 'server';
    if (status >= 400) return 'bad_request';
    return 'server';
}

function withQuery(path, query) {
    if (!query) return path;
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        usp.append(k, String(v));
    }
    const qs = usp.toString();
    if (!qs) return path;
    return path + (path.includes('?') ? '&' : '?') + qs;
}

async function parseBody(res) {
    const text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return text; }
}

async function request(method, path, body, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    if (opts.signal) {
        if (opts.signal.aborted) ac.abort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);

    try {
        const init = { method, signal: ac.signal, headers: {} };
        if (body !== null && body !== undefined) {
            init.headers['Content-Type'] = 'application/json';
            init.body = typeof body === 'string' ? body : JSON.stringify(body);
        }
        const res = await fetch(withQuery(path, opts.query), init);
        const payload = await parseBody(res);
        if (!res.ok) {
            const message = (payload && payload.message) || ('HTTP ' + res.status);
            throw new ApiError({ status: res.status, code: codeForStatus(res.status), message, body: payload });
        }
        return payload;
    } catch (err) {
        if (err instanceof ApiError) throw err;
        if (err && err.name === 'AbortError') {
            throw new ApiError({
                status: 0,
                code: timedOut ? 'timeout' : 'aborted',
                message: timedOut ? 'Request timed out' : 'Request aborted',
            });
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            throw new ApiError({ status: 0, code: 'offline', message: 'Offline' });
        }
        throw new ApiError({ status: 0, code: 'server', message: (err && err.message) || 'Network error' });
    } finally {
        clearTimeout(timer);
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
    }
}

/** GET with timeout, abort and a single retry on 5xx. Returns parsed JSON. */
export async function apiGet(path, opts = {}) {
    const retry = opts.retry ?? 1;
    try {
        return await request('GET', path, null, opts);
    } catch (err) {
        if (retry > 0 && err instanceof ApiError && err.code === 'server') {
            return apiGet(path, { ...opts, retry: retry - 1 });
        }
        throw err;
    }
}

/** POST/PUT/PATCH/DELETE — no retry (not idempotent). */
export function apiSend(method, path, body = null, opts = {}) {
    return request(method, path, body, { ...opts, retry: 0 });
}

/** SSE-style streaming POST. Returns { done: Promise, abort(): void }. */
export function apiStream(path, body, {
    onToken, onMeta, onCitations, onDone, onError, signal, timeoutMs = 300_000,
} = {}) {
    const ac = new AbortController();
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
    const timer = setTimeout(() => ac.abort('timeout'), timeoutMs);

    const done = (async () => {
        try {
            const res = await fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                body: JSON.stringify(body ?? {}),
                signal: ac.signal,
            });
            if (!res.ok || !res.body) {
                throw new ApiError({
                    status: res.status,
                    code: codeForStatus(res.status),
                    message: 'HTTP ' + res.status,
                });
            }
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            for (;;) {
                const { value, done: fin } = await reader.read();
                if (fin) break;
                buf += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf('\n\n')) !== -1) {
                    const chunk = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    const line = chunk.split('\n').find((l) => l.startsWith('data:'));
                    if (!line) continue;
                    const raw = line.slice(5).trim();
                    if (raw === '[DONE]') continue;
                    let ev;
                    try { ev = JSON.parse(raw); } catch (e) { continue; }
                    if (ev.token && onToken) onToken(ev.token);
                    if (ev.meta && onMeta) onMeta(ev.meta);
                    if (ev.citations && onCitations) onCitations(ev.citations);
                    if (ev.result && onDone) onDone(ev.result);
                }
            }
        } catch (err) {
            const e = err instanceof ApiError
                ? err
                : new ApiError({
                    code: err && err.name === 'AbortError' ? 'aborted' : 'server',
                    message: (err && err.message) || 'Stream failed',
                });
            if (onError) onError(e); else throw e;
        } finally {
            clearTimeout(timer);
        }
    })();

    return { done, abort: () => ac.abort() };
}
