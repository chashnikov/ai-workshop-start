// The decisions in spec/web.md, checked on the pages the web view serves for ./fixture, as if it
// were on GitHub, and for small GitHub repositories answered in tests/helpers.ts and below.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative } from 'node:path';
import { after, test } from 'node:test';
import { openGitHub, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';
import { CLI, EXAMPLE, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** What GitHub answers for JetBrains/<name>: a tree of the files, and the files at COMMIT. */
function onGitHub(name: string, files: Record<string, string>): Recording {
  const recording: Recording = {
    [`https://api.github.com/repos/JetBrains/${name}`]: { status: 200, body: { full_name: `JetBrains/${name}`, default_branch: 'main' } },
    [`https://api.github.com/repos/JetBrains/${name}/commits/main`]: { status: 200, body: { sha: COMMIT } },
    [`https://api.github.com/repos/JetBrains/${name}/git/trees/${COMMIT}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  };
  for (const [path, body] of Object.entries(files)) {
    recording[`https://raw.githubusercontent.com/JetBrains/${name}/${COMMIT}/${path}`] = { status: 200, body };
  }
  return recording;
}

/** ./fixture, as if it were JetBrains/fixture. */
function fixtureOnGitHub(): Recording {
  const paths = (readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return onGitHub('fixture', Object.fromEntries(paths.map((path) => [path, readFileSync(join(FIXTURE, path), 'utf8')])));
}

/** A skill whose front matter and content are markup. */
const MARKUP = onGitHub('markup', {
  '.claude/skills/markup/SKILL.md': '---\nname: "<b>markup</b>"\ndescription: Says "<img src=x onerror=alert(1)>".\n---\n<script>alert(1)</script>\n',
});

/** Two skills that call themselves the same in their front matter. */
const SAME_NAME = onGitHub('same-name', {
  '.claude/skills/one/SKILL.md': '---\nname: review\ndescription: The first.\n---\nOne.\n',
  '.claude/skills/two/SKILL.md': '---\nname: review\ndescription: The second.\n---\nTwo.\n',
});

/** No skills at all. */
const EMPTY = onGitHub('empty', { 'README.md': '# Empty\n' });

const requests: string[] = [];
const github = replay({ ...EXAMPLE, ...fixtureOnGitHub(), ...MARKUP, ...SAME_NAME, ...EMPTY });
const counted: Fetch = (url, init) => {
  requests.push(url);
  return github(url, init);
};
// Code search for JetBrains/example, as EXAMPLE answers it; the tree for the others.
const server = createWebServer({
  open: (input) => openGitHub(input, { fetch: counted, token: /example/.test(input) ? 'test' : undefined }),
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

/** The left column: each skill's anchor, name and summary. */
function list(html: string) {
  const nav = /<nav class="list">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<a href="#([^"]+)"><span class="name">(.*?)<\/span>(?:<span class="summary">(.*?)<\/span>)?<\/a>/g)].map(
    ([, anchor, name, summary]) => ({ anchor, name, summary }),
  );
}

/** The right column: each skill's section, by anchor. */
function details(html: string): Map<string, string> {
  const column = /<div class="details">([\s\S]*)<\/div>\s*<\/div>/.exec(html)?.[1] ?? '';
  return new Map([...column.matchAll(/<section class="detail" id="([^"]+)">([\s\S]*?)<\/section>/g)].map(([, id, section]) => [id, section]));
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
  assert.doesNotMatch(page.html, /<script/);
  // Only the selected section is shown: the targeted one, else the first one.
  assert.match(page.html, /\.detail \{ display: none;/);
  assert.match(page.html, /\.detail:target, \.details:not\(:has\(\.detail:target\)\) \.detail:first-child \{ display: block; \}/);
  // Its item in the list is highlighted the same way.
  for (const { anchor } of list(page.html)) {
    assert.ok(page.html.includes(`body:has(#${anchor}:target) .list a[href="#${anchor}"]`), anchor);
  }
  assert.match(page.html, /\.skills:not\(:has\(\.detail:target\)\) \.list li:first-child a \{ background/);
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
  assert.doesNotMatch(page.html, /<script>|<img|<b>/);
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

test('another path → 404; another method → 405', async () => {
  const missing = await get('skills');
  assert.equal(missing.status, 404);
  assert.equal(text(missing.html), 'Not found: /skills');
  const posted = await get('', { method: 'POST' });
  assert.equal(posted.status, 405);
  assert.equal(text(posted.html), 'Only GET is supported');
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

test('skill-atlas serve: a bad or taken port → a clear message, exit code 1', async (t) => {
  const bad = spawnSync(process.execPath, [CLI, 'serve', '--port', 'x'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.equal(bad.stderr, 'Not a port: x\nUsage: skill-atlas serve [--port <port>]\n');

  const taken = createServer();
  t.after(() => taken.close());
  const port = new URL(await listen(taken)).port;
  const busy = spawnSync(process.execPath, [CLI, 'serve', '--port', port], { encoding: 'utf8' });
  assert.equal(busy.status, 1);
  assert.match(busy.stderr, new RegExp(`^Cannot start the web view on port ${port}: .*EADDRINUSE`));
});
