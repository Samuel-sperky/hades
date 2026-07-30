import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SCREEN,
    SCREENS,
    SCREEN_ICONS,
    SCREEN_LABELS,
    normalizeScreen,
} from '../../resources/js/core/screens.js';

/* Zamknuté rozhranie #16 — zoznam obrazoviek je kontrakt medzi router.js (P9),
   chatom (P6), obrazovkami (P10) a e-shopom (P11). Test padne, keď niekto zoznam
   zmení bez zápisu do CLAUDE.md. */

describe('core/screens — register obrazoviek', () => {
    it('obsahuje presne 9 zamknutých obrazoviek v definovanom poradí', () => {
        expect(SCREENS).toEqual([
            'dnes',
            'dennik',
            'graf',
            'kniznica',
            'chat',
            'eshop',
            'rozhodnutia',
            'kontrola',
            'smernica',
        ]);
    });

    it('každá obrazovka má SK popisok a ikonu', () => {
        for (const name of SCREENS) {
            expect(SCREEN_LABELS[name], 'popisok ' + name).toBeTruthy();
            expect(SCREEN_ICONS[name], 'ikona ' + name).toBeTruthy();
        }
        expect(Object.keys(SCREEN_LABELS).sort()).toEqual([...SCREENS].sort());
        expect(Object.keys(SCREEN_ICONS).sort()).toEqual([...SCREENS].sort());
    });

    it('v zozname nie sú duplikáty', () => {
        expect(new Set(SCREENS).size).toBe(SCREENS.length);
    });

    it('normalizeScreen prepustí platnú obrazovku', () => {
        for (const name of SCREENS) expect(normalizeScreen(name)).toBe(name);
    });

    it('normalizeScreen padne na predvolenú pri neznámom/prázdnom vstupe', () => {
        expect(DEFAULT_SCREEN).toBe('dnes');
        expect(normalizeScreen('neexistuje')).toBe(DEFAULT_SCREEN);
        expect(normalizeScreen(null)).toBe(DEFAULT_SCREEN);
        expect(normalizeScreen(undefined)).toBe(DEFAULT_SCREEN);
        expect(normalizeScreen('')).toBe(DEFAULT_SCREEN);
    });
});
