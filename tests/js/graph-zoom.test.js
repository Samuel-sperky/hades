import { beforeEach, describe, expect, it } from 'vitest';
import { S } from '../../resources/js/core/state/index.js';
import {
    K_DETAIL, K_FIT_MAX, K_FIT_MIN, K_LABEL_FADE_FROM, K_LABEL_FADE_TO,
    applyReadableZoom, fitZoom, labelFade,
} from '../../resources/js/graph/render/zoom.js';

/* Rozhodnutie 74: po auto-fite musí byť graf čitateľný (k ≈ 0.6), nie „celý, ale zlievajúci sa". */

beforeEach(() => {
    S.cam = { x: 0, y: 0, k: 0.85 };
});

describe('fitZoom', () => {
    it('reálny stav grafu (211 uzlov, bbox 1591×1476 @ 1440×900) nesmie skončiť pod prahom detailu', () => {
        const k = fitZoom(1591, 1476, 1440, 900);
        // surový fit je 0.488 → pod K_DETAIL (uzly by boli lacné disky, popisky vyfadované)
        expect(Math.min((1440 - 180) / 1591, (900 - 180) / 1476)).toBeLessThan(K_DETAIL);
        expect(k).toBe(K_FIT_MIN);
        expect(k).toBeGreaterThan(K_DETAIL);
    });

    it('neznámy viewport (0×0 pred prvým layoutom) nepadne na spodnú zátku 0.14', () => {
        expect(fitZoom(1591, 1476, 0, 0)).toBe(K_FIT_MIN);
        expect(fitZoom(1591, 1476, 1440, 0)).toBe(K_FIT_MIN);
        expect(fitZoom(1591, 1476, -5, -5)).toBe(K_FIT_MIN);
    });

    it('malý graf sa nenafúkne nad strop', () => {
        expect(fitZoom(100, 100, 1440, 900)).toBe(K_FIT_MAX);
    });

    it('stredne veľký graf si drží presný fit medzi podlahou a stropom', () => {
        // bbox 1000×500, viewport 1440×900, pad 90 → min(1.26, 1.44) = 1.26
        expect(fitZoom(1000, 500, 1440, 900)).toBeCloseTo(1.26, 5);
    });

    it('degenerovaný bbox (jediný uzol) nespadne na delenie nulou', () => {
        expect(fitZoom(0, 0, 1440, 900)).toBe(K_FIT_MAX);
        expect(Number.isFinite(fitZoom(NaN, NaN, 1440, 900))).toBe(true);
    });
});

describe('labelFade', () => {
    it('rampa popiskov ide z 0 na 1 medzi prahmi', () => {
        expect(labelFade(K_LABEL_FADE_FROM)).toBe(0);
        expect(labelFade(K_LABEL_FADE_FROM - 0.1)).toBe(0);
        expect(labelFade(K_LABEL_FADE_TO)).toBe(1);
        expect(labelFade(3)).toBe(1);
        expect(labelFade(0.53)).toBeCloseTo(0.5, 5);
    });

    it('čitateľné minimum ukáže popisky aspoň na 80 %', () => {
        expect(labelFade(K_FIT_MIN)).toBeGreaterThan(0.8);
    });
});

describe('applyReadableZoom', () => {
    it('zdvihne zoom a podrží stred záberu', () => {
        // fitView zapisuje cam.x = -cx·k → po zdvihnutí k musí stred cx zostať rovnaký
        const cx = -120, cy = 300;
        S.cam = { x: -cx * 0.14, y: -cy * 0.14, k: 0.14 };
        expect(applyReadableZoom()).toBe(true);
        expect(S.cam.k).toBe(K_FIT_MIN);
        expect(-S.cam.x / S.cam.k).toBeCloseTo(cx, 6);
        expect(-S.cam.y / S.cam.k).toBeCloseTo(cy, 6);
    });

    it('čitateľný zoom nechá nedotknutý (oddialenie kolieskom sa nevracia späť)', () => {
        S.cam = { x: 10, y: 20, k: 0.85 };
        expect(applyReadableZoom()).toBe(false);
        expect(S.cam).toEqual({ x: 10, y: 20, k: 0.85 });
    });

    it('presne na podlahe nič nemení', () => {
        S.cam = { x: 1, y: 2, k: K_FIT_MIN };
        expect(applyReadableZoom()).toBe(false);
        expect(S.cam.k).toBe(K_FIT_MIN);
    });

    it('nezmyselný zoom (0) nechá na pokoji namiesto delenia nulou', () => {
        S.cam = { x: 0, y: 0, k: 0 };
        expect(applyReadableZoom()).toBe(false);
        expect(Number.isFinite(S.cam.x)).toBe(true);
    });
});
