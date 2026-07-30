/* P8 — kamera. Zoom má jediné miesto (zoomAt), takže strop/podlaha platí pre
   koliesko, tlačidlá aj skratky; drôtovanie ide na data-zoom (§4.7), nie na id. */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let camera, S;

beforeAll(async () => {
    installGraphDom('<div id="zoomctl">'
        + '<button id="zoom-in" data-zoom="in"></button>'
        + '<button id="zoom-out" data-zoom="out"></button>'
        + '<button id="zoom-reset" data-zoom="reset"></button>'
        + '<button data-zoom="nonsense"></button>'
        + '</div>');
    camera = await import('../../resources/js/graph/camera.js');
    ({ S } = await import('../../resources/js/core/state/index.js'));
    S.w = 1200; S.h = 800;
    camera.register(document.body);
});

beforeEach(() => {
    S.cam = { x: 0, y: 0, k: 0.85 };
    S.nodes = [];
    S.local = null;
    S.view = 'map';
    for (const k of ['types', 'sources', 'areas', 'tags']) S.filter[k].clear();
});

describe('graph/camera.js — screenToWorld', () => {
    it('maps the screen centre to the world origin', () => {
        expect(camera.screenToWorld(S.w / 2, S.h / 2)).toEqual({ x: 0, y: 0 });
    });
});

describe('graph/camera.js — zoom', () => {
    it('keeps the zoom inside its limits', () => {
        camera.zoomBy(100);
        expect(S.cam.k).toBe(camera.K_MAX);
        camera.zoomBy(0.0001);
        expect(S.cam.k).toBe(camera.K_MIN);
    });

    it('keeps the pivot point still while zooming', () => {
        const px = 300, py = 200;
        const before = camera.screenToWorld(px, py);
        camera.zoomAt(px, py, 1.7);
        const after = camera.screenToWorld(px, py);
        expect(after.x).toBeCloseTo(before.x, 6);
        expect(after.y).toBeCloseTo(before.y, 6);
    });

    it('pans by screen pixels', () => {
        camera.panBy(-40, 25);
        expect(S.cam).toMatchObject({ x: -40, y: 25 });
    });
});

describe('graph/camera.js — register', () => {
    it('wires the buttons through data-zoom', () => {
        document.querySelector('[data-zoom="in"]').click();
        expect(S.cam.k).toBeCloseTo(0.85 * 1.3, 6);
        document.querySelector('[data-zoom="out"]').click();
        expect(S.cam.k).toBeCloseTo(0.85, 6);
    });

    it('ignores an unknown data-zoom value', () => {
        const el = document.querySelector('[data-zoom="nonsense"]');
        expect(el.onclick).toBe(null);
    });

    it('reset fits the view — empty graph falls back to the default camera', () => {
        document.querySelector('[data-zoom="reset"]').click();
        expect(S.cam).toEqual({ x: 0, y: 0, k: 0.85 });
    });

    it('fits the camera onto the visible nodes', () => {
        S.nodes = [
            { id: 1, type: 'skill', label: 'a', tags: [], x: -400, y: -200 },
            { id: 2, type: 'skill', label: 'b', tags: [], x: 400, y: 200 },
        ];
        camera.fitView();
        expect(S.cam.x).toBeCloseTo(0, 6);   // bbox je symetrický okolo počiatku
        expect(S.cam.y).toBeCloseTo(0, 6);
        expect(S.cam.k).toBeGreaterThan(camera.K_MIN);
        expect(S.cam.k).toBeLessThanOrEqual(1.6);
    });
});
