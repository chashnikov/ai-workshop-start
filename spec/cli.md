# Command line
`./skill-atlas scan <GitHub URL | directory>`; for an organization URL, its repositories with skills
`./skill-atlas serve [--port <port>]`: the web view, [web.md](web.md)
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
### Organization
```
JetBrains · 2 repositories with skills
JetBrains/intellij-community · 12 skills
  https://github.com/JetBrains/intellij-community
JetBrains/kotlin · 6 skills
  https://github.com/JetBrains/kotlin
```
- Only the repositories with skills, sorted by **id**; `./skill-atlas scan <repository URL>` shows the skills of one
- The **progress** on *stderr*, on one line, cleared before the result: on a terminal only, nothing in a file or a pipe
