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

/** ./fixture as GitHub answers it for JetBrains/fixture: its tree, and its files at COMMIT. */
function fixtureOnGitHub(): Recording {
  const paths = (readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  const recording: Recording = {
    'https://api.github.com/repos/JetBrains/fixture': { status: 200, body: { full_name: 'JetBrains/fixture', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/fixture/commits/main': { status: 200, body: { sha: COMMIT } },
    [`https://api.github.com/repos/JetBrains/fixture/git/trees/${COMMIT}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  };
  for (const path of paths) {
    recording[`https://raw.githubusercontent.com/JetBrains/fixture/${COMMIT}/${path}`] = {
      status: 200,
      body: readFileSync(join(FIXTURE, path), 'utf8'),
    };
  }
  return recording;
}

/** A skill whose front matter and content are markup. */
const MARKUP: Recording = {
  'https://api.github.com/repos/JetBrains/markup': { status: 200, body: { full_name: 'JetBrains/markup', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/markup/commits/main': { status: 200, body: { sha: COMMIT } },
  [`https://api.github.com/repos/JetBrains/markup/git/trees/${COMMIT}?recursive=1`]: {
    status: 200,
    body: { truncated: false, tree: [{ path: '.claude/skills/markup/SKILL.md', mode: '100644', type: 'blob', sha: COMMIT }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/markup/${COMMIT}/.claude/skills/markup/SKILL.md`]: {
    status: 200,
    body: '---\nname: "<b>markup</b>"\ndescription: Says "<img src=x onerror=alert(1)>".\n---\n<script>alert(1)</script>\n',
  },
};

const requests: string[] = [];
const github = replay({ ...EXAMPLE, ...fixtureOnGitHub(), ...MARKUP });
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

test('a repository: its id, linked, the commit, and each skill with its description, pinned link and content', async () => {
  const page = await view('https://github.com/JetBrains/example');
  assert.equal(page.status, 200);
  assert.match(page.html, /name="repo" value="https:\/\/github.com\/JetBrains\/example"/);
  assert.match(page.html, /<h2 class="repository"><a href="https:\/\/github.com\/JetBrains\/example">JetBrains\/example<\/a> · 1 skill at <code>5ab6270<\/code>/);
  assert.match(page.html, /<p class="description">Write commit messages the way this repository does. Use for every commit.<\/p>/);
  assert.ok(page.html.includes(`<a href="https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md">`));
  assert.match(page.html, /<pre class="content"># Commits<\/pre>/);
});

test('./fixture on GitHub: every skill, sorted by name, with copies, contents, a table of contents and the warning', async () => {
  const page = await view('github.com/JetBrains/fixture');
  assert.equal(page.status, 200);
  assert.deepEqual([...page.html.matchAll(/<h3>(.*?)<\/h3>/g)].map((match) => match[1]), [
    'code-style',
    'commits',
    'release-checklist',
    'testing',
  ]);
  assert.deepEqual([...page.html.matchAll(/<nav>.*?<\/nav>/gs)][0][0].match(/href="#skill-[^"]+"/g), [
    'href="#skill-code-style"',
    'href="#skill-commits"',
    'href="#skill-release-checklist"',
    'href="#skill-testing"',
  ]);
  assert.match(page.html, /<p class="copies">also in <code>.github\/skills\/code-style\/SKILL.md<\/code><\/p>/);
  assert.ok(text(page.html).includes('Start with the area, then say what changed: `editor: keep the caret after undo`.'));
  assert.match(page.html, /<li>warning: .agents\/skills\/release-checklist\/SKILL.md: malformed front matter: [^<]*<\/li>/);
  assert.doesNotMatch(page.html, /not-a-skill/);
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
