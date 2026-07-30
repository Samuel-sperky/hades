import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiError } from '../../resources/js/core/api.js';
import {
    CHAT_STREAM_PATH, chatErrorMessage, normalizeMessages, normalizeThreads, streamChat,
} from '../../resources/js/chat/api.js';

/* Fake SSE odpoveď — presne tvar, ktorý sľubuje zamknuté rozhranie #17. */
function sseResponse(frames, { ok = true, status = 200 } = {}) {
    const enc = new TextEncoder();
    let i = 0;
    return {
        ok,
        status,
        body: {
            getReader: () => ({
                read: async () => (i < frames.length
                    ? { value: enc.encode(frames[i++]), done: false }
                    : { value: undefined, done: true }),
            }),
        },
    };
}

const frame = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';

describe('chat/api.js — hlášky podľa ApiError.code (žiadne „Hades mlčí")', () => {
    it('maps every locked code to its own Slovak message', () => {
        const codes = ['unauthorized', 'rate_limited', 'unavailable', 'timeout', 'aborted', 'offline', 'bad_request', 'server'];
        const msgs = codes.map((code) => chatErrorMessage(new ApiError({ code, status: 500 })));
        expect(new Set(msgs).size).toBe(codes.length);
        expect(chatErrorMessage(new ApiError({ code: 'rate_limited', status: 429 }))).toContain('429');
        expect(chatErrorMessage(new ApiError({ code: 'unauthorized', status: 401 }))).toContain('401');
        expect(msgs.every((m) => m && m.length > 5)).toBe(true);
    });

    it('never returns an empty message for a non-ApiError', () => {
        expect(chatErrorMessage(new Error('boom'))).toBeTruthy();
    });
});

describe('chat/api.js — tolerantné čítanie payloadov (#18)', () => {
    it('normalizes conversations from an array or an envelope', () => {
        const a = normalizeThreads([{ id: 1, title: 'A' }]);
        const b = normalizeThreads({ conversations: [{ id: 1, title: 'A' }] });
        const c = normalizeThreads({ data: [{ id: 1, title: 'A' }] });
        expect(a).toEqual(b);
        expect(b).toEqual(c);
        expect(a[0].title).toBe('A');
    });

    it('drops rows without an id and defaults the title', () => {
        const t = normalizeThreads([{ title: 'no id' }, { id: 5 }]);
        expect(t).toHaveLength(1);
        expect(t[0].title).toBe('Bez názvu');
    });

    it('normalizes messages including snake_case metrics', () => {
        const m = normalizeMessages({
            messages: [{ id: 3, role: 'assistant', content: 'x', model: 'qwen3:4b', ms: 1200, tok_per_s: 11.4, cited_node_ids: [1, 2] }],
        });
        expect(m[0].tokPerS).toBe(11.4);
        expect(m[0].citations).toEqual([1, 2]);
    });

    it('drops malformed messages instead of throwing', () => {
        expect(normalizeMessages({ messages: [null, { role: 'user' }, { content: 'x' }] })).toEqual([]);
        expect(normalizeMessages(undefined)).toEqual([]);
    });
});

describe('chat/api.js — streamChat proti SSE kontraktu #17', () => {
    let fetchMock;

    beforeEach(() => {
        vi.useFakeTimers();
        fetchMock = vi.fn();
        globalThis.fetch = fetchMock;
    });
    afterEach(() => { vi.useRealTimers(); });

    it('posts to /api/chat/stream with the locked body shape', async () => {
        fetchMock.mockResolvedValue(sseResponse([frame({ result: { text: 'ok' } })]));
        const onDone = vi.fn();
        await streamChat({
            message: 'ahoj', conversationId: 9, contextNodeIds: [1, 2], model: 'qwen3:4b',
        }, { onDone }).done;

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [path, init] = fetchMock.mock.calls[0];
        expect(path).toBe(CHAT_STREAM_PATH);
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ message: 'ahoj', conversation_id: 9, context_node_ids: [1, 2], model: 'qwen3:4b' });
        expect(onDone).toHaveBeenCalledOnce();
    });

    it('omits model when none is chosen and sends a null conversation_id', async () => {
        fetchMock.mockResolvedValue(sseResponse([frame({ result: {} })]));
        await streamChat({ message: 'x' }, {}).done;
        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.model).toBeUndefined();
        expect(body.conversation_id).toBeNull();
        expect(body.context_node_ids).toEqual([]);
    });

    it('delivers token, meta, citations and done in order', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            frame({ meta: { model: 'qwen3:4b', degraded: false } }),
            frame({ token: 'Ahoj' }),
            frame({ token: ' svet' }),
            frame({ citations: [7, 8] }),
            frame({ result: { text: 'Ahoj svet', ms: 900, tok_per_s: 12 } }),
        ]));
        const seen = [];
        const onDone = vi.fn();
        await streamChat({ message: 'x' }, {
            onToken: (t) => seen.push(t),
            onMeta: (m) => seen.push(m.model),
            onCitations: (c) => seen.push(c),
            onDone,
        }).done;
        expect(seen).toEqual(['qwen3:4b', 'Ahoj', ' svet', [7, 8]]);
        expect(onDone.mock.calls[0][0].tok_per_s).toBe(12);
    });

    it('handles multiple SSE frames arriving in one chunk', async () => {
        fetchMock.mockResolvedValue(sseResponse([
            frame({ token: 'a' }) + frame({ token: 'b' }) + frame({ result: { text: 'ab' } }),
        ]));
        const tokens = [];
        await streamChat({ message: 'x' }, { onToken: (t) => tokens.push(t) }).done;
        expect(tokens).toEqual(['a', 'b']);
    });

    it('turns 429 into a rate_limited ApiError, not an empty answer', async () => {
        fetchMock.mockResolvedValue(sseResponse([], { ok: false, status: 429 }));
        const onError = vi.fn();
        await streamChat({ message: 'x' }, { onError }).done;
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0].code).toBe('rate_limited');
        expect(chatErrorMessage(onError.mock.calls[0][0])).toContain('429');
    });

    it('turns 401 into unauthorized', async () => {
        fetchMock.mockResolvedValue(sseResponse([], { ok: false, status: 401 }));
        const onError = vi.fn();
        await streamChat({ message: 'x' }, { onError }).done;
        expect(onError.mock.calls[0][0].code).toBe('unauthorized');
    });

    it('reports a stream that ends without a done event (apiStream drops `error`)', async () => {
        fetchMock.mockResolvedValue(sseResponse([frame({ token: 'a' }), frame({ error: { message: 'model spadol' } })]));
        const onDone = vi.fn();
        const onError = vi.fn();
        await streamChat({ message: 'x' }, { onToken: () => {}, onDone, onError }).done;
        expect(onDone).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0]).toBeInstanceOf(ApiError);
    });

    it('never fires both onDone and onError', async () => {
        fetchMock.mockResolvedValue(sseResponse([frame({ result: { text: 'ok' } })]));
        const onDone = vi.fn();
        const onError = vi.fn();
        await streamChat({ message: 'x' }, { onDone, onError }).done;
        expect(onDone).toHaveBeenCalledOnce();
        expect(onError).not.toHaveBeenCalled();
    });

    it('abort() stops the stream and reports nothing further', async () => {
        let release;
        fetchMock.mockImplementation(() => new Promise((r) => { release = r; }));
        const onDone = vi.fn();
        const onError = vi.fn();
        const s = streamChat({ message: 'x' }, { onDone, onError });
        s.abort();
        release(sseResponse([frame({ result: { text: 'late' } })]));
        await s.done;
        expect(onDone).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
    });

    it('first-token watchdog fires a timeout after 90 s of silence', async () => {
        fetchMock.mockImplementation(() => new Promise(() => {}));   // nikdy neodpovie
        const onError = vi.fn();
        streamChat({ message: 'x' }, { onError });
        await vi.advanceTimersByTimeAsync(90_001);
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0].code).toBe('timeout');
    });

    it('idle watchdog fires after 30 s without a further token', async () => {
        const enc = new TextEncoder();
        let sent = false;
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: () => {
                        if (sent) return new Promise(() => {});   // ticho po prvom tokene
                        sent = true;
                        return Promise.resolve({ value: enc.encode(frame({ token: 'a' })), done: false });
                    },
                }),
            },
        });
        const onError = vi.fn();
        streamChat({ message: 'x' }, { onToken: () => {}, onError });
        await vi.advanceTimersByTimeAsync(5);
        await vi.advanceTimersByTimeAsync(30_001);
        expect(onError).toHaveBeenCalledOnce();
        expect(onError.mock.calls[0][0].code).toBe('timeout');
    });
});
