import { describe, expect, it } from 'vitest';

import {
    buildDirectiveMarkdown,
    contextSentence,
    oneLine,
} from '../../../resources/js/screens/directive/markdown-builder.js';
import { pickSelected, suggestTotal } from '../../../resources/js/screens/directive/suggest.js';

/* Smernica je vstup do promptu pre Claude Code — jej markdown je kontrakt.
   Test drží dve veci: (1) sekcia „Kde nájdeš" je naozaj zrušená (akceptačné
   kritérium P10), (2) do výstupu sa dostanú LEN zaškrtnuté položky. */

const PICKED = {
    skills: [
        { id: 1, label: 'Laravel refactor', path: 'skills/laravel.md', verified: true },
        { id: 2, label: 'Neoverený skill', path: 'skills/x.md', verified: false },
        { id: 3, label: 'Overený bez cesty', verified: true },
    ],
    projects: [{ id: 4, label: 'AuraAI', info: 'C:\\Aura\\aura-ai' }],
    facts: [{ id: 5, label: 'Port', snippet: '  8082   je   dev  port ' }],
    rules: [{ id: 6, label: 'Commity', snippet: 'anglicky' }],
};


describe('buildDirectiveMarkdown', () => {
    const md = buildDirectiveMarkdown('Prerob dashboard', PICKED);

    it('začína nadpisom s úlohou a končí jedným newline', () => {
        expect(md.startsWith('# Smernica: Prerob dashboard\n')).toBe(true);
        expect(md.endsWith('\n')).toBe(true);
        expect(md.endsWith('\n\n')).toBe(false);
    });

    it('sekcia „Kde nájdeš" je zrušená (akceptačné kritérium P10)', () => {
        expect(md).not.toContain('Kde nájdeš');
    });

    it('do skillov ide len overený uzol s cestou', () => {
        expect(md).toContain('- Laravel refactor — `skills/laravel.md`');
        expect(md).not.toContain('Neoverený skill');
        expect(md).not.toContain('Overený bez cesty');
    });

    it('projekty, fakty a pravidlá majú svoje sekcie v pevnom poradí', () => {
        const order = ['## Kontext', '## Použi tieto skilly', '## Súvisiace projekty',
            '## Kľúčové fakty', '## Pravidlá a preferencie']
            .map((h) => md.indexOf(h));
        expect(order.every((i) => i >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('úryvky sa zlepia na jeden riadok', () => {
        expect(md).toContain('- Port: 8082 je dev port');
    });

    it('prázdny výber dá len nadpis a kontext', () => {
        const empty = buildDirectiveMarkdown('', { skills: [], projects: [], facts: [], rules: [] });
        expect(empty).toContain('# Smernica: Nešpecifikovaná úloha');
        expect(empty).toContain('## Kontext');
        expect(empty).not.toContain('## Použi tieto skilly');
    });

    it('hovorí AuraAI, nie Hades (rebranding W1)', () => {
        expect(md).toContain('AuraAI');
        expect(md).not.toContain('Hades');
    });
});


describe('contextSentence', () => {
    it('vymenuje počty len keď niečo je', () => {
        expect(contextSentence('X', [{}], [{}, {}])).toContain('Zahŕňa 1× skill a 2× projekt.');
        expect(contextSentence('X', [], [])).not.toContain('Zahŕňa');
    });

    it('bez úlohy použije neutrálny predmet', () => {
        expect(contextSentence('', [], [])).toContain('túto úlohu');
    });
});


describe('oneLine', () => {
    it('skráti a doplní výpustku', () => {
        expect(oneLine('a'.repeat(200))).toHaveLength(161);
        expect(oneLine('a'.repeat(200)).endsWith('…')).toBe(true);
    });

    it('znesie null aj prázdny vstup', () => {
        expect(oneLine(null)).toBe('');
        expect(oneLine('  ')).toBe('');
    });
});


describe('pickSelected / suggestTotal', () => {
    const suggested = {
        skills: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }],
        projects: [{ id: 3, label: 'C' }],
    };

    it('spočíta všetky návrhy naprieč skupinami', () => {
        expect(suggestTotal(suggested)).toBe(3);
        expect(suggestTotal({})).toBe(0);
        expect(suggestTotal(null)).toBe(0);
    });

    it('prepustí len zaškrtnuté id a vždy vráti všetky kľúče', () => {
        const picked = pickSelected(suggested, new Set([2, 3]));
        expect(picked.skills.map((s) => s.id)).toEqual([2]);
        expect(picked.projects.map((s) => s.id)).toEqual([3]);
        expect(picked.facts).toEqual([]);
        expect(picked.rules).toEqual([]);
    });
});
