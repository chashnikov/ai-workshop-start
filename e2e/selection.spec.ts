// Selecting a skill (spec/web.md): where the page is after a click on a skill in the list, in a real browser. Clicked
// with page.mouse where the link is, as a user would: locator.click() would scroll it into view itself. Without
// Playwright's Chromium (npx playwright install --only-shell chromium) it is skipped, except in CI, where it must run.
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chromium, expect, test, type Page } from '@playwright/test';
import { NOW, organizationOnGitHub } from '../src/core/fixture.ts';
import { openGitHub, scanOrganization } from '../src/core/github.ts';
import { replay } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';

const API = 'https://api.github.com';
let base = '';
let close = () => Promise.resolve();

test.beforeAll(async () => {
  const browser = await chromium.launch().then(
    (browser) => browser.close().then(() => true),
    () => false,
  );
  test.skip(!browser && !process.env.CI, 'no Playwright Chromium');
  // The fixture organization and 12 empty repositories: a warning each above the chooser, as GitHub answers
  // `409 Git Repository is empty.`, so the skills start below the first screen.
  const recording = organizationOnGitHub();
  const empty = Array.from({ length: 12 }, (_, i) => `empty-${String(i + 1).padStart(2, '0')}`);
  recording[`${API}/orgs/JetBrains/repos?type=all&per_page=100&page=1`].body = ['tools', 'docs', 'fixture', ...empty]
    .map((name) => ({ full_name: `JetBrains/${name}`, default_branch: 'main' }));
  for (const name of empty) recording[`${API}/repos/JetBrains/${name}/git/trees/main?recursive=1`] = { status: 409, body: { message: 'Git Repository is empty.' } };
  const github = replay(recording);
  const server = createWebServer({
    open: (input) => openGitHub(input, { fetch: github }),
    organization: (input, options = {}) => scanOrganization(input, { fetch: github, ...options }),
    now: () => NOW,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  close = () => new Promise<void>((done) => server.close(() => done()));
});

test.afterAll(() => close());

async function chooseFixture(page: Page) {
  await page.goto(`${base}?repo=${encodeURIComponent('https://github.com/JetBrains')}`);
  await page.locator('select').selectOption({ label: 'JetBrains/fixture · 4 skills' });
  await page.locator('.chooser button').click();
  await page.waitForURL(/&repo=/);
  await expect(page.locator('.warnings li')).toHaveCount(13);
}

async function clickSkill(page: Page, name: string) {
  const link = (await page.locator(`.list a[href="#skill-${name}"]`).boundingBox())!;
  await page.mouse.click(link.x + link.width / 2, link.y + link.height / 2);
  await page.waitForURL(new RegExp(`#skill-${name}$`));
  await expect(page.locator('.detail:visible h3')).toHaveText(name);
}

const scrollY = (page: Page) => page.evaluate<number>('scrollY');
const scrollable = (page: Page) => page.evaluate<number>('document.documentElement.scrollHeight - innerHeight');
const fixtureInOrganization = () => `${base}?org=${encodeURIComponent('https://github.com/JetBrains')}&repo=${encodeURIComponent('https://github.com/JetBrains/fixture')}`;
const top = (page: Page, selector: string): Promise<number> => page.locator(selector).first().evaluate((element) => (element as any).getBoundingClientRect().top);

test('selecting a skill does not move the page, scrolled down to skills below the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await chooseFixture(page);
  expect(await top(page, '.skills')).toBeGreaterThan(720);
  await page.mouse.move(640, 300);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scrollY(page)).toBe(600);
  await clickSkill(page, 'testing');
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(600);
  // The list and the selected skill, still in view.
  for (const selector of ['.list a[href="#skill-testing"]', '.detail:visible .panel']) {
    expect(await top(page, selector), selector).toBeGreaterThanOrEqual(0);
    expect(await top(page, selector), selector).toBeLessThan(720);
  }
});

test('selecting a skill at the top keeps the page at the top: the repository stays in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await chooseFixture(page);
  expect(await scrollable(page)).toBeGreaterThan(0);
  expect(await scrollY(page)).toBe(0);
  await clickSkill(page, 'commits');
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(0);
  expect(await top(page, 'h2.repository')).toBeGreaterThanOrEqual(0);
});

test('a link to a skill shows the page at the top, the skills below the first screen too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${fixtureInOrganization()}#skill-testing`);
  await expect(page.locator('.detail:visible h3')).toHaveText('testing');
  expect(await top(page, '.skills')).toBeGreaterThan(720);
  expect(await scrollable(page)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  expect(await scrollY(page)).toBe(0);
});

test('narrow screens: the list above the skill; selecting one scrolls to it', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.goto(`${base}?repo=${encodeURIComponent('https://github.com/JetBrains/fixture')}`);
  expect(await top(page, '.list')).toBeLessThan(await top(page, '.details'));
  await clickSkill(page, 'testing');
  await scrolledTo(page, '.detail:visible');
});

test('narrow screens: a link to a skill scrolls to it', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.goto(`${fixtureInOrganization()}#skill-testing`);
  await expect(page.locator('.detail:visible h3')).toHaveText('testing');
  await scrolledTo(page, '.detail:visible');
});

/** Scrolled so that its top is 1rem below the window's, as far as the page scrolls. */
async function scrolledTo(page: Page, selector: string) {
  const max = await scrollable(page);
  // Polled as one value, the page and the element read together: the page may still be scrolling.
  await expect.poll(() => page.locator(selector).first().evaluate((element, max) => {
    const { scrollY } = element.ownerDocument.defaultView!;
    return scrollY > 0 && Math.abs(Math.min(max, scrollY + (element as any).getBoundingClientRect().top - 16) - scrollY) < 1;
  }, max)).toBe(true);
}
