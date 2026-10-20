// The decisions in spec/analysis.md#organization, spec/cli.md#organization and spec/web.md#organization,
// checked on what the commands print and the pages the web view serves for small organizations
// answered below.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubOrganizationUrl, parseGitHubUrl, scanOrganization } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';

const API = 'https://api.github.com';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill. More about it.\n---\n# ${name}\n`;

/** What GitHub answers for an organization's, or a user's, login. */
function owner(login: string, type: 'Organization' | 'User'): Recording {
  return { [`${API}/users/${login}`]: { status: 200, body: { login, type } } };
}

/** The repositories' list, 100 a page, as GitHub pages it. */
function list(url: string, repositories: { id: string; branch?: string }[]): Recording {
  const recording: Recording = {};
  for (let page = 1; page === 1 || (page - 1) * 100 <= repositories.length; page++) {
    const items = repositories.slice((page - 1) * 100, page * 100).map(({ id, branch = 'main' }) => ({ full_name: id, default_branch: branch }));
    recording[`${url}&per_page=100&page=${page}`] = { status: 200, body: items };
    if (items.length < 100) break;
  }
  return recording;
}

/** A repository's tree at its default branch, for listing it in its organization. */
function tree(id: string, paths: string[], branch = 'main'): Recording {
  return {
    [`${API}/repos/${id}/git/trees/${branch}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  };
}

/** A repository, for scanning it: its default branch at COMMIT, its tree and its files. */
function repository(id: string, files: Record<string, string>): Recording {
  const recording: Recording = {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: COMMIT } },
    [`${API}/repos/${id}/git/trees/${COMMIT}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  };
  for (const [path, body] of Object.entries(files)) {
    recording[`https://raw.githubusercontent.com/${id}/${COMMIT}/${path}`] = { status: 200, body };
  }
  return recording;
}

const TOOLS = {
  '.claude/skills/review/SKILL.md': skill('review'),
  '.agents/skills/review/SKILL.md': skill('review'),
  '.github/skills/testing/SKILL.md': skill('testing'),
  'docs/skills/not-a-skill/SKILL.md': skill('not-a-skill'),
  'README.md': '# Tools\n',
};

/**
 * Acme, an organization: Acme/tools with two skills (one with a copy), Acme/agents with one on a
 * `release/1` branch, Acme/docs with none, and Acme/empty, which GitHub cannot list.
 */
const ACME: Recording = {
  ...owner('Acme', 'Organization'),
  ...list(`${API}/orgs/Acme/repos?type=all`, [{ id: 'Acme/tools' }, { id: 'Acme/docs' }, { id: 'Acme/empty' }, { id: 'Acme/agents', branch: 'release/1' }]),
  ...tree('Acme/tools', Object.keys(TOOLS)),
  ...tree('Acme/docs', ['README.md', 'skills/SKILL.md']),
  [`${API}/repos/Acme/empty/git/trees/main?recursive=1`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  ...tree('Acme/agents', ['agent/skills/deploy/SKILL.md'], 'release/1'),
  ...repository('Acme/tools', TOOLS),
  // With a token: one code search over the organization, which finds other files named SKILL.md too.
  [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: {
    status: 200,
    body: {
      total_count: 5,
      items: [
        ...['.claude/skills/review/SKILL.md', '.agents/skills/review/SKILL.md', '.github/skills/testing/SKILL.md', 'docs/skills/not-a-skill/SKILL.md'].map(
          (path) => ({ path, repository: { full_name: 'Acme/tools' } }),
        ),
        { path: 'agent/skills/deploy/SKILL.md', repository: { full_name: 'Acme/agents' } },
        { path: 'skills/SKILL.md', repository: { full_name: 'Acme/docs' } },
      ],
    },
  },
};

/** octo, a user: the user's own repositories, and `user:` in the code search. */
const OCTO: Recording = {
  ...owner('octo', 'User'),
  ...list(`${API}/users/octo/repos?type=owner`, [{ id: 'octo/dotfiles' }]),
  ...tree('octo/dotfiles', ['.claude/skills/shell/SKILL.md']),
  [`${API}/search/code?q=filename:SKILL.md+user:octo&per_page=100&page=1`]: {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/shell/SKILL.md', repository: { full_name: 'octo/dotfiles' } }] },
  },
};

/** Plain, an organization whose repositories have no skills. */
const PLAIN: Recording = {
  ...owner('Plain', 'Organization'),
  ...list(`${API}/orgs/Plain/repos?type=all`, [{ id: 'Plain/site' }]),
  ...tree('Plain/site', ['README.md']),
};

const NOBODY: Recording = { [`${API}/users/Nobody`]: { status: 404, body: { message: 'Not Found' } } };

const github = replay({ ...ACME, ...OCTO, ...PLAIN, ...NOBODY });

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from the recordings above. */
async function atlas(args: string[], fetch = github, token?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open: (input) => openGitHub(input, { fetch, token }),
    organization: (input) => scanOrganization(input, { fetch, token }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const ACME_OUTPUT = [
  'Acme · 2 repositories with skills',
  'Acme/agents · 1 skill',
  '  https://github.com/Acme/agents',
  'Acme/tools · 2 skills',
  '  https://github.com/Acme/tools',
].join('\n');

test('an organization URL: github.com/<organization> or github.com/orgs/<organization>; a repository URL is not one', () => {
  for (const input of ['https://github.com/Acme', 'github.com/Acme/', 'http://www.github.com/orgs/Acme', ' https://github.com/orgs/Acme/ ']) {
    assert.equal(parseGitHubOrganizationUrl(input), 'Acme', input);
  }
  for (const input of ['https://github.com/Acme/tools', 'https://github.com/', 'https://gitlab.com/Acme', './Acme']) {
    assert.equal(parseGitHubOrganizationUrl(input), undefined, input);
  }
  assert.deepEqual(parseGitHubUrl('https://github.com/Acme/tools'), { owner: 'Acme', repo: 'tools' });
});

test('scan <organization URL>: only the repositories with skills, sorted by id, with their number of skills', async () => {
  const result = await atlas(['scan', 'https://github.com/Acme']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ACME_OUTPUT);
  // Acme/docs has no skill: skills/SKILL.md is not in a skill root.
  assert.doesNotMatch(result.stdout, /Acme\/docs|Acme\/empty/);
});

test('scan <organization URL>: a repository that cannot be listed is a warning, and the scan goes on', async () => {
  const result = await atlas(['scan', 'https://github.com/orgs/Acme']);
  assert.equal(result.code, 0);
  assert.equal(
    result.stderr,
    `warning: Acme/empty: cannot be listed: GitHub answered 409 for ${API}/repos/Acme/empty/git/trees/main?recursive=1: Git Repository is empty.; skipped`,
  );
});

test('scan <organization URL> with GITHUB_TOKEN: one code search over the organization, the same repositories', async () => {
  const requests: string[] = [];
  const result = await atlas(['scan', 'https://github.com/Acme'], (url, init) => (requests.push(url), github(url, init)), 'test');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ACME_OUTPUT);
  assert.equal(result.stderr, '');
  assert.deepEqual(requests, [`${API}/users/Acme`, `${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]);
});

test("a user's URL: the user's own repositories, with or without GITHUB_TOKEN", async () => {
  const expected = ['octo · 1 repository with skills', 'octo/dotfiles · 1 skill', '  https://github.com/octo/dotfiles'].join('\n');
  assert.equal((await atlas(['scan', 'https://github.com/octo'])).stdout, expected);
  assert.equal((await atlas(['scan', 'https://github.com/octo'], github, 'test')).stdout, expected);
});

test('an organization with more than 100 repositories: every page of them', async () => {
  const repositories = Array.from({ length: 150 }, (_, n) => ({ id: `Many/r${String(n).padStart(3, '0')}` }));
  const many = replay({
    ...owner('Many', 'Organization'),
    ...list(`${API}/orgs/Many/repos?type=all`, repositories),
    ...Object.assign({}, ...repositories.map(({ id }) => tree(id, id === 'Many/r149' ? ['.claude/skills/last/SKILL.md'] : []))),
  });
  const result = await atlas(['scan', 'https://github.com/Many'], many);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['Many · 1 repository with skills', 'Many/r149 · 1 skill', '  https://github.com/Many/r149'].join('\n'));
});

test('GITHUB_TOKEN: at most 1000 SKILL.md files from the code search, a warning for the rest', async () => {
  const recording: Recording = owner('Huge', 'Organization');
  for (let page = 1; page <= 10; page++) {
    const items = Array.from({ length: 100 }, (_, n) => ({ path: `.claude/skills/s${(page - 1) * 100 + n}/SKILL.md`, repository: { full_name: 'Huge/skills' } }));
    recording[`${API}/search/code?q=filename:SKILL.md+org:Huge&per_page=100&page=${page}`] = { status: 200, body: { total_count: 1500, items } };
  }
  const result = await atlas(['scan', 'https://github.com/Huge'], replay(recording), 'test');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Huge\/skills · 1000 skills$/m);
  assert.equal(result.stderr, 'warning: GitHub returns at most 1000 SKILL.md files; 500 more were left out');
});

test('the rate limit → the clear message, the scan stops, exit code 1', async () => {
  const limited = replay({
    ...owner('Limited', 'Organization'),
    ...list(`${API}/orgs/Limited/repos?type=all`, [{ id: 'Limited/a' }, { id: 'Limited/b' }]),
    [`${API}/repos/Limited/a/git/trees/main?recursive=1`]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
    ...tree('Limited/b', ['.claude/skills/b/SKILL.md']),
  });
  const result = await atlas(['scan', 'https://github.com/Limited'], limited);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});

test('unknown organization → a clear message, exit code 1', async () => {
  const result = await atlas(['scan', 'https://github.com/Nobody']);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'Organization not found: https://github.com/Nobody');
});

// The web view.

const server = createWebServer({
  open: (input) => openGitHub(input, { fetch: github }),
  organization: (input) => scanOrganization(input, { fetch: github }),
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
after(() => {
  server.closeAllConnections();
  server.close();
});

async function get(query: string) {
  const response = await fetch(`${base}?${query}`);
  return { status: response.status, html: await response.text() };
}

/** The chooser: its organization, and each option's value, text and whether it is selected. */
function chooser(html: string) {
  const form = /<form class="chooser" method="get" action="\/">([\s\S]*?)<\/form>/.exec(html)?.[1];
  if (form === undefined) return undefined;
  return {
    org: /<input type="hidden" name="org" value="([^"]*)">/.exec(form)?.[1],
    button: /<button type="submit">([^<]*)<\/button>/.exec(form)?.[1],
    options: [...form.matchAll(/<option value="([^"]*)"( selected)?( disabled)?>([^<]*)<\/option>/g)].map(([, value, selected, , text]) => ({
      value,
      text,
      selected: Boolean(selected),
    })),
  };
}

test('web: an organization URL → its id, linked, the number of repositories with skills, and a chooser', async () => {
  const page = await get(`repo=${encodeURIComponent('https://github.com/Acme')}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /<h2 class="organization"><a href="https:\/\/github.com\/Acme">Acme<\/a> · 2 repositories with skills<\/h2>/);
  assert.match(page.html, /<ul class="warnings"><li>warning: Acme\/empty: cannot be listed: [^<]*<\/li><\/ul>/);
  assert.deepEqual(chooser(page.html), {
    org: 'https://github.com/Acme',
    button: 'Show skills',
    options: [
      { value: '', text: 'Choose a repository', selected: true },
      { value: 'https://github.com/Acme/agents', text: 'Acme/agents · 1 skill', selected: false },
      { value: 'https://github.com/Acme/tools', text: 'Acme/tools · 2 skills', selected: false },
    ],
  });
  // Nothing chosen yet: no skills, and no script.
  assert.doesNotMatch(page.html, /<script|class="skills"/);
});

test('web: choosing a repository → the chooser again, the repository chosen, then its skills', async () => {
  const page = await get(`org=${encodeURIComponent('https://github.com/Acme')}&repo=${encodeURIComponent('https://github.com/Acme/tools')}`);
  assert.equal(page.status, 200);
  const chosen = chooser(page.html);
  assert.deepEqual(
    chosen?.options.filter((option) => option.selected),
    [{ value: 'https://github.com/Acme/tools', text: 'Acme/tools · 2 skills', selected: true }],
  );
  assert.ok(page.html.indexOf('class="chooser"') < page.html.indexOf('class="repository"'));
  assert.match(page.html, /<h2 class="repository"><a href="https:\/\/github.com\/Acme\/tools">Acme\/tools<\/a> · 2 skills at <code>0123456<\/code>/);
  assert.deepEqual(
    [...page.html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map(([, name]) => name),
    ['review', 'testing'],
  );
  // The filter keeps the organization: Enter without the script asks for the chooser again.
  assert.match(page.html, /<form class="filter" method="get" action="\/">\n<input type="hidden" name="org" value="https:\/\/github.com\/Acme">/);
});

test('web: no repository with skills → "No repositories with skills found.", no chooser', async () => {
  const page = await get(`repo=${encodeURIComponent('github.com/Plain')}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /Plain<\/a> · 0 repositories with skills<\/h2>\n\n<p class="empty">No repositories with skills found.<\/p>/);
  assert.equal(chooser(page.html), undefined);
});

test('web: unknown organization → the clear message on the page, status 400', async () => {
  const page = await get(`repo=${encodeURIComponent('https://github.com/Nobody')}`);
  assert.equal(page.status, 400);
  assert.match(page.html, /<p class="error">Organization not found: https:\/\/github.com\/Nobody<\/p>/);
  const chosen = await get(`org=${encodeURIComponent('https://github.com/Acme/tools')}&repo=${encodeURIComponent('https://github.com/Acme/tools')}`);
  assert.equal(chosen.status, 400);
  assert.match(chosen.html, /<p class="error">Not a GitHub organization URL: https:\/\/github.com\/Acme\/tools<\/p>/);
});
