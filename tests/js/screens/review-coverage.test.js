import { describe, expect, it } from 'vitest';

import {
    applyMark,
    areaCoverage,
    coverage,
    decNeedsReview,
    triageCandidates,
} from '../../../resources/js/screens/review/coverage.js';

/* Matematika pokrytia istoty — kvôli nej sa obrazovka Kontrola vôbec dá použiť.
   Čísla v testoch sú reálne z DB pri písaní balíka: 684 uzlov, 64 overených,
   0 hypotéz, 6 pascí, 614 bez značky, 5 v fronte na overenie. */

const CERT = { overene: 64, hypoteza: 0, pasca: 6, bez: 614, total: 684, needs_review: 5 };


describe('coverage', () => {
    it('spočíta značené a percento pokrytia z reálnych čísel', () => {
        const c = coverage(CERT);
        expect(c.marked).toBe(70);
        expect(c.pct).toBe(10);      // 70 / 684 = 10,2 %
        expect(c.needsReview).toBe(5);
    });

    it('nulový total nedelí nulou', () => {
        expect(coverage({ total: 0, bez: 0 }).pct).toBe(0);
        expect(coverage(null).pct).toBe(0);
        expect(coverage(undefined).total).toBe(0);
    });

    it('bez značky nikdy nepretečie nad total', () => {
        const c = coverage({ total: 3, bez: 10 });
        expect(c.marked).toBe(0);
        expect(c.pct).toBe(0);
    });
});


describe('applyMark — optimistický posun pokrytia po overení', () => {
    it('presunie jeden uzol z „bez" do „overené"', () => {
        const next = applyMark(CERT, 'overene');
        expect(next.bez).toBe(613);
        expect(next.overene).toBe(65);
        expect(coverage(next).marked).toBe(71);
    });

    it('neznáma značka len uberie z „bez", nič nepridá', () => {
        const next = applyMark(CERT, 'nezmysel');
        expect(next.bez).toBe(613);
        expect(next.overene).toBe(64);
    });

    it('nepustí „bez" pod nulu', () => {
        expect(applyMark({ bez: 0, overene: 1 }, 'overene').bez).toBe(0);
    });

    it('nemutuje vstup', () => {
        applyMark(CERT, 'overene');
        expect(CERT.bez).toBe(614);
    });
});


describe('decNeedsReview', () => {
    it('zníži frontu na overenie a zastaví na nule', () => {
        expect(decNeedsReview({ needs_review: 5 }).needs_review).toBe(4);
        expect(decNeedsReview({ needs_review: 0 }).needs_review).toBe(0);
        expect(decNeedsReview({}).needs_review).toBe(0);
    });
});


describe('triageCandidates', () => {
    const nodes = [
        { id: 1, type: 'core', certainty: null, strength: 99 },
        { id: 2, type: 'skill', certainty: null, strength: 4 },
        { id: 3, type: 'skill', certainty: 'overene', strength: 9 },
        { id: 4, type: 'memory', certainty: null, strength: 7 },
        { id: 5, type: 'project', certainty: '', strength: 7 },
    ];

    it('vynechá jadro a už označené uzly', () => {
        // id 1 je core, id 3 má certainty → von. Zvyšok podľa strength zostupne,
        // pri rovnosti (id 4 a 5 majú 7) rozhoduje vyššie id.
        expect(triageCandidates(nodes).map((n) => n.id)).toEqual([5, 4, 2]);
    });

    it('prázdny string v certainty sa počíta ako „bez značky"', () => {
        expect(triageCandidates(nodes).some((n) => n.id === 5)).toBe(true);
    });

    it('drží limit a znesie neplatný vstup', () => {
        expect(triageCandidates(nodes, 2)).toHaveLength(2);
        expect(triageCandidates(null)).toEqual([]);
        expect(triageCandidates([null, undefined])).toEqual([]);
    });
});


describe('areaCoverage', () => {
    const perArea = [
        { name: 'Vývoj', count: 100, bez: 50, color: '#03797e' },
        { name: 'Dizajn', count: 36, bez: 34 },
        { name: 'Prázdna', count: 0, bez: 0 },
    ];

    it('radí od najhoršie pokrytej oblasti', () => {
        const out = areaCoverage(perArea);
        expect(out.map((a) => a.name)).toEqual(['Prázdna', 'Dizajn', 'Vývoj']);
        expect(out.find((a) => a.name === 'Dizajn').pct).toBe(6);
        expect(out.find((a) => a.name === 'Vývoj').pct).toBe(50);
    });

    it('nulový počet dá 0 % a nespadne', () => {
        expect(areaCoverage([{ name: 'x', count: 0 }])[0].pct).toBe(0);
        expect(areaCoverage(null)).toEqual([]);
    });
});
