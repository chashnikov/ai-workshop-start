// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
export const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

const github = replay(EXAMPLE);

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    // With a token, through code search, as EXAMPLE answers it.
    open: (input) => (parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input)),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

/** The commit GitHub answers for the repositories of onGitHub. */
export const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** What GitHub answers for JetBrains/<name>: a tree of the files, and the files at COMMIT. */
export function onGitHub(name: string, files: Record<string, string>): Recording {
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
export function fixtureOnGitHub(): Recording {
  const paths = (readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return onGitHub('fixture', Object.fromEntries(paths.map((path) => [path, readFileSync(join(FIXTURE, path), 'utf8')])));
}
