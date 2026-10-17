import { defineConfig } from '@playwright/test';

/**
 * Documentation screenshot tour. Separate from playwright.config.ts on purpose: `npm run test:e2e`
 * never produces images, and `npm run screenshots` never runs the regression scenarios.
 *
 * One dev server (fresh demo.db, development badge hidden) and one browser serve the whole tour.
 * SCREENSHOT_LOCALE=es runs the same tour against the Spanish interface (see docs/screenshots/PROVENANCE.md).
 */
export default defineConfig({
  testDir: './tests/screenshots',
  testMatch: '**/*.spec.ts',
  outputDir: './test-results/screenshots',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args: process.env.PLAYWRIGHT_EXTRA_ARGS ? JSON.parse(process.env.PLAYWRIGHT_EXTRA_ARGS) : [],
    } : undefined,
  },
  webServer: {
    // The reset script only deletes the local demo database; the webpack flag matches the e2e configuration.
    command: 'node tests/screenshots/reset-demo-db.mjs && npm run demo:setup && npm run dev -- --port 3000 --hostname localhost --webpack',
    url: 'http://localhost:3000/api/health',
    env: { HIDE_DEV_INDICATOR: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
