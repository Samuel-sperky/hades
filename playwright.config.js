import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

/* E2E suite beží proti ŽIVÉMU dev stacku (docker compose up), nič si nespúšťa sama.
   Port 8082 je sprintový port; Hades drží 8080, kým AuraAI nie je prijatá.

   Základná URL: z hostiteľa je appka na localhost:8082, ale VNÚTRI kontajnera `app`
   žiadny 8082 neexistuje — server tam počúva na 8080. Predtým default 8082 platil
   pre oba prípady a beh v kontajneri padal na ECONNREFUSED, kým človek neuhádol
   `AURAAI_BASE_URL`. Detekcia je jednoduchá: /.dockerenv existuje len v kontajneri.

   host.docker.internal:8082 sa NEPOUŽÍVA zámerne — appka podľa portu stránky
   rozhoduje, či ide WebSocket same-origin (`graph/ws.js`), a nesúlad portov len
   presunie tú istú chybu inam. Šum z Reverbu filtruje helpers.js, s dôvodom. */
const inContainer = existsSync('/.dockerenv');
const baseURL = process.env.AURAAI_BASE_URL
    || (inContainer ? 'http://localhost:8080' : 'http://localhost:8082');

const desktop = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    workers: 1,
    retries: 0, // flaky test má padnúť hneď a nahlas, nie sa schovať za retry
    reporter: [['list']],
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    /* Každý spec beží v projektoch, v ktorých má zmysel — žiadne `test.skip`,
       takže „0 skipnutých" platí aj tu. Tmavý beh je len smoke: prepínanie tém
       má vlastný spec a ostatné obrazovky na téme nezávisia. */
    projects: [
        {
            name: 'desktop-light',
            testIgnore: /mobile\.spec\.js/,
            use: { ...desktop, colorScheme: 'light' },
        },
        {
            name: 'desktop-dark',
            testMatch: /smoke\.spec\.js/,
            use: { ...desktop, colorScheme: 'dark' },
        },
        {
            /* 390 × 844 = iPhone 14/15, najužšie zariadenie, ktoré obsluhujeme.
               Preset devices['iPhone 14'] sa NEPOUŽÍVA: ťahá za sebou WebKit a
               v kontajneri máme nainštalované len chromium. */
            name: 'mobile',
            testMatch: /mobile\.spec\.js/,
            use: {
                ...devices['Desktop Chrome'],
                viewport: { width: 390, height: 844 },
                deviceScaleFactor: 3,
                isMobile: true,
                hasTouch: true,
                colorScheme: 'light',
            },
        },
    ],
});
