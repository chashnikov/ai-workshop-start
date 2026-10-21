// ./fixture as GitHub would answer for it, for the tests and `npm run demo`: no network, no token.
import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Recording } from './replay.ts';

export const FIXTURE = fileURLToPath(new URL('../../fixture', import.meta.url));

/** The commit GitHub answers for the repositories of onGitHub. */
export const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/** When a file was last updated, unless `onGitHub` is told otherwise. */
export const UPDATED = '2026-10-01T12:00:00Z';

/** The time the tests and the demo look from: how long ago a skill was updated, as of it. */
export const NOW = Date.parse('2026-10-21T12:00:00Z');

/** When ./fixture's skills were last updated, as GitHub answers for JetBrains/fixture. */
export const FIXTURE_UPDATED: Record<string, string> = {
  '.claude/skills/code-style/SKILL.md': '2026-09-14T08:12:45Z',
  '.claude/skills/commits/SKILL.md': '2026-10-20T15:05:21Z',
  '.agents/skills/release-checklist/SKILL.md': '2026-03-02T23:59:59Z',
  'agent/skills/testing/SKILL.md': '2025-12-31T07:00:00Z',
};

/** The last commit to a file of `id`, up to `commit`, as GitHub answers it: at `date`. */
export function history(id: string, commit: string, path: string, date: string): Recording {
  return {
    [`https://api.github.com/repos/${id}/commits?sha=${commit}&path=${path}&per_page=1`]: {
      status: 200,
      body: [{ sha: commit, commit: { committer: { date } } }],
    },
  };
}

/**
 * What GitHub answers for JetBrains/<name>: a tree of the files, the files at COMMIT, and when each
 * one was last updated: `updated`, else UPDATED.
 */
export function onGitHub(name: string, files: Record<string, string>, updated: Record<string, string> = {}): Recording {
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
    Object.assign(recording, history(`JetBrains/${name}`, COMMIT, path, updated[path] ?? UPDATED));
  }
  return recording;
}

/** ./fixture, as if it were JetBrains/fixture. */
export function fixtureOnGitHub(): Recording {
  const paths = (readdirSync(FIXTURE, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURE, join(entry.parentPath, entry.name)));
  return onGitHub('fixture', Object.fromEntries(paths.map((path) => [path, readFileSync(join(FIXTURE, path), 'utf8')])), FIXTURE_UPDATED);
}

/**
 * JetBrains, an organization, listed without a token: JetBrains/fixture as above, JetBrains/tools
 * with one skill and JetBrains/docs with none.
 */
export function organizationOnGitHub(): Recording {
  const API = 'https://api.github.com';
  const tools = { '.claude/skills/review/SKILL.md': '---\nname: review\ndescription: Review a change the way this team does. Use for every pull request.\n---\n# Review\n' };
  const fixture = fixtureOnGitHub();
  const tree = (name: string, paths: string[]): Recording => ({
    [`${API}/repos/JetBrains/${name}/git/trees/main?recursive=1`]: {
      status: 200,
      body: { truncated: false, tree: paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: COMMIT })) },
    },
  });
  const fixturePaths = Object.keys(fixture).filter((url) => url.startsWith('https://raw.githubusercontent.com/')).map((url) => url.split(`/${COMMIT}/`)[1]);
  return {
    ...fixture,
    ...onGitHub('tools', tools),
    [`${API}/users/JetBrains`]: { status: 200, body: { login: 'JetBrains', type: 'Organization' } },
    [`${API}/orgs/JetBrains/repos?type=all&per_page=100&page=1`]: {
      status: 200,
      body: ['tools', 'docs', 'fixture'].map((name) => ({ full_name: `JetBrains/${name}`, default_branch: 'main' })),
    },
    ...tree('fixture', fixturePaths),
    ...tree('tools', Object.keys(tools)),
    ...tree('docs', ['README.md']),
  };
}
