/* P8 — viditeľnosť uzlov a prázdny stav filtrov.
   Moduly grafu čítajú <canvas id="mind"> pri importe, takže markup musí stáť
   pred dynamickým importom. */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let filters, S;

beforeAll(async () => {
    installGraphDom();
    filters = await import('../../resources/js/graph/filters.js');
    ({ S } = await import('../../resources/js/core/state/index.js'));
});

function node(over = {}) {
    return { id: 1, type: 'skill', label: 'n', source: 'session', area_id: 7, tags: [], ...over };
}

beforeEach(() => {
    for (const k of ['types', 'sources', 'areas', 'tags', 'relations']) S.filter[k].clear();
    S.nodes = [];
    S.local = null;
    document.querySelectorAll('#filter-empty').forEach((el) => el.classList.add('hidden'));
});

describe('graph/filters.js — nodeVisible', () => {
    it('lets everything through with no filter', () => {
        expect(filters.filterActive()).toBe(false);
        expect(filters.nodeVisible(node(), null)).toBe(true);
    });

    it('hides a filtered type but never the core', () => {
        S.filter.types.add('skill');
        expect(filters.nodeVisible(node(), null)).toBe(false);
        expect(filters.nodeVisible(node({ type: 'core' }), null)).toBe(true);
    });

    it('buckets sources: digest and archive share one bucket, missing source is manual', () => {
        S.filter.sources.add('digest');
        expect(filters.nodeVisible(node({ source: 'archive' }), null)).toBe(false);
        expect(filters.nodeVisible(node({ source: 'digest' }), null)).toBe(false);
        S.filter.sources.clear();
        S.filter.sources.add('manual');
        expect(filters.nodeVisible(node({ source: null }), null)).toBe(false);
    });

    it('treats tags as a positive filter', () => {
        S.filter.tags.add('docker');
        expect(filters.nodeVisible(node({ tags: ['docker'] }), null)).toBe(true);
        expect(filters.nodeVisible(node({ tags: ['vite'] }), null)).toBe(false);
        expect(filters.nodeVisible(node({ tags: [] }), null)).toBe(false);
    });

    it('lets the local graph win over the filters', () => {
        S.filter.types.add('skill');
        const loc = new Set([1]);
        expect(filters.nodeVisible(node({ id: 1 }), loc)).toBe(true);
        expect(filters.nodeVisible(node({ id: 2 }), loc)).toBe(false);
    });
});

describe('graph/filters.js — visibleCounts', () => {
    it('counts the visible nodes and the visible non-core nodes apart', () => {
        S.nodes = [node({ id: 1, type: 'core' }), node({ id: 2 }), node({ id: 3, type: 'memory' })];
        expect(filters.visibleCounts()).toEqual({ total: 3, nonCore: 2 });
        S.filter.types.add('skill');
        expect(filters.visibleCounts()).toEqual({ total: 2, nonCore: 1 });
        S.filter.types.add('memory');
        expect(filters.visibleCounts()).toEqual({ total: 1, nonCore: 0 });
    });
});

describe('graph/filters.js — prázdny stav', () => {
    it('shows the notice only when an active filter hides every non-core node', () => {
        S.nodes = [node({ id: 1, type: 'core' }), node({ id: 2 })];
        filters.updateFilterNotice();
        expect(document.getElementById('filter-empty')).toBe(null); // nič sa nestavia zbytočne

        S.filter.types.add('skill');
        filters.updateFilterNotice();
        const el = document.getElementById('filter-empty');
        expect(el).not.toBe(null);
        expect(el.classList.contains('hidden')).toBe(false);
        expect(el.textContent).toContain('Filtre skryli celú sieť');

        S.filter.types.clear();
        filters.updateFilterNotice();
        expect(document.getElementById('filter-empty').classList.contains('hidden')).toBe(true);
    });

    it('refreshVisibility updates the notice AND the a11y summary together', () => {
        S.nodes = [node({ id: 1, type: 'core' }), node({ id: 2 })];
        S.filter.types.add('skill');

        filters.refreshVisibility();

        expect(document.getElementById('filter-empty').classList.contains('hidden')).toBe(false);
        // bez tohto by čítač obrazovky ohlásil počty z času načítania stránky
        expect(document.getElementById('graph-summary').textContent).toContain('Filtre skryli');
        expect(document.getElementById('graph-summary').textContent).toContain('Zobrazených 1 uzlov');
    });

    it('stays hidden in local-graph mode (the root is always visible)', () => {
        S.nodes = [node({ id: 2 })];
        S.filter.types.add('skill');
        S.local = { rootId: 2, depth: 1 };
        filters.updateFilterNotice();
        const el = document.getElementById('filter-empty');
        expect(el === null || el.classList.contains('hidden')).toBe(true);
    });
});

describe('graph/filters.js — clearAllFilters', () => {
    it('clears every set and re-syncs the checkboxes in the dock', () => {
        document.body.insertAdjacentHTML('beforeend',
            '<div id="dockfix"><input type="checkbox" data-ftype="skill">'
            + '<input type="checkbox" data-fsource="session">'
            + '<input type="checkbox" data-frel="uses">'
            + '<input type="checkbox" data-ftag="docker" checked></div>');
        S.nodes = [node({ id: 2 })];
        S.filter.types.add('skill');
        S.filter.relations.add('uses');
        S.filter.tags.add('docker');

        filters.clearAllFilters();

        expect(filters.filterActive()).toBe(false);
        expect(S.filter.relations.size).toBe(0);
        expect(document.querySelector('input[data-ftype]').checked).toBe(true);
        expect(document.querySelector('input[data-fsource]').checked).toBe(true);
        expect(document.querySelector('input[data-frel]').checked).toBe(true);
        expect(document.querySelector('input[data-ftag]').checked).toBe(false);
        document.getElementById('dockfix').remove();
    });
});
