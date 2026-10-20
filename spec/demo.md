# Demo video
`npm run demo [-- --out <file.webm>]`: a video of the web view's **filter**, `recordings/filter.webm` by default
- Works on a *remote machine*: a **headless** browser, Playwright's Chromium; *no display*, no network, no `GITHUB_TOKEN`
  - `./fixture`, served as if it were `JetBrains/fixture` on GitHub, as in the tests
- What it shows, each step with a caption and the page's address:
  every skill; `co` typed *letter by letter*; a matching skill selected; `co st`, several words; `zzz`, no match;
  the field emptied, every skill again
- Prints each step, the words and the skills shown, then `Recorded: <file>`
## Errors
- `--out` not a `.webm` file, or other arguments → the usage, exit code 1
- No browser → how to install it, `npx playwright install --only-shell chromium`, exit code 1
