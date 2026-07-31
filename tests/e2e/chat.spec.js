import { expect, test } from '@playwright/test';

import { boot, CHAT_REPLY, gotoScreen, mockChat, watchConsole } from './helpers.js';

/* Chat: napísanie správy → príchod odpovede.

   LLM je mockovaný podľa SSE kontraktu #17 (helpers.mockChat). Naživo by test
   závisel od Ollamy, teda od modelu, GPU a náhody — presne to, čo z testu robí
   flaky test. Kontrakt, ktorý overujeme, je frontend: request odíde, tokeny sa
   naskladajú do bubliny, stream sa korektne uzavrie. */

test.describe('chat', () => {
    test('sending a message streams an answer into the log', async ({ page }, testInfo) => {
        const watch = watchConsole(page);
        await mockChat(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'chat');

        const input = page.locator('#prompt-input');
        await expect(input).toBeVisible();
        await input.fill('Čo si sa dnes naučil?');

        // waitForResponse sa registruje PRED odoslaním, inak sa dá prehliadnuť.
        const stream = page.waitForResponse((r) => r.url().includes('/api/chat/stream'));
        await page.locator('#chat-send').click();
        await stream;

        const user = page.locator('#chat-screen-log .msg-row--user').last();
        await expect(user).toContainText('Čo si sa dnes naučil?');

        const answer = page.locator('#chat-screen-log .msg-row--assistant').last();
        await expect(answer).toBeVisible();
        await expect(answer).toContainText(CHAT_REPLY);

        // stream sa uzavrel: appka už nie je v streamujúcom stave a composer je späť v hre
        await expect.poll(() => page.evaluate(() => document.body.dataset.chatMode)).toBe('screen');
        await expect(page.locator('#chat-stop')).toBeHidden();
        await expect(input).toHaveValue('');

        watch.expectClean();
    });

    test('an empty prompt sends nothing', async ({ page }, testInfo) => {
        await mockChat(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'chat');

        let sent = 0;
        page.on('request', (r) => { if (r.url().includes('/api/chat')) sent++; });

        await page.locator('#prompt-input').fill('   ');
        await page.locator('#chat-send').click();
        await expect(page.locator('#chat-screen-log .msg-row--user')).toHaveCount(0);
        expect(sent).toBe(0);
    });

    test('the thread survives a switch to another screen and back', async ({ page }, testInfo) => {
        await mockChat(page);
        await boot(page, testInfo);
        await gotoScreen(page, 'chat');

        const stream = page.waitForResponse((r) => r.url().includes('/api/chat/stream'));
        await page.locator('#prompt-input').fill('Prvá otázka');
        await page.locator('#chat-send').click();
        await stream;
        await expect(page.locator('#chat-screen-log .msg-row--assistant').last()).toContainText(CHAT_REPLY);

        // Composer sa medzi hostmi fyzicky presúva (chat/modes.js) — správy sa musia
        // poskladať znovu zo stavu, nie stratiť.
        await gotoScreen(page, 'dnes');
        await expect.poll(() => page.evaluate(() => document.body.dataset.chatMode)).toBe('quickbar');
        await gotoScreen(page, 'chat');
        await expect(page.locator('#chat-screen-log .msg-row--user')).toHaveCount(1);
        await expect(page.locator('#chat-screen-log .msg-row--assistant')).toHaveCount(1);
    });
});
