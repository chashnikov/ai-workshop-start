#!/usr/bin/env node
// `npm run demo [-- --out <file>]`: a video of the web view, an organization's chooser then the filter,
// recorded in a headless browser, so it works where there is no display: a remote machine, a container,
// CI. The demo itself, and the fixture organization it is played on, are in ./demo.ts.
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { filterField, playDemo, SIZE, startDemoServer, type Step } from './demo.ts';

const usage = 'Usage: npm run demo [-- --out <file.webm>]';
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

const server = await startDemoServer();
const videos = join(tmpdir(), `skill-atlas-demo-${process.pid}`);
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  await server.close();
  console.error(`Cannot start the headless browser: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}
Install it with: npx playwright install --only-shell chromium   (add --with-deps for the system libraries, as root)`);
  process.exit(1);
}
try {
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: videos, size: SIZE } });
  const page = await context.newPage();
  await playDemo(page, server.base, step, KEY_DELAY);
  const video = page.video()!;
  await context.close();
  await mkdir(dirname(out), { recursive: true });
  await video.saveAs(out);
  console.log(`Recorded: ${out}`);
} finally {
  await browser.close();
  await server.close();
  await rm(videos, { recursive: true, force: true });
}

/**
 * A caption over the page, with the address that keeps the words; printed: the skills shown and the
 * address's anchor, or, on an organization's page, its heading and the chooser's repositories.
 */
async function step(page: Page, { caption }: Step) {
  await page.evaluate(`(${CAPTION})(${JSON.stringify(caption)})`);
  if (!(await filterField(page).count())) {
    const heading = await page.locator('h2.organization').textContent();
    const choices = await page.locator('.chooser option:not([disabled])').allTextContents();
    console.log(`${caption} | ${heading} → ${choices.join(', ')} | no anchor`);
    await page.waitForTimeout(PAUSE);
    return;
  }
  const shown = await page.locator('.list li:not(.group):not([hidden]) .name').allTextContents();
  const filter = await filterField(page).inputValue();
  const anchor = new URL(page.url()).hash || 'no anchor';
  console.log(`${caption} | “${filter}” → ${shown.join(', ') || 'No skills match'} | ${anchor}`);
  await page.waitForTimeout(PAUSE);
}
