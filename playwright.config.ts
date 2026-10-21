// The demo's screenshot test (e2e/demo.spec.ts): `npm run test:screenshots`, part of `npm test`.
// The screenshots are kept in Git, in e2e/screenshots/, rendered by Playwright's headless Chromium on Linux,
// as in CI; `npm run test:screenshots -- --update-snapshots=all` renders them again, after a change to the page:
// all of them, a change within maxDiffPixelRatio too.
import { defineConfig } from '@playwright/test';
import { SIZE } from './scripts/demo.ts';

export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { browserName: 'chromium', viewport: SIZE },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
});
