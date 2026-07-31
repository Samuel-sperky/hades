import { expect, test } from '@playwright/test';

import { boot, CHAT_REPLY, mockChat, watchConsole } from './helpers.js';

/* Mobil 390 px: rail sa schová, mobilná navigácia ho zastúpi, chat je použiteľný.

   Viewport nastavuje projekt `mobile` v playwright.config.js — 390 × 844 je
   iPhone 14/15, teda najužšie zariadenie, ktoré ešte chceme obsluhovať.
   Breakpoint, ktorý rail skrýva, je 640 px (resources/css/mobile.css). */

/* Prepnutie obrazovky na mobile ide cez #mobile-nav, nie cez rail. Do spodnej
   lišty sa zmestia štyri destinácie; ostatné žijú v „viac" sheete. */
const IN_BAR = ['dnes', 'chat', 'dennik', 'kniznica'];

async function gotoMobileScreen(page, key) {
    if (IN_BAR.includes(key)) {
        await page.locator(`#mobile-nav .mdest[data-screen="${key}"]`).click();
    } else {
        await page.locator('#mobile-more').click();
        await expect(page.locator('#mobile-sheet')).toBeVisible();
        await page.locator(`#mobile-sheet .msheet-item[data-screen="${key}"]`).click();
    }
    await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe(key);
}

test.describe('mobile 390px', () => {
    test('the rail is hidden and the mobile nav takes over', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await boot(page, testInfo);

        await expect(page.locator('#rail')).toBeHidden();
        await expect(page.locator('#mobile-nav')).toBeVisible();

        // Bočná navigácia nesmie zaberať šírku, ktorú potrebuje obsah.
        const railBox = await page.locator('#rail').boundingBox();
        expect(railBox, 'skrytý rail nemá mať box').toBeNull();

        // Nič nesmie tlačiť stránku do vodorovného scrollu.
        const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
        }));
        expect(overflow.scroll, 'stránka pretečie do vodorovného scrollu')
            .toBeLessThanOrEqual(overflow.client + 1);

        watch.expectClean();
    });

    test('the more sheet reaches the screens that do not fit the bar', async ({ page }, testInfo) => {
        await boot(page, testInfo);

        await expect(page.locator('#mobile-sheet')).toBeHidden();
        await page.locator('#mobile-more').click();
        await expect(page.locator('#mobile-sheet')).toBeVisible();

        // E-shop sa do spodnej lišty nezmestil, býva len tu.
        const eshop = page.locator('#mobile-sheet .msheet-item[data-screen="eshop"]');
        await expect(eshop).toBeVisible();
        await eshop.click();
        await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe('eshop');
        await expect(page.locator('#mobile-sheet')).toBeHidden();
    });

    test('chat is usable: the composer fits and an answer arrives', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await mockChat(page);
        await boot(page, testInfo);
        await gotoMobileScreen(page, 'chat');

        const input = page.locator('#prompt-input');
        const send = page.locator('#chat-send');
        await expect(input).toBeVisible();
        await expect(send).toBeVisible();

        // Použiteľnosť = composer sa vojde do viewportu a tlačidlo je dosiahnuteľné.
        const vw = page.viewportSize().width;
        const inputBox = await input.boundingBox();
        const sendBox = await send.boundingBox();
        expect(inputBox.x).toBeGreaterThanOrEqual(0);
        expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(vw + 1);
        expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(vw + 1);
        expect(sendBox.height, 'terč pod prstom má mať aspoň 32 px').toBeGreaterThanOrEqual(32);

        const stream = page.waitForResponse((r) => r.url().includes('/api/chat/stream'));
        await input.fill('Ahoj z mobilu');
        await send.click();
        await stream;

        await expect(page.locator('#chat-screen-log .msg-row--user').last()).toContainText('Ahoj z mobilu');
        await expect(page.locator('#chat-screen-log .msg-row--assistant').last()).toContainText(CHAT_REPLY);

        watch.expectClean();
    });

    test('the graph screen swaps its desktop tooling for a note', async ({ page }, testInfo) => {
        await boot(page, testInfo);
        await gotoMobileScreen(page, 'graf');

        /* Na 390 px sa plátno ZÁMERNE skrýva (mobile.css: visibility: hidden) —
           mapa vedomia potrebuje veľké plátno a myš. Namiesto prázdnej plochy,
           ktorá vyzerá ako rozbitá appka, sa zobrazí vysvetľujúca poznámka. */
        await expect(page.locator('#mind')).toBeHidden();
        await expect(page.locator('#zoomctl')).toBeHidden();
        await expect(page.locator('#graph-tools')).toBeHidden();

        const note = page.locator('#mobile-graph-note');
        await expect(note).toBeVisible();
        await expect(note).toContainText('Vizualizácia je len na desktope');

        // Poznámka musí ponúkať cestu von, nie slepú uličku.
        await note.locator('button[data-screen="dnes"]').click();
        await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe('dnes');
    });

    test('screenshots for the mobile baseline', async ({ page }, testInfo) => {
        await mockChat(page);
        await boot(page, testInfo);
        for (const key of ['dnes', 'chat', 'dennik', 'kniznica']) {
            await gotoMobileScreen(page, key);
            await page.screenshot({
                path: `tests/e2e/__screenshots__/${key}-${testInfo.project.name}.png`,
                fullPage: false,
            });
        }
    });
});
