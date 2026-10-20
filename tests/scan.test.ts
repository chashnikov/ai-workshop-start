// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for small GitHub repositories answered in tests/helpers.ts and below. ./fixture/README.md
// lists the cases of where skills live.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, history } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 4 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.claude/skills/code-style/SKILL.md`,
      '  also in .github/skills/code-style/SKILL.md',
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
      'testing — Run the tests before pushing.',
      `  ${root}/agent/skills/testing/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: [^\n]*$/);
});

test('./fixture: a skill is <root>/skills/<name>/SKILL.md in .agents, .claude, agent or .github at the root', () => {
  // SKILL.md at the root, in docs/skills, in nested/.claude/skills, in .claude, in .claude/skills,
  // one level too deep, and skill.md: none of them is a skill, and none of them is a warning.
  assert.doesNotMatch(fixture.stdout, /not-a-skill/);
  assert.doesNotMatch(fixture.stderr, /not-a-skill|nested|docs/);
});

test('./fixture: the same name in different roots is one skill, listed once, with the others as copies', () => {
  assert.equal(fixture.stdout.match(/^code-style\b/gm)?.length, 1);
  assert.match(fixture.stdout, /\/\.claude\/skills\/code-style\/SKILL\.md\n {2}also in \.github\/skills\/code-style\/SKILL\.md\n/);
});

test('GitHub: only skill files are skills, and the same name in different roots is one skill', async () => {
  const commit = '0123456789abcdef0123456789abcdef01234567';
  const skill = (name: string) => ({ status: 200, body: `---\nname: ${name}\ndescription: The ${name} skill.\n---\n` });
  const raw = `https://raw.githubusercontent.com/JetBrains/skills/${commit}`;
  const github = replay({
    'https://api.github.com/repos/JetBrains/skills': { status: 200, body: { full_name: 'JetBrains/skills', default_branch: 'main' } },
    'https://api.github.com/repos/JetBrains/skills/commits/main': { status: 200, body: { sha: commit } },
    [`https://api.github.com/repos/JetBrains/skills/git/trees/${commit}?recursive=1`]: {
      status: 200,
      body: {
        truncated: false,
        tree: [
          'SKILL.md',
          'docs/skills/not-a-skill/SKILL.md',
          'nested/.claude/skills/not-a-skill/SKILL.md',
          '.claude/SKILL.md',
          '.claude/skills/SKILL.md',
          '.claude/skills/not-a-skill/nested/SKILL.md',
          '.claude/skills/not-a-skill/skill.md',
          '.agents/skills/review/SKILL.md',
          '.claude/skills/review/SKILL.md',
          'agent/skills/review/SKILL.md',
          '.github/skills/testing/SKILL.md',
        ].map((path) => ({ path, mode: '100644', type: 'blob', sha: commit })),
      },
    },
    // Only skill files are read: reading any other one is not recorded and fails the scan.
    [`${raw}/.agents/skills/review/SKILL.md`]: skill('review'),
    [`${raw}/.claude/skills/review/SKILL.md`]: skill('review'),
    [`${raw}/agent/skills/review/SKILL.md`]: skill('review'),
    [`${raw}/.github/skills/testing/SKILL.md`]: skill('testing'),
    // When each skill was last updated: its own file's; its copies' are not asked for.
    ...history('JetBrains/skills', commit, '.agents/skills/review/SKILL.md', '2026-10-20T15:05:21Z'),
    ...history('JetBrains/skills', commit, '.github/skills/testing/SKILL.md', '2026-09-14T08:12:45Z'),
  });
  const result = await scan(await openGitHub('https://github.com/JetBrains/skills', { fetch: github }));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.skills.map(({ name, path, copies, updated }) => ({ name, path, copies, updated })),
    [
      {
        name: 'review',
        path: '.agents/skills/review/SKILL.md',
        copies: ['.claude/skills/review/SKILL.md', 'agent/skills/review/SKILL.md'],
        updated: '2026-10-20T15:05:21Z',
      },
      { name: 'testing', path: '.github/skills/testing/SKILL.md', copies: [], updated: '2026-09-14T08:12:45Z' },
    ],
  );
});

test('a local directory: no commit, so no last update; nothing asked for', async () => {
  const result = await scan(await openDirectory(FIXTURE));
  assert.deepEqual(result.skills.map((skill) => skill.updated), ['', '', '', '']);
  assert.doesNotMatch(result.warnings.join('\n'), /last update/);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});
