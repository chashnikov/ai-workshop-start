# Web view
`./skill-atlas serve [--port <port>]`: a page at `http://127.0.0.1:<port>/`, port **3000** by default.
A *thin client* like the CLI: it scans on every request; *nothing is stored*.
## Input
A **GitHub repository** URL, in the page's form: `GET /?repo=<URL>`
- GitHub only: the page *never reads local directories*
- Listens on `127.0.0.1` only; `GITHUB_TOKEN` as for the CLI
## Output
`<owner>/<repo> · N skills`, linked to the repository, with the scanned commit
- **Master-detail**: the skills in a *left column*, sorted by **name**: name and the description's *first sentence*;
  the *selected* skill on the right: name, the *whole* description, the link pinned to the commit,
  `also in <paths>` for copies, and its **content**: the SKILL.md after the front matter
- The *first* skill is selected by default; selecting another is `#skill-<name>`: *no new scan*, no script, a link to share
- No skills → `No skills found.`
- Narrow screens: the list above the skill
- Warnings on the page; the scan goes on
- Repository content is *text*, never markup: it is escaped, shown as written
## Errors
- Not a GitHub URL, or an unreachable repository → the clear message on the page, status 400
- Another path → 404; another method than `GET` → 405
- A port that is not a number, or is taken → a clear message, exit code 1
