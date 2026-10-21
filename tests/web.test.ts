// The decisions in spec/web.md, checked on the pages the web view serves for ./fixture, as if it
// were on GitHub, and for small GitHub repositories answered in tests/helpers.ts and below.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { openGitHub, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { run } from '../src/commands.ts';
import { scan } from '../src/core/scan.ts';
import { createWebServer } from '../src/web.ts';
import { CLI, COMMIT, EXAMPLE, EXAMPLE_COMMIT, FIXTURE, FIXTURE_UPDATED, fixtureOnGitHub, history, NOW, onGitHub } from './helpers.ts';

/** A skill whose front matter and content are markup. */
const MARKUP = onGitHub('markup', {
  '.claude/skills/markup/SKILL.md': '---\nname: "<b>markup</b>"\ndescription: Says "<img src=x onerror=alert(1)>".\n---\n<script>alert(1)</script>\n',
});

/** Two skills that call themselves the same in their front matter. */
const SAME_NAME = onGitHub('same-name', {
  '.claude/skills/one/SKILL.md': '---\nname: review\ndescription: The first.\n---\nOne.\n',
  '.claude/skills/two/SKILL.md': '---\nname: review\ndescription: The second.\n---\nTwo.\n',
});

/** Two names with the same anchor: `skill-a-b`, then `skill-a-b-2`. */
const SAME_ANCHOR = onGitHub('same-anchor', {
  '.claude/skills/one/SKILL.md': '---\nname: a-b\ndescription: The first.\n---\nOne.\n',
  '.claude/skills/two/SKILL.md': '---\nname: a.b\ndescription: The second.\n---\nTwo.\n',
});

/**
 * Similar skills: `gradle` and `release` in their names, `code` in two descriptions, `onboarding` like none;
 * `kotlin` in every one, so not a group.
 */
const GROUPS = onGitHub('groups', {
  '.claude/skills/release-tag/SKILL.md': '---\nname: release-tag\ndescription: Tags a Kotlin release.\n---\nTag.\n',
  '.claude/skills/gradle-bump/SKILL.md': '---\nname: gradle-bump\ndescription: Bumps the Gradle version of Kotlin.\n---\nBump.\n',
  '.claude/skills/lint/SKILL.md': '---\nname: lint\ndescription: Checks the Kotlin code style.\n---\nLint.\n',
  '.claude/skills/releases/SKILL.md': '---\nname: releases\ndescription: Writes the notes of Kotlin releases.\n---\nNotes.\n',
  '.claude/skills/onboarding/SKILL.md': '---\nname: onboarding\ndescription: Welcomes a new Kotlin teammate.\n---\nHello.\n',
  '.claude/skills/formatting/SKILL.md': '---\nname: formatting\ndescription: Formats Kotlin code.\n---\nFormat.\n',
  '.claude/skills/gradle-cache/SKILL.md': '---\nname: gradle-cache\ndescription: Clears the Gradle build cache for Kotlin.\n---\nClear.\n',
});

/** The default selection when the list is in groups: the first skill shown of the first group with one shown. */
const FIRST_IN_GROUPS =
  /\.skills:not\(:has\(\.detail:target:not\(\[hidden\]\)\)\) \.list \.group:nth-child\(1 of :has\(li:not\(\[hidden\]\)\)\) li:nth-child\(1 of :not\(\[hidden\]\)\) a \{ background/;

/** No skills at all. */
const EMPTY = onGitHub('empty', { 'README.md': '# Empty\n' });

const requests: string[] = [];
const github = replay({ ...EXAMPLE, ...fixtureOnGitHub(), ...MARKUP, ...SAME_NAME, ...SAME_ANCHOR, ...GROUPS, ...EMPTY });
const counted: Fetch = (url, init) => {
  requests.push(url);
  return github(url, init);
};
// Code search for JetBrains/example, as EXAMPLE answers it; the tree for the others.
const server = createWebServer({
  open: (input) => openGitHub(input, { fetch: counted, token: /example/.test(input) ? 'test' : undefined }),
  now: () => NOW,
});
const base = await listen(server);
after(() => {
  server.closeAllConnections();
  server.close();
});

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

async function get(query = '', init?: RequestInit) {
  const response = await fetch(`${base}${query}`, init);
  return { status: response.status, type: response.headers.get('content-type'), html: await response.text() };
}

const view = (repo: string) => get(`?repo=${encodeURIComponent(repo)}`);

/** The page's text, without its markup, its head and the form. */
function text(html: string): string {
  return html
    .replace(/<head>[\s\S]*?<\/head>|<header>[\s\S]*?<\/header>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

test('the page is a form that asks for a GitHub repository URL', async () => {
  const page = await get();
  assert.equal(page.status, 200);
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.match(page.html, /<form method="get" action="\/">\s*<input type="text" name="repo" value=""/);
  assert.equal(text(page.html), '');
});

test('a repository: its id, linked, the commit, and its skill with its description, pinned link and content', async () => {
  const page = await view('https://github.com/JetBrains/example');
  assert.equal(page.status, 200);
  assert.match(page.html, /name="repo" value="https:\/\/github.com\/JetBrains\/example"/);
  assert.match(page.html, /<h2 class="repository"><a href="https:\/\/github.com\/JetBrains\/example">JetBrains\/example<\/a> · 1 skill at <code>5ab6270<\/code>/);
  assert.match(page.html, /<p class="description">Write commit messages the way this repository does. Use for every commit.<\/p>/);
  assert.ok(page.html.includes(`<a href="https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md">`));
  assert.match(page.html, /<pre class="content"># Commits<\/pre>/);
});

/**
 * The left column's items: each skill's anchor, name, summary and when it was last updated: the time, its tooltip and
 * how long ago; the `hidden` ones too with `all`.
 */
function items(html: string, all = false) {
  const nav = /<nav class="list">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const item = /<li( hidden)?><a href="#([^"]+)"><span class="name">(.*?)<\/span>(?:<span class="summary">(.*?)<\/span>)?(?:<time class="updated" datetime="([^"]*)" title="([^"]*)">(.*?)<\/time>)?<\/a><\/li>/g;
  return [...nav.matchAll(item)]
    .filter(([, hidden]) => all || !hidden)
    .map(([, , anchor, name, summary, datetime, title, updated]) => ({ anchor, name, summary, datetime, title, updated }));
}

/** The left column: each skill's anchor, name and summary; the `hidden` ones too with `all`. */
function list(html: string, all = false) {
  return items(html, all).map(({ anchor, name, summary }) => ({ anchor, name, summary }));
}

/** The right column: each skill's section, by anchor; the `hidden` ones too with `all`. */
function details(html: string, all = false): Map<string, string> {
  const column = /<div class="details">([\s\S]*)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  return new Map(
    [...column.matchAll(/<section class="detail" id="([^"]+)"( hidden)?>([\s\S]*?)<\/section>/g)]
      .filter(([, , hidden]) => all || !hidden)
      .map(([, id, , section]) => [id, section]),
  );
}

test('./fixture on GitHub: the skills, sorted by name, in the left column, with their first sentence', async () => {
  const page = await view('github.com/JetBrains/fixture');
  assert.equal(page.status, 200);
  assert.deepEqual(list(page.html), [
    { anchor: 'skill-code-style', name: 'code-style', summary: 'Follow the project&#39;s code style.' },
    { anchor: 'skill-commits', name: 'commits', summary: 'Write commit messages the way this repository does.' },
    { anchor: 'skill-release-checklist', name: 'release-checklist', summary: undefined },
    { anchor: 'skill-testing', name: 'testing', summary: 'Run the tests before pushing.' },
  ]);
  assert.match(page.html, /<li>warning: .agents\/skills\/release-checklist\/SKILL.md: malformed front matter: [^<]*<\/li>/);
  assert.doesNotMatch(page.html, /not-a-skill/);
});

test('./fixture on GitHub: each skill in the list shows how long ago it was last updated, its date and time in UTC as the tooltip', async () => {
  const page = await view('github.com/JetBrains/fixture');
  assert.deepEqual(items(page.html).map(({ name, datetime, title, updated }) => ({ name, datetime, title, updated })), [
    { name: 'code-style', datetime: '2026-09-14T08:12:45.000Z', title: '2026-09-14 08:12 UTC', updated: 'Updated 1 month ago' },
    { name: 'commits', datetime: '2026-10-20T15:05:21.000Z', title: '2026-10-20 15:05 UTC', updated: 'Updated 20 hours ago' },
    { name: 'release-checklist', datetime: '2026-03-02T23:59:59.000Z', title: '2026-03-02 23:59 UTC', updated: 'Updated 7 months ago' },
    { name: 'testing', datetime: '2025-12-31T07:00:00.000Z', title: '2025-12-31 07:00 UTC', updated: 'Updated 9 months ago' },
  ]);
});

test('last updated: how long ago, in its largest whole unit, as of the time the page is served', async () => {
  const id = 'JetBrains/history';
  const github = replay({
    ...onGitHub('history', { '.claude/skills/one/SKILL.md': '---\nname: one\ndescription: One.\n---\n' }),
    ...history(id, COMMIT, '.claude/skills/one/SKILL.md', '2026-10-20T12:00:00Z'),
  });
  let clock = 0;
  const server = createWebServer({ open: (input) => openGitHub(input, { fetch: github }), now: () => clock });
  const base = await listen(server);
  const updated = async (now: string) => {
    clock = Date.parse(now);
    return items(await (await fetch(`${base}?repo=${encodeURIComponent(`https://github.com/${id}`)}`)).text())[0].updated;
  };
  try {
    assert.equal(await updated('2026-10-20T11:00:00Z'), 'Updated just now', 'a time still to come');
    assert.equal(await updated('2026-10-20T12:00:59Z'), 'Updated just now');
    assert.equal(await updated('2026-10-20T12:01:00Z'), 'Updated 1 minute ago');
    assert.equal(await updated('2026-10-20T12:59:59Z'), 'Updated 59 minutes ago');
    assert.equal(await updated('2026-10-20T13:00:00Z'), 'Updated 1 hour ago');
    assert.equal(await updated('2026-10-21T11:59:59Z'), 'Updated 23 hours ago');
    assert.equal(await updated('2026-10-21T12:00:00Z'), 'Updated 1 day ago');
    assert.equal(await updated('2026-11-18T12:00:00Z'), 'Updated 29 days ago');
    assert.equal(await updated('2026-11-19T12:00:00Z'), 'Updated 1 month ago');
    assert.equal(await updated('2027-10-19T12:00:00Z'), 'Updated 12 months ago');
    assert.equal(await updated('2027-10-20T12:00:00Z'), 'Updated 1 year ago');
    assert.equal(await updated('2029-10-20T12:00:00Z'), 'Updated 3 years ago');
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('last updated: the last commit to the SKILL.md up to the scanned commit, a request per skill, a copy not asked for', async () => {
  requests.length = 0;
  await view('github.com/JetBrains/fixture');
  const asked = requests.filter((url) => url.startsWith('https://api.github.com/repos/JetBrains/fixture/commits?'));
  assert.deepEqual(asked.sort(), Object.keys(FIXTURE_UPDATED).map((path) => `https://api.github.com/repos/JetBrains/fixture/commits?sha=${COMMIT}&path=${path}&per_page=1`).sort());
});

test('last updated: a time with a zone offset is shown in UTC, as of it; no commit → nothing shown', async () => {
  const id = 'JetBrains/history';
  const files = {
    '.claude/skills/offset/SKILL.md': '---\nname: offset\ndescription: An offset.\n---\n',
    '.claude/skills/none/SKILL.md': '---\nname: none\ndescription: No commit.\n---\n',
  };
  const github = replay({
    ...onGitHub('history', files),
    ...history(id, COMMIT, '.claude/skills/offset/SKILL.md', '2026-10-20T23:30:00+02:00'),
    [`https://api.github.com/repos/${id}/commits?sha=${COMMIT}&path=.claude/skills/none/SKILL.md&per_page=1`]: { status: 200, body: [] },
  });
  const server = createWebServer({ open: (input) => openGitHub(input, { fetch: github }), now: () => NOW });
  const base = await listen(server);
  try {
    const html = await (await fetch(`${base}?repo=${encodeURIComponent(`https://github.com/${id}`)}`)).text();
    assert.deepEqual(items(html).map(({ name, title, updated }) => ({ name, title, updated })), [
      { name: 'none', title: undefined, updated: undefined },
      { name: 'offset', title: '2026-10-20 21:30 UTC', updated: 'Updated 14 hours ago' },
    ]);
    assert.doesNotMatch(html, /<li>warning: /);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

/** The page for JetBrains/history, with its skills' commits answered `answer`. */
async function withHistory(files: Record<string, string>, answer: { status: number; body: unknown }) {
  const id = 'JetBrains/history';
  const recording = onGitHub('history', files);
  for (const path of Object.keys(files)) recording[`https://api.github.com/repos/${id}/commits?sha=${COMMIT}&path=${path}&per_page=1`] = answer;
  const server = createWebServer({ open: (input) => openGitHub(input, { fetch: replay(recording) }) });
  const base = await listen(server);
  try {
    const page = await fetch(`${base}?repo=${encodeURIComponent(`https://github.com/${id}`)}`);
    return { status: page.status, html: await page.text() };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const warningsOf = (html: string) => [...html.matchAll(/<li>warning: (.*?)<\/li>/g)].map(([, warning]) => text(warning));

test('last updated cannot be read → the skills all the same, without it, and one warning for all of them', async () => {
  const error = { status: 500, body: { message: 'Server Error' } };
  const two = await withHistory(
    {
      '.claude/skills/a/SKILL.md': '---\nname: a\ndescription: A.\n---\n',
      '.claude/skills/b/SKILL.md': '---\nname: b\ndescription: B.\n---\n',
    },
    error,
  );
  assert.equal(two.status, 200);
  assert.deepEqual(items(two.html).map(({ name, updated }) => ({ name, updated })), [
    { name: 'a', updated: undefined },
    { name: 'b', updated: undefined },
  ]);
  const commits = `https://api.github.com/repos/JetBrains/history/commits?sha=${COMMIT}&path=.claude/skills/`;
  assert.equal(warningsOf(two.html).length, 1);
  assert.match(warningsOf(two.html)[0], new RegExp(`^the last update of 2 skills cannot be read: GitHub answered 500 for ${commits.replace(/[.?]/g, '\\$&')}(a|b)/SKILL\\.md&per_page=1: Server Error$`));
  const one = await withHistory({ '.claude/skills/a/SKILL.md': '---\nname: a\ndescription: A.\n---\n' }, error);
  assert.deepEqual(warningsOf(one.html), [`the last update of 1 skill cannot be read: GitHub answered 500 for ${commits}a/SKILL.md&per_page=1: Server Error`]);
});

test('last updated: the rate limit stops the scan, as any other request\'s does → the clear message, status 400', async () => {
  const page = await withHistory(
    { '.claude/skills/a/SKILL.md': '---\nname: a\ndescription: A.\n---\n' },
    { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  );
  assert.equal(page.status, 400);
  assert.equal(text(page.html), 'GitHub rate limit reached; set GITHUB_TOKEN');
});

test('last updated: at most 8 requests for it at the same time', async () => {
  const files = Object.fromEntries(Array.from({ length: 30 }, (_, n) => [`.claude/skills/s${n}/SKILL.md`, `---\nname: s${n}\n---\n`]));
  const recorded = replay(onGitHub('many', files));
  let running = 0;
  let most = 0;
  const fetch: Fetch = async (url, init) => {
    if (!url.includes('/commits?')) return recorded(url, init);
    most = Math.max(most, ++running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return recorded(url, init);
  };
  const result = await scan(await openGitHub('https://github.com/JetBrains/many', { fetch }), { updated: true });
  assert.equal(result.skills.filter((skill) => skill.updated).length, 30);
  assert.equal(most, 8);
});

test('./fixture on GitHub: in the right column, each skill in full: description, pinned link, copies, content', async () => {
  const page = await view('github.com/JetBrains/fixture');
  const sections = details(page.html);
  assert.deepEqual([...sections.keys()], list(page.html).map((item) => item.anchor));
  const commits = text(sections.get('skill-commits') ?? '');
  assert.equal(
    commits,
    'commits Write commit messages the way this repository does. Use for every commit. .claude/skills/commits/SKILL.md ' +
      '# Commits Start with the area, then say what changed: `editor: keep the caret after undo`.',
  );
  assert.ok(sections.get('skill-commits')?.includes(`href="https://github.com/JetBrains/fixture/blob/${COMMIT}/.claude/skills/commits/SKILL.md"`));
  assert.match(sections.get('skill-code-style') ?? '', /<p class="copies">also in <code>.github\/skills\/code-style\/SKILL.md<\/code><\/p>/);
  assert.match(sections.get('skill-release-checklist') ?? '', /<pre class="content">/);
});

test('the first skill is selected by default; a link to #<anchor> selects another, with no script', async () => {
  const page = await view('github.com/JetBrains/fixture');
  // CSS selects; the only script is the filter's.
  assert.equal(scripts(page.html).length, 1);
  // Only the selected section is shown: the targeted one, else the first one; never a hidden one.
  assert.match(page.html, /\.detail \{ display: none; \}/);
  assert.match(
    page.html,
    /\.detail:target:not\(\[hidden\]\), \.details:not\(:has\(\.detail:target:not\(\[hidden\]\)\)\) \.detail:nth-child\(1 of :not\(\[hidden\]\)\) \{ display: contents; \}/,
  );
  // Its item in the list is highlighted the same way.
  for (const { anchor } of list(page.html)) {
    assert.ok(page.html.includes(`body:has(#${anchor}:target:not([hidden])) .list a[href="#${anchor}"]`), anchor);
  }
  assert.match(page.html, FIRST_IN_GROUPS);
});

/** The left column's groups: each one's name and the names of its skills; the `hidden` ones too with `all`. */
function groups(html: string, all = false) {
  const nav = /<nav class="list">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<li class="group"><h3 class="group-name">(.*?)<\/h3><ul>([\s\S]*?)<\/ul><\/li>/g)].map(([, name, skills]) => ({
    name: text(name),
    skills: list(`<nav class="list">${skills}</nav>`, all).map((item) => item.name),
  }));
}

test('groups: similar skills together, under the keyword they share in their names or descriptions; Other last', async () => {
  const page = await view('https://github.com/JetBrains/groups');
  assert.equal(page.status, 200);
  assert.deepEqual(groups(page.html), [
    // `code` in two descriptions only; `kotlin`, in every one, makes no group.
    { name: 'code', skills: ['formatting', 'lint'] },
    { name: 'gradle', skills: ['gradle-bump', 'gradle-cache'] },
    // `release-tag` and `releases`: the keyword as most of them write it.
    { name: 'release', skills: ['release-tag', 'releases'] },
    { name: 'Other', skills: ['onboarding'] },
  ]);
  // On the right, in the same order; the anchors those of the list sorted by name.
  assert.deepEqual([...details(page.html).keys()], ['skill-formatting', 'skill-lint', 'skill-gradle-bump', 'skill-gradle-cache', 'skill-release-tag', 'skill-releases', 'skill-onboarding']);
  assert.deepEqual([...details(page.html).keys()], list(page.html).map((item) => item.anchor));
});

test('groups: the endings dropped, `commits` and `committing` are one keyword; a tie goes to the one in more names', async () => {
  const page = await view('github.com/JetBrains/fixture');
  // `commit`, in a name, before `change`, in descriptions only: then `testing` is alone.
  assert.deepEqual(groups(page.html), [
    { name: 'commit', skills: ['code-style', 'commits'] },
    { name: 'Other', skills: ['release-checklist', 'testing'] },
  ]);
});

test('groups: no keyword shared, or only by every skill → no groups, the list sorted by name', async () => {
  for (const repo of ['https://github.com/JetBrains/example', 'https://github.com/JetBrains/same-name', 'https://github.com/JetBrains/markup']) {
    const page = await view(repo);
    assert.deepEqual(groups(page.html), [], repo);
    assert.doesNotMatch(page.html, /class="group/, repo);
    assert.match(page.html, /\.skills:not\(:has\(\.detail:target:not\(\[hidden\]\)\)\) \.list li:nth-child\(1 of :not\(\[hidden\]\)\) a \{ background/, repo);
  }
});

test('groups: the first skill of the first group is selected by default, with no script; a group\'s name is text', async () => {
  const page = await view('https://github.com/JetBrains/groups');
  assert.match(page.html, FIRST_IN_GROUPS);
  assert.match(page.html, /\.group:not\(:has\(li:not\(\[hidden\]\)\)\) \{ display: none; \}/);
  assert.equal(scripts(page.html).length, 1);
});

test('groups and the filter: the groups stay those of the whole list; one with no skill shown is not shown', async () => {
  const page = await filtered('https://github.com/JetBrains/groups', 'gradle');
  assert.deepEqual(groups(page.html), [
    { name: 'code', skills: [] },
    { name: 'gradle', skills: ['gradle-bump', 'gradle-cache'] },
    { name: 'release', skills: [] },
    { name: 'Other', skills: [] },
  ]);
  assert.deepEqual(groups(page.html, true).map(({ name }) => name), ['code', 'gradle', 'release', 'Other']);
  // The CSS hides the groups with no skill shown, as the script filters too.
  assert.match(page.html, /\.group:not\(:has\(li:not\(\[hidden\]\)\)\) \{ display: none; \}/);
  assert.deepEqual([...details(page.html).keys()], ['skill-gradle-bump', 'skill-gradle-cache']);
  const browsed = browse((await view('https://github.com/JetBrains/groups')).html, base);
  browsed.type('re');
  assert.deepEqual(browsed.shown(), ['release-tag', 'releases']);
  assert.deepEqual(browsed.sections(), ['skill-release-tag', 'skill-releases']);
});

test('anchors are letters, digits, _ and -, and unique even when skills share a name', async () => {
  assert.deepEqual(list((await view('https://github.com/JetBrains/markup')).html).map((item) => item.anchor), ['skill--b-markup--b-']);
  const same = await view('https://github.com/JetBrains/same-name');
  assert.deepEqual(list(same.html).map(({ anchor, summary }) => ({ anchor, summary })), [
    { anchor: 'skill-review', summary: 'The first.' },
    { anchor: 'skill-review-2', summary: 'The second.' },
  ]);
  assert.deepEqual([...details(same.html).keys()], ['skill-review', 'skill-review-2']);
});

test('no skills → "No skills found."', async () => {
  const page = await view('https://github.com/JetBrains/empty');
  assert.equal(page.status, 200);
  assert.equal(text(page.html), 'JetBrains/empty · 0 skills at 0123456 No skills found.');
});

test('repository content is text, never markup', async () => {
  const page = await view('https://github.com/JetBrains/markup');
  assert.equal(page.status, 200);
  assert.doesNotMatch(scripts(page.html).join(''), /alert/);
  assert.doesNotMatch(page.html, /<script>alert|<img|<b>/);
  assert.match(page.html, /<h3>&#60;b&#62;markup&#60;\/b&#62;<\/h3>/);
  assert.match(page.html, /<pre class="content">&#60;script&#62;alert\(1\)&#60;\/script&#62;<\/pre>/);
  assert.ok(text(page.html).includes('Says "<img src=x onerror=alert(1)>".'));
});

test('every request scans again: nothing is stored', async () => {
  requests.length = 0;
  await view('https://github.com/JetBrains/example');
  await view('https://github.com/JetBrains/example');
  assert.equal(requests.filter((url) => url === 'https://api.github.com/repos/JetBrains/example').length, 2);
});

test('not a GitHub URL → the message on the page, status 400; local directories are never read', async () => {
  const page = await view(FIXTURE);
  assert.equal(page.status, 400);
  assert.equal(text(page.html), `Not a GitHub repository URL: ${FIXTURE}`);
  assert.match(page.html, /<p class="error">/);
});

test('unreachable repository → the clear message on the page, status 400', async () => {
  const page = await view('https://github.com/JetBrains/not-answered');
  assert.equal(page.status, 400);
  assert.equal(text(page.html), 'Cannot reach GitHub: not recorded: https://api.github.com/repos/JetBrains/not-answered');
});

/** A request as written, path and `Host` included: `fetch` normalizes neither. */
async function raw(method: string, path: string, host = new URL(base).host) {
  const sent = request(new URL(base), { method, path, headers: { host } });
  sent.end();
  const [response] = (await once(sent, 'response')) as [import('node:http').IncomingMessage];
  let html = '';
  for await (const chunk of response) html += chunk;
  return { status: response.statusCode, headers: response.headers, html };
}

test('another path → 404, //<path> too', async () => {
  const missing = await get('skills');
  assert.equal(missing.status, 404);
  assert.equal(text(missing.html), 'Not found: /skills');
  const doubled = await raw('GET', '//skills');
  assert.equal(doubled.status, 404);
  assert.equal(text(doubled.html), 'Not found: //skills');
});

test('another host → 403: no DNS rebinding; 127.0.0.1 and localhost are served', async () => {
  const rebound = await raw('GET', '/?repo=github.com/JetBrains/example', 'attacker.example');
  assert.equal(rebound.status, 403);
  assert.equal(text(rebound.html), 'Not served for the host: attacker.example');
  const otherPort = await raw('GET', '/', '127.0.0.1:1');
  assert.equal(otherPort.status, 403);
  const port = new URL(base).port;
  assert.equal((await raw('GET', '/', `127.0.0.1:${port}`)).status, 200);
  assert.equal((await raw('GET', '/', `localhost:${port}`)).status, 200);
});

test('HEAD: the headers only, no scan; another method → 405 with Allow: GET, HEAD', async () => {
  requests.length = 0;
  const head = await raw('HEAD', `/?repo=${encodeURIComponent('https://github.com/JetBrains/example')}`);
  assert.equal(head.status, 200);
  assert.equal(head.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(head.html, '');
  assert.deepEqual(requests, []);
  const posted = await raw('POST', '/');
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.allow, 'GET, HEAD');
  assert.equal(text(posted.html), 'Only GET is supported');
});

test('selecting a skill does not move the page: at the top, the repository stays in view', async () => {
  const page = await view('github.com/JetBrains/fixture');
  // The selected section has no box, its panel has: following its #anchor, the browser has nothing to scroll to.
  // In a browser: e2e/selection.spec.ts.
  assert.doesNotMatch(page.html, /scroll-margin-top: 100vh/);
  for (const [anchor, section] of details(page.html, true)) assert.ok(section.startsWith('<div class="panel">\n<h3>') && section.endsWith('</div>'), anchor);
  assert.match(page.html, /\.panel \{ border: 1px solid #d0d7de;/);
  assert.ok(page.html.indexOf('<h2 class="repository">') < page.html.indexOf('<div class="skills">'));
});

test('narrow screens: the list above the skill; selecting one scrolls to it', async () => {
  const page = await view('github.com/JetBrains/fixture');
  assert.match(page.html, /@media \(max-width: 48rem\) \{ \.skills \{ grid-template-columns: 1fr; \}.* \.detail:target:not\(\[hidden\]\) \{ display: block; scroll-margin-top: 1rem; \} \}/);
  // The list comes first in the page, so in one column it is above the skill.
  assert.ok(page.html.indexOf('<nav class="list">') < page.html.indexOf('<div class="details">'));
});

test('skill-atlas serve: port 3000 by default', async () => {
  const ports: number[] = [];
  const printed: string[] = [];
  const code = await run(['serve'], {
    open: () => Promise.reject(new Error('not opened')),
    print: (line) => printed.push(line),
    error: (line) => printed.push(line),
    serve: async (port) => {
      ports.push(port);
      return `http://127.0.0.1:${port}/`;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(ports, [3000]);
  assert.deepEqual(printed, ['Skill Atlas web view: http://127.0.0.1:3000/']);
});

test('skill-atlas serve: prints the address and serves the page on 127.0.0.1', async (t) => {
  const child = spawn(process.execPath, [CLI, 'serve', '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const [line] = (await once(child.stdout, 'data')) as [Buffer];
  const address = /^Skill Atlas web view: (http:\/\/127\.0\.0\.1:\d+\/)\n$/.exec(line.toString())?.[1];
  assert.ok(address, line.toString());
  const response = await fetch(address);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /name="repo"/);
});

test('skill-atlas serve: a port that is not a number, over 65535 or taken → a clear message, exit code 1', async (t) => {
  const bad = spawnSync(process.execPath, [CLI, 'serve', '--port', 'x'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, 'Not a port: x\nUsage: skill-atlas serve [--port <port>]\n');
  const over = spawnSync(process.execPath, [CLI, 'serve', '--port', '70000'], { encoding: 'utf8' });
  assert.equal(over.status, 1);
  assert.equal(over.stderr, 'Not a port: 70000\nUsage: skill-atlas serve [--port <port>]\n');

  const taken = createServer();
  t.after(() => taken.close());
  const port = new URL(await listen(taken)).port;
  const busy = spawnSync(process.execPath, [CLI, 'serve', '--port', port], { encoding: 'utf8' });
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, new RegExp(`^Cannot start the web view on port ${port}: .*EADDRINUSE`));
});

/** The filter's form above the list: the repository it keeps, and the word. */
function filterForm(html: string) {
  const nav = /<nav class="list">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  const form = /^<form class="filter" method="get" action="\/">([\s\S]*?)<\/form>/.exec(nav)?.[1];
  if (form === undefined) return undefined;
  return {
    repo: /<input type="hidden" name="repo" value="([^"]*)">/.exec(form)?.[1],
    filter: /<input type="search" name="filter" value="([^"]*)"/.exec(form)?.[1],
  };
}

const filtered = (repo: string, filter: string) => get(`?repo=${encodeURIComponent(repo)}&filter=${encodeURIComponent(filter)}`);

test('filter: a text field above the list, for the same repository; empty shows every skill', async () => {
  const page = await view('github.com/JetBrains/fixture');
  // filterForm reads the form only at the start of the list's column: above the list.
  assert.deepEqual(filterForm(page.html), { repo: 'github.com/JetBrains/fixture', filter: '' });
  const empty = await filtered('github.com/JetBrains/fixture', '  ');
  assert.equal(list(empty.html).length, 4);
  assert.deepEqual(filterForm(empty.html), { repo: 'github.com/JetBrains/fixture', filter: '' });
  // No button: the field filters as it changes, else Enter submits it.
  assert.doesNotMatch(/<form class="filter"[\s\S]*?<\/form>/.exec(page.html)?.[0] ?? '', /<button/);
});

test('filter: only the skills whose names contain the word, ignoring case, in both columns', async () => {
  const page = await filtered('github.com/JetBrains/fixture', 'CO');
  assert.equal(page.status, 200);
  assert.deepEqual(list(page.html).map((item) => item.name), ['code-style', 'commits']);
  assert.deepEqual([...details(page.html).keys()], ['skill-code-style', 'skill-commits']);
  // The others are on the page, hidden, for the field to show them again with no request.
  assert.equal(list(page.html, true).length, 4);
  assert.equal(details(page.html, true).size, 4);
  assert.deepEqual(filterForm(page.html), { repo: 'github.com/JetBrains/fixture', filter: 'CO' });
  // The heading still counts the repository's skills; the warnings stay.
  assert.match(page.html, /JetBrains\/fixture<\/a> · 4 skills/);
  assert.match(page.html, /<li>warning: /);
  // Names only: "testing" says "pushing" in its description, not in its name.
  assert.deepEqual(list((await filtered('github.com/JetBrains/fixture', 'push')).html), []);
});

test('filter: several words → only the skills whose names contain every one, in any order', async () => {
  const names = async (words: string) => list((await filtered('github.com/JetBrains/fixture', words)).html).map((item) => item.name);
  assert.deepEqual(await names('co st'), ['code-style']);
  assert.deepEqual(await names(' ST\tCO '), ['code-style']);
  assert.deepEqual(await names('e  t'), ['code-style', 'release-checklist', 'testing']);
  assert.deepEqual(await names('co xyz'), []);
  assert.deepEqual(noMatch((await filtered('github.com/JetBrains/fixture', ' co  xyz ')).html), { hidden: false, text: 'No skills match “co xyz”.' });
});

test('filter: the anchors stay those of the whole list; the first match is selected by default, with no script', async () => {
  const page = await filtered('github.com/JetBrains/fixture', 'test');
  assert.deepEqual(list(page.html).map((item) => item.anchor), ['skill-testing']);
  assert.ok(page.html.includes('body:has(#skill-testing:target:not([hidden])) .list a[href="#skill-testing"]'));
  // A link to a hidden skill selects the first match: the CSS ignores a hidden :target.
  assert.match(page.html, /<section class="detail" id="skill-commits" hidden>/);
  assert.match(page.html, FIRST_IN_GROUPS);
  // `.` drops `a-b`, the first of the two: `a.b` keeps its whole-list anchor, and is selected.
  const anchor = await filtered('https://github.com/JetBrains/same-anchor', '.');
  assert.deepEqual(list(anchor.html).map(({ anchor, name }) => ({ anchor, name })), [{ anchor: 'skill-a-b-2', name: 'a.b' }]);
  assert.deepEqual([...details(anchor.html).keys()], ['skill-a-b-2']);
  const same = await filtered('https://github.com/JetBrains/same-name', 'view');
  assert.deepEqual(list(same.html).map((item) => item.anchor), ['skill-review', 'skill-review-2']);
});

test('filter: no match → "No skills match", the field still there; the word is text, never markup', async () => {
  const page = await filtered('github.com/JetBrains/fixture', '<b>"x"</b>');
  assert.equal(page.status, 200);
  assert.deepEqual(filterForm(page.html), { repo: 'github.com/JetBrains/fixture', filter: '&#60;b&#62;&#34;x&#34;&#60;/b&#62;' });
  assert.doesNotMatch(page.html, /<b>/);
  assert.deepEqual(noMatch(page.html), { hidden: false, text: 'No skills match “<b>"x"</b>”.' });
  assert.deepEqual(list(page.html), []);
  assert.deepEqual(noMatch((await filtered('github.com/JetBrains/fixture', 'co')).html)?.hidden, true);
});

test('filter: a repository with no skills → "No skills found.", no filter', async () => {
  const page = await filtered('https://github.com/JetBrains/empty', 'x');
  assert.equal(text(page.html), 'JetBrains/empty · 0 skills at 0123456 No skills found.');
  assert.equal(filterForm(page.html), undefined);
});

/** The "No skills match" line: whether it is hidden, and its text. */
function noMatch(html: string) {
  const match = /<p class="empty no-match"( hidden)?>([^<]*)<\/p>/.exec(html);
  return match && { hidden: Boolean(match[1]), text: text(match[2]) };
}

/** The page's scripts. */
function scripts(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, script]) => script);
}

/**
 * The page's own script, run on the elements it reads, as the served page has them: the field,
 * the items with their names, the sections, the "No skills match" line, and the address.
 */
function browse(html: string, address: string) {
  const [script] = scripts(html);
  assert.ok(script, 'the page has a script');
  const element = (hidden: boolean, textContent = '') => ({ hidden, textContent });
  const items = [...html.matchAll(/<li( hidden)?><a href="#([^"]+)"><span class="name">(.*?)<\/span>/g)].map(([, hidden, anchor, name]) => {
    const item = { ...element(Boolean(hidden)), anchor, name: element(false, text(name)) };
    return { ...item, querySelector: (selector: string) => (assert.equal(selector, '.name'), item.name) };
  });
  const sections = [...html.matchAll(/<section class="detail" id="([^"]+)"( hidden)?>/g)].map(([, id, hidden]) => ({ id, ...element(Boolean(hidden)) }));
  const line = noMatch(html)!;
  const none = element(line.hidden, line.text);
  const listeners: Record<string, ((event: { preventDefault(): void }) => void)[]> = { input: [], submit: [] };
  const on = (type: string, listener: (event: { preventDefault(): void }) => void) => listeners[type].push(listener);
  const field = {
    value: text(/<input type="search" name="filter" value="([^"]*)"/.exec(html)![1]),
    addEventListener: (type: string, listener: () => void) => (assert.equal(type, 'input'), on(type, listener)),
    form: { addEventListener: (type: string, listener: () => void) => (assert.equal(type, 'submit'), on(type, listener)) },
  };
  const location = { href: address };
  const document = {
    querySelector: (selector: string) => ({ '.filter input[type=search]': field, '.no-match': none })[selector],
    querySelectorAll: (selector: string) => ({ '.list li:not(.group)': items, '.details .detail': sections })[selector],
  };
  const history = { replaceState: (_state: unknown, _title: string, url: URL) => (location.href = String(url)) };
  runInNewContext(script, { document, location, history, URL });
  return {
    type(value: string) {
      field.value = value;
      for (const listener of listeners.input) listener({ preventDefault() {} });
    },
    /** Enter in the field: whether the form is still submitted, a new request. */
    enter() {
      let submitted = true;
      for (const listener of listeners.submit) listener({ preventDefault: () => (submitted = false) });
      return submitted;
    },
    anchors: () => items.filter((item) => !item.hidden).map((item) => item.anchor),
    shown: () => items.filter((item) => !item.hidden).map((item) => item.name.textContent),
    sections: () => sections.filter((section) => !section.hidden).map((section) => section.id),
    none: () => ({ hidden: none.hidden, text: none.textContent }),
    address: () => location.href,
  };
}

test('filter on the fly: as the word is typed, only the skills whose names contain it, with no request', async () => {
  const address = `${base}?repo=github.com%2FJetBrains%2Ffixture#skill-commits`;
  const page = browse((await view('github.com/JetBrains/fixture')).html, address);
  requests.length = 0;
  page.type('C');
  assert.deepEqual(page.shown(), ['code-style', 'commits', 'release-checklist']);
  page.type('CO');
  assert.deepEqual(page.shown(), ['code-style', 'commits']);
  assert.deepEqual(page.sections(), ['skill-code-style', 'skill-commits']);
  assert.equal(page.none().hidden, true);
  // The address keeps the word, the repository and the selected skill: a link to share.
  assert.equal(page.address(), `${base}?repo=github.com%2FJetBrains%2Ffixture&filter=CO#skill-commits`);
  // Empty, or only spaces: every skill, and no filter in the address.
  page.type('  ');
  assert.equal(page.shown().length, 4);
  assert.equal(page.address(), address);
  // Enter submits nothing: the list is already filtered.
  page.type('co');
  assert.equal(page.enter(), false);
  assert.deepEqual(requests, []);
});

test('filter on the fly: no match → "No skills match", the field still there; back to the matches as the word changes', async () => {
  const html = (await filtered('github.com/JetBrains/fixture', 'co')).html;
  const page = browse(html, `${base}?repo=github.com%2FJetBrains%2Ffixture&filter=co`);
  page.type(' <b>"x"</b> ');
  assert.deepEqual(page.shown(), []);
  assert.deepEqual(page.sections(), []);
  // textContent: the word is text, never markup.
  assert.deepEqual(page.none(), { hidden: false, text: 'No skills match “<b>"x"</b>”.' });
  page.type('test');
  assert.deepEqual(page.shown(), ['testing']);
  assert.equal(page.none().hidden, true);
});

test('filter on the fly: several words → only the skills whose names contain every one', async () => {
  const page = browse((await view('github.com/JetBrains/fixture')).html, `${base}?repo=github.com%2FJetBrains%2Ffixture`);
  page.type('co');
  assert.deepEqual(page.shown(), ['code-style', 'commits']);
  page.type('co ');
  assert.deepEqual(page.shown(), ['code-style', 'commits']);
  page.type('co st');
  assert.deepEqual(page.shown(), ['code-style']);
  assert.deepEqual(page.sections(), ['skill-code-style']);
  assert.equal(page.address(), `${base}?repo=github.com%2FJetBrains%2Ffixture&filter=co+st`);
  page.type('co st x');
  assert.deepEqual(page.shown(), []);
  assert.deepEqual(page.none(), { hidden: false, text: 'No skills match “co st x”.' });
});

test('filter on the fly: the same skills as the filter in the request', async () => {
  for (const word of ['', 'CO', 'm', 'review', 'push', 'zzz', 'Release-', 'co st', ' ST\tCO ', 'e  t', 'co xyz']) {
    const served = await filtered('github.com/JetBrains/fixture', word);
    const page = browse((await view('github.com/JetBrains/fixture')).html, base);
    page.type(word);
    assert.deepEqual(page.shown(), list(served.html).map((item) => item.name), word);
    assert.deepEqual(page.sections(), [...details(served.html).keys()], word);
  }
  // `.` drops `a-b`, the first of two names with the same anchor: `a.b` keeps its whole-list anchor.
  const anchor = browse((await view('https://github.com/JetBrains/same-anchor')).html, base);
  anchor.type('.');
  assert.deepEqual(anchor.anchors(), ['skill-a-b-2']);
  assert.deepEqual(anchor.sections(), ['skill-a-b-2']);
  const same = browse((await view('https://github.com/JetBrains/same-name')).html, base);
  same.type('VIEW');
  assert.deepEqual(same.sections(), ['skill-review', 'skill-review-2']);
});
