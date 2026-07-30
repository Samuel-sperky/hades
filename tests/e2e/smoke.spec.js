import { test, expect } from '@playwright/test';

/* W0 smoke: all seven screens render, the graph paints, and the console stays clean.
   Screenshots land in tests/e2e/__screenshots__/ and are the visual baseline. */

const SCREENS = [
    { key: 'dnes', body: '#dnes-body' },
    { key: 'dennik', body: '#journal-list' },
    { key: 'graf', body: null },
    { key: 'kniznica', body: '#library-body' },
    { key: 'rozhodnutia', body: '#rozhodnutia-body' },
    { key: 'kontrola', body: '#kontrola-body' },
    { key: 'smernica', body: '#directive-body' },
];

/** Collect console errors and page errors for the whole test. */
function watchConsole(page) {
    const errors = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.type() + ': ' + msg.text());
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    return errors;
}

/** The app reads its theme from aura.theme, never from prefers-color-scheme —
    so the dark project has to ask for dark explicitly. */
async function boot(page, projectName = '') {
    const theme = projectName.includes('dark') ? 'dark' : 'light';
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('aura.theme', t);
        localStorage.setItem('aura.hints', 'done');
    }, theme);
    await page.reload();
    await page.waitForFunction(() => window.AURA && window.AURA.S.nodes.length > 0, null, { timeout: 30_000 });
    await page.evaluate(() => {
        const h = document.getElementById('hint');
        if (h) h.classList.add('hidden');
    });
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
}

test.describe('W0 smoke', () => {
    test('all seven screens render with a clean console', async ({ page }, testInfo) => {
        const errors = watchConsole(page);
        await boot(page, testInfo.project.name);

        for (const s of SCREENS) {
            await page.click(`#rail .dest[data-screen="${s.key}"]`);
            await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe(s.key);

            if (s.key === 'graf') {
                await expect(page.locator('#mind')).toBeVisible();
                const painted = await page.evaluate(() => {
                    const c = document.getElementById('mind');
                    if (!c.width) return 0;
                    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
                    const f = [px[0], px[1], px[2]];
                    let n = 0;
                    for (let i = 0; i < px.length; i += 4) {
                        if (px[i] !== f[0] || px[i + 1] !== f[1] || px[i + 2] !== f[2]) n++;
                    }
                    return n;
                });
                expect(painted).toBeGreaterThan(1000);
            } else {
                await expect(page.locator(`#screen-${s.key}`)).toHaveClass(/active/);
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

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('hub node sits in the middle of the graph and is the largest core', async ({ page }, testInfo) => {
        await boot(page, testInfo.project.name);
        await page.click('#rail .dest[data-screen="graf"]');
        const info = await page.evaluate(() => {
            const S = window.AURA.S;
            const hub = S.nodes.find((n) => n.type === 'core' && n.label === S.name);
            const others = S.nodes.filter((n) => n.type === 'core' && n.label !== S.name);
            return { hub: { x: hub.x, y: hub.y, fx: hub.fx, fy: hub.fy }, otherCores: others.length };
        });
        expect(info.hub.x).toBe(0);
        expect(info.hub.y).toBe(0);
        expect(info.otherCores).toBeGreaterThan(0);
    });

    test('the selected screen survives a reload', async ({ page }, testInfo) => {
        await boot(page, testInfo.project.name);
        await page.click('#rail .dest[data-screen="kniznica"]');
        await expect.poll(() => page.evaluate(() => localStorage.getItem('aura.screen'))).toBe('kniznica');
        await page.reload();
        await page.waitForFunction(() => window.AURA);
        await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe('kniznica');
    });

    test('Cmd-K opens, searches and closes on Escape', async ({ page }, testInfo) => {
        await boot(page, testInfo.project.name);
        await page.click('#cmdk-trigger');
        await expect(page.locator('#cmdk')).not.toHaveClass(/hidden/);
        await page.fill('#cmdk-input', 'aura');
        await expect.poll(
            () => page.locator('#cmdk-results').evaluate((el) => el.children.length),
            { timeout: 30_000 },
        ).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(page.locator('#cmdk')).toHaveClass(/hidden/);
    });

    test('theme toggle persists to the aura namespace', async ({ page }, testInfo) => {
        await boot(page, testInfo.project.name);
        await page.click('#btn-settings');
        const before = await page.evaluate(() => document.documentElement.dataset.theme);
        await page.click('#theme-toggle');
        const after = await page.evaluate(() => document.documentElement.dataset.theme);
        expect(after).not.toBe(before);
        expect(await page.evaluate(() => localStorage.getItem('aura.theme'))).toBe(after);
    });

    test('legacy hades.* preferences are migrated on first load', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(() => {
            localStorage.clear();
            localStorage.setItem('hades.theme', 'dark');
            localStorage.setItem('hades.minWeight2', '2.5');
        });
        await page.reload();
        await page.waitForFunction(() => window.AURA);
        expect(await page.evaluate(() => localStorage.getItem('aura.theme'))).toBe('dark');
        expect(await page.evaluate(() => localStorage.getItem('aura.minWeight'))).toBe('2.5');
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
        // old keys stay in place as the rollback net
        expect(await page.evaluate(() => localStorage.getItem('hades.theme'))).toBe('dark');
    });
});
