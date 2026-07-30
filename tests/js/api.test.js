import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiGet, apiSend, ApiError, codeForStatus } from '../../resources/js/core/api.js';

function res(status, body, ok) {
    return {
        ok: ok ?? (status >= 200 && status < 300),
        status,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
}

afterEach(() => vi.unstubAllGlobals());

describe('core/api.js — every failure is an ApiError', () => {
    it('returns the parsed body on success', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => res(200, { nodes: [1, 2] })));
        await expect(apiGet('/api/mind')).resolves.toEqual({ nodes: [1, 2] });
    });

    it('maps HTTP status to a stable error code', () => {
        expect(codeForStatus(401)).toBe('unauthorized');
        expect(codeForStatus(403)).toBe('unauthorized');
        expect(codeForStatus(429)).toBe('rate_limited');
        expect(codeForStatus(503)).toBe('unavailable');
        expect(codeForStatus(500)).toBe('server');
        expect(codeForStatus(422)).toBe('bad_request');
    });

    it('throws instead of silently returning an empty body on 429', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => res(429, { message: 'Slow down' })));
        const err = await apiGet('/api/mind', { retry: 0 }).catch((e) => e);
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe('rate_limited');
        expect(err.status).toBe(429);
        expect(err.message).toBe('Slow down');
    });

    it('surfaces 401 as unauthorized', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
        const err = await apiGet('/api/v1/mind', { retry: 0 }).catch((e) => e);
        expect(err.code).toBe('unauthorized');
    });

    it('retries a 5xx GET exactly once', async () => {
        const f = vi.fn()
            .mockResolvedValueOnce(res(500, {}))
            .mockResolvedValueOnce(res(200, { ok: true }));
        vi.stubGlobal('fetch', f);
        await expect(apiGet('/api/today')).resolves.toEqual({ ok: true });
        expect(f).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 4xx GET', async () => {
        const f = vi.fn(async () => res(404, {}));
        vi.stubGlobal('fetch', f);
        await apiGet('/api/nope').catch(() => {});
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('does not retry writes', async () => {
        const f = vi.fn(async () => res(500, {}));
        vi.stubGlobal('fetch', f);
        await apiSend('POST', '/api/nodes', { label: 'x' }).catch(() => {});
        expect(f).toHaveBeenCalledTimes(1);
    });

    it('reports a timeout as code "timeout"', async () => {
        vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
            });
        })));
        const err = await apiGet('/api/slow', { timeoutMs: 5, retry: 0 }).catch((e) => e);
        expect(err.code).toBe('timeout');
    });

    it('reports a caller abort as code "aborted"', async () => {
        vi.stubGlobal('fetch', vi.fn((url, init) => new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => {
                const e = new Error('aborted');
                e.name = 'AbortError';
                reject(e);
            });
        })));
        const ac = new AbortController();
        const p = apiGet('/api/slow', { signal: ac.signal, retry: 0 }).catch((e) => e);
        ac.abort();
        expect((await p).code).toBe('aborted');
    });

    it('survives a non-JSON body without throwing a parse error', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => res(200, '<html>nope</html>')));
        await expect(apiGet('/api/weird')).resolves.toBe('<html>nope</html>');
    });

    it('appends query parameters', async () => {
        const f = vi.fn(async () => res(200, {}));
        vi.stubGlobal('fetch', f);
        await apiGet('/api/mind', { query: { scope: 'all' } });
        expect(f.mock.calls[0][0]).toBe('/api/mind?scope=all');
    });
});
