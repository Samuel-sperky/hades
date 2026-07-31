/* W1 — deterministický radiálny layout MAPY.

   Kľúčová vlastnosť: rovnaké ID → rovnaké pozície medzi návštevami (seed z ID,
   žiadny d3-force). Test overuje determinizmus seedu aj tvar layoutu. */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let S, mapLayout, invalidateMapLayout, seededRand;

beforeAll(async () => {
    installGraphDom();
    ({ S } = await import('../../resources/js/core/state/index.js'));
    ({ mapLayout, invalidateMapLayout } = await import('../../resources/js/graph/map/layout.js'));
    ({ seededRand } = await import('../../resources/js/graph/map/prng.js'));
});

beforeEach(() => {
    invalidateMapLayout();
    S.areas = new Map([
        [1, { id: 1, name: 'Vývoj & kód', slug: 'vyvoj-kod', color: '#03797e', angle: 342 }],
        [2, { id: 2, name: 'Biznis & projekty', slug: 'biznis-projekty', color: '#2f6d8f', angle: 126 }],
    ]);
    S.departments = new Map([
        [10, { id: 10, area_id: 1, name: 'Backend', slug: 'backend' }],
        [11, { id: 11, area_id: 1, name: 'DevOps', slug: 'devops' }],
        [12, { id: 12, area_id: 2, name: 'Aplikácie', slug: 'aplikacie' }],
    ]);
    S.nodes = [
        { id: 1, type: 'core', area_id: null, department_id: null },
        { id: 2, type: 'skill', area_id: 1, department_id: 10, strength: 8 },
        { id: 3, type: 'skill', area_id: 1, department_id: 10, strength: 3 },
        { id: 4, type: 'project', area_id: 2, department_id: 12, strength: 4 },
    ];
});

describe('map/prng — seededRand', () => {
    it('je deterministický pre rovnaký seed', () => {
        const a = seededRand(20260731);
        const b = seededRand(20260731);
        expect(a()).toBe(b());
        expect(a()).toBe(b());
    });

    it('rôzne seedy dávajú rôzne postupnosti', () => {
        expect(seededRand(1)()).not.toBe(seededRand(2)());
    });
});

describe('map/layout — mapLayout', () => {
    it('rozmiestni oblasti podľa uhla z payloadu', () => {
        const lay = mapLayout();
        expect(lay.areas.length).toBe(2);
        const a1 = lay.areaById.get(1);
        // angle 342° → bázová pozícia mimo počiatku
        expect(Math.hypot(a1.bx, a1.by)).toBeGreaterThan(200);
    });

    it('priradí oddelenia oblastiam a listy oddeleniam', () => {
        const lay = mapLayout();
        expect(lay.depts.length).toBe(3);
        expect(lay.areaById.get(1).depts.length).toBe(2);
        expect(lay.deptById.get(10).leaves.length).toBe(2); // uzly 2 a 3
        expect(lay.deptById.get(12).leaves.length).toBe(1); // uzol 4
        expect(lay.leaves.length).toBe(3);                  // core sa nepočíta
        expect(lay.areaById.get(1).leafCount).toBe(2);
    });

    it('je stabilný medzi prepočtami (deterministický seed)', () => {
        const a = mapLayout();
        const snap = a.leaves.map((l) => [l.id, l.bx, l.by]);
        invalidateMapLayout();
        const b = mapLayout();
        const snap2 = b.leaves.map((l) => [l.id, l.bx, l.by]);
        expect(snap2).toEqual(snap);
    });

    it('ignoruje uzly bez department_id a jadro', () => {
        S.nodes.push({ id: 9, type: 'memory', area_id: 1, department_id: null });
        invalidateMapLayout();
        const lay = mapLayout();
        expect(lay.leafByNode.has(9)).toBe(false);
        expect(lay.leafByNode.has(1)).toBe(false);
    });
});
