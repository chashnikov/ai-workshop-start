import { AtlasError, RateLimitError } from './errors.ts';
import { findSkills, SKILL_ROOTS } from './find.ts';
import type { Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/**
 * `https://github.com/<organization>`, or `https://github.com/orgs/<organization>`, with or without
 * the scheme or a trailing slash: an organization's, or a user's, login.
 */
export function parseGitHubOrganizationUrl(input: string): string | undefined {
  return /^(?:https?:\/\/)?(?:www\.)?github\.com\/(?:orgs\/)?([\w.-]+)\/?$/i.exec(input.trim())?.[1];
}

/** Resolves the default branch to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<{ full_name: string; default_branch: string }>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  const id = info.full_name;
  const { sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`);
  const warnings: string[] = [];
  const paths = options.token ? await searchPaths(github, id, warnings) : await treePaths(github, id, sha, warnings);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** Code search in one repository: the files named SKILL.md. */
async function searchPaths(github: Client, id: string, warnings: string[]): Promise<string[]> {
  return (await search(github, `repo:${id}`, warnings)).map((item) => item.path);
}

type Found = { path: string; repository: { full_name: string } };

/**
 * Code search looks at the whole default branch, 100 results a page; GitHub returns at most 1000
 * results, ten pages, and those found in time when the search times out: a warning for each.
 */
async function search(github: Client, qualifiers: string, warnings: string[]): Promise<Found[]> {
  const found = new Map<string, Found>(); // pages can repeat a result
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; incomplete_results?: boolean; items: Found[] }>(
      `${API}/search/code?q=filename:SKILL.md+${qualifiers}&per_page=100&page=${page}`,
    );
    for (const item of result.items) found.set(`${item.repository?.full_name}:${item.path}`, item);
    if (result.incomplete_results) {
      warnings.push('GitHub code search timed out; some SKILL.md files may be missing');
      break;
    }
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
    if (page === 10) warnings.push(`GitHub returns at most 1000 SKILL.md files; ${result.total_count - 1000} more were left out`);
  }
  return [...found.values()];
}

/** A repository of an organization that has skills, and how many. */
export type OrganizationRepository = { id: string; url: string; skills: number };

export type OrganizationResult = {
  /** The organization's, or the user's, login and page. */
  organization: { id: string; url: string };
  /** Only those with skills, sorted by id. */
  repositories: OrganizationRepository[];
  warnings: string[];
};

/** How many repositories are listed at the same time, without a token. */
const PARALLEL = 8;

/**
 * Every repository of an organization, or of a user, that has skills: with a token, through one code
 * search over all of them; without it, through each repository's tree at its default branch.
 * A repository that cannot be listed is a warning, and the scan goes on.
 */
export async function scanOrganization(input: string, options: GitHubOptions): Promise<OrganizationResult> {
  const name = parseGitHubOrganizationUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const owner = await github.json<{ login: string; type: string }>(
    `${API}/users/${name}`,
    `Organization not found: https://github.com/${name}`,
  );
  const organization = owner.type === 'Organization';
  const warnings: string[] = [];
  const paths = options.token
    ? await searchOrganization(github, `${organization ? 'org' : 'user'}:${owner.login}`, warnings)
    : await organizationTrees(github, options, organization ? `${API}/orgs/${owner.login}/repos?type=all` : `${API}/users/${owner.login}/repos?type=owner`, warnings);
  const repositories = [...paths]
    .map(([id, files]) => ({ id, url: `https://github.com/${id}`, skills: findSkills(files).length }))
    .filter((repository) => repository.skills > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { organization: { id: owner.login, url: `https://github.com/${owner.login}` }, repositories, warnings };
}

/**
 * Code search over the whole organization, forks too: the files that may be skills, by repository.
 * Code search leaves out forks, which the trees include, and `fork:true` finds only forks (as GitHub
 * answers): one search for each.
 */
async function searchOrganization(github: Client, qualifier: string, warnings: string[]): Promise<Map<string, string[]>> {
  const paths = new Map<string, string[]>();
  const found = [...(await search(github, qualifier, warnings)), ...(await search(github, `${qualifier}+fork:true`, warnings))];
  for (const { path, repository } of found) {
    paths.set(repository.full_name, [...(paths.get(repository.full_name) ?? []), path]);
  }
  return paths;
}

/** Each repository's tree at its default branch, a few at a time: the files that may be skills, by repository. */
async function organizationTrees(github: Client, options: GitHubOptions, list: string, warnings: string[]): Promise<Map<string, string[]>> {
  const repositories: { full_name: string; default_branch: string }[] = [];
  for (let page = 1; ; page++) {
    const result = await github.json<{ full_name: string; default_branch: string }[]>(`${list}&per_page=100&page=${page}`);
    repositories.push(...result);
    if (result.length < 100) break;
  }
  // In the listed order, however the requests finish.
  const listed: { paths?: string[]; warnings: string[] }[] = repositories.map(() => ({ warnings: [] }));
  let next = 0;
  let stopped = false; // once the scan has failed, the other workers take no more repositories
  async function worker() {
    while (!stopped && next < repositories.length) {
      const index = next++;
      const { full_name: id, default_branch: branch } = repositories[index];
      // A client of its own: its answers, a whole tree among them, are dropped once the repository is listed.
      const own = client(options);
      try {
        listed[index].paths = await treePaths(own, id, await treeRef(own, id, branch), listed[index].warnings);
      } catch (error) {
        if (error instanceof RateLimitError || !(error instanceof AtlasError)) {
          stopped = true;
          throw error;
        }
        listed[index].warnings.push(`cannot be listed: ${error.message}; skipped`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, repositories.length) }, worker));
  const paths = new Map<string, string[]>();
  repositories.forEach(({ full_name: id }, index) => {
    if (listed[index].paths) paths.set(id, listed[index].paths);
    warnings.push(...listed[index].warnings.map((warning) => `${id}: ${warning}`));
  });
  return paths;
}

/**
 * The tree takes a branch name as it is, one request less; a name with `/` would read as more of
 * the path, so it is resolved to its commit first.
 */
async function treeRef(github: Client, id: string, branch: string): Promise<string> {
  if (!branch.includes('/')) return encodeURIComponent(branch);
  return (await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(branch)}`)).sha;
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or only the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string, warnings: string[]): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  warnings.push(`the tree is too large to list at once; looked only in ${SKILL_ROOTS.join(', ')} (GITHUB_TOKEN searches everywhere)`);
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new RateLimitError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
