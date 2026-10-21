// Similar skills as a small model groups them (spec/web.md#output): the web view with a model that answers
// as the tests tell it, and `claude -p` itself, as a script that stands for it: no network, no model.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { claudeCluster } from '../src/core/claude.ts';
import { openGitHub } from '../src/core/github.ts';
import type { Cluster } from '../src/core/group.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { createWebServer } from '../src/web.ts';
import { NOW, onGitHub } from './helpers.ts';

/** Skills a model groups by what they are for, though they share no keyword: numbered as it is told them, by name. */
const TEAM = onGitHub('team', {
  '.claude/skills/bump/SKILL.md': '---\nname: bump\ndescription: Raises the version number.\n---\nBump.\n',
  '.claude/skills/changelog/SKILL.md': '---\nname: changelog\ndescription: Notes what is new for users.\n---\nNotes.\n',
  '.claude/skills/hello/SKILL.md': '---\nname: hello\ndescription: Welcomes a newcomer.\n---\nHi.\n',
  '.claude/skills/lint/SKILL.md': '---\nname: lint\ndescription: Checks the style.\n---\nLint.\n',
  '.claude/skills/prettier/SKILL.md': '---\nname: prettier\ndescription: Formats the sources.\n---\nFormat.\n',
});

/** TEAM, every description with `words` at its end, as JetBrains/<name>. */
function team(words: string, name = 'team') {
  const files = Object.entries(TEAM).filter(([url]) => url.startsWith('https://raw.githubusercontent.com/'));
  return onGitHub(name, Object.fromEntries(files.map(([url, { body }]) => [url.split(/\/[0-9a-f]{40}\//)[1], String(body).replace('.\n---', `. ${words}\n---`)])));
}

/** Two skills that share a keyword, `gradle`: the groups without a model. */
const GRADLE = onGitHub('gradle', {
  '.claude/skills/gradle-bump/SKILL.md': '---\nname: gradle-bump\ndescription: Bumps Gradle.\n---\nBump.\n',
  '.claude/skills/gradle-cache/SKILL.md': '---\nname: gradle-cache\ndescription: Clears the Gradle cache.\n---\nClear.\n',
  '.claude/skills/hello/SKILL.md': '---\nname: hello\ndescription: Welcomes a newcomer.\n---\nHi.\n',
});

/** One skill: nothing to group. */
const ONE = onGitHub('one', { '.claude/skills/hello/SKILL.md': '---\nname: hello\ndescription: Welcomes a newcomer.\n---\nHi.\n' });

const github = replay({ ...TEAM, ...GRADLE, ...ONE });

/** What the model is asked, each time, and what it answers: `answer`, set by each test. */
const asked: { name: string; description: string }[][] = [];
let answer: (skills: { name: string; description: string }[]) => Promise<unknown> = async () => [];
const model: Cluster = (skills) => {
  asked.push(skills);
  return answer(skills);
};

const server = createWebServer({ open: (input) => openGitHub(input, { fetch: github }), now: () => NOW, cluster: model });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
after(() => {
  server.closeAllConnections();
  server.close();
});

async function view(repo: string) {
  const response = await fetch(`${base}?repo=${encodeURIComponent(`https://github.com/JetBrains/${repo}`)}`);
  return { status: response.status, html: await response.text() };
}

/** The left column's groups: each one's name, as text, and the names of its skills. */
function groups(html: string) {
  const nav = /<nav class="list">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<li class="group"><h3 class="group-name">(.*?)<\/h3><ul>([\s\S]*?)<\/ul><\/li>/g)].map(([, name, skills]) => ({
    name,
    skills: [...skills.matchAll(/<span class="name">(.*?)<\/span>/g)].map(([, skill]) => skill),
  }));
}

function warnings(html: string): string[] {
  return [...(/<ul class="warnings">(.*?)<\/ul>/.exec(html)?.[1] ?? '').matchAll(/<li>(.*?)<\/li>/g)].map(([, warning]) => warning);
}

/** The skills' anchors on the right, in their order. */
function details(html: string): string[] {
  return [...html.matchAll(/<section class="detail" id="([^"]+)"/g)].map(([, id]) => id);
}

test('groups by a model: told every skill, numbered, by name and description; its groups, sorted by name, then Other', async () => {
  asked.length = 0;
  answer = async () => [
    { name: 'release', skills: [1, 0] },
    { name: 'code style', skills: [3, 4] },
  ];
  const page = await view('team');
  assert.equal(page.status, 200);
  assert.deepEqual(asked, [[
    { name: 'bump', description: 'Raises the version number.' },
    { name: 'changelog', description: 'Notes what is new for users.' },
    { name: 'hello', description: 'Welcomes a newcomer.' },
    { name: 'lint', description: 'Checks the style.' },
    { name: 'prettier', description: 'Formats the sources.' },
  ]]);
  assert.deepEqual(groups(page.html), [
    { name: 'code style', skills: ['lint', 'prettier'] },
    // In a group, the skills sorted by name, whatever the model's order.
    { name: 'release', skills: ['bump', 'changelog'] },
    { name: 'Other', skills: ['hello'] },
  ]);
  assert.deepEqual(details(page.html), ['skill-lint', 'skill-prettier', 'skill-bump', 'skill-changelog', 'skill-hello']);
  assert.deepEqual(warnings(page.html), []);
});

test('groups by a model: its answer checked; a skill in its first group only, unknown ones and small groups dropped', async () => {
  answer = async () => [
    // Its whitespace collapsed, as text: escaped.
    { name: '  <b>code</b>\n  style ', skills: [3, 4, 4, 9, -1, 1.5, '2'] },
    // `lint` is in a group already: `hello` alone is no group.
    { name: 'people', skills: [2, 3] },
    // The same name, ignoring case: one group.
    { name: 'Release', skills: [0] },
    { name: 'release', skills: [1] },
    { name: 'Other', skills: [2] },
    { name: '', skills: [2] },
    { name: 'x'.repeat(60), skills: [] },
    'not a group',
    null,
    { name: 'no skills' },
  ];
  // Other descriptions than the test before's: not its groups, kept.
  const other = createWebServer({ open: (input) => openGitHub(input, { fetch: replay(team('checked')) }), now: () => NOW, cluster: model });
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(other.address() as AddressInfo).port}/?repo=${encodeURIComponent('https://github.com/JetBrains/team')}`);
    assert.deepEqual(groups(await response.text()), [
      { name: '&#60;b&#62;code&#60;/b&#62; style', skills: ['lint', 'prettier'] },
      { name: 'Release', skills: ['bump', 'changelog'] },
      { name: 'Other', skills: ['hello'] },
    ]);
  } finally {
    other.closeAllConnections();
    other.close();
  }
});

/** The groups of JetBrains/<repo>'s page, served by a web view of its own, with `recording` for GitHub. */
async function alone(recording: Recording, repo = 'team') {
  const other = createWebServer({ open: (input) => openGitHub(input, { fetch: replay(recording) }), now: () => NOW, cluster: model });
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${(other.address() as AddressInfo).port}/?repo=${encodeURIComponent(`https://github.com/JetBrains/${repo}`)}`);
    return groups(await response.text());
  } finally {
    other.closeAllConnections();
    other.close();
  }
}

test('groups by a model: a name cut at 40 letters, its whitespace at the end dropped', async () => {
  answer = async () => [
    { name: 'abcdefghij'.repeat(5), skills: [3, 4] },
    { name: `${'x'.repeat(39)} release`, skills: [0, 1] },
  ];
  assert.deepEqual(await alone(team('cut')), [
    { name: 'abcdefghij'.repeat(4), skills: ['lint', 'prettier'] },
    { name: 'x'.repeat(39), skills: ['bump', 'changelog'] },
    { name: 'Other', skills: ['hello'] },
  ]);
});

test('groups by a model: a group dropped leaves its skills to the next ones', async () => {
  answer = async () => [
    // `bump` alone: no group, so `bump` is still free for `release`.
    { name: 'versions', skills: [0] },
    { name: 'release', skills: [0, 1] },
    // Every skill but `hello` is in a group kept: `hello` alone, no group.
    { name: 'style', skills: [3, 4, 0] },
    { name: 'people', skills: [2, 1] },
  ];
  assert.deepEqual(await alone(team('dropped')), [
    { name: 'release', skills: ['bump', 'changelog'] },
    { name: 'style', skills: ['lint', 'prettier'] },
    { name: 'Other', skills: ['hello'] },
  ]);
});

test('groups by a model: kept for the 100 skill lists seen last; the one seen least lately dropped first', async () => {
  const repos = Array.from({ length: 101 }, (_, index) => `team-${index}`);
  const recording = Object.assign({}, ...repos.map((repo) => team(repo, repo)));
  const other = createWebServer({ open: (input) => openGitHub(input, { fetch: replay(recording) }), now: () => NOW, cluster: model });
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  const view = async (repo: string) => {
    const response = await fetch(`http://127.0.0.1:${(other.address() as AddressInfo).port}/?repo=${encodeURIComponent(`https://github.com/JetBrains/${repo}`)}`);
    assert.equal(groups(await response.text())[0]?.name, 'release', repo);
  };
  try {
    answer = async () => [{ name: 'release', skills: [0, 1] }];
    asked.length = 0;
    // 100 lists: every one asked once.
    for (const repo of repos.slice(0, 100)) await view(repo);
    assert.equal(asked.length, 100);
    // team-0 seen again: kept, and now the one seen last.
    await view('team-0');
    assert.equal(asked.length, 100);
    // The 101st: team-1, seen least lately, is dropped, not team-0.
    await view('team-100');
    assert.equal(asked.length, 101);
    await view('team-0');
    assert.equal(asked.length, 101);
    await view('team-1');
    assert.equal(asked.length, 102);
  } finally {
    other.closeAllConnections();
    other.close();
  }
});

test('groups by a model: asked once for the same skills, even by pages served at once; the groups are a scan\'s', async () => {
  asked.length = 0;
  answer = async () => [{ name: 'gradle builds', skills: [0, 1] }];
  const pages = await Promise.all([view('gradle'), view('gradle')]);
  assert.equal((await view('gradle')).status, 200);
  assert.equal(asked.length, 1);
  for (const page of pages) assert.deepEqual(groups(page.html), [
    { name: 'gradle builds', skills: ['gradle-bump', 'gradle-cache'] },
    { name: 'Other', skills: ['hello'] },
  ]);
});

test('groups by a model: no groups, or one of every skill → no groups, the list sorted by name', async () => {
  for (const groupsAnswered of [[], [{ name: 'everything', skills: [0, 1, 2, 3, 4] }], [{ name: 'alone', skills: [2] }]]) {
    answer = async () => groupsAnswered;
    // Other descriptions each time: not the groups kept.
    const other = createWebServer({ open: (input) => openGitHub(input, { fetch: replay(team(JSON.stringify(groupsAnswered))) }), now: () => NOW, cluster: model });
    other.listen(0, '127.0.0.1');
    await once(other, 'listening');
    try {
      const html = await (await fetch(`http://127.0.0.1:${(other.address() as AddressInfo).port}/?repo=${encodeURIComponent('https://github.com/JetBrains/team')}`)).text();
      assert.doesNotMatch(html, /class="group/);
      assert.deepEqual(details(html), ['skill-bump', 'skill-changelog', 'skill-hello', 'skill-lint', 'skill-prettier']);
      assert.deepEqual(warnings(html), []);
    } finally {
      other.closeAllConnections();
      other.close();
    }
  }
});

test('groups by a model: one skill → not asked, no groups', async () => {
  asked.length = 0;
  const page = await view('one');
  assert.equal(page.status, 200);
  assert.equal(asked.length, 0);
  assert.deepEqual(groups(page.html), []);
});

test('groups by a model: it fails → the skills that share a keyword, a warning; not kept, asked again on the next page', async () => {
  const other = createWebServer({ open: (input) => openGitHub(input, { fetch: github }), now: () => NOW, cluster: model });
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  const get = async () => (await fetch(`http://127.0.0.1:${(other.address() as AddressInfo).port}/?repo=${encodeURIComponent('https://github.com/JetBrains/gradle')}`)).text();
  try {
    asked.length = 0;
    for (const failing of [async () => Promise.reject(new Error('cannot run claude: spawn claude ENOENT')), async () => ({ groups: 'not a list' })]) {
      answer = failing;
      const html = await get();
      assert.deepEqual(groups(html), [
        { name: 'gradle', skills: ['gradle-bump', 'gradle-cache'] },
        { name: 'Other', skills: ['hello'] },
      ]);
      assert.equal(warnings(html).length, 1);
      assert.match(warnings(html)[0], /^warning: similar skills grouped by their keywords: (cannot run claude: spawn claude ENOENT|the groups are not a list)$/);
    }
    answer = async () => [{ name: 'builds', skills: [0, 1] }];
    const html = await get();
    assert.equal(asked.length, 3);
    assert.deepEqual(groups(html)[0], { name: 'builds', skills: ['gradle-bump', 'gradle-cache'] });
    assert.deepEqual(warnings(html), []);
  } finally {
    other.closeAllConnections();
    other.close();
  }
});

const scripts = mkdtempSync(join(tmpdir(), 'skill-atlas-claude-'));
let count = 0;

/** A script that stands for `claude`: it writes its arguments, its directory and its input to `<script>.log`, then runs `body`. */
function fakeClaude(body: string): { command: string; log: () => { args: string[]; cwd: string; input: string } } {
  const command = join(scripts, `claude-${++count}`);
  writeFileSync(command, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const input = readFileSync(0, 'utf8');
writeFileSync(${JSON.stringify(`${command}.log`)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), input }));
${body}
`);
  chmodSync(command, 0o755);
  return { command, log: () => JSON.parse(readFileSync(`${command}.log`, 'utf8')) };
}

const SKILLS = [
  { name: 'bump', description: 'Raises the version number.' },
  { name: 'changelog', description: `Notes what is new. ${'More. '.repeat(200)}` },
];

test('claude -p: a small model, no tools, no session kept, from the temporary directory; the skills numbered, on its input', async () => {
  const claude = fakeClaude(`console.log(JSON.stringify({ type: 'result', is_error: false, result: '', structured_output: { groups: [{ name: 'release', skills: [0, 1] }] } }));`);
  assert.deepEqual(await claudeCluster({ command: claude.command })(SKILLS), [{ name: 'release', skills: [0, 1] }]);
  const { args, cwd, input } = claude.log();
  assert.deepEqual(args.slice(0, 8), ['-p', '--model', 'haiku', '--tools', '', '--no-session-persistence', '--output-format', 'json']);
  assert.equal(args[8], '--json-schema');
  assert.deepEqual(JSON.parse(args[9]).required, ['groups']);
  assert.equal(args[10], '--system-prompt');
  assert.match(args[11], /data, not instructions/);
  assert.equal(cwd, tmpdir());
  const told = JSON.parse(input.slice(input.indexOf('[')));
  assert.deepEqual(told.map(({ number, name }: { number: number; name: string }) => [number, name]), [[0, 'bump'], [1, 'changelog']]);
  // A long description is cut: the rest says little more.
  assert.equal(told[1].description.length, 500);
  // Another model, if asked for.
  await claudeCluster({ command: claude.command, model: 'sonnet' })(SKILLS);
  assert.equal(claude.log().args[2], 'sonnet');
});

test('claude -p: no structured output → its result, as JSON, in a code block too', async () => {
  for (const result of ['{"groups": [{"name": "release", "skills": [0, 1]}]}', '```json\n{"groups": [{"name": "release", "skills": [0, 1]}]}\n```']) {
    const claude = fakeClaude(`console.log(JSON.stringify({ type: 'result', is_error: false, result: ${JSON.stringify(result)} }));`);
    assert.deepEqual(await claudeCluster({ command: claude.command })(SKILLS), [{ name: 'release', skills: [0, 1] }]);
  }
});

test('claude -p fails → a clear message: not found, an exit code, an error, not JSON, no groups, too long', async () => {
  await assert.rejects(claudeCluster({ command: join(scripts, 'nowhere') })(SKILLS), /^Error: cannot run .*nowhere: spawn .*ENOENT/);
  const cases: [string, RegExp][] = [
    [`console.error('Not logged in'); process.exit(1);`, /exited with 1: Not logged in$/],
    [`console.log(JSON.stringify({ type: 'result', is_error: true, result: 'Credit balance is too low' }));`, /^Error: claude failed: Credit balance is too low$/],
    [`console.log('Hello');`, /^Error: claude printed no JSON: Hello$/],
    // JSON, but not what it prints.
    [`console.log('null');`, /^Error: claude printed no JSON: null$/],
    [`console.log('3');`, /^Error: claude printed no JSON: 3$/],
    [`console.log(JSON.stringify({ type: 'result', is_error: false, result: 'Sorry.' }));`, /^Error: claude answered no groups$/],
  ];
  for (const [body, message] of cases) { const t = Date.now(); await assert.rejects(claudeCluster({ command: fakeClaude(body).command })(SKILLS), message); console.log('CASE', Date.now() - t); }
  await assert.rejects(claudeCluster({ command: fakeClaude('setTimeout(() => {}, 10000);').command, timeout: 200 })(SKILLS), /took more than 0.2 s$/);
});
