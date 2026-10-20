# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every `SKILL.md`: **name**, **description**, **link**, **content**
## Architecture
Core: fetch → find → parse. CLI and web view ([web.md](web.md)): *thin clients*.
Skill: id = `repo:path`, name, description, body, commit
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
## Skill definition
Skill is defined by a `<root>/skills/<name>/SKILL.md` file where:
* `<name>`: the skill name
* `<root>`: one of `.agents`, `.claude`, `agent`, `.github` directory located in the repository root;
* Skills with the same name in different roots are the same skill: listed once, the others are its copies.
* Files in other directories must not be considered as skills.
