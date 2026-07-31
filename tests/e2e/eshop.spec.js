import { expect, test } from '@playwright/test';

import { boot, ESHOP_FIXTURE, gotoScreen, mockEshop, watchConsole } from './helpers.js';

/* E-shop: obrazovka sa naplní a NIKDE nie je súhrnný obrat.

   Pravidlo N1 (resources/js/screens/eshop.js): hlavné číslo je POČET objednávok,
   obrat sa smie zobraziť LEN po krajinách a s priznaním odhadnutej meny.
   Zakázané je súhrnné číslo obratu a prepočet na jednu menu.

   Fixture zámerne obsahuje obrat po krajinách, takže test odlíši „žiadne peniaze
   na obrazovke" (to by prešlo aj na prázdnej obrazovke) od „žiadny SÚHRN". */

/** Reťazce, ktoré by na obrazovke znamenali agregovaný obrat. */
const FORBIDDEN_SUMMARY = [
    /celkov[ýá]\s+obrat/i,
    /obrat\s+celkom/i,
    /súhrnn[ýá]\s+obrat/i,
    /celkov[áé]\s+(suma|tržb)/i,
    /tržby\s+celkom/i,
];

test.describe('eshop', () => {
    test('the screen fills in and shows no aggregate revenue', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await mockEshop(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'eshop');

        // 1) naplní sa: hero KPI je POČET objednávok v e-shope
        const kpi = page.locator('#eshop-kpi');
        await expect(kpi).toBeVisible();
        await expect(kpi).toContainText('Objednávok v e-shope');
        await expect(kpi).toContainText('Produktov v katalógu');
        const hero = kpi.locator('.kpi-hero').first();
        await expect(hero).toContainText(/\d/);

        // 2) zoznam objednávok aj rozpad po dňoch dobehol
        await expect(page.locator('#eshop-orders')).toContainText(String(ESHOP_FIXTURE.orders.data.orders[0].id));
        await expect(page.locator('#eshop-days')).toContainText('Objednávky po dňoch');
        await expect(page.locator('#eshop-status')).toBeVisible();

        // 3) obrat po krajinách JE — inak by bod 4 nič nedokazoval
        const countries = page.locator('#eshop-countries');
        await expect(countries).toContainText('Krajiny podľa počtu objednávok');
        await expect(countries).toContainText('(SK)');
        // amountHtml pripája ISO kód meny, nikdy symbol — a pri odhade aj značku „odhad".
        await expect(countries).toContainText('CZK');
        await expect(countries).toContainText('odhad');

        // 4) a nikde na obrazovke nie je súhrnný obrat
        const text = await page.locator('#screen-eshop').innerText();
        for (const bad of FORBIDDEN_SUMMARY) {
            expect(text, 'obrazovka e-shopu obsahuje zakázaný súhrn obratu: ' + bad).not.toMatch(bad);
        }

        // 5) hero číslo nie je peňažná hodnota — meny patria len ku krajinám a objednávkam
        const heroText = await hero.innerText();
        expect(heroText, 'hero KPI nesmie byť peňažná suma').not.toMatch(/€|EUR|CZK|Kč|HUF|Ft/);

        watch.expectClean();
    });

    test('an order opens its detail without a summed total', async ({ page }, testInfo) => {
        await mockEshop(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'eshop');

        const first = page.locator('#eshop-orders .es-order').first();
        await expect(first).toBeVisible();
        await first.click();

        const detail = page.locator('#eshop-order-detail');
        await expect(detail).toBeVisible();
        // Suma JEDNEJ objednávky je povolená (je v mene objednávky, nič sa nesčítava).
        await expect(detail).toContainText('Zaplatené');
        const text = await detail.innerText();
        for (const bad of FORBIDDEN_SUMMARY) {
            expect(text, 'detail objednávky obsahuje zakázaný súhrn obratu: ' + bad).not.toMatch(bad);
        }
    });

    test('a dead eshop API degrades instead of blanking the screen', async ({ page }, testInfo) => {
        // Cudzie API padá — obrazovka to musí priznať, nie zostať prázdna ani hodiť výnimku.
        await page.route('**/api/eshop/**', (route) => route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ ok: false, error: 'upstream down' }),
        }));
        const pageErrors = [];
        page.on('pageerror', (e) => pageErrors.push(e.message));

        await boot(page, testInfo);
        await gotoScreen(page, 'eshop');

        await expect(page.locator('#eshop-status')).toBeVisible();
        await expect.poll(
            () => page.locator('#eshop-status').evaluate((el) => el.textContent.trim().length),
        ).toBeGreaterThan(3);
        expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    });
});
