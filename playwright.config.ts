import { defineConfig } from '@playwright/test';

/**
 * End-to-end config. The app is served from a real Nitro build, and each spec
 * points the browser at its own stub OpenCode server (see test/browser/seed.ts).
 *
 * OPENCODE_URL is deliberately left unset: /api/config then reports no server,
 * which is what lets a spec choose the upstream per test through localStorage.
 * Run `nuxt build` first, or use `yarn test:e2e`.
 */
const PORT = Number(process.env.E2E_PORT ?? 3999);
const HOST = '127.0.0.1';

export default defineConfig({
  testDir: 'test/browser',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: `http://${HOST}:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

  webServer: {
    command: 'node .output/server/index.mjs',
    url: `http://${HOST}:${PORT}/api/config`,
    env: { PORT: String(PORT), NITRO_PORT: String(PORT), HOST, NODE_ENV: 'production' },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
