# Web view
`./skill-atlas serve [--port <port>]`: a page at `http://127.0.0.1:<port>/`, port **3000** by default.
A *thin client* like the CLI: it scans on every request; *nothing is stored*.
## Input
A **GitHub repository** URL, in the page's form: `GET /?repo=<URL>`
- GitHub only: the page *never reads local directories*
- Listens on `127.0.0.1` only, and answers only the `Host` `127.0.0.1:<port>` or `localhost:<port>`: no DNS rebinding;
  `GITHUB_TOKEN` as for the CLI
## Output
`<owner>/<repo> · N skills`, linked to the repository, with the scanned commit
- **Master-detail**: the skills in a *left column*, sorted by **name**: name and the description's *first sentence*;
  the *selected* skill on the right: name, the *whole* description, the link pinned to the commit,
  `also in <paths>` for copies, and its **content**: the SKILL.md after the front matter
- The *first* skill is selected by default; selecting another is `#skill-<name>`: *no new scan*, no script (CSS), a link to share
- In `<name>`, anything but letters, digits, `_` and `-` is `-`; the same anchor again gets `-2`, `-3`…
- Selecting a skill keeps the page at the top: the repository stays *in view*
- No skills → `No skills found.`
- **Filter**: a text field *above the list*; `&filter=<word>` shows only the skills whose **name** contains the word,
  ignoring case; empty → every skill
  - **On the fly**: as the word is typed, the list and the skills follow, *no new request*, *no new scan*;
    the address keeps the word, a link to share. The page's *only* script; without it, the field submits
    the word, a new request
  - The anchors stay those of the whole list; the *first matching* skill is selected by default,
    a link to a skill that does not match too
  - No skill matches → `No skills match “<word>”.`, the field still there
- Narrow screens: the list above the skill; selecting one scrolls to it
- Warnings on the page; the scan goes on
- Repository content is *text*, never markup: it is escaped, shown as written
## Errors
- Not a GitHub URL, or an unreachable repository → the clear message on the page, status 400
- Another host → 403; another path → 404, `//<path>` too
- `HEAD`: the headers only, *no scan*; another method → 405, with `Allow: GET, HEAD`
- A port that is not a number, is over 65535, or is taken → a clear message, exit code 1
