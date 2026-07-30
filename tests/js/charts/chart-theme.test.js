import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { certColor, chartChains, chartColor, cssVarChain } from '../../../resources/js/charts/chart-theme.js';

/* DRIFT TEST grafov (akceptačné kritérium P10).

   Padne, keď sa v resources/js/charts/** objaví farebná literálka alebo keď
   niektorá reťaz tokenov prestane smerovať na CSS custom properties. Predtým
   mal každý graf vlastný `cssVar('--x', '#03797e')` fallback, takže light
   hodnota vedela nepozorovane rozísť s :root — presne tá trieda chyby, ktorú
   Aura odchytila až testom. */

const CHARTS_DIR = join(process.cwd(), 'resources/js/charts');

function chartFiles() {
    return readdirSync(CHARTS_DIR).filter((f) => f.endsWith('.js'));
}

describe('charts — žiadna farba mimo tokenov', () => {
    it('v resources/js/charts/** nie je hex, rgb() ani hsl()', () => {
        const offenders = [];
        for (const file of chartFiles()) {
            const src = readFileSync(join(CHARTS_DIR, file), 'utf8');
            // komentáre vyhodíme — v nich smie byť čokoľvek (napr. pomer kontrastu)
            const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
            for (const re of [/#[0-9a-fA-F]{3,8}\b/, /\brgba?\(/, /\bhsla?\(/]) {
                const m = code.match(re);
                if (m) offenders.push(file + ' → ' + m[0]);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('každá reťaz je neprázdna a obsahuje len CSS custom properties', () => {
        const chains = chartChains();
        expect(Object.keys(chains).length).toBeGreaterThan(0);
        for (const [role, names] of Object.entries(chains)) {
            expect(names.length, role).toBeGreaterThan(0);
            for (const name of names) expect(name, role).toMatch(/^--[a-z0-9-]+$/);
        }
    });

    it('reťaz istoty pokrýva všetky štyri stavy', () => {
        const chains = chartChains();
        for (const key of ['cert-overene', 'cert-hypoteza', 'cert-pasca', 'cert-none']) {
            expect(chains[key], key).toBeTruthy();
        }
    });
});


describe('cssVarChain', () => {
    beforeEach(() => {
        document.documentElement.style.cssText = '';
    });

    it('vezme prvý definovaný token v reťazi', () => {
        document.documentElement.style.setProperty('--chart-2', 'teal');
        expect(cssVarChain(['--chart-2', '--cert-overene'])).toBe('teal');
    });

    it('preskočí nedefinovaný token a padne na ďalší', () => {
        document.documentElement.style.setProperty('--cert-overene', 'green');
        expect(cssVarChain(['--chart-2', '--cert-overene'])).toBe('green');
    });

    it('bez jediného tokenu vráti currentColor, nikdy prázdny string', () => {
        expect(cssVarChain(['--nic-takeho'])).toBe('currentColor');
        expect(certColor('overene')).toBeTruthy();
        expect(chartColor('growth')).toBeTruthy();
    });

    it('neznámy kľúč istoty sa chová ako „bez značky"', () => {
        document.documentElement.style.setProperty('--cert-none', 'grey');
        expect(certColor('nezmysel')).toBe(certColor('bez'));
        expect(certColor(null)).toBe(certColor('none'));
    });
});
