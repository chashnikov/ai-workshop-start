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
 * `GET /` is the form; `GET /?repo=<URL>` is the form and the repository's skills. Only for this
 * machine's own addresses: a page elsewhere must not read it through DNS rebinding.
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
    try {
      send(200, page(input, result(await scan(await open(input)))));
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
 * `<owner>/<repo> · N skills`, the warnings, then master-detail: the skills on the left, the
 * selected one on the right. Every skill is on the page, so selecting one is `#<anchor>` and
 * CSS `:target`, with the first one selected by default: no request, no script.
 */
function result({ repository, skills, warnings }: ScanResult): string {
  const count = `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  const commit = repository.commit ? ` at <code>${escape(repository.commit.slice(0, 7))}</code>` : '';
  const anchors = anchorsOf(skills);
  const heading = `<h2 class="repository"><a href="${escape(repository.url)}">${escape(repository.id)}</a> · ${count}${commit}</h2>
${warnings.length ? `<ul class="warnings">${warnings.map((warning) => `<li>warning: ${escape(warning)}</li>`).join('')}</ul>` : ''}`;
  if (!skills.length) return `${heading}\n<p class="empty">No skills found.</p>`;
  // The selected skill's item in the list: anchors are [\w-] only, safe in CSS as they are.
  const selected = anchors.map((id) => `body:has(#${id}:target) .list a[href="#${id}"]`).join(',\n');
  return `${heading}
<style>
${selected},
.skills:not(:has(.detail:target)) .list li:first-child a { background: #ddf4ff; border-color: #54aeff; }
</style>
<div class="skills">
<nav class="list"><ul>
${skills.map((skill, index) => listItem(skill, anchors[index])).join('\n')}
</ul></nav>
<div class="details">
${skills.map((skill, index) => detail(repository, skill, anchors[index])).join('\n')}
</div>
</div>`;
}

function listItem(skill: Skill, anchor: string): string {
  const summary = skill.description ? `<span class="summary">${escape(firstSentence(skill.description))}</span>` : '';
  return `<li><a href="#${anchor}"><span class="name">${escape(skill.name)}</span>${summary}</a></li>`;
}

function detail(repository: Repository, skill: Skill, anchor: string): string {
  const link = skillLink(repository, skill);
  return `<section class="detail" id="${anchor}">
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
form { display: flex; flex: 1; gap: .5rem; min-width: 20rem; }
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
.detail:target, .details:not(:has(.detail:target)) .detail:first-child { display: block; }
.detail h3 { font-size: 1.5rem; }
.description { margin-top: 0; }
.link, .copies { font-size: .875rem; margin: .25rem 0; }
.content { background: #f6f8fa; border-radius: 6px; padding: .75rem; overflow-x: auto; white-space: pre-wrap; font-size: .875rem; }
.empty { color: #59636e; }
.content.empty { background: none; padding: 0; }
.warnings { color: #9a6700; }
.error { color: #d1242f; font-weight: 600; }
@media (max-width: 48rem) { .skills { grid-template-columns: 1fr; } .list { position: static; max-height: none; } }
`;
