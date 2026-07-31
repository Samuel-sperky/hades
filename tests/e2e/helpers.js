/* Spoločné pomôcky pre e2e suite.

   PRAVIDLO STABILITY: nikde `waitForTimeout` ako hlavná synchronizácia.
   Čaká sa na stav (`toBeVisible`, `expect.poll`, `waitForFunction`,
   `waitForResponse`), nie na uplynutý čas. Flaky test je horší než žiadny.

   Externé a ešte nepostavené API sa mockujú (`mockEshop`, `mockChat`) — suite
   nesmie padať preto, že cudzí e-shop odpovedal o sekundu dlhšie. */

import { expect } from '@playwright/test';

/* ---------- známy šum ---------- */

/* Nevydarené requesty, ktoré NIE SÚ regresia appky. Každý riadok má dôvod;
   cieľ je prázdny zoznam, nie rastúca tabuľka. Keď P5 endpoint postaví,
   riadok zmizne a test začne 404 hlásiť. */
export const KNOWN_BAD_ROUTES = [
    { pattern: /\/api\/llm\/stats(\?|$)/, why: 'endpoint P5 zatiaľ neexistuje (CLAUDE.md §7)' },
];

/* Reverb je na hostiteľovi publikovaný na 8083 a `auraai.public_ws_host` je
   `localhost`. Prehliadač bežiaci VNÚTRI kontajnera `app` tam nedosiahne,
   takže pusher-js zahlási transportnú chybu. Nie je to chyba appky — pri behu
   z hostiteľa sa tento filter vôbec netrafí. */
const WS_TRANSPORT_NOISE = /WebSocket connection to |WebSocket is closed|pusher/i;

/* Generický riadok bez URL. 404-ky sledujeme adresne cez `page.on('response')`,
   kde vidíme konkrétnu cestu — tu by tento vzor len maskoval, čo tam chytáme. */
const RESOURCE_NOISE = /Failed to load resource/i;

/**
 * Zbiera chyby konzoly, nezachytené výnimky a nevydarené HTTP odpovede.
 * Volaj PRED `boot()`, inak ti utečie boot fáza.
 */
export function watchConsole(page) {
    const errors = [];
    const badResponses = [];

    page.on('console', (msg) => {
        const type = msg.type();
        if (type !== 'error' && type !== 'warning') return;
        const text = msg.text();
        if (RESOURCE_NOISE.test(text) || WS_TRANSPORT_NOISE.test(text)) return;
        errors.push(type + ': ' + text);
    });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('response', (res) => {
        if (res.status() < 400) return;
        const url = res.url();
        if (KNOWN_BAD_ROUTES.some((r) => r.pattern.test(url))) return;
        badResponses.push(res.status() + ' ' + url);
    });

    return {
        errors,
        badResponses,
        /** Jedna asercia pre oboje; volá sa na konci testu. */
        expectClean() {
            expect(errors, 'chyby konzoly:\n' + errors.join('\n')).toEqual([]);
            expect(badResponses, 'nevydarené requesty:\n' + badResponses.join('\n')).toEqual([]);
        },
    };
}

/* ---------- boot ---------- */

/**
 * Načíta appku s deterministickými preferenciami.
 *
 * Preferencie ide `addInitScript`, nie goto → evaluate → reload: appka nabootuje
 * RAZ a už so správnou témou, takže miznú dvojité boot fázy aj preblik témy.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{project:{name:string}}} testInfo
 * @param {{theme?:'light'|'dark'}} opts
 */
export async function boot(page, testInfo, { theme } = {}) {
    const want = theme || (testInfo.project.name.includes('dark') ? 'dark' : 'light');
    await page.addInitScript((t) => {
        localStorage.setItem('aura.hints', 'done'); // onboarding overlay nesmie zakryť UI
        // Tému nastavíme len raz. addInitScript beží pri KAŽDEJ navigácii, takže
        // bezpodmienečný setItem by po `page.reload()` prepísal to, čo si appka
        // medzitým uložila — a testy na perzistenciu by boli nepravdivo zelené.
        if (!localStorage.getItem('aura.theme')) localStorage.setItem('aura.theme', t);
    }, want);
    await page.goto('/');
    await page.waitForFunction(
        () => window.AURA && window.AURA.S.nodes.length > 0,
        null,
        { timeout: 30_000 },
    );
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(want);
    return want;
}

/** Prepne obrazovku cez rail a počká, kým router dobehne. */
export async function gotoScreen(page, key) {
    await page.locator(`#rail .dest[data-screen="${key}"]`).click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.screen)).toBe(key);
    if (key !== 'graf') await expect(page.locator(`#screen-${key}`)).toHaveClass(/active/);
}

/* Počká, kým sa force simulácia utíchne — kvôli čitateľným screenshotom grafu.
   Screenshoty sú artefakt, nie asercia, takže neutíchnutá simulácia test NEZHODÍ:
   inak by sme si do suite pridali flaky bod bez toho, že by čokoľvek overoval. */
export async function settleGraph(page, timeout = 12_000) {
    try {
        await page.waitForFunction(
            () => {
                const sim = window.AURA.S.sim;
                return !sim || sim.alpha() <= Math.max(sim.alphaMin(), 0.02);
            },
            null,
            { timeout },
        );
        return true;
    } catch {
        return false;
    }
}

/** Koľko pixelov plátna sa líši od farby ľavého horného rohu (= namaľovalo sa niečo). */
export function paintedPixels(page) {
    return page.evaluate(() => {
        const c = document.getElementById('mind');
        if (!c || !c.width) return 0;
        const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const bg = [px[0], px[1], px[2]];
        let n = 0;
        for (let i = 0; i < px.length; i += 4) {
            if (px[i] !== bg[0] || px[i + 1] !== bg[1] || px[i + 2] !== bg[2]) n++;
        }
        return n;
    });
}

/* ---------- mocky ---------- */

/* E-shop visí na cudzom API (sperky). Naživo je pomalé a mimo našej kontroly,
   preto fixtures: tvar je odpísaný z reálnej odpovede, len s malými číslami.
   Fixture ZÁMERNE obsahuje obrat po krajinách — pravidlo N1 zakazuje SÚHRNNÝ
   obrat, nie sumu pri krajine, a test musí vedieť ten rozdiel odlíšiť. */
export const ESHOP_FIXTURE = {
    health: {
        ok: true,
        data: {
            ok: true, orders: true, products: true, error: null,
            latency_ms: 12, checked_at: '2026-07-31T12:00:00+02:00',
            totals: { orders: 1764077, products: 41018 }, key_configured: true,
        },
        meta: { cached: true, source: 'test' },
    },
    summary: {
        ok: true,
        data: {
            generated_at: '2026-07-31T12:00:00+02:00',
            window: { days: 7, from: '2026-07-25', until: '2026-08-01' },
            orders: { in_window: 800, today: 66, complete: false, total_in_shop: 1764077 },
            by_day: [
                { date: '2026-07-27', orders: 70 },
                { date: '2026-07-28', orders: 220 },
                { date: '2026-07-29', orders: 224 },
                { date: '2026-07-30', orders: 220 },
                { date: '2026-07-31', orders: 66 },
            ],
            // `country_iso` je kľúč, ktorý normalizeCountries číta ako ISO kód —
            // samotné `country` je len ľudský názov a mena by sa nedala odhadnúť.
            countries: [
                { country_iso: 'SK', country: 'Slovensko', orders: 410, total_paid: 12345.5 },
                { country_iso: 'CZ', country: 'Česko', orders: 260, total_paid: 98765 },
                { country_iso: 'HU', country: 'Maďarsko', orders: 130, total_paid: 4567890 },
            ],
            countries_meta: { basis: 'sample', sample_size: 800, currency_is_estimate: true, note: 'test fixture' },
            months: [],
            live: { available: true, stopped_by: null },
            scan: { stopped_by: null, complete: false, requests: 8, pages: 8, undated: 0 },
        },
        meta: { cached: true, source: 'test' },
    },
    orders: {
        ok: true,
        data: {
            total: 1764077,
            orders: [
                { id: 900001, date_add: '2026-07-31 09:10:00', country_iso: 'SK', country: 'Slovensko', total_paid: 129.9, product_ids: [11, 12] },
                { id: 900002, date_add: '2026-07-31 08:05:00', country_iso: 'CZ', country: 'Česko', total_paid: 2490, product_ids: [13] },
                { id: 900003, date_add: '2026-07-30 19:44:00', country_iso: 'HU', country: 'Maďarsko', total_paid: 45900, product_ids: [] },
            ],
        },
        meta: { cached: true, source: 'test' },
    },
};

/** Zamkne e-shop obrazovku na fixture — bez siete, bez čakania na cudzie API. */
export async function mockEshop(page) {
    const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/eshop/health*', (route) => route.fulfill(json(ESHOP_FIXTURE.health)));
    await page.route('**/api/eshop/summary*', (route) => route.fulfill(json(ESHOP_FIXTURE.summary)));
    await page.route('**/api/eshop/orders*', (route) => route.fulfill(json(ESHOP_FIXTURE.orders)));
}

/* Odpoveď modelu, ktorú vracia mock streamu. Musí byť dosť špecifická,
   aby sa nedala zameniť s ničím v UI. */
export const CHAT_REPLY = 'Mockovaná odpoveď vedomia pre e2e test.';

/**
 * Nahradí LLM mockom podľa SSE kontraktu #17 (`token`, `meta`, `done`).
 * Bez toho by test závisel od Ollamy — teda od modelu, GPU a náhody.
 */
export async function mockChat(page) {
    await page.route('**/api/chat/conversations', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        return route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, data: { id: 4242, title: 'E2E vlákno' } }),
        });
    });

    await page.route('**/api/chat/stream', (route) => {
        const frames = CHAT_REPLY.split(' ').map((w, i) => ({ token: (i ? ' ' : '') + w }));
        const body = [
            { meta: { model: 'e2e-mock', conversation_id: 4242, title: 'E2E vlákno' } },
            ...frames,
            { result: { model: 'e2e-mock', ms: 12, tok_per_s: 99, conversation_id: 4242 } },
        ].map((ev) => 'data: ' + JSON.stringify(ev) + '\n\n').join('');

        return route.fulfill({
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
            body,
        });
    });
}
