/* W1 — stavový stroj MAPY (prechody go) + hash routing.

   Overuje 4-úrovňové zanorenie mapa→oblasť→oddelenie→uzol, návrat mapBack a
   obojsmerný prevod stav ↔ hash (deep-link / back button). */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let S, mapLayout, invalidateMapLayout, state, hash;

beforeAll(async () => {
    installGraphDom('<nav id="breadcrumb"></nav>');
    ({ S } = await import('../../resources/js/core/state/index.js'));
    ({ mapLayout, invalidateMapLayout } = await import('../../resources/js/graph/map/layout.js'));
    state = await import('../../resources/js/graph/map/state.js');
    hash = await import('../../resources/js/graph/map/hash.js');
    S.w = 1200; S.h = 800;
});

beforeEach(() => {
    S.screen = 'dnes'; // vypni auto rAF slučku (scheduleFrame beží len na 'graf')
    S.cam = { x: 0, y: 0, k: 0.85 };
    invalidateMapLayout();
    S.areas = new Map([
        [1, { id: 1, name: 'Vývoj & kód', slug: 'vyvoj-kod', color: '#03797e', angle: 342 }],
        [2, { id: 2, name: 'Biznis & projekty', slug: 'biznis-projekty', color: '#2f6d8f', angle: 126 }],
    ]);
    S.departments = new Map([
        [10, { id: 10, area_id: 1, name: 'Backend', slug: 'backend' }],
        [12, { id: 12, area_id: 2, name: 'Aplikácie', slug: 'aplikacie' }],
    ]);
    S.nodes = [
        { id: 1, type: 'core', area_id: null, department_id: null },
        { id: 2, type: 'skill', area_id: 1, department_id: 10, strength: 8, label: 'MCP server' },
        { id: 4, type: 'project', area_id: 2, department_id: 12, strength: 4, label: 'Aura KPI' },
    ];
    window.history.replaceState(null, '', '#');
});

describe('map/state — prechody go()', () => {
    it('zanorí mapa → oblasť → oddelenie → uzol a odvodí kontext', () => {
        state.mapGo({ level: 'map' }, { animate: false });
        expect(state.getMapState().level).toBe('map');

        state.mapGo({ level: 'area', area: 1 }, { animate: false });
        expect(state.getMapState()).toMatchObject({ level: 'area', areaId: 1 });

        state.mapGo({ level: 'dept', dept: 10 }, { animate: false });
        expect(state.getMapState()).toMatchObject({ level: 'dept', areaId: 1, deptId: 10 });

        state.mapGo({ level: 'node', node: 2 }, { animate: false });
        // úroveň uzla odvodí oddelenie aj oblasť z listu
        expect(state.getMapState()).toMatchObject({ level: 'node', areaId: 1, deptId: 10, nodeId: 2 });
    });

    it('mapBack sa vracia o úroveň vyššie', () => {
        state.mapGo({ level: 'node', node: 2 }, { animate: false });
        state.mapBack();
        expect(state.getMapState().level).toBe('dept');
        state.mapBack();
        expect(state.getMapState().level).toBe('area');
        state.mapBack();
        expect(state.getMapState().level).toBe('map');
    });

    it('mapSibling prechádza oddelenia v oblasti dookola', () => {
        state.mapGo({ level: 'dept', dept: 10 }, { animate: false });
        state.mapSibling(1);
        // oblasť 1 má len 1 oddelenie → ostáva na 10
        expect(state.getMapState().deptId).toBe(10);
    });

    it('go na neznámy uzol spadne na mapu', () => {
        state.mapGo({ level: 'node', node: 999 }, { animate: false });
        expect(state.getMapState().level).toBe('map');
    });
});

describe('map/hash — formatHash / parseHash', () => {
    it('serializuje každú úroveň', () => {
        const lay = mapLayout();
        const area = lay.areaById.get(1);
        const dept = lay.deptById.get(10);
        expect(hash.formatHash({ level: 'map' }, null, null)).toBe('#mapa');
        expect(hash.formatHash({ level: 'area' }, area, null)).toBe('#mapa/vyvoj-kod');
        expect(hash.formatHash({ level: 'dept' }, area, dept)).toBe('#mapa/vyvoj-kod/backend');
        expect(hash.formatHash({ level: 'node', nodeId: 2 }, area, dept)).toBe('#mapa/vyvoj-kod/backend/2');
    });

    it('rozparsuje deep-link späť na stav', () => {
        const lay = mapLayout();
        expect(hash.parseHash('#mapa', lay)).toEqual({ level: 'map' });
        expect(hash.parseHash('#mapa/vyvoj-kod', lay)).toEqual({ level: 'area', area: 1 });
        expect(hash.parseHash('#mapa/vyvoj-kod/backend', lay)).toEqual({ level: 'dept', dept: 10 });
        expect(hash.parseHash('#mapa/vyvoj-kod/backend/2', lay)).toEqual({ level: 'node', node: 2 });
    });

    it('neznámy slug / uzol degraduje na najbližšiu platnú úroveň', () => {
        const lay = mapLayout();
        expect(hash.parseHash('#mapa/neexistuje', lay)).toEqual({ level: 'map' });
        expect(hash.parseHash('#mapa/vyvoj-kod/neexistuje', lay)).toEqual({ level: 'area', area: 1 });
        expect(hash.parseHash('#mapa/vyvoj-kod/backend/999', lay)).toEqual({ level: 'dept', dept: 10 });
    });
});
