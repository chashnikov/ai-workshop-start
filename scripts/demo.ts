// The demo, shared by `npm run demo` (scripts/record-demo.ts), which records it, and its screenshot test
// (e2e/demo.spec.ts), which compares its key moments with screenshots kept in Git. ./fixture is served as if
// it were on GitHub, in an organization, as in the tests (src/core/fixture.ts): no network, no token.
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright';
import { NOW, organizationOnGitHub } from '../src/core/fixture.ts';
import { openGitHub, scanOrganization } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';

export const SIZE = { width: 1280, height: 720 };

/** A key moment of the demo: `name` for its screenshot, `caption` for the video. */
export type Step = { name: string; caption: string };

/** The web view over the fixture organization, on a free port: its address, and how to stop it. */
export async function startDemoServer() {
  const github = replay(organizationOnGitHub());
  const server = createWebServer({
    open: (input) => openGitHub(input, { fetch: github }),
    organization: (input, { read, progress } = {}) => scanOrganization(input, { fetch: github, read, progress }),
    // The same "Updated … ago" whenever it is played: the screenshots stay the same.
    now: () => NOW,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

/**
 * Plays the demo on `page`, from `base`: the organization's chooser, then the filter. `step` is called at
 * each key moment, once the page shows it; `keyDelay` is between the keys typed in the filter.
 */
export async function playDemo(page: Page, base: string, step: (page: Page, step: Step) => Promise<void>, keyDelay = 0) {
  await page.goto(base);
  await page.getByRole('textbox', { name: 'GitHub repository or organization URL' }).pressSequentially('https://github.com/JetBrains', { delay: keyDelay / 4 });
  await page.keyboard.press('Enter');
  await page.waitForURL(/\?repo=/);
  await step(page, { name: 'organization', caption: 'A whole organization: its repositories with skills' });
  await page.getByRole('combobox', { name: 'Repository' }).selectOption({ label: 'JetBrains/fixture · 4 skills' });
  await page.locator('.chooser').getByRole('button', { name: 'Show skills' }).click();
  await page.waitForURL(/&repo=/);
  await step(page, { name: 'repository', caption: 'Choose one: its skills, the chooser stays on top' });
  await type(page, 'co', keyDelay);
  await step(page, { name: 'filter', caption: 'Filter as you type: names that contain “co”' });
  await page.locator('.list li:not([hidden]) a').nth(1).click();
  await step(page, { name: 'selected', caption: 'Select a matching skill' });
  await type(page, ' st', keyDelay);
  await step(page, { name: 'words', caption: 'Several words: names that contain every one' });
  await filterField(page).fill('');
  await type(page, 'zzz', keyDelay);
  await step(page, { name: 'no-match', caption: 'No skill matches' });
  await filterField(page).fill('');
  await step(page, { name: 'empty', caption: 'Empty: every skill again' });
}

export function filterField(page: Page) {
  return page.getByRole('searchbox', { name: 'Filter skills by name' });
}

async function type(page: Page, text: string, keyDelay: number) {
  await filterField(page).press('End');
  await filterField(page).pressSequentially(text, { delay: keyDelay });
}
