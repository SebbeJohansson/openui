/**
 * Playwright fixtures that give every spec its own stub OpenCode server.
 *
 * `openCode` starts one on an ephemeral port and tears it down afterwards.
 * `visit` writes the credentials the app reads at startup, so the page connects
 * to that server and no other. Because the app server runs without
 * OPENCODE_URL, /api/config reports no upstream and these stored credentials
 * win — which is what keeps parallel specs isolated from each other.
 */
import { test as base, type Page } from '@playwright/test';
import { startFakeOpenCode, type FakeOpenCode } from './fake-opencode';
import { twoSessions } from './seed';

/** Mirrors StorageKeys.auth.credentials with the app's storage prefix. */
const CREDENTIALS_KEY = 'opencode.auth.credentials.v1';

export type OpenUiFixtures = {
  /** The stub server this test talks to. Reseed it before visiting. */
  openCode: FakeOpenCode;
  /** Open the app pointed at `openCode` and wait for the shell to render. */
  visit: (path?: string) => Promise<void>;
};

async function pointAtServer(page: Page, url: string) {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key!, value!);
    },
    [CREDENTIALS_KEY, JSON.stringify({ url, username: '', password: '' })] as const,
  );
}

export const test = base.extend<OpenUiFixtures>({
  // Playwright requires the fixtures argument to be destructured, and this
  // fixture depends on none of them.
  // eslint-disable-next-line no-empty-pattern
  openCode: async ({}, use) => {
    const server = await startFakeOpenCode(structuredClone(twoSessions));
    await use(server);
    await server.close();
  },

  visit: async ({ page, openCode }, use) => {
    await pointAtServer(page, openCode.url);
    await use(async (path = '/') => {
      await page.goto(path);
      // The shell replaces the loading screen only once startup succeeds.
      await page.locator('.app-header').waitFor({ state: 'visible' });
      // A frame pushed before the browser attaches is dropped, not queued.
      await openCode.eventStreamReady();
    });
  },
});

export { expect } from '@playwright/test';
