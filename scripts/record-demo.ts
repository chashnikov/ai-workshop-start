#!/usr/bin/env node
// `npm run demo [-- --out <file>]`: a video of the web view's filter, recorded in a headless browser,
// so it works where there is no display: a remote machine, a container, CI. ./fixture is served as if
// it were on GitHub, as in the tests (src/core/fixture.ts): no network, no token.
import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { fixtureOnGitHub } from '../src/core/fixture.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';

const usage = 'Usage: npm run demo [-- --out <file.webm>]';
const SIZE = { width: 1280, height: 720 };
/** Between the keys, and on each step: slow enough to follow. */
const KEY_DELAY = 250;
const PAUSE = 1500;
/** Runs in the page, so it is a script, not a function: this program has no DOM types. */
const CAPTION = `(caption) => {
  let bar = document.getElementById('demo-caption');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'demo-caption';
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:.75rem 1rem;background:#1f2328e6;color:#fff;font:16px/1.4 system-ui,sans-serif;z-index:9';
    document.body.append(bar);
  }
  const address = document.createElement('div');
  address.style.cssText = 'font:13px ui-monospace,monospace;opacity:.75';
  address.textContent = decodeURIComponent(location.href);
  bar.replaceChildren(caption, address);
}`;

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1].endsWith('.webm'))) {
  console.error(usage);
  process.exit(1);
}
const out = resolve(args[1] ?? 'recordings/filter.webm');

const github = replay(fixtureOnGitHub());
const server = createWebServer({ open: (input) => openGitHub(input, { fetch: github }) });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

const videos = join(tmpdir(), `skill-atlas-demo-${process.pid}`);
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  server.close();
  console.error(`Cannot start the headless browser: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}
Install it with: npx playwright install --only-shell chromium   (add --with-deps for the system libraries, as root)`);
  process.exit(1);
}
try {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videos, size: SIZE } });
  const page = await context.newPage();
  await page.goto(`${base}?repo=${encodeURIComponent('https://github.com/JetBrains/fixture')}`);
  await step(page, 'Every skill in the repository');
  await type(page, 'co');
  await step(page, 'Filter as you type: names that contain “co”');
  await page.locator('.list li:not([hidden]) a').nth(1).click();
  await step(page, 'Select a matching skill');
  await type(page, ' st');
  await step(page, 'Several words: names that contain every one');
  await filterField(page).fill('');
  await type(page, 'zzz');
  await step(page, 'No skill matches');
  await filterField(page).fill('');
  await step(page, 'Empty: every skill again');
  const video = page.video()!;
  await context.close();
  await mkdir(dirname(out), { recursive: true });
  await video.saveAs(out);
  console.log(`Recorded: ${out}`);
} finally {
  await browser.close();
  server.close();
  await rm(videos, { recursive: true, force: true });
}

async function type(page: Page, text: string) {
  await filterField(page).press('End');
  await filterField(page).pressSequentially(text, { delay: KEY_DELAY });
}

/** A caption over the page, with the address that keeps the words; the skills shown and the address's anchor, printed. */
async function step(page: Page, caption: string) {
  await page.evaluate(`(${CAPTION})(${JSON.stringify(caption)})`);
  const shown = await page.locator('.list li:not([hidden]) .name').allTextContents();
  const filter = await filterField(page).inputValue();
  const anchor = new URL(page.url()).hash || 'no anchor';
  console.log(`${caption} | “${filter}” → ${shown.join(', ') || 'No skills match'} | ${anchor}`);
  await page.waitForTimeout(PAUSE);
}

function filterField(page: Page) {
  return page.getByRole('searchbox', { name: 'Filter skills by name' });
}
