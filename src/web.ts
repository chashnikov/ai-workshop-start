// The web view: a page that takes a GitHub repository URL and shows its skills and their content.
// A thin client like the CLI: it scans on every request and stores nothing.
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { firstSentence, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type ScanResult, type Source } from './core/scan.ts';

export type WebOptions = {
  /** Opens the repository the page asks for. */
  open(input: string): Promise<Source>;
};

/**
 * `GET /` is the form; `GET /?repo=<URL>` is the form and the repository's skills; `&filter=<words>`
 * only the skills whose names contain every word (the page's script then filters as the words are typed).
 * Only for this machine's own addresses: a page elsewhere must not read it through DNS rebinding.
 */
export function createWebServer({ open }: WebOptions): Server {
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
    try {
      send(200, page(input, result(await scan(await open(input)), input, filter)));
    } catch (failure) {
      if (failure instanceof AtlasError) return send(400, page(input, error(failure.message)));
      send(500, page(input, error(`Unexpected error: ${failure instanceof Error ? failure.message : String(failure)}`)));
    }
  });
}

/** The whole page: the form, then what it found. */
function page(input: string, content = ''): string {
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
<input type="text" name="repo" value="${escape(input)}" placeholder="https://github.com/owner/repo" aria-label="GitHub repository URL" required>
<button type="submit">Show skills</button>
</form>
</header>
<main>${content}</main>
</body>
</html>
`;
}

/**
 * `<owner>/<repo> · N skills`, the warnings, then master-detail: the filter and the skills on the
 * left, the selected one on the right. Every skill is on the page, those that do not pass the filter
 * `hidden`, so selecting one is `#<anchor>` and CSS `:target`, with the first one shown selected by
 * default: no request. The filter is the request's, then FILTER's as the field changes: the anchors
 * are the unfiltered ones, so a link selects the same skill with or without a filter.
 */
function result({ repository, skills, warnings }: ScanResult, input: string, filter: string): string {
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
<nav class="list">${filterForm(input, filter)}<ul>
${all.map(({ skill, anchor, shown }) => listItem(skill, anchor, shown)).join('\n')}
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
function filterForm(input: string, filter: string): string {
  return `<form class="filter" method="get" action="/">
<input type="hidden" name="repo" value="${escape(input)}">
<input type="search" name="filter" value="${escape(filter)}" placeholder="Filter by name" aria-label="Filter skills by name">
</form>`;
}

function listItem(skill: Skill, anchor: string, shown: boolean): string {
  const summary = skill.description ? `<span class="summary">${escape(firstSentence(skill.description))}</span>` : '';
  return `<li${shown ? '' : ' hidden'}><a href="#${anchor}"><span class="name">${escape(skill.name)}</span>${summary}</a></li>`;
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
input { flex: 1; font: inherit; padding: .4rem .6rem; border: 1px solid #d0d7de; border-radius: 6px; }
button { font: inherit; padding: .4rem .9rem; border: 1px solid #1f883d; border-radius: 6px; background: #1f883d; color: #fff; cursor: pointer; }
a { color: #0969da; }
.skills { display: grid; grid-template-columns: minmax(14rem, 22rem) 1fr; gap: 1.5rem; align-items: start; }
.list { position: sticky; top: 1rem; max-height: calc(100vh - 2rem); overflow-y: auto; }
.list ul { list-style: none; margin: 0; padding: 0; }
.list a { display: block; padding: .5rem .75rem; margin-bottom: .25rem; border: 1px solid transparent; border-radius: 6px; color: inherit; text-decoration: none; }
.list a:hover { background: #f6f8fa; }
.list .name { display: block; font-weight: 600; }
.list .summary { display: block; font-size: .8125rem; color: #59636e; }
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
