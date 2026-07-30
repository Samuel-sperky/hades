import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Rozhodnutie 81: prefers-reduced-motion musí vypnúť animácie plátna, nie len CSS.
   core/motion.js číta preferenciu raz pri načítaní, preto sa moduly importujú dynamicky
   s podvrhnutým matchMedia. */

const REDUCE = '(prefers-reduced-motion: reduce)';

function mockMatchMedia(reduce) {
    window.matchMedia = vi.fn((q) => ({
        matches: q === REDUCE ? reduce : false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
    }));
}

async function loadWith(reduce) {
    vi.resetModules();
    mockMatchMedia(reduce);
    const motion = await import('../../resources/js/core/motion.js');
    const anim = await import('../../resources/js/graph/animation.js');
    const state = await import('../../resources/js/core/state/index.js');
    return { motion, anim, S: state.S };
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
    document.body.className = '';
});

afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.resetModules();
});

describe('prefers-reduced-motion: reduce', () => {
    it('REDUCED_MOTION je zapnuté', async () => {
        const { motion } = await loadWith(true);
        expect(motion.REDUCED_MOTION).toBe(true);
    });

    it('vypne udalostné animácie aj ambientný život, aj keď sú slidery na maxime', async () => {
        const { anim, S } = await loadWith(true);
        S.opts.anim = 1;
        S.opts.life = 1;
        expect(anim.animLevel()).toBe(0);
        expect(anim.lifeLevel()).toBe(0);
    });

    it('ambientný režim animácie neprebudí', async () => {
        const { anim, S } = await loadWith(true);
        S.opts.anim = 1;
        S.opts.life = 0;
        document.body.classList.add('ambient');
        expect(anim.animLevel()).toBe(0);
        expect(anim.lifeLevel()).toBe(0);
    });

    it('zrod uzla ani dýchanie nemodulujú polomer', async () => {
        const { anim, S } = await loadWith(true);
        S._clock = 10;
        S._anim = 1;
        S._life = 0;   // lifeLevel() = 0 → frame() nastaví _life na 0
        S.cam = { x: 0, y: 0, k: 1 };
        const n = { id: 3, type: 'skill', _born: 9.9 };
        expect(anim.birthScale(n)).toBe(1);
        expect(anim.breatheFactor(n)).toBe(1);
    });
});

describe('bez reduced-motion', () => {
    it('slidery riadia intenzitu', async () => {
        const { motion, anim, S } = await loadWith(false);
        expect(motion.REDUCED_MOTION).toBe(false);
        S.opts.anim = 1;
        S.opts.life = 0.5;
        expect(anim.animLevel()).toBe(1);
        expect(anim.lifeLevel()).toBe(0.5);
        S.opts.anim = 0;
        expect(anim.animLevel()).toBe(0);
    });

    it('ambientný režim zosilní jemné efekty', async () => {
        const { anim, S } = await loadWith(false);
        S.opts.anim = 0.5;
        S.opts.life = 0.5;
        document.body.classList.add('ambient');
        expect(anim.animLevel()).toBeCloseTo(0.8, 6);
        expect(anim.lifeLevel()).toBeCloseTo(1.08, 6);
    });

    it('dýchanie mrzne pri interakcii a pod prahom detailu', async () => {
        const { anim, S } = await loadWith(false);
        S._clock = 3;
        S._life = 1;
        S._lifeTier = 0;
        S.hover = null;
        S.cam = { x: 0, y: 0, k: 1 };
        const n = { id: 3, type: 'skill' };
        S._interacting = false;
        expect(anim.breatheFactor(n)).not.toBe(1);
        S._interacting = true;
        expect(anim.breatheFactor(n)).toBe(1);
        S._interacting = false;
        S.cam = { x: 0, y: 0, k: 0.4 };  // pod K_DETAIL
        expect(anim.breatheFactor(n)).toBe(1);
    });
});
