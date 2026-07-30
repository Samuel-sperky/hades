/* Kontrakt §4.8 + otvorený bod §7.6 — strážny test dizajnového systému.
   Stylelint (.stylelintrc.json) je pri ruke pri písaní, ale `npm run lint:css`
   nie je v testovej bráne. Tento test ju robí: nulový baseline sa nesmie zhoršiť
   ani vtedy, keď niekto pridá CSS bez spustenia lintera.

   Zároveň drží drift test rodinnej palety (rozhodnutie #55): --chart-1..8 musia
   v light aj dark bloku existovať a mať presné hodnoty z C:\Aura\sperky-ai. */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// vitest beží z koreňa projektu (vitest.config.js root), takže cwd je spoľahlivejšie
// než import.meta.url — ten je vo vitest virtuálny.
const CSS_ROOT = resolve(process.cwd(), 'resources/css');

/** Súbory, ktoré podľa kontraktu §4.8 SMÚ obsahovať farebné literály. */
const COLOR_LITERAL_ALLOWED = ['tokens.css', 'dark.css'];

function cssFiles(dir = CSS_ROOT, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) cssFiles(full, out);
        else if (entry.endsWith('.css')) out.push(full);
    }
    return out;
}

/** Odstráni /* … *​/ komentáre — literál v komentári nie je porušenie kontraktu. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

describe('CSS token contract (§4.8)', () => {
    const files = cssFiles();

    it('nájde CSS parciály', () => {
        expect(files.length).toBeGreaterThan(40);
    });

    it('žiadny hex literál mimo tokens.css a dark.css', () => {
        const offenders = [];
        for (const file of files) {
            const rel = relative(CSS_ROOT, file).replace(/\\/g, '/');
            if (COLOR_LITERAL_ALLOWED.includes(rel)) continue;
            const src = stripComments(readFileSync(file, 'utf8'));
            const hits = src.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
            // dátové URI (napr. favicon v CSS) a fragmenty url(#id) nie sú farby
            const colors = hits.filter((h) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(h));
            if (colors.length) offenders.push(rel + ' → ' + colors.join(', '));
        }
        expect(offenders).toEqual([]);
    });

    it('žiadne rgba()/hsla() s číselnými zložkami mimo tokens.css a dark.css', () => {
        const offenders = [];
        for (const file of files) {
            const rel = relative(CSS_ROOT, file).replace(/\\/g, '/');
            if (COLOR_LITERAL_ALLOWED.includes(rel)) continue;
            const src = stripComments(readFileSync(file, 'utf8'));
            // rgba(var(--x), .3) je sankcionovaný vzor (alfa nad tokenovým tripletom);
            // rgba(16, 29, 27, .06) je literál a je zakázaný.
            const hits = src.match(/(?:rgba?|hsla?)\(\s*\d/g) || [];
            if (hits.length) offenders.push(rel + ' → ' + hits.length + '×');
        }
        expect(offenders).toEqual([]);
    });

    it('každý CSS súbor má ≤ 400 riadkov (kontrakt §2)', () => {
        const tooLong = [];
        for (const file of files) {
            const lines = readFileSync(file, 'utf8').split('\n').length;
            if (lines > 400) tooLong.push(relative(CSS_ROOT, file).replace(/\\/g, '/') + ' = ' + lines);
        }
        expect(tooLong).toEqual([]);
    });
});

describe('Aura family drift (rozhodnutie #55)', () => {
    const tokens = readFileSync(join(CSS_ROOT, 'tokens.css'), 'utf8');
    const dark = readFileSync(join(CSS_ROOT, 'dark.css'), 'utf8');

    // Meraný etalón: C:\Aura\sperky-ai/src/app/globals.css, overený proti
    // aura-roadmap a aura-redesign (zhoda 3/3).
    const LIGHT = {
        '--chart-1': '#d8b878', '--chart-2': '#05bcc4', '--chart-3': '#6f86d6', '--chart-4': '#e0857b',
        '--chart-5': '#6ec6a4', '--chart-6': '#c08adb', '--chart-7': '#e0a850', '--chart-8': '#5b9bd5',
    };
    const DARK = {
        '--chart-1': '#d8b878', '--chart-2': '#4dd9df', '--chart-3': '#8a9cf0', '--chart-4': '#ec988f',
        '--chart-5': '#7fd6b4', '--chart-6': '#d29ff0', '--chart-7': '#ecba6c', '--chart-8': '#74b0e8',
    };

    const declared = (src, name) => {
        const m = src.match(new RegExp('\\' + name + ':\\s*([^;]+);'));
        return m ? m[1].trim().split(/\s+/)[0] : null;
    };

    it('light --chart-1..8 sedí s rodinou', () => {
        for (const [k, v] of Object.entries(LIGHT)) expect(declared(tokens, k), k).toBe(v);
    });

    it('dark --chart-1..8 sedí s rodinou', () => {
        for (const [k, v] of Object.entries(DARK)) expect(declared(dark, k), k).toBe(v);
    });

    it('dark panel / linka / gold sú rodinné hodnoty (rozhodnutia #56, #57)', () => {
        expect(declared(dark, '--panel-rgb')).toBe('22,');   // #161f1d ako RGB triplet
        expect(dark).toContain('--panel-rgb: 22, 31, 29;');
        expect(declared(dark, '--border')).toBe('#27332f');
        expect(declared(dark, '--gold')).toBe('#d8b878');
    });

    it('density tokeny existujú v cozy aj v oboch opt-in škálach (#59)', () => {
        for (const k of ['--card-pad', '--kpi-pad', '--section-gap', '--row-pad-y', '--control-h', '--page-h1', '--grid-gap']) {
            expect(tokens, k).toContain(k + ':');
        }
        expect(tokens).toContain(':root[data-density="comfortable"]');
        expect(tokens).toContain(':root[data-density="compact"]');
    });

    it('viewport-aware výšky grafov sú clamp(), nie fixné px (#65, G3)', () => {
        expect(declared(tokens, '--chart-h')).toMatch(/^clamp\(/);
        expect(tokens).toContain('--chart-h-sm:');
        expect(tokens).toContain('--chart-h-lg:');
    });

    it('shell geometria je odvodená z --rail-w (collapse 72 ↔ 208)', () => {
        expect(tokens).toContain('--rail-w-collapsed: 72px;');
        expect(tokens).toContain('--rail-w-expanded: 208px;');
        expect(tokens).toContain('--shell-left: calc(');
    });
});
