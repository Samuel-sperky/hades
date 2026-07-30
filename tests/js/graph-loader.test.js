/* P8 — načítanie grafu ide cez core/api.js (§4.1, otvorený bod §7.3).
   Predtým sa `res.ok` nekontroloval vôbec: 401/429 dorazilo ako prázdna odpoveď
   a `reloadGraph` ju spolkol v tichu. */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let loader, api, S;

const payload = (over = {}) => ({
    name: 'AuraAI',
    state: { awake: false },
    areas: [{ id: 1, name: 'vyvoj-kod', angle: 342 }],
    departments: [{ id: 5, name: 'docker' }],
    nodes: [
        { id: 1, type: 'core', label: 'AuraAI', created_at: '2026-01-01 10:00:00' },
        { id: 2, type: 'skill', label: 'Vite', created_at: '2026-02-01 10:00:00' },
    ],
    edges: [{ id: 9, source_id: 1, target_id: 2, weight: 1 }],
    ws: { key: 'k', host: 'localhost', port: 8083, app_port: '8082' },
    ...over,
});

function jsonRes(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
    };
}

beforeAll(async () => {
    installGraphDom();
    loader = await import('../../resources/js/graph/loader.js');
    api = await import('../../resources/js/core/api.js');
    ({ S } = await import('../../resources/js/core/state/index.js'));
});

beforeEach(() => {
    S.nodes = [];
    S.edges = [];
    S.byId = new Map();
    S.areas = new Map();
    S.departments = new Map();
    S.selected = null;
    S.local = null;
    S.focus = { areaId: null, departmentId: null };
    S.graphScope = 'live';
});

describe('graph/loader.js — loadGraph', () => {
    it('asks for the graph with the scope as a query parameter', async () => {
        const fetchMock = vi.fn(async () => jsonRes(payload()));
        vi.stubGlobal('fetch', fetchMock);

        const data = await loader.loadGraph();

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('/api/mind?scope=live');
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(data.name).toBe('AuraAI');
        expect(S.nodes.length).toBe(2);
        expect(S.edges.length).toBe(1);
        expect(S.edges[0].source.id).toBe(1);   // hrany sú prepojené na objekty uzlov
    });

    it('drops edges whose endpoints are missing', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonRes(payload({
            edges: [{ id: 9, source_id: 1, target_id: 404 }],
        }))));
        await loader.loadGraph();
        expect(S.edges.length).toBe(0);
    });

    it('surfaces 429 as ApiError(rate_limited) instead of an empty graph', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ message: 'Too Many Attempts.' }, 429)));

        await expect(loader.loadGraph()).rejects.toBeInstanceOf(api.ApiError);
        expect(S.nodes.length).toBe(0);
    });

    it('surfaces 401 as ApiError(unauthorized)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ message: 'Unauthenticated.' }, 401)));
        await expect(loader.loadGraph()).rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    });

    it('retries a 500 exactly once (GET retry from api.js)', async () => {
        const fetchMock = vi.fn(async () => jsonRes({ message: 'boom' }, 500));
        vi.stubGlobal('fetch', fetchMock);
        await expect(loader.loadGraph()).rejects.toMatchObject({ code: 'server' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});

describe('graph/loader.js — reloadGraph', () => {
    it('keeps the existing node positions', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonRes(payload())));
        await loader.loadGraph();
        S.byId.get(2).x = 123;
        S.byId.get(2).y = -45;

        await loader.reloadGraph();

        expect(S.byId.get(2).x).toBe(123);
        expect(S.byId.get(2).y).toBe(-45);
    });

    it('reports a failed background reload instead of swallowing it', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => jsonRes(payload())));
        await loader.loadGraph();
        const before = S.nodes.length;

        vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ message: 'Too Many Attempts.' }, 429)));
        await loader.reloadGraph();   // nesmie vyhodiť — beží na pozadí

        expect(S.nodes.length).toBe(before);           // graf zostal nedotknutý
        const toast = document.querySelector('#toasts .toast');
        expect(toast).not.toBe(null);
        expect(toast.textContent).toContain('Priveľa požiadaviek');
    });
});

describe('graph/loader.js — apiErrorText', () => {
    it('translates the codes that deserve a message and stays quiet otherwise', () => {
        const t = (code) => loader.apiErrorText(new api.ApiError({ code }));
        expect(t('unauthorized')).toContain('zamietnutý');
        expect(t('rate_limited')).toContain('Priveľa');
        expect(t('unavailable')).toContain('nedostupné');
        expect(t('timeout')).toContain('neodpovedalo');
        expect(t('server')).toContain('Chyba servera');
        expect(t('offline')).toBe(null);
        expect(t('aborted')).toBe(null);
    });
});
