// ./fixture as GitHub would answer for it, for the tests and `npm run demo`: no network, no token.
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Recording } from './replay.ts';

export const FIXTURE = fileURLToPath(new URL('../../fixture', import.meta.url));

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
