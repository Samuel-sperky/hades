/* Téma s treťou možnosťou „Systém" (rozhodnutie #64).
   Zmena logiky = test. Overuje sa rozloženie preferencie, zápis do localStorage
   a to, že setTheme() drží pôvodnú signatúru (app.js ju volá nezmenene). */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Canvas/render závislosti sú mimo rozsahu tohto testu — mock, aby import prešel.
vi.mock('../../resources/js/graph/canvas-colors.js', () => ({ setCanvasTheme: vi.fn() }));
vi.mock('../../resources/js/graph/render/cert-colors.js', () => ({ invalidateCertColors: vi.fn() }));
vi.mock('../../resources/js/graph/render/draw.js', () => ({ draw: vi.fn() }));

/** matchMedia stub — stav je premenný, aby sa dala odsimulovať zmena OS témy.
    `fire(matches)` prepne stav aj upozorní listenerov, presne ako prehliadač. */
function stubMatchMedia(darkMatches) {
    const state = { dark: darkMatches };
    const listeners = [];
    globalThis.matchMedia = (q) => ({
        media: q,
        get matches() { return q.includes('prefers-color-scheme: dark') ? state.dark : false; },
        addEventListener: (_e, fn) => listeners.push(fn),
        removeEventListener: () => {},
    });
    return {
        fire(dark) { state.dark = dark; listeners.forEach((fn) => fn({ matches: dark })); },
    };
}

async function loadTheme() {
    vi.resetModules();
    return import('../../resources/js/theme.js');
}

describe('theme — preferencia vs. rozložená hodnota', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset.theme;
    });

    it('svetlá a tmavá sa rozložia na seba samé', async () => {
        stubMatchMedia(false);
        const { setTheme } = await loadTheme();

        setTheme('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(localStorage.getItem('aura.theme')).toBe('light');

        setTheme('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(localStorage.getItem('aura.theme')).toBe('dark');
    });

    it('„system" uloží system, ale stampne konkrétnu hodnotu podľa OS', async () => {
        stubMatchMedia(true);
        const { setTheme, resolveTheme } = await loadTheme();

        setTheme('system');
        expect(localStorage.getItem('aura.theme')).toBe('system');
        expect(document.documentElement.dataset.theme).toBe('dark');
        expect(resolveTheme('system')).toBe('dark');
    });

    it('„system" pri svetlom OS stampne light', async () => {
        stubMatchMedia(false);
        const { setTheme } = await loadTheme();
        setTheme('system');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('neznáma hodnota degraduje na light (nezhodí boot)', async () => {
        stubMatchMedia(false);
        const { setTheme, themePref } = await loadTheme();
        setTheme('nonsense');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(themePref()).toBe('light');
    });

    it('preferencia sa čita zo starého hades.theme cez shim (#2)', async () => {
        stubMatchMedia(false);
        localStorage.setItem('hades.theme', 'dark');
        const { themePref } = await loadTheme();
        expect(themePref()).toBe('dark');
    });

    it('zmena OS témy prekreslí len pri preferencii „system"', async () => {
        const os = stubMatchMedia(false);
        const { setTheme } = await loadTheme();

        setTheme('light');
        os.fire(true);
        expect(document.documentElement.dataset.theme).toBe('light'); // ručná voľba sa nemení

        setTheme('system');
        expect(document.documentElement.dataset.theme).toBe('dark');  // OS je už dark
        os.fire(false);
        expect(document.documentElement.dataset.theme).toBe('light');
        os.fire(true);
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('THEMES je zoznam troch možností', async () => {
        stubMatchMedia(false);
        const { THEMES } = await loadTheme();
        expect(THEMES).toEqual(['light', 'dark', 'system']);
    });
});
