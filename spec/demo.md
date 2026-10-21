# Demo video
`npm run demo [-- --out <file.webm>]`: a video of the web view: an **organization**'s chooser, then the **filter**, `recordings/filter.webm` by default
- Works on a *remote machine*: a **headless** browser, Playwright's Chromium; *no display*, no network, no `GITHUB_TOKEN`
  - `./fixture`, served as if it were `JetBrains/fixture` on GitHub, as in the tests, in the organization `JetBrains`,
    listed without a token, with `JetBrains/tools` (one skill) and `JetBrains/docs` (none)
  - Seen as of a fixed time, `2026-10-21 12:00 UTC`: the same `Updated … ago` whenever it is played
- What it shows, each step with a caption and the page's address:
  `https://github.com/JetBrains` typed, its repositories with skills in the chooser; `JetBrains/fixture` chosen, every skill,
  the chooser on top; `co` typed *letter by letter*; a matching skill selected; `co st`, several words; `zzz`, no match;
  the field emptied, every skill again; scrolled down, another skill selected with a click where it is, the page where it was
- Prints each step, the words, the skills shown and the address's anchor (the selected skill), then `Recorded: <file>`
  - the organization's step: its heading and the chooser's repositories instead of the words and the skills
## Screenshot test
`npm run test:screenshots`, part of `npm test`: the same demo, with Playwright Test; each step's page compared with its
screenshot, kept in Git: `e2e/screenshots/<step>.png`, the whole page, without the caption
- The steps: `organization`, `repository`, `filter`, `selected`, `words`, `no-match`, `empty`, `scrolled`
- Rendered by Playwright's headless Chromium on Linux, as in CI; a page changed on purpose →
  `npm run test:screenshots -- --update-snapshots=all`, every one, a change too small to fail the test too, and the new screenshots committed; or the `update-screenshots`
  label on the pull request: CI renders them and commits them to its branch
- A screenshot that does not match → the test fails; in CI, the actual one, the expected one and their diff
  in the run's artifacts
- No browser → skipped, except in CI
## Errors
- `--out` not a `.webm` file, or other arguments → the usage, exit code 1
- No browser → how to install it, `npx playwright install --only-shell chromium`, exit code 1
