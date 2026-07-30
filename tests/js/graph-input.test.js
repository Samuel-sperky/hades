/* P8 — vstupná vrstva plátna a a11y minimum.
   Pointer Events + capture: ťahanie musí skončiť aj keď sa pointer stratí
   (predtým visel mousemove/mouseup na window a uzol sa „lepil" na kurzor). */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { installGraphDom } from './support/graph-dom.js';

let input, S, canvas;

// jsdom nepozná PointerEvent — MouseEvent s typom pointer* spustí ten istý listener
function pointer(type, { x = 0, y = 0, button = 0, pointerId = 1, pointerType = 'mouse' } = {}) {
    const e = new window.MouseEvent(type, { clientX: x, clientY: y, button, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'pointerId', { value: pointerId });
    Object.defineProperty(e, 'pointerType', { value: pointerType });
    return e;
}

beforeAll(async () => {
    installGraphDom();
    input = await import('../../resources/js/graph/input.js');
    ({ S } = await import('../../resources/js/core/state/index.js'));
    canvas = document.getElementById('mind');
    S.w = 1200; S.h = 800;
    input.register(canvas);
});

beforeEach(() => {
    S.nodes = [];
    S.edges = [];
    S.byId = new Map();
    S.areas = new Map();
    S.departments = new Map();
    S.local = null;
    S.connectFrom = null;
    S.view = 'map';
    S.cam = { x: 0, y: 0, k: 0.85 };
    S._interacting = false;
    for (const k of ['types', 'sources', 'areas', 'tags']) S.filter[k].clear();
});

describe('graph/input.js — a11y minimum plátna', () => {
    it('makes the canvas an image role with a label, a description and keyboard focus', () => {
        expect(canvas.getAttribute('role')).toBe('img');
        expect(canvas.getAttribute('tabindex')).toBe('0');
        expect(canvas.getAttribute('aria-label')).toBeTruthy();
        expect(canvas.getAttribute('aria-describedby')).toBe('graph-summary');
        expect(document.getElementById('graph-summary')).not.toBe(null);
    });

    it('writes the node, edge and area counts into the hidden summary', () => {
        S.name = 'AuraAI';
        S.nodes = [
            { id: 1, type: 'core', label: 'AuraAI' },
            { id: 2, type: 'skill', label: 'Vite', tags: [] },
        ];
        S.edges = [{ id: 1 }];
        S.areas = new Map([[1, { id: 1 }], [2, { id: 2 }]]);
        S.departments = new Map([[1, { id: 1 }]]);

        input.updateGraphSummary();
        const text = document.getElementById('graph-summary').textContent;

        expect(text).toContain('2 uzlov');
        expect(text).toContain('1 spojení');
        expect(text).toContain('2 oblastí');
        expect(text).toContain('Zobrazených 2 uzlov');
    });

    it('says so when the filters hid the whole network', () => {
        S.nodes = [
            { id: 1, type: 'core', label: 'AuraAI' },
            { id: 2, type: 'skill', label: 'Vite', tags: [] },
        ];
        S.filter.types.add('skill');
        input.updateGraphSummary();
        expect(document.getElementById('graph-summary').textContent).toContain('Filtre skryli');
    });

    it('pans the camera with the arrow keys', () => {
        canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        expect(S.cam.x).toBeLessThan(0);
        const afterRight = S.cam.x;
        canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        expect(S.cam.x).toBeGreaterThan(afterRight);
        canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        expect(S.cam.y).toBeLessThan(0);
    });

    it('ignores keys it does not own', () => {
        const before = { ...S.cam };
        canvas.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(S.cam).toEqual(before);
    });
});

describe('graph/input.js — pan a koniec interakcie', () => {
    it('pans the camera while dragging the empty canvas', () => {
        canvas.dispatchEvent(pointer('pointerdown', { x: 100, y: 100 }));
        expect(S._interacting).toBe(true);
        canvas.dispatchEvent(pointer('pointermove', { x: 140, y: 130 }));
        expect(S.cam.x).toBe(40);
        expect(S.cam.y).toBe(30);
        canvas.dispatchEvent(pointer('pointerup', { x: 140, y: 130 }));
        expect(S._interacting).toBe(false);
    });

    it('ends the interaction on a lost pointer (drag no longer sticks)', () => {
        canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10 }));
        canvas.dispatchEvent(pointer('pointermove', { x: 60, y: 10 }));
        canvas.dispatchEvent(pointer('pointercancel', { x: 60, y: 10 }));

        expect(S._interacting).toBe(false);
        expect(canvas.classList.contains('dragging')).toBe(false);
        expect(canvas.classList.contains('grabbing')).toBe(false);

        const camBefore = { ...S.cam };
        canvas.dispatchEvent(pointer('pointermove', { x: 400, y: 400 }));
        expect(S.cam.x).toBe(camBefore.x);   // pohyb po strate pointera už nepanuje
    });

    it('releases a dragged node and unpins it', () => {
        const n = { id: 2, type: 'skill', label: 'Vite', tags: [], x: 0, y: 0, strength: 1 };
        S.nodes = [n];
        S.byId = new Map([[2, n]]);
        S.cam = { x: 0, y: 0, k: 1 };

        canvas.dispatchEvent(pointer('pointerdown', { x: S.w / 2, y: S.h / 2 }));  // stred = uzol na (0,0)
        expect(n.fx).toBe(0);
        canvas.dispatchEvent(pointer('pointermove', { x: S.w / 2 + 30, y: S.h / 2 }));
        expect(n.fx).toBe(30);
        canvas.dispatchEvent(pointer('pointerup', { x: S.w / 2 + 30, y: S.h / 2 }));
        expect(n.fx).toBe(null);
        expect(S.cam.x).toBe(0);   // ťahal sa uzol, nie kamera
    });

    it('keeps the main core node pinned in the centre', () => {
        S.name = 'AuraAI';
        const core = { id: 1, type: 'core', label: 'AuraAI', x: 0, y: 0, strength: 1 };
        S.nodes = [core];
        S.byId = new Map([[1, core]]);
        S.cam = { x: 0, y: 0, k: 1 };

        canvas.dispatchEvent(pointer('pointerdown', { x: S.w / 2, y: S.h / 2 }));
        canvas.dispatchEvent(pointer('pointermove', { x: S.w / 2 + 50, y: S.h / 2 + 50 }));
        canvas.dispatchEvent(pointer('pointerup', { x: S.w / 2 + 50, y: S.h / 2 + 50 }));

        expect(core.fx).toBe(0);
        expect(core.fy).toBe(0);
    });

    it('ignores touch entirely (graph is desktop-only, decision #76/#77)', () => {
        canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, pointerType: 'touch' }));
        expect(S._interacting).toBe(false);
        canvas.dispatchEvent(pointer('pointermove', { x: 90, y: 90, pointerType: 'touch' }));
        expect(S.cam.x).toBe(0);
    });

    it('ignores non-primary mouse buttons', () => {
        canvas.dispatchEvent(pointer('pointerdown', { x: 10, y: 10, button: 2 }));
        expect(S._interacting).toBe(false);
    });
});
