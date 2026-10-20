// The web view: a page that takes a GitHub repository URL and shows its skills and their content.
// A thin client like the CLI: it scans on every request and stores nothing.
import { createServer, type Server } from 'node:http';
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type ScanResult, type Source } from './core/scan.ts';

export type WebOptions = {
  /** Opens the repository the page asks for. */
  open(input: string): Promise<Source>;
};

/** `GET /` is the form; `GET /?repo=<URL>` is the form and the repository's skills. */
export function createWebServer({ open }: WebOptions): Server {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const send = (status: number, html: string) => {
      response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') return send(405, page('', error('Only GET is supported')));
    if (url.pathname !== '/') return send(404, page('', error(`Not found: ${url.pathname}`)));
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

/** `<owner>/<repo> · N skills`, the warnings, a table of contents, then each skill in full. */
function result({ repository, skills, warnings }: ScanResult): string {
  const count = `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  const commit = repository.commit ? ` at <code>${escape(repository.commit.slice(0, 7))}</code>` : '';
  return `
<h2 class="repository"><a href="${escape(repository.url)}">${escape(repository.id)}</a> · ${count}${commit}</h2>
${warnings.length ? `<ul class="warnings">${warnings.map((warning) => `<li>warning: ${escape(warning)}</li>`).join('')}</ul>` : ''}
${skills.length ? `<nav><ul>${skills.map((skill) => `<li><a href="#${anchor(skill)}">${escape(skill.name)}</a></li>`).join('')}</ul></nav>` : ''}
${skills.map((skill) => skillSection(repository, skill)).join('\n')}`;
}

function skillSection(repository: Repository, skill: Skill): string {
  const link = skillLink(repository, skill);
  return `<section class="skill" id="${anchor(skill)}">
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

/** Skill names are unique in a scan: they make the anchors. */
function anchor(skill: Skill): string {
  return `skill-${encodeURIComponent(skill.name)}`;
}

/** Everything from a repository is text, never markup. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const STYLE = `
body { font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 0 1rem 3rem; color: #1f2328; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #d0d7de; }
header h1 { font-size: 1.25rem; margin: 0; }
header h1 a { color: inherit; text-decoration: none; }
form { display: flex; flex: 1; gap: .5rem; min-width: 20rem; }
input { flex: 1; font: inherit; padding: .4rem .6rem; border: 1px solid #d0d7de; border-radius: 6px; }
button { font: inherit; padding: .4rem .9rem; border: 1px solid #1f883d; border-radius: 6px; background: #1f883d; color: #fff; cursor: pointer; }
a { color: #0969da; }
nav ul { display: flex; flex-wrap: wrap; gap: .25rem 1rem; list-style: none; padding: 0; }
.skill { border: 1px solid #d0d7de; border-radius: 6px; padding: 0 1rem 1rem; margin: 1rem 0; }
.description { margin-top: 0; }
.link, .copies { font-size: .875rem; margin: .25rem 0; }
.content { background: #f6f8fa; border-radius: 6px; padding: .75rem; overflow-x: auto; white-space: pre-wrap; font-size: .875rem; }
.empty { color: #59636e; background: none; padding: 0; }
.warnings { color: #9a6700; }
.error { color: #d1242f; font-weight: 600; }
`;
