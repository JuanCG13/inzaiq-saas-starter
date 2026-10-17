import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
      args: process.env.PLAYWRIGHT_EXTRA_ARGS ? JSON.parse(process.env.PLAYWRIGHT_EXTRA_ARGS) : [],
    } : undefined,
  },
  webServer: {
    // Webpack avoids filesystem-cache corruption in transient CI/container mounts.
    command: 'npm run demo:setup && npm run dev -- --port 3000 --hostname localhost --webpack',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
