import { expect, test } from '@playwright/test';

import {
    boot, gotoScreen, mockEshop, paintedPixels, settleGraph, watchConsole,
} from './helpers.js';

/* Smoke: všetkých DEVÄŤ obrazoviek (core/screens.js, rozhranie #16) sa vykreslí,
   graf sa namaľuje a konzola zostane čistá.

   Screenshoty padajú do tests/e2e/__screenshots__/ ako ARTEFAKT na obhliadku,
   nie ako pixelová asercia — dôvod je v tests/e2e/README.md. */

const SCREENS = [
    { key: 'dnes', body: '#dnes-body' },
    { key: 'dennik', body: '#journal-list' },
    { key: 'graf', body: null },
    { key: 'kniznica', body: '#library-body' },
    { key: 'chat', body: '#chat-screen-log' },
    { key: 'eshop', body: '#eshop-kpi' },
    { key: 'rozhodnutia', body: '#rozhodnutia-body' },
    { key: 'kontrola', body: '#kontrola-body' },
    { key: 'smernica', body: '#directive-body' },
];

test.describe('smoke', () => {
    test('all nine screens render with a clean console', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await mockEshop(page); // cudzie API nesmie rozhodovať o výsledku smoke testu
        await boot(page, testInfo);

        // Rail musí ponúkať presne tie obrazovky, ktoré tu testujeme.
        await expect(page.locator('#rail .dest[data-screen]')).toHaveCount(SCREENS.length);

        for (const s of SCREENS) {
            await gotoScreen(page, s.key);

            if (s.key === 'graf') {
                await expect(page.locator('#mind')).toBeVisible();
                await settleGraph(page);
                expect(await paintedPixels(page)).toBeGreaterThan(1000);
            } else {
                await expect(page.locator(s.body)).toBeVisible();
                await expect.poll(
                    () => page.locator(s.body).evaluate((el) => el.textContent.replace(/\s/g, '').length),
                    { timeout: 30_000 },
                ).toBeGreaterThan(20);
            }

            await page.screenshot({
                path: `tests/e2e/__screenshots__/${s.key}-${testInfo.project.name}.png`,
                fullPage: false,
            });
        }

        watch.expectClean();
    });

    test('the selected screen survives a reload', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'kniznica');
        await expect.poll(() => page.evaluate(() => localStorage.getItem('aura.screen'))).toBe('kniznica');
        await page.reload();
        await page.waitForFunction(() => window.AURA);
        await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe('kniznica');
    });

    test('Cmd-K opens, searches and closes on Escape', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await page.locator('#cmdk-trigger').click();
        await expect(page.locator('#cmdk')).not.toHaveClass(/hidden/);
        await page.locator('#cmdk-input').fill('aura');
        await expect.poll(
            () => page.locator('#cmdk-results').evaluate((el) => el.children.length),
            { timeout: 30_000 },
        ).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('#cmdk')).toHaveClass(/hidden/);
    });

    test('legacy hades.* preferences are migrated on first load', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.clear();
            localStorage.setItem('hades.theme', 'dark');
            localStorage.setItem('hades.minWeight2', '2.5');
        });
        await page.goto('/');
        await page.waitForFunction(() => window.AURA);
        expect(await page.evaluate(() => localStorage.getItem('aura.theme'))).toBe('dark');
        expect(await page.evaluate(() => localStorage.getItem('aura.minWeight'))).toBe('2.5');
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
        // staré kľúče zostávajú na mieste ako záchranná sieť pre rollback
        expect(await page.evaluate(() => localStorage.getItem('hades.theme'))).toBe('dark');
    });

});
