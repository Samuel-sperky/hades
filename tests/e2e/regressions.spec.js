import { expect, test } from '@playwright/test';

import { boot, gotoScreen, mockChat } from './helpers.js';

/* ---------------------------------------------------------------------------
   REGRESIE PO OPRAVENÝCH CHYBÁCH

   Tento súbor vznikol ako zoznam známych chýb s `test.fail()`. Obe chyby, ktoré
   e2e vlna našla, sú medzitým opravené, takže `test.fail()` je odobraný a testy
   sú odteraz obyčajné regresné testy. Presne takto to malo fungovať: test sa po
   oprave rozsvietil („expected to fail, but passed") a vynútil si zmenu.

   Tretí test — „regression guard: what covers the quickbar" — bol zmazaný,
   pretože tvrdil, že chyba existuje (`toBe('covered')`). Jeho úlohu prevzal
   test nižšie, ktorý overuje opak.
   --------------------------------------------------------------------------- */
test.use({ trace: 'off', screenshot: 'off' });

test.describe('regresie', () => {
    /* Pôvodná chyba: `shell/cmdk.js` si držal vlastný `CMDK_NAV` so SIEDMYMI
       obrazovkami z čias pred pridaním Chatu a E-shopu, hoci zamknuté rozhranie
       #16 hovorí, že jediný zdroj pravdy je `core/screens.js`. Paletou sa preto
       na tie dve obrazovky nedalo dostať. Opravené odvodením zoznamu zo SCREENS. */
    test('Cmd-K vie na každú obrazovku z core/screens.js', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await page.locator('#cmdk-trigger').click();
        await expect(page.locator('#cmdk')).not.toHaveClass(/hidden/);
        await page.locator('#cmdk-input').fill('e-shop');
        const hit = page.locator('#cmdk-results .cmdk-item[data-nav="eshop"]').first();
        await expect(hit).toBeVisible({ timeout: 3_000 });
        await hit.click();
        await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe('eshop');
    });

    /* Pôvodná chyba: quickbar `#prompt` bol na `--z-chrome` (10), ale `#screens`
       je na `--z-panel` (20) a prekrýva celú obsahovú plochu vrátane dolného
       stredu, kde quickbar stojí — takže `#chat-expand` aj `#chat-send` boli na
       KAŽDEJ obsahovej obrazovke nekliknuteľné a klik zachytil obsah. Opravené
       zdvihnutím quickbaru nad obsahovú vrstvu (`--z-panel + 2`). */
    test('quickbar chatu je kliknuteľný na obsahovej obrazovke', async ({ page }, testInfo) => {
        await mockChat(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'dnes');
        await page.locator('#chat-expand').click({ timeout: 5_000 });
        await expect(page.locator('#chat-overlay')).not.toHaveClass(/hidden/);
        await expect(page.locator('#prompt-input')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#chat-overlay')).toHaveClass(/hidden/);
    });

    /* Priamy dôkaz o vrstvení, nezávislý od kliku: v strede tlačidla musí byť
       naozaj tlačidlo, nie obsah obrazovky. Chytí to aj prípad, keď by niekto
       neskôr zdvihol `#screens` alebo pridal ďalší panel nad quickbar. */
    test('quickbar nie je ničím prekrytý', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoScreen(page, 'dnes');
        const state = await page.evaluate(() => {
            const b = document.getElementById('chat-expand');
            if (!b) return 'chat-expand chýba';
            const r = b.getBoundingClientRect();
            const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            if (top === b || b.contains(top)) return 'ok';
            return 'prekryté: ' + (top ? top.className || top.tagName : 'null');
        });
        expect(state, 'quickbar musí byť najvrchnejší prvok vo svojom strede').toBe('ok');
    });
});
