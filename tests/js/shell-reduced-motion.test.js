/* prefers-reduced-motion — dynamický listener + pokrytie canvas animácií (#81).
   Kľúčová vlastnosť: pohyb sa vypne BEZ zápisu do localStorage, takže po vypnutí
   preferencie sa používateľove hodnoty vrátia presne také, aké boli. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestDraw = vi.fn();
vi.mock('../../resources/js/graph/render/frame.js', () => ({ requestDraw }));

function stubMatchMedia(reduce) {
    const state = { reduce };
    const listeners = [];
    globalThis.matchMedia = (q) => ({
        media: q,
        get matches() { return q.includes('prefers-reduced-motion') ? state.reduce : false; },
        addEventListener: (_e, fn) => listeners.push(fn),
        removeEventListener: () => {},
    });
    return { fire(v) { state.reduce = v; listeners.forEach((fn) => fn({ matches: v })); } };
}

async function load() {
    vi.resetModules();
    requestDraw.mockClear();
    const state = await import('../../resources/js/core/state/index.js');
    const mod = await import('../../resources/js/shell/reduced-motion.js');
    return { S: state.S, ...mod };
}

describe('reduced-motion', () => {
    beforeEach(() => {
        localStorage.clear();
        delete document.documentElement.dataset.reducedMotion;
    });

    it('bez preferencie sa nič nemení a atribút nevznikne', async () => {
        stubMatchMedia(false);
        const { S, register } = await load();
        S.opts.anim = 0.8;
        S.opts.life = 0.6;
        register();
        expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
        expect(S.opts.anim).toBe(0.8);
        expect(S.opts.life).toBe(0.6);
    });

    it('so zapnutou preferenciou znuluje pohyb canvasu a stampne atribút', async () => {
        stubMatchMedia(true);
        const { S, register } = await load();
        S.opts.anim = 0.8;
        S.opts.life = 0.6;
        register();
        expect(document.documentElement.dataset.reducedMotion).toBe('1');
        expect(S.opts.anim).toBe(0);
        expect(S.opts.life).toBe(0);
        expect(requestDraw).toHaveBeenCalled();
    });

    it('nezapisuje do localStorage (preferencie používateľa zostávajú)', async () => {
        stubMatchMedia(true);
        const { S, register } = await load();
        S.opts.anim = 0.8;
        register();
        expect(localStorage.getItem('aura.opts')).toBeNull();
    });

    it('vypnutie preferencie za behu vráti presne pôvodné hodnoty', async () => {
        const os = stubMatchMedia(false);
        const { S, register } = await load();
        S.opts.anim = 0.75;
        S.opts.life = 0.35;
        register();

        os.fire(true);
        expect(S.opts.anim).toBe(0);
        expect(S.opts.life).toBe(0);

        os.fire(false);
        expect(S.opts.anim).toBe(0.75);
        expect(S.opts.life).toBe(0.35);
        expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
    });

    it('ručná zmena slidera počas preferencie zneplatní snapshot', async () => {
        const os = stubMatchMedia(true);
        const { S, register, dropMotionSnapshot } = await load();
        S.opts.anim = 0.9;
        register();
        expect(S.opts.anim).toBe(0);

        // používateľ posunul slider Animácie → setOpt() zavolá dropMotionSnapshot
        S.opts.anim = 0.4;
        dropMotionSnapshot('anim');

        os.fire(false);
        expect(S.opts.anim).toBe(0.4); // nie 0.9 — snapshot bol zahodený
    });

    it('dropMotionSnapshot ignoruje kľúče, ktoré s pohybom nesúvisia', async () => {
        const os = stubMatchMedia(true);
        const { S, register, dropMotionSnapshot } = await load();
        S.opts.anim = 0.9;
        register();
        dropMotionSnapshot('labelAlpha');
        os.fire(false);
        expect(S.opts.anim).toBe(0.9); // snapshot prežil
    });

    it('bez matchMedia (staré prostredie) sa nezrúti', async () => {
        globalThis.matchMedia = undefined;
        const { register, reducedMotion } = await load();
        expect(() => register()).not.toThrow();
        expect(reducedMotion()).toBe(false);
    });
});
