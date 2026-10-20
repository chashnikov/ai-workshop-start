# Demo video
`npm run demo [-- --out <file.webm>]`: a video of the web view: an **organization**'s chooser, then the **filter**, `recordings/filter.webm` by default
- Works on a *remote machine*: a **headless** browser, Playwright's Chromium; *no display*, no network, no `GITHUB_TOKEN`
  - `./fixture`, served as if it were `JetBrains/fixture` on GitHub, as in the tests, in the organization `JetBrains`,
    listed without a token, with `JetBrains/tools` (one skill) and `JetBrains/docs` (none)
- What it shows, each step with a caption and the page's address:
  `https://github.com/JetBrains` typed, its repositories with skills in the chooser; `JetBrains/fixture` chosen, every skill,
  the chooser on top; `co` typed *letter by letter*; a matching skill selected; `co st`, several words; `zzz`, no match;
  the field emptied, every skill again
- Prints each step, the words, the skills shown and the address's anchor (the selected skill), then `Recorded: <file>`
  - the organization's step: its heading and the chooser's repositories instead of the words and the skills
## Errors
- `--out` not a `.webm` file, or other arguments → the usage, exit code 1
- No browser → how to install it, `npx playwright install --only-shell chromium`, exit code 1
