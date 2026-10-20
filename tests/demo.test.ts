// The decisions in spec/demo.md, checked on the real recording script: a headless browser, no
// display, no network. Without Playwright's Chromium (npx playwright install --only-shell chromium) the
// recording is skipped, except in CI, where it must run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { chromium } from 'playwright';

const SCRIPT = fileURLToPath(new URL('../scripts/record-demo.ts', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'skill-atlas-demo-test-'));
after(() => rmSync(temp, { recursive: true, force: true }));

function record(args: string[], env: Record<string, string> = {}) {
  // No DISPLAY: as on a remote machine.
  const { DISPLAY, WAYLAND_DISPLAY, ...rest } = process.env;
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...rest, ...env }, timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const browser = await chromium.launch().then(
  (browser) => browser.close().then(() => true),
  () => false,
);

test('demo: a video of the filter, with no display and no network', { skip: !browser && !process.env.CI && 'no Playwright Chromium' }, () => {
  const out = join(temp, 'nested', 'filter.webm');
  const { code, stdout, stderr } = record(['--out', out]);
  assert.equal(code, 0, stderr);
  assert.ok(stdout.endsWith(`Recorded: ${out}\n`), stdout);
  const video = readFileSync(out);
  // WebM: an EBML header, and more than a still frame.
  assert.deepEqual([...video.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3]);
  assert.ok(video.length > 50_000, `${video.length} bytes`);
  // What it shows: every skill, then the filter as it is typed, a selection, several words, no match, empty.
  // The selection is the address's anchor: #skill-commits from the click on, as the filter keeps it.
  const steps = stdout.split('\n').filter((line) => line.includes(' | ')).map((line) => line.split(' | ').slice(1).join(' | '));
  assert.deepEqual(steps, [
    '“” → code-style, commits, release-checklist, testing | no anchor',
    '“co” → code-style, commits | no anchor',
    '“co” → code-style, commits | #skill-commits',
    '“co st” → code-style | #skill-commits',
    '“zzz” → No skills match | #skill-commits',
    '“” → code-style, commits, release-checklist, testing | #skill-commits',
  ]);
});

test('demo: --out must be a .webm file; anything else is the usage, exit code 1', () => {
  for (const args of [['--out'], ['--out', 'filter.mp4'], ['filter.webm'], ['--out', 'a.webm', 'b']]) {
    const { code, stderr } = record(args);
    assert.equal(code, 1, args.join(' '));
    assert.equal(stderr, 'Usage: npm run demo [-- --out <file.webm>]\n');
  }
});

test('demo: no browser → how to install it, exit code 1', () => {
  const { code, stdout, stderr } = record(['--out', join(temp, 'none.webm')], { PLAYWRIGHT_BROWSERS_PATH: join(temp, 'no-browsers') });
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /^Cannot start the headless browser: .+\nInstall it with: npx playwright install --only-shell chromium/);
});
