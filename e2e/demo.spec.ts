// The demo (scripts/demo.ts), as a test: each key moment of `npm run demo` compared with its screenshot in
// e2e/screenshots/. Without Playwright's Chromium (npx playwright install --only-shell chromium) it is
// skipped, except in CI, where it must run.
import { chromium, expect, test } from '@playwright/test';
import { playDemo, startDemoServer } from '../scripts/demo.ts';

let server: Awaited<ReturnType<typeof startDemoServer>>;

test.beforeAll(async () => {
  const browser = await chromium.launch().then(
    (browser) => browser.close().then(() => true),
    () => false,
  );
  test.skip(!browser && !process.env.CI, 'no Playwright Chromium');
  server = await startDemoServer();
});

test.afterAll(async () => server?.close());

test('demo: each key moment looks as its screenshot', async ({ page }) => {
  const steps: string[] = [];
  await playDemo(page, server.base, async (page, { name, caption }) => {
    steps.push(name);
    await test.step(caption, async () => {
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  });
  expect(steps).toEqual(['organization', 'repository', 'filter', 'selected', 'words', 'no-match', 'empty']);
  await expect(page).toHaveURL(/#skill-commits$/);
});
