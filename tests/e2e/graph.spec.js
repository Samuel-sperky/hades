import { expect, test } from '@playwright/test';

import { boot, gotoScreen, paintedPixels, settleGraph, watchConsole } from './helpers.js';

/* Graf: hub v strede, zoom funguje.

   Zoom sa testuje POMEROM, nie absolútnou hodnotou. W2 posunula default zoom po
   auto-fite z 0.489 na 0.6 a zabetónované číslo by suite rozbilo znovu — kontrakt
   je „zoom in priblíži, zoom out oddiali, reset vráti fit", nie konkrétne `k`. */

const K_MIN = 0.14;
const K_MAX = 3.2;
const STEP = 1.3;

const camK = (page) => page.evaluate(() => window.AURA.S.cam.k);

test.describe('graph', () => {
    test('the hub core sits pinned in the middle', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'graf');
        await expect(page.locator('#mind')).toBeVisible();

        const info = await page.evaluate(() => {
            const S = window.AURA.S;
            const hub = S.nodes.find((n) => n.type === 'core' && n.label === S.name);
            const others = S.nodes.filter((n) => n.type === 'core' && n.label !== S.name);
            return hub
                ? { x: hub.x, y: hub.y, fx: hub.fx, fy: hub.fy, otherCores: others.length }
                : null;
        });
        expect(info, 'hub uzol (core s menom vedomia) sa v grafe nenašiel').not.toBeNull();
        expect(info.x).toBe(0);
        expect(info.y).toBe(0);
        // Pripnutý cez fx/fy, takže ho simulácia neodfúkne zo stredu.
        expect(info.fx).toBe(0);
        expect(info.fy).toBe(0);
        expect(info.otherCores).toBeGreaterThan(0);
    });

    test('the canvas actually paints the network', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'graf');
        await settleGraph(page);
        expect(await paintedPixels(page)).toBeGreaterThan(1000);
        watch.expectClean();
    });

    test('zoom in, zoom out and reset move the camera', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'graf');
        await settleGraph(page);

        /* Pozor na rozdiel, o ktorý sa rozbil predošlý baseline: štartovacie `k`
           je DEFAULT po nábehu (W2: 0.6), zatiaľ čo `reset` spustí skutočný
           fitView a vyjde mu iné číslo (dnes ~0.49). Referenciou je preto stav
           PO resete, nie stav po nábehu — a porovnávame pomery, nie konštanty. */
        const start = await camK(page);
        expect(start).toBeGreaterThan(K_MIN);
        expect(start).toBeLessThan(K_MAX);

        await page.locator('[data-zoom="reset"]').click();
        const fitted = await camK(page);
        expect(fitted).toBeGreaterThan(K_MIN);
        expect(fitted).toBeLessThan(K_MAX);

        await page.locator('[data-zoom="in"]').click();
        const zoomedIn = await camK(page);
        expect(zoomedIn).toBeCloseTo(fitted * STEP, 3);

        await page.locator('[data-zoom="out"]').click();
        await page.locator('[data-zoom="out"]').click();
        const zoomedOut = await camK(page);
        expect(zoomedOut).toBeCloseTo(fitted / STEP, 3);
        expect(zoomedOut).toBeLessThan(zoomedIn);

        // reset je idempotentný — vráti presne ten istý fit
        await page.locator('[data-zoom="reset"]').click();
        await expect.poll(() => camK(page)).toBeCloseTo(fitted, 3);
    });

    test('zoom stays inside the K_MIN…K_MAX clamp', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'graf');
        await settleGraph(page);

        const inBtn = page.locator('[data-zoom="in"]');
        for (let i = 0; i < 15; i++) await inBtn.click();
        expect(await camK(page)).toBeLessThanOrEqual(K_MAX + 1e-6);

        const outBtn = page.locator('[data-zoom="out"]');
        for (let i = 0; i < 30; i++) await outBtn.click();
        expect(await camK(page)).toBeGreaterThanOrEqual(K_MIN - 1e-6);
    });

    test('the mouse wheel zooms the canvas', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'graf');
        await settleGraph(page);

        const before = await camK(page);
        const box = await page.locator('#mind').boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(0, -240);
        await expect.poll(() => camK(page)).toBeGreaterThan(before);
    });
});
