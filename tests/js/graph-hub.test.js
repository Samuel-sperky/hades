import { beforeEach, describe, expect, it } from 'vitest';
import { S } from '../../resources/js/core/state/index.js';
import { anchorOf } from '../../resources/js/graph/anchors.js';
import { hubNode, isHub, nodeRadius } from '../../resources/js/graph/geometry.js';

/* Hub uzol („AuraAI") drží stred siete a je najväčší. Identifikácia bola rozsypaná
   na 6 miest ako `n.type === 'core' && n.label === S.name`; po rebrandingu je jediným
   zdrojom pravdy geometry.hubNode() s fallbackom pre prípad ďalšieho renamu. */

function setGraph(nodes, name = 'AuraAI') {
    S.name = name;
    S.nodes = nodes;
    S.byId = new Map(nodes.map((n) => [n.id, n]));
    S.degree = new Map();
    S.areas = new Map();
    S.departments = new Map();
}

const cores = () => ([
    { id: 1, type: 'core', label: 'AuraAI' },
    { id: 2, type: 'core', label: 'Hodnoty' },
    { id: 3, type: 'core', label: 'Štýl komunikácie' },
    { id: 4, type: 'core', label: 'Vzťah k tvorcovi' },
    { id: 9, type: 'skill', label: 'nejaký skill' },
]);

beforeEach(() => {
    S.opts.nodeScale = 1;
});

describe('hubNode', () => {
    it('po rebrandingu nájde premenovaný core uzol (label = config auraai.name)', () => {
        const nodes = cores();
        setGraph(nodes, 'AuraAI');
        expect(hubNode()).toBe(nodes[0]);
        expect(isHub(nodes[0])).toBe(true);
        expect(isHub(nodes[1])).toBe(false);
        expect(isHub(nodes[4])).toBe(false);
    });

    it('keď žiadny core uzol nesedí na mene, hubom je core s najnižším id (graf nestratí stred)', () => {
        const nodes = cores();
        setGraph(nodes, 'ÚplneIné');
        expect(hubNode()).toBe(nodes[0]); // id 1
        expect(isHub(nodes[0])).toBe(true);
    });

    it('rešpektuje poradie v poli — match vyhrá nad nižším id', () => {
        const nodes = [
            { id: 2, type: 'core', label: 'Hodnoty' },
            { id: 7, type: 'core', label: 'AuraAI' },
        ];
        setGraph(nodes, 'AuraAI');
        expect(hubNode()).toBe(nodes[1]);
    });

    it('prázdny graf nevráti hub a nespadne', () => {
        setGraph([]);
        expect(hubNode()).toBe(null);
        expect(isHub(null)).toBe(false);
        expect(isHub(undefined)).toBe(false);
    });

    it('graf bez core uzla nevráti hub', () => {
        setGraph([{ id: 5, type: 'skill', label: 'x' }]);
        expect(hubNode()).toBe(null);
    });

    it('memoizácia sa zneplatní po znovunačítaní grafu aj po zmene mena', () => {
        const first = cores();
        setGraph(first, 'AuraAI');
        expect(hubNode()).toBe(first[0]);

        const second = [{ id: 11, type: 'core', label: 'AuraAI' }];
        setGraph(second, 'AuraAI');
        expect(hubNode()).toBe(second[0]);

        S.name = 'Hades';
        expect(hubNode()).toBe(second[0]); // fallback na najnižšie id
    });
});

describe('hub je väčší a v strede', () => {
    it('nodeRadius: hub 24, ostatné core 14, bežný uzol pod 15', () => {
        const nodes = cores();
        setGraph(nodes);
        expect(nodeRadius(nodes[0])).toBe(24);
        expect(nodeRadius(nodes[1])).toBe(14);
        expect(nodeRadius(nodes[4])).toBeLessThan(15);
        expect(nodeRadius(nodes[0])).toBeGreaterThan(nodeRadius(nodes[4]));
    });

    it('nodeRadius škáluje sliderom nodeScale', () => {
        const nodes = cores();
        setGraph(nodes);
        S.opts.nodeScale = 1.5;
        expect(nodeRadius(nodes[0])).toBe(36);
    });

    it('anchorOf: hub na (0,0), ostatné core na prstenci 85', () => {
        const nodes = cores();
        setGraph(nodes);
        expect(anchorOf(nodes[0])).toEqual({ x: 0, y: 0 });
        for (const c of [nodes[1], nodes[2], nodes[3]]) {
            const a = anchorOf(c);
            expect(Math.hypot(a.x, a.y)).toBeCloseTo(85, 6);
        }
    });

    it('anchorOf drží stred aj po nezosúladenom rename (fallback hub)', () => {
        const nodes = cores();
        setGraph(nodes, 'Hades');
        expect(anchorOf(nodes[0])).toEqual({ x: 0, y: 0 });
        expect(Math.hypot(anchorOf(nodes[1]).x, anchorOf(nodes[1]).y)).toBeCloseTo(85, 6);
    });
});
