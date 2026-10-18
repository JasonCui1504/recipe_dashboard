import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests. Two isolated servers run on 127.0.0.1 with throwaway
 * databases in .test-tmp/: one seeded app, and a clean one to restore into.
 * Set PLAYWRIGHT_CHROMIUM_PATH to use a specific Chromium binary.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '.test-tmp/playwright-results',
  use: {
    baseURL: 'http://127.0.0.1:4310',
    trace: 'off',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath } }, grep: /@mobile/ },
  ],
  webServer: [
    { command: 'node e2e/server.mjs 4310 main', url: 'http://127.0.0.1:4310/api/health', reuseExistingServer: false, timeout: 30_000 },
    { command: 'node e2e/server.mjs 4311 restore', url: 'http://127.0.0.1:4311/api/health', reuseExistingServer: false, timeout: 30_000 },
  ],
});
