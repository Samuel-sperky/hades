import { expect, test } from '@playwright/test';

import { boot, gotoScreen, watchConsole } from './helpers.js';

/* Dark / light prepnutie.

   W2 (rozhodnutie #64) vymenila prepínač za segmentované ovládanie `#theme-seg`
   s tromi možnosťami. Starý `#theme-toggle` je v DOM `visually-hidden` len preto,
   že naň mieril smoke test — odteraz už nemieri, takže P9 ho môže zahodiť
   (poznámka je v reporte A11). */

const seg = (page, pref) => page.locator(`#theme-seg button[data-theme-pref="${pref}"]`);
const rootTheme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const storedPref = (page) => page.evaluate(() => localStorage.getItem('aura.theme'));

async function openSettings(page) {
    await page.locator('#btn-settings').click();
    await expect(page.locator('#sec-settings')).toBeVisible();
    await expect(page.locator('#theme-seg')).toBeVisible();
}

test.describe('theme', () => {
    test('switching light → dark → light repaints and persists', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await boot(page, testInfo, { theme: 'light' });
        await openSettings(page);

        expect(await rootTheme(page)).toBe('light');
        const lightBg = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );

        await seg(page, 'dark').click();
        await expect.poll(() => rootTheme(page)).toBe('dark');
        expect(await storedPref(page)).toBe('dark');
        await expect(seg(page, 'dark')).toHaveAttribute('aria-checked', 'true');
        await expect(seg(page, 'light')).toHaveAttribute('aria-checked', 'false');

        const darkBg = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );
        expect(darkBg, 'tmavá téma musí reálne prekresliť pozadie').not.toBe(lightBg);

        await seg(page, 'light').click();
        await expect.poll(() => rootTheme(page)).toBe('light');
        expect(await storedPref(page)).toBe('light');

        watch.expectClean();
    });

    test('the chosen theme survives a reload', async ({ page }, testInfo) => {
        await boot(page, testInfo, { theme: 'light' });
        await openSettings(page);
        await seg(page, 'dark').click();
        await expect.poll(() => rootTheme(page)).toBe('dark');

        await page.reload();
        await page.waitForFunction(() => window.AURA);
        expect(await rootTheme(page)).toBe('dark');
    });

    test('the system option stores the preference, not the resolved value', async ({ page }, testInfo) => {
        // Projekt beží s colorScheme: light, takže 'system' sa má rozložiť na 'light',
        // ale v localStorage musí zostať 'system' — inak by sa voľba stratila.
        await boot(page, testInfo, { theme: 'light' });
        await openSettings(page);
        await seg(page, 'system').click();
        await expect.poll(() => storedPref(page)).toBe('system');
        await expect.poll(() => rootTheme(page)).toBe('light');
        await expect(seg(page, 'system')).toHaveAttribute('aria-checked', 'true');
    });

    test('the graph canvas repaints after a theme switch', async ({ page }, testInfo) => {
        await boot(page, testInfo, { theme: 'light' });
        await gotoScreen(page, 'graf');
        await expect(page.locator('#mind')).toBeVisible();

        // Rohový pixel = pozadie plátna; po prepnutí témy sa musí zmeniť.
        const corner = () => page.evaluate(() => {
            const c = document.getElementById('mind');
            const px = c.getContext('2d').getImageData(0, 0, 1, 1).data;
            return [px[0], px[1], px[2]].join(',');
        });
        const light = await corner();

        await page.locator('#btn-settings').click();
        await expect(page.locator('#theme-seg')).toBeVisible();
        await seg(page, 'dark').click();
        await expect.poll(() => rootTheme(page)).toBe('dark');
        await expect.poll(() => corner()).not.toBe(light);
    });
});
