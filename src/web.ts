// The web view: a page that takes a GitHub repository URL and shows its skills and their content.
// A thin client like the CLI: it scans on every request and stores nothing, but the organizations
// scanned lately, so that choosing one of their repositories shows its skills at once.
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { parseGitHubOrganizationUrl, parseGitHubUrl, type OrganizationResult } from './core/github.ts';
import { firstSentence, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type ScanResult, type Source } from './core/scan.ts';

export type WebOptions = {
  /** Opens the repository the page asks for. */
  open(input: string): Promise<Source>;
  /**
   * Lists the repositories with skills of the organization the page asks for, telling `progress` how
   * it goes; with `read`, their skills too, so that choosing one of them shows its skills with no new scan.
   */
  organization?(input: string, options?: { read?: boolean; progress?(message: string): void }): Promise<OrganizationResult>;
  /** The time, in milliseconds: when a kept organization is too old, how long ago a skill was updated. `Date.now` by default. */
  now?(): number;
};

/** How long a scanned organization is kept, and how many of them at most. */
const KEPT_FOR = 10 * 60 * 1000;
const KEPT = 10;

/**
 * `GET /` is the form; `GET /?repo=<URL>` is the form and the repository's skills; `&filter=<words>`
 * only the skills whose names contain every word (the page's script then filters as the words are typed).
 * `GET /?repo=<organization URL>` is a chooser of its repositories with skills; it chooses with
 * `?org=<organization URL>&repo=<URL>`: the chooser again, then the repository's skills, from the
 * organization as it was scanned if it is kept. The organization's page shows the scan's progress as it loads.
 * Only for this machine's own addresses: a page elsewhere must not read it through DNS rebinding.
 */
export function createWebServer({ open, organization, now = Date.now }: WebOptions): Server {
  // The organizations scanned lately, by login in lower case, the oldest first: the only thing stored.
  const kept = new Map<string, { at: number; listed: OrganizationResult }>();
  const key = (input: string) => parseGitHubOrganizationUrl(input)!.toLowerCase();
  const keep = (input: string, listed: OrganizationResult) => {
    kept.delete(key(input));
    kept.set(key(input), { at: now(), listed });
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  };
  const recall = (input: string) => {
    const entry = kept.get(key(input));
    return entry && now() - entry.at < KEPT_FOR ? entry.listed : undefined;
  };

  return createServer(async (request, response) => {
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
      response.end(html);
    };
    const port = request.socket.localPort;
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) {
      return send(403, page('', error(`Not served for the host: ${request.headers.host ?? ''}`)));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return send(405, page('', error('Only GET is supported')), { Allow: 'GET, HEAD' });
    }
    // The request's own path: with a base URL, `//skills` would be the host `skills`.
    const url = new URL(`http://localhost${request.url ?? '/'}`);
    if (url.pathname !== '/') return send(404, page('', error(`Not found: ${url.pathname}`)));
    // The headers only: no scan for an answer nobody reads.
    if (request.method === 'HEAD') return send(200, '');
    const input = url.searchParams.get('repo')?.trim() ?? '';
    if (!input) return send(200, page(''));
    const filter = url.searchParams.get('filter')?.trim() ?? '';
    const org = (organization && url.searchParams.get('org')?.trim()) || '';
    try {
      if (organization && parseGitHubOrganizationUrl(input)) {
        // The page starts with the first progress, and shows the latest one until the scan is done:
        // a failure before it is still a status of its own, one after it is on the page.
        let started = false;
        const progress = (message: string) => {
          if (!started) {
            started = true;
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            response.write(`${top(input)}<div class="progress" role="status">\n`);
          }
          response.write(`<p>${escape(message)}</p>\n`);
        };
        let content: string;
        try {
          const listed = await organization(input, { read: true, progress });
          keep(input, listed);
          content = repositories(listed, '');
        } catch (failure) {
          if (!started) throw failure;
          content = error(describe(failure));
        }
        if (!started) return send(200, page(input, content));
        return response.end(`</div>\n${content}${BOTTOM}`);
      }
      if (org && !parseGitHubOrganizationUrl(org)) throw new AtlasError(`Not a GitHub organization URL: ${org}`);
      // The organization as it was scanned, with the repository's skills: no request at all.
      let listed: OrganizationResult | AtlasError | undefined = org ? recall(org) : undefined;
      let scanned = listed?.repositories.find((repository) => same(repository.id, input))?.result;
      if (!scanned) {
        // Both at once: each one is requests to GitHub. If the organization fails, the repository is still shown.
        // Only listed, not read: the others are read as they are chosen.
        const listing = listed ?? (org ? organization!(org, { read: false }).then((result) => (keep(org, result), result), (failure: unknown) => (failure instanceof AtlasError ? failure : Promise.reject(failure))) : undefined);
        [listed, scanned] = await Promise.all([listing, open(input).then((source) => scan(source, { updated: true }))]);
        // Kept with the organization: chosen again, it is shown at once.
        const kept = listed instanceof AtlasError ? undefined : listed?.repositories.find((repository) => same(repository.id, input));
        if (kept) Object.assign(kept, { result: scanned, skills: scanned.skills.length });
      }
      let chooser = '';
      if (listed instanceof AtlasError) chooser = `<ul class="warnings"><li>warning: no repository chooser: ${escape(listed.message)}</li></ul>\n`;
      else if (listed) chooser = repositories(listed, input);
      send(200, page(input, `${chooser}${result(scanned, input, filter, org, now())}`));
    } catch (failure) {
      send(failure instanceof AtlasError ? 400 : 500, page(input, error(describe(failure))));
    }
  });
}

function describe(failure: unknown): string {
  if (failure instanceof AtlasError) return failure.message;
  return `Unexpected error: ${failure instanceof Error ? failure.message : String(failure)}`;
}

/** Whether the repository URL is the repository `<owner>/<repo>`, whatever the case. */
function same(id: string, input: string): boolean {
  const name = parseGitHubUrl(input);
  return Boolean(name) && `${name!.owner}/${name!.repo}`.toLowerCase() === id.toLowerCase();
}

/** The whole page: the form, then what it found. */
function page(input: string, content = ''): string {
  return `${top(input)}${content}${BOTTOM}`;
}

/** The page up to what it found: the form. */
function top(input: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Skill Atlas</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1><a href="/">Skill Atlas</a></h1>
<form method="get" action="/">
<input type="text" name="repo" value="${escape(input)}" placeholder="https://github.com/owner/repo or https://github.com/organization" aria-label="GitHub repository or organization URL" required>
<button type="submit">Show skills</button>
</form>
</header>
<main>`;
}

const BOTTOM = `</main>
</body>
</html>
`;

/**
 * `<organization> · N repositories with skills`, the warnings, then a chooser of them: no script, a
 * form that asks for the chosen repository, with the organization to show the chooser again.
 */
function repositories({ organization, repositories, warnings }: OrganizationResult, input: string): string {
  const count = `${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'} with skills`;
  const heading = `<h2 class="organization"><a href="${escape(organization.url)}">${escape(organization.id)}</a> · ${count}</h2>
${warnings.length ? `<ul class="warnings">${warnings.map((warning) => `<li>warning: ${escape(warning)}</li>`).join('')}</ul>` : ''}`;
  if (!repositories.length) return `${heading}\n<p class="empty">No repositories with skills found.</p>`;
  const any = repositories.some((repository) => same(repository.id, input));
  const options = repositories.map((repository) => {
    const selected = same(repository.id, input) ? ' selected' : '';
    const skills = `${repository.skills} ${repository.skills === 1 ? 'skill' : 'skills'}`;
    return `<option value="${escape(repository.url)}"${selected}>${escape(repository.id)} · ${skills}</option>`;
  });
  return `${heading}
<form class="chooser" method="get" action="/">
<input type="hidden" name="org" value="${escape(organization.url)}">
<select name="repo" aria-label="Repository" required>
<option value=""${any ? '' : ' selected'} disabled>Choose a repository</option>
${options.join('\n')}
</select>
<button type="submit">Show skills</button>
</form>`;
}

/**
 * `<owner>/<repo> · N skills`, the warnings, then master-detail: the filter and the skills on the
 * left, the selected one on the right. Every skill is on the page, those that do not pass the filter
 * `hidden`, so selecting one is `#<anchor>` and CSS `:target`, with the first one shown selected by
 * default: no request. The filter is the request's, then FILTER's as the field changes: the anchors
 * are the unfiltered ones, so a link selects the same skill with or without a filter.
 */
function result({ repository, skills, warnings }: ScanResult, input: string, filter: string, org: string, now: number): string {
  const count = `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  const commit = repository.commit ? ` at <code>${escape(repository.commit.slice(0, 7))}</code>` : '';
  const anchors = anchorsOf(skills);
  const heading = `<h2 class="repository"><a href="${escape(repository.url)}">${escape(repository.id)}</a> · ${count}${commit}</h2>
${warnings.length ? `<ul class="warnings">${warnings.map((warning) => `<li>warning: ${escape(warning)}</li>`).join('')}</ul>` : ''}`;
  if (!skills.length) return `${heading}\n<p class="empty">No skills found.</p>`;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const all = skills.map((skill, index) => ({ skill, anchor: anchors[index], shown: words.every((word) => skill.name.toLowerCase().includes(word)) }));
  const none = all.every(({ shown }) => !shown);
  // The selected skill's item in the list: anchors are [\w-] only, safe in CSS as they are.
  const selected = all.map(({ anchor }) => `body:has(#${anchor}:target:not([hidden])) .list a[href="#${anchor}"]`).join(',\n');
  return `${heading}
<style>
${selected},
.skills:not(:has(.detail:target:not([hidden]))) .list li:nth-child(1 of :not([hidden])) a { background: #ddf4ff; border-color: #54aeff; }
</style>
<div class="skills">
<nav class="list">${filterForm(input, filter, org)}<ul>
${all.map(({ skill, anchor, shown }) => listItem(skill, anchor, shown, now)).join('\n')}
</ul>
<p class="empty no-match"${none ? '' : ' hidden'}>No skills match &#8220;${escape(filter)}&#8221;.</p>
</nav>
<div class="details">
${all.map(({ skill, anchor, shown }) => detail(repository, skill, anchor, shown)).join('\n')}
</div>
</div>
<script>${FILTER}</script>`;
}

/**
 * Filters as the field changes, the way the server does: the skills whose names contain every word,
 * ignoring case; the address keeps the words, a link to share. Enter submits nothing: the list is
 * already filtered, no new request, no new scan. Static: no repository content in it.
 */
const FILTER = `
const field = document.querySelector('.filter input[type=search]');
const items = [...document.querySelectorAll('.list li')];
const details = [...document.querySelectorAll('.details .detail')];
const none = document.querySelector('.no-match');
field.addEventListener('input', () => {
  const filter = field.value.trim();
  const words = filter.toLowerCase().split(/\\s+/).filter(Boolean);
  let shown = 0;
  items.forEach((item, index) => {
    const name = item.querySelector('.name').textContent.toLowerCase();
    const match = words.every((word) => name.includes(word));
    item.hidden = details[index].hidden = !match;
    if (match) shown++;
  });
  none.hidden = shown > 0;
  none.textContent = \`No skills match \u201c\${filter}\u201d.\`;
  const url = new URL(location.href);
  if (filter) url.searchParams.set('filter', filter);
  else url.searchParams.delete('filter');
  history.replaceState(null, '', url);
});
field.form.addEventListener('submit', (event) => event.preventDefault());
`;

/**
 * Above the list: only the skills whose names contain every word, for the same repository. No button:
 * the script filters as the field changes; without it, Enter submits the field.
 */
function filterForm(input: string, filter: string, org: string): string {
  return `<form class="filter" method="get" action="/">
${org ? `<input type="hidden" name="org" value="${escape(org)}">\n` : ''}<input type="hidden" name="repo" value="${escape(input)}">
<input type="search" name="filter" value="${escape(filter)}" placeholder="Filter by name" aria-label="Filter skills by name">
</form>`;
}

function listItem(skill: Skill, anchor: string, shown: boolean, now: number): string {
  const summary = skill.description ? `<span class="summary">${escape(firstSentence(skill.description))}</span>` : '';
  return `<li${shown ? '' : ' hidden'}><a href="#${anchor}"><span class="name">${escape(skill.name)}</span>${summary}${updated(skill.updated, now)}</a></li>`;
}

/**
 * `Updated 3 days ago`: how long ago, as of `now`, the same on every machine with no script; the date and
 * time in UTC, `2026-10-20 15:05 UTC`, as its tooltip. Nothing when it is not known.
 */
function updated(time: string, now: number): string {
  const date = new Date(time);
  if (!time || Number.isNaN(date.getTime())) return '';
  const iso = date.toISOString();
  return `<time class="updated" datetime="${iso}" title="${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC">Updated ${ago(now - date.getTime())}</time>`;
}

/** How long ago, in its largest whole unit: `just now` under a minute, and for a time still to come. */
function ago(elapsed: number): string {
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const [n, unit] =
    days >= 365 ? [Math.floor(days / 365), 'year'] :
    days >= 30 ? [Math.floor(days / 30), 'month'] :
    days >= 1 ? [days, 'day'] :
    hours >= 1 ? [hours, 'hour'] :
    [minutes, 'minute'];
  return n < 1 ? 'just now' : `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

function detail(repository: Repository, skill: Skill, anchor: string, shown: boolean): string {
  const link = skillLink(repository, skill);
  return `<section class="detail" id="${anchor}"${shown ? '' : ' hidden'}>
<h3>${escape(skill.name)}</h3>
${skill.description ? `<p class="description">${escape(skill.description)}</p>` : ''}
<p class="link"><a href="${escape(link)}">${escape(skill.path)}</a></p>
${skill.copies.length ? `<p class="copies">also in ${skill.copies.map((copy) => `<code>${escape(copy)}</code>`).join(', ')}</p>` : ''}
${skill.body ? `<pre class="content">${escape(skill.body)}</pre>` : '<p class="content empty">No content after the front matter.</p>'}
</section>`;
}

function error(message: string): string {
  return `<p class="error">${escape(message)}</p>`;
}

/**
 * `skill-<name>`, with anything but letters, digits, `_` and `-` as `-`, so a link can select it;
 * a number after it when two skills would have the same one.
 */
function anchorsOf(skills: Skill[]): string[] {
  const used = new Set<string>();
  return skills.map((skill) => {
    const base = `skill-${skill.name.replace(/[^\w-]/g, '-')}`;
    let anchor = base;
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
    used.add(anchor);
    return anchor;
  });
}

/** Everything from a repository is text, never markup. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 80rem; padding: 0 1rem 3rem; color: #1f2328; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #d0d7de; }
header h1 { font-size: 1.25rem; margin: 0; }
header h1 a { color: inherit; text-decoration: none; }
header form { display: flex; flex: 1; gap: .5rem; min-width: 20rem; }
.filter { display: flex; margin-bottom: .75rem; }
.filter input { min-width: 0; }
.progress { color: #59636e; }
/* Only the latest progress, and none once the page has what it found. */
.progress p:not(:last-child), .progress:not(:last-child) { display: none; }
.chooser { display: flex; gap: .5rem; max-width: 40rem; margin-bottom: 1rem; }
select { min-width: 0; background: #fff; }
input, select { flex: 1; font: inherit; padding: .4rem .6rem; border: 1px solid #d0d7de; border-radius: 6px; }
button { font: inherit; padding: .4rem .9rem; border: 1px solid #1f883d; border-radius: 6px; background: #1f883d; color: #fff; cursor: pointer; }
a { color: #0969da; }
.skills { display: grid; grid-template-columns: minmax(14rem, 22rem) 1fr; gap: 1.5rem; align-items: start; }
.list { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; }
.list ul { list-style: none; margin: 0; padding: 0; }
.list a { display: block; padding: .5rem .75rem; margin-bottom: .25rem; border: 1px solid transparent; border-radius: 6px; color: inherit; text-decoration: none; }
.list a:hover { background: #f6f8fa; }
.list .name { display: block; font-weight: 600; }
.list .summary { display: block; font-size: .8125rem; color: #59636e; }
.list .updated { display: block; font-size: .75rem; color: #59636e; }
.detail { display: none; border: 1px solid #d0d7de; border-radius: 6px; padding: 0 1rem 1rem; min-width: 0; }
.detail:target:not([hidden]), .details:not(:has(.detail:target:not([hidden]))) .detail:nth-child(1 of :not([hidden])) { display: block; }
/* Selecting a skill scrolls to it; a margin taller than the screen keeps the page at the top, the repository in view. */
.detail { scroll-margin-top: 100vh; }
.detail h3 { font-size: 1.5rem; }
.description { margin-top: 0; }
.link, .copies { font-size: .875rem; margin: .25rem 0; }
.content { background: #f6f8fa; border-radius: 6px; padding: .75rem; overflow-x: auto; white-space: pre-wrap; font-size: .875rem; }
.empty { color: #59636e; }
.content.empty { background: none; padding: 0; }
.warnings { color: #9a6700; }
.error { color: #d1242f; font-weight: 600; }
@media (max-width: 48rem) { .skills { grid-template-columns: 1fr; } .list { position: static; max-height: none; } .detail { scroll-margin-top: 1rem; } }
`;
