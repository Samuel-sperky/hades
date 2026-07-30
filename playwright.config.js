import { defineConfig, devices } from '@playwright/test';

/* Smoke suite runs against the live dev stack (docker compose up).
   Port 8082 is the sprint port; Hades still owns 8080 until AuraAI is accepted. */
export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    timeout: 60_000,
    expect: { timeout: 15_000 },
    use: {
        baseURL: process.env.AURAAI_BASE_URL || 'http://localhost:8082',
        viewport: { width: 1440, height: 900 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'desktop-light', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
        { name: 'desktop-dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    ],
});
