// The decisions in spec/analysis.md#organization, spec/cli.md#organization and spec/web.md#organization,
// checked on what the commands print and the pages the web view serves for small organizations
// answered below.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { after, test } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubOrganizationUrl, parseGitHubUrl, scanOrganization, type Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { createWebServer } from '../src/web.ts';

const API = 'https://api.github.com';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const skill = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill. More about it.\n---\n# ${name}\n`;

/** What GitHub answers for an organization's, or a user's, login. */
function owner(login: string, type: 'Organization' | 'User'): Recording {
  return { [`${API}/users/${login}`]: { status: 200, body: { login, type } } };
}

/** The repositories' list, 100 a page, as GitHub pages it. */
function list(url: string, repositories: { id: string; branch?: string; fork?: boolean }[]): Recording {
  const recording: Recording = {};
  for (let page = 1; page === 1 || (page - 1) * 100 <= repositories.length; page++) {
    const items = repositories.slice((page - 1) * 100, page * 100).map(({ id, branch = 'main', fork = false }) => ({ full_name: id, default_branch: branch, fork }));
    recording[`${url}&per_page=100&page=${page}`] = { status: 200, body: items };
    if (items.length < 100) break;
  }
  return recording;
}

/** A repository's tree at its default branch, or at a commit, for listing it in its organization. */
function tree(id: string, paths: string[], ref = 'main'): Recording {
  return {
    [`${API}/repos/${id}/git/trees/${ref}?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  };
}

/** A repository, for scanning it: its default branch at COMMIT, its tree and its files. */
function repository(id: string, files: Record<string, string>, branch = 'main'): Recording {
  const recording: Recording = {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: branch } },
    [`${API}/repos/${id}/commits/${branch}`]: { status: 200, body: { sha: COMMIT } },
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
 * `release/1` branch, Acme/docs with none, Acme/empty, which GitHub cannot list, and Acme/forked, a
 * fork: nothing is recorded for it, so asking GitHub about it fails.
 */
const ACME: Recording = {
  ...owner('Acme', 'Organization'),
  ...list(`${API}/orgs/Acme/repos?type=all`, [{ id: 'Acme/tools' }, { id: 'Acme/docs' }, { id: 'Acme/empty' }, { id: 'Acme/agents', branch: 'release/1' }, { id: 'Acme/forked', fork: true }]),
  ...tree('Acme/tools', Object.keys(TOOLS)),
  ...tree('Acme/docs', ['README.md', 'skills/SKILL.md']),
  [`${API}/repos/Acme/empty/git/trees/main?recursive=1`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  // A branch name with `/`: resolved to its commit first.
  [`${API}/repos/Acme/agents/commits/release/1`]: { status: 200, body: { sha: COMMIT } },
  ...tree('Acme/agents', ['agent/skills/deploy/SKILL.md'], COMMIT),
  // For reading their skills: each repository with skills at its commit.
  ...repository('Acme/tools', TOOLS),
  ...repository('Acme/agents', { 'agent/skills/deploy/SKILL.md': skill('deploy') }, 'release/1'),
  // With a token: a code search over the organization, which finds other files named SKILL.md too,
  // and leaves out forks.
  [`${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`]: {
    status: 200,
    body: {
      total_count: 6,
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

/** Limited, an organization GitHub stops answering for: the rate limit. */
const LIMITED: Recording = {
  ...owner('Limited', 'Organization'),
  ...list(`${API}/orgs/Limited/repos?type=all`, [{ id: 'Limited/a' }, { id: 'Limited/b' }]),
  [`${API}/repos/Limited/a/git/trees/main?recursive=1`]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  ...tree('Limited/b', ['.claude/skills/b/SKILL.md']),
};

/** Half: the skills of Half/gone cannot be read as it is listed (its branch is gone); a scan of it finds them. */
const HALF: Recording = {
  ...owner('Half', 'Organization'),
  ...list(`${API}/orgs/Half/repos?type=all`, [{ id: 'Half/gone' }, { id: 'Half/here' }]),
  ...tree('Half/gone', ['.claude/skills/a/SKILL.md']),
  ...tree('Half/here', ['.claude/skills/b/SKILL.md']),
  [`${API}/repos/Half/gone/commits/main`]: { status: 409, body: { message: 'Git Repository is empty.' } },
  ...repository('Half/gone', { '.claude/skills/a/SKILL.md': skill('a') }, 'trunk'),
  ...repository('Half/here', { '.claude/skills/b/SKILL.md': skill('b') }),
};

const NOBODY: Recording = { [`${API}/users/Nobody`]: { status: 404, body: { message: 'Not Found' } } };

const github = replay({ ...ACME, ...OCTO, ...PLAIN, ...LIMITED, ...HALF, ...NOBODY });

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from the recordings above. */
async function atlas(args: string[], fetch = github, token?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const progress: string[] = [];
  const code = await run(args, {
    open: (input) => openGitHub(input, { fetch, token }),
    organization: (input, progress) => scanOrganization(input, { fetch, token, progress }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
    progress: (text) => progress.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n'), progress };
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

test('scan <organization URL>: forks are not processed, with or without GITHUB_TOKEN', async () => {
  for (const token of [undefined, 'test']) {
    const requests: string[] = [];
    const result = await atlas(['scan', 'https://github.com/Acme'], (url, init) => (requests.push(url), github(url, init)), token);
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /Acme\/forked/);
    assert.deepEqual(requests.filter((url) => url.includes('Acme/forked') || url.includes('fork:')), []);
  }
});

test('scan <organization URL>: a repository that cannot be listed is a warning, and the scan goes on', async () => {
  const result = await atlas(['scan', 'https://github.com/orgs/Acme']);
  assert.equal(result.code, 0);
  assert.equal(
    result.stderr,
    `warning: Acme/empty: cannot be listed: GitHub answered 409 for ${API}/repos/Acme/empty/git/trees/main?recursive=1: Git Repository is empty.; skipped`,
  );
});

test('scan <organization URL> with GITHUB_TOKEN: a code search over the organization, the same repositories', async () => {
  const requests: string[] = [];
  const result = await atlas(['scan', 'https://github.com/Acme'], (url, init) => (requests.push(url), github(url, init)), 'test');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ACME_OUTPUT);
  assert.equal(result.stderr, '');
  assert.deepEqual(requests, [
    `${API}/users/Acme`,
    `${API}/search/code?q=filename:SKILL.md+org:Acme&per_page=100&page=1`,
  ]);
});

test('GITHUB_TOKEN: a code search that timed out → what it found, and a warning', async () => {
  const timedOut = replay({
    ...owner('Slow', 'Organization'),
    [`${API}/search/code?q=filename:SKILL.md+org:Slow&per_page=100&page=1`]: {
      status: 200,
      body: { total_count: 1, incomplete_results: true, items: [{ path: '.claude/skills/a/SKILL.md', repository: { full_name: 'Slow/a' } }] },
    },
  });
  const result = await atlas(['scan', 'https://github.com/Slow'], timedOut, 'test');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Slow\/a · 1 skill$/m);
  assert.equal(result.stderr, 'warning: GitHub code search timed out; some SKILL.md files may be missing');
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

test('a repository whose tree is too large: only its skill roots, its root tree asked for once, and a warning', async () => {
  const entries = (items: { path: string; type: string; sha: string }[]) => ({ status: 200, body: { truncated: false, tree: items.map((item) => ({ mode: '100644', ...item })) } });
  const recording = replay({
    ...owner('Big', 'Organization'),
    ...list(`${API}/orgs/Big/repos?type=all`, [{ id: 'Big/mono' }]),
    [`${API}/repos/Big/mono/git/trees/main?recursive=1`]: { status: 200, body: { truncated: true, tree: [] } },
    [`${API}/repos/Big/mono/git/trees/main`]: entries([{ path: '.claude', type: 'tree', sha: 'claude' }]),
    [`${API}/repos/Big/mono/git/trees/claude`]: entries([{ path: 'skills', type: 'tree', sha: 'skills' }]),
    [`${API}/repos/Big/mono/git/trees/skills?recursive=1`]: entries([{ path: 'build/SKILL.md', type: 'blob', sha: COMMIT }]),
  });
  const requests: string[] = [];
  const result = await atlas(['scan', 'https://github.com/Big'], (url, init) => (requests.push(url), recording(url, init)));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['Big · 1 repository with skills', 'Big/mono · 1 skill', '  https://github.com/Big/mono'].join('\n'));
  assert.match(result.stderr, /^warning: Big\/mono: the tree is too large to list at once; looked only in \.agents\/skills, /);
  assert.equal(requests.filter((url) => url === `${API}/repos/Big/mono/git/trees/main`).length, 1);
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
  const result = await atlas(['scan', 'https://github.com/Limited']);
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
});

test('the rate limit: the other repositories being listed finish, no more are asked for', async () => {
  const repositories = Array.from({ length: 20 }, (_, n) => ({ id: `Busy/r${String(n).padStart(2, '0')}` }));
  const recording = replay({
    ...owner('Busy', 'Organization'),
    ...list(`${API}/orgs/Busy/repos?type=all`, repositories),
    [`${API}/repos/Busy/r00/git/trees/main?recursive=1`]: { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
    ...Object.assign({}, ...repositories.slice(1).map(({ id }) => tree(id, []))),
  });
  const trees: string[] = [];
  // The rate limit answers at once; the other trees a little later.
  const busy: typeof github = async (url, init) => {
    if (url.includes('/git/trees/')) {
      trees.push(url);
      if (!url.includes('/r00/')) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return recording(url, init);
  };
  const result = await atlas(['scan', 'https://github.com/Busy'], busy);
  assert.equal(result.stderr, 'GitHub rate limit reached; set GITHUB_TOKEN');
  await new Promise((resolve) => setTimeout(resolve, 100));
  // Eight at a time: the first eight, and none after them.
  assert.equal(trees.length, 8);
});

test('unknown organization → a clear message, exit code 1', async () => {
  const result = await atlas(['scan', 'https://github.com/Nobody']);
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'Organization not found: https://github.com/Nobody');
});

test('scan <organization URL>: the progress as it goes, cleared before the result', async () => {
  const result = await atlas(['scan', 'https://github.com/Acme']);
  assert.deepEqual(result.progress, [
    'Listing the repositories of Acme…',
    ...[0, 1, 2, 3, 4].map((done) => `Listed ${done} of 4 repositories of Acme…`),
    '',
  ]);
  const searched = await atlas(['scan', 'https://github.com/Acme'], github, 'test');
  assert.deepEqual(searched.progress, ['Searching the repositories of Acme for SKILL.md files…', '']);
  // A failure clears it too.
  assert.deepEqual((await atlas(['scan', 'https://github.com/Nobody'])).progress, ['']);
});

test('reading the skills as the organization is scanned: each repository as a scan of it shows it, pinned to its commit', async () => {
  const progress: string[] = [];
  const result = await scanOrganization('https://github.com/Acme', { fetch: github, read: true, progress: (message) => progress.push(message) });
  const tools = result.repositories.find((repository) => repository.id === 'Acme/tools')!;
  assert.deepEqual(tools.result, await scan(await openGitHub('https://github.com/Acme/tools', { fetch: github })));
  assert.deepEqual(
    result.repositories.map(({ id, skills, result }) => ({ id, skills, names: result?.skills.map((skill) => `${skill.name}@${skill.commit}`) })),
    [
      { id: 'Acme/agents', skills: 1, names: [`deploy@${COMMIT}`] },
      { id: 'Acme/tools', skills: 2, names: [`review@${COMMIT}`, `testing@${COMMIT}`] },
    ],
  );
  assert.deepEqual(progress.slice(-3), [0, 1, 2].map((done) => `Read the skills of ${done} of 2 repositories…`));
});

test('reading the skills: a repository that cannot be read is a warning, still listed, and the scan goes on', async () => {
  const result = await scanOrganization('https://github.com/Half', { fetch: github, read: true });
  assert.deepEqual(
    result.repositories.map(({ id, skills, result }) => ({ id, skills, read: Boolean(result) })),
    [
      { id: 'Half/gone', skills: 1, read: false },
      { id: 'Half/here', skills: 1, read: true },
    ],
  );
  assert.deepEqual(result.warnings, [`Half/gone: its skills cannot be read: GitHub answered 409 for ${API}/repos/Half/gone/commits/main: Git Repository is empty.`]);
});

test('reading the skills: the rate limit stops the reading, not the scan; the listing is kept, with a warning', async () => {
  // GitHub stops answering once the repositories are listed, as the reading starts.
  let reading = false;
  const limited: Fetch = async (url, init) =>
    reading ? new Response(JSON.stringify({ message: 'API rate limit exceeded for 192.0.2.1.' }), { status: 403 }) : github(url, init);
  const progress = (message: string) => (reading ||= message.startsWith('Read the skills'));
  const result = await scanOrganization('https://github.com/Acme', { fetch: limited, read: true, progress });
  assert.deepEqual(
    result.repositories.map(({ id, skills, result }) => ({ id, skills, read: Boolean(result) })),
    [
      { id: 'Acme/agents', skills: 1, read: false },
      { id: 'Acme/tools', skills: 2, read: false },
    ],
  );
  assert.equal(result.warnings.at(-1), 'the skills of 2 repositories were not read: GitHub rate limit reached; set GITHUB_TOKEN');
});

test('reading the skills: a repository whose tree is too large keeps its warning, as a scan of it does', async () => {
  const entries = (items: { path: string; type: string; sha: string }[]) => ({ status: 200, body: { truncated: false, tree: items.map((item) => ({ mode: '100644', ...item })) } });
  const recording: Recording = {
    ...owner('Large', 'Organization'),
    ...list(`${API}/orgs/Large/repos?type=all`, [{ id: 'Large/mono' }]),
    ...repository('Large/mono', { '.claude/skills/build/SKILL.md': skill('build') }),
    [`${API}/repos/Large/mono/git/trees/claude`]: entries([{ path: 'skills', type: 'tree', sha: 'skills' }]),
    [`${API}/repos/Large/mono/git/trees/skills?recursive=1`]: entries([{ path: 'build/SKILL.md', type: 'blob', sha: COMMIT }]),
  };
  // Too large, by branch for the organization's listing, and at the commit for a scan of it.
  for (const ref of ['main', COMMIT]) {
    recording[`${API}/repos/Large/mono/git/trees/${ref}?recursive=1`] = { status: 200, body: { truncated: true, tree: [] } };
    recording[`${API}/repos/Large/mono/git/trees/${ref}`] = entries([{ path: '.claude', type: 'tree', sha: 'claude' }]);
  }
  const large = replay(recording);
  const requests: string[] = [];
  const result = await scanOrganization('https://github.com/Large', { fetch: (url, init) => (requests.push(url), large(url, init)), read: true });
  const mono = result.repositories[0].result!;
  assert.deepEqual(mono, await scan(await openGitHub('https://github.com/Large/mono', { fetch: large })));
  assert.match(mono.warnings[0], /^the tree is too large to list at once; looked only in /);
  // Without a token, the list said the branch: the repository is not asked for again.
  assert.ok(!requests.includes(`${API}/repos/Large/mono`));
});

// The web view.

/** Every request to GitHub the web view makes, and its clock. */
const requests: string[] = [];
const counted: Fetch = (url, init) => (requests.push(url), github(url, init));
let clock = 0;
const server = createWebServer({
  open: (input) => openGitHub(input, { fetch: counted }),
  organization: (input, options) => scanOrganization(input, { fetch: counted, ...options }),
  now: () => clock,
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
  clock += 60 * 60 * 1000; // the organization is no longer kept: listed again
  requests.length = 0;
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
  // Listed, not read: only the chosen repository's files, and none of the others'.
  assert.ok(requests.includes(`${API}/users/Acme`));
  const files = requests.filter((url) => url.startsWith('https://raw.githubusercontent.com/'));
  assert.deepEqual(files.sort(), [
    `https://raw.githubusercontent.com/Acme/tools/${COMMIT}/.agents/skills/review/SKILL.md`,
    `https://raw.githubusercontent.com/Acme/tools/${COMMIT}/.github/skills/testing/SKILL.md`,
  ]);
  // Another one, chosen then: scanned, the organization not listed again.
  requests.length = 0;
  const other = await get(`org=${encodeURIComponent('https://github.com/Acme')}&repo=${encodeURIComponent('https://github.com/Acme/agents')}`);
  assert.deepEqual([...other.html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map(([, name]) => name), ['deploy']);
  assert.ok(requests.includes(`${API}/repos/Acme/agents`));
  assert.ok(!requests.includes(`${API}/users/Acme`));
});

test('web: the organization cannot be listed → the chosen repository is still shown, with a warning', async () => {
  const page = await get(`org=${encodeURIComponent('https://github.com/Nobody')}&repo=${encodeURIComponent('https://github.com/Acme/tools')}`);
  assert.equal(page.status, 200);
  assert.equal(chooser(page.html), undefined);
  assert.match(page.html, /<li>warning: no repository chooser: Organization not found: https:\/\/github.com\/Nobody<\/li>/);
  assert.match(page.html, /<h2 class="repository"><a href="https:\/\/github.com\/Acme\/tools">Acme\/tools<\/a> · 2 skills/);
});

test('web: the organization page shows the progress as it loads, then only what it found', async () => {
  // The tree of Acme/tools answers only once the first part of the page has arrived.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const slow = createWebServer({
    open: (input) => openGitHub(input, { fetch: github }),
    organization: (input, options) =>
      scanOrganization(input, { fetch: async (url, init) => (url.includes('Acme/tools/git/trees') && (await held), github(url, init)), ...options }),
  });
  slow.listen(0, '127.0.0.1');
  await once(slow, 'listening');
  after(() => slow.close());
  const response = await fetch(`http://127.0.0.1:${(slow.address() as AddressInfo).port}/?repo=github.com%2FAcme`);
  assert.equal(response.status, 200);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let html = '';
  while (!html.includes('Listed 0 of 4 repositories of Acme…')) html += (await reader.read()).value;
  assert.doesNotMatch(html, /class="chooser"|<\/html>/);
  release();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) html += chunk.value;
  const progress = /<div class="progress" role="status">\n([\s\S]*?)<\/div>\n<h2 class="organization">/.exec(html)?.[1];
  assert.deepEqual(progress?.trim().split('\n'), [
    '<p>Listing the repositories of Acme…</p>',
    ...[0, 1, 2, 3, 4].map((done) => `<p>Listed ${done} of 4 repositories of Acme…</p>`),
    ...[0, 1, 2].map((done) => `<p>Read the skills of ${done} of 2 repositories…</p>`),
  ]);
  assert.equal(chooser(html)?.options.length, 3);
  // Only the latest progress, and none once the page has what it found: CSS, no script.
  assert.match(html, /\.progress p:not\(:last-child\), \.progress:not\(:last-child\) \{ display: none; \}/);
  assert.doesNotMatch(html, /<script/);
  assert.ok(html.endsWith('</main>\n</body>\n</html>\n'));
});

test('web: choosing a repository of an organization just scanned → its skills at once, with no request to GitHub', async () => {
  await get(`repo=${encodeURIComponent('https://github.com/Acme')}`);
  requests.length = 0;
  const chosen = `org=${encodeURIComponent('https://github.com/acme')}&repo=${encodeURIComponent('https://github.com/acme/TOOLS')}`;
  const page = await get(chosen);
  assert.equal(page.status, 200);
  assert.equal(requests.length, 0, requests.join(" "));
  assert.equal(chooser(page.html)?.options.find((option) => option.selected)?.value, 'https://github.com/Acme/tools');
  assert.deepEqual([...page.html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map(([, name]) => name), ['review', 'testing']);
  assert.ok(page.html.includes(`https://github.com/Acme/tools/blob/${COMMIT}/.agents/skills/review/SKILL.md`));
  // With a filter, sent with Enter without the script: at once too.
  await get(`${chosen}&filter=test`);
  assert.equal(requests.length, 0, requests.join(" "));
  // A repository the organization has no skills in, or another organization: scanned as before.
  await get(`org=${encodeURIComponent('https://github.com/Acme')}&repo=${encodeURIComponent('https://github.com/Acme/docs')}`);
  assert.ok(requests.includes(`${API}/repos/Acme/docs`));
  // Only the repository: the organization is kept, it is not listed again.
  assert.ok(!requests.includes(`${API}/users/Acme`));
});

test('web: choosing a repository whose skills could not be read → it is scanned, the organization not listed again', async () => {
  const page = await get(`repo=${encodeURIComponent('https://github.com/Half')}`);
  assert.match(page.html, /<li>warning: Half\/gone: its skills cannot be read: /);
  requests.length = 0;
  const chosen = await get(`org=${encodeURIComponent('https://github.com/Half')}&repo=${encodeURIComponent('https://github.com/Half/gone')}`);
  assert.equal(chosen.status, 200);
  assert.ok(requests.includes(`${API}/repos/Half/gone`));
  assert.ok(!requests.includes(`${API}/users/Half`));
  assert.equal(chooser(chosen.html)?.options.find((option) => option.selected)?.value, 'https://github.com/Half/gone');
  assert.deepEqual([...chosen.html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map(([, name]) => name), ['a']);
  // Kept with the organization: chosen again, at once.
  requests.length = 0;
  const again = await get(`org=${encodeURIComponent('https://github.com/Half')}&repo=${encodeURIComponent('https://github.com/Half/gone')}`);
  assert.equal(requests.length, 0, requests.join(' '));
  // The same page, its warnings and the organization's too.
  assert.equal(again.html, chosen.html);
});

test('web: an organization is kept for 10 minutes, then scanned again; the organization page always scans', async () => {
  await get(`repo=${encodeURIComponent('https://github.com/Acme')}`);
  const chosen = `org=${encodeURIComponent('https://github.com/Acme')}&repo=${encodeURIComponent('https://github.com/Acme/tools')}`;
  clock += 10 * 60 * 1000 - 1;
  requests.length = 0;
  await get(chosen);
  assert.equal(requests.length, 0, requests.join(" "));
  clock += 1;
  await get(chosen);
  assert.ok(requests.includes(`${API}/users/Acme`));
  // Scanned again: kept again.
  requests.length = 0;
  await get(chosen);
  assert.equal(requests.length, 0, requests.join(" "));
  await get(`repo=${encodeURIComponent('https://github.com/Acme')}`);
  assert.ok(requests.includes(`${API}/users/Acme`));
});

test('web: at most the 10 organizations scanned last are kept', async () => {
  const names = Array.from({ length: 11 }, (_, n) => `Org${n}`);
  const many = replay(
    Object.assign(
      {},
      ...names.map((name) => ({
        ...owner(name, 'Organization'),
        ...list(`${API}/orgs/${name}/repos?type=all`, [{ id: `${name}/r` }]),
        ...tree(`${name}/r`, ['.claude/skills/a/SKILL.md']),
        ...repository(`${name}/r`, { '.claude/skills/a/SKILL.md': skill('a') }),
      })),
    ),
  );
  const asked: string[] = [];
  const kept = createWebServer({
    open: (input) => openGitHub(input, { fetch: many }),
    organization: (input, options) => scanOrganization(input, { fetch: (url, init) => (asked.push(url), many(url, init)), ...options }),
  });
  kept.listen(0, '127.0.0.1');
  await once(kept, 'listening');
  after(() => kept.close());
  const at = `http://127.0.0.1:${(kept.address() as AddressInfo).port}/`;
  for (const name of names) await (await fetch(`${at}?repo=github.com%2F${name}`)).text();
  asked.length = 0;
  for (const name of names.slice(1)) await (await fetch(`${at}?org=github.com%2F${name}&repo=github.com%2F${name}%2Fr`)).text();
  assert.equal(asked.length, 0, asked.join(" "));
  await (await fetch(`${at}?org=github.com%2FOrg0&repo=github.com%2FOrg0%2Fr`)).text();
  assert.ok(asked.includes(`${API}/users/Org0`));
});

test('web: the rate limit while the skills are read → the chooser all the same, with a warning', async () => {
  let reading = false;
  const limited = createWebServer({
    open: (input) => openGitHub(input, { fetch: github }),
    organization: (input, options) =>
      scanOrganization(input, {
        fetch: async (url, init) => (reading ? new Response(JSON.stringify({ message: 'API rate limit exceeded' }), { status: 403 }) : github(url, init)),
        read: options?.read,
        progress: (message) => ((reading ||= message.startsWith('Read the skills')), options?.progress?.(message)),
      }),
  });
  limited.listen(0, '127.0.0.1');
  await once(limited, 'listening');
  after(() => limited.close());
  const html = await (await fetch(`http://127.0.0.1:${(limited.address() as AddressInfo).port}/?repo=github.com%2FAcme`)).text();
  assert.equal(chooser(html)?.options.length, 3);
  assert.match(html, /<li>warning: the skills of 2 repositories were not read: GitHub rate limit reached; set GITHUB_TOKEN<\/li>/);
  assert.doesNotMatch(html, /<p class="error">/);
});

test('web: a failure once the progress is on the page → the message on the page, after it', async () => {
  const page = await get(`repo=${encodeURIComponent('https://github.com/Limited')}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /<p>Listed 0 of 2 repositories of Limited…<\/p>\n(?:<p>[^<]*<\/p>\n)*<\/div>\n<p class="error">GitHub rate limit reached; set GITHUB_TOKEN<\/p><\/main>/);
  assert.equal(chooser(page.html), undefined);
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
