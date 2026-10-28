/**
 * Navigation through the real UI, against a stub OpenCode server.
 *
 * These cover what a unit test structurally cannot: the app running in a real
 * browser, with the SharedWorker that owns the session-state mirror and the SSE
 * stream that feeds it. The fixture seeds two sessions, so every assertion here
 * names data the spec put there itself.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The session picker in the top bar. */
const SESSION_PICKER = '.tree-dropdown-root .ui-dropdown-button';

/** Scope thread assertions to the chat panel; the composer echoes sent text. */
const thread = (page: Page) => page.locator('.output-panel-content');

async function switchTo(page: Page, title: string) {
  await page.locator(SESSION_PICKER).click();
  await page.getByText(title, { exact: true }).click();
}

test('opens the most recently updated session', async ({ page, visit }) => {
  await visit();

  await expect(page.locator('.selected-label')).toContainText('Add rate limiting');
  await expect(thread(page).getByText('add a rate limiter')).toBeVisible();
  expect(new URL(page.url()).search).toBe('?project=p1&session=ses_beta');
});

test('switching session replaces the thread', async ({ page, visit }) => {
  // The regression this suite exists for: the selection used to change while
  // the previous session's messages stayed on screen.
  await visit();
  await expect(thread(page).getByText('add a rate limiter')).toBeVisible();

  await switchTo(page, 'Fix the login bug');

  await expect(thread(page).getByText('why is login broken')).toBeVisible();
  await expect(thread(page).getByText('add a rate limiter')).toHaveCount(0);
  await expect(page.locator('.selected-label')).toContainText('Fix the login bug');
  await expect(page).toHaveURL(/session=ses_alpha/);
});

test('a shared link opens the session it names', async ({ page, visit }) => {
  await visit('/?project=p1&session=ses_alpha');

  await expect(page.locator('.selected-label')).toContainText('Fix the login bug');
  await expect(thread(page).getByText('why is login broken')).toBeVisible();
});

test('a reload stays on the session that was selected', async ({ page, visit }) => {
  await visit();
  await switchTo(page, 'Fix the login bug');
  await expect(page).toHaveURL(/session=ses_alpha/);

  await page.reload();

  await expect(page.locator('.selected-label')).toContainText('Fix the login bug');
  await expect(thread(page).getByText('why is login broken')).toBeVisible();
  await expect(thread(page).getByText('add a rate limiter')).toHaveCount(0);
});

test('a session renamed on the server updates the header', async ({ page, openCode, visit }) => {
  // Exercises the SSE stream and the SharedWorker state mirror end to end.
  await visit();

  openCode.push({
    directory: '/home/dev/api',
    payload: {
      type: 'session.updated',
      properties: {
        info: {
          id: 'ses_beta',
          slug: 'ses_beta',
          projectID: 'p1',
          directory: '/home/dev/api',
          title: 'Renamed by the server',
          version: '1',
          time: { created: 2_000, updated: 3_000 },
        },
      },
    },
  });

  await expect(page.locator('.selected-label')).toContainText('Renamed by the server');
});

test('the todo panel follows the selected session', async ({ page, visit }) => {
  await visit('/?project=p1&session=ses_alpha');
  await page.locator('.side-tab', { hasText: 'TODO' }).click();

  await expect(page.getByText('Reproduce the 401')).toBeVisible();

  await switchTo(page, 'Add rate limiting');

  await expect(page.getByText('Reproduce the 401')).toHaveCount(0);
});
