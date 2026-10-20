# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

For an organization, `./skill-atlas scan https://github.com/<organization>` lists its repositories with skills.

`./skill-atlas serve` opens the same in a browser, at http://127.0.0.1:3000/, with each skill's content and when it was last updated; for an organization, a chooser of its repositories.

`npm run demo` records a video of its organization chooser and filter, in a headless browser: on a remote machine too, with no
display ([spec/demo.md](spec/demo.md)).

```console
$ npx playwright install --only-shell chromium   # once; add --with-deps, as root, for the system libraries
$ npm run demo
Recorded: …/recordings/filter.webm
```

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests, and the demo as a screenshot test:
each key moment compared with its screenshot in [e2e/screenshots/](e2e/screenshots/).

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
