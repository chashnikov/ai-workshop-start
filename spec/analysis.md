# Repository analysis
## Input
A **GitHub repository** URL, or a local directory; or a **GitHub organization** URL, see [Organization](#organization)
## Output
Every `SKILL.md`: **name**, **description**, **link**, **content**
## Architecture
Core: fetch → find → parse. CLI and web view ([web.md](web.md)): *thin clients*.
Skill: id = `repo:path`, name, description, body, commit, **last updated**
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- **Last updated**: the time of the last commit to the skill's SKILL.md, up to the scanned commit; its copies' are not asked for
  - GitHub: a request per skill, `commits?sha=<commit>&path=<path>&per_page=1`; a local directory: none, not known
  - It cannot be read, the rate limit say → not known, *one warning*: `the last update of N skills cannot be read: <message>`;
    the scan goes on
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
## Skill definition
Skill is defined by a `<root>/skills/<name>/SKILL.md` file where:
* `<name>`: the skill name
* `<root>`: one of `.agents`, `.claude`, `agent`, `.github` directory located in the repository root;
* Skills with the same name in different roots are the same skill: listed once, the others are its copies.
* Files in other directories must not be considered as skills.
## Organization
A **GitHub organization** URL: `https://github.com/<organization>`, or `https://github.com/orgs/<organization>`;
a user's `https://github.com/<user>` too
- Every repository of the organization is scanned; only those that **have skills** are shown, sorted by **id**,
  each with the number of its skills, as defined above
- Do not process forks
- A repository that cannot be listed, an empty one say → a *warning*, the scan goes on;
  the rate limit → the clear message, the scan stops: no more repositories are asked for
- **Progress** as it goes: `Listing the repositories of <organization>…`, `Listed 3 of 40 repositories of <organization>…`,
  or `Searching the repositories of <organization> for SKILL.md files…`; `Read the skills of 2 of 5 repositories…`
  when the skills are read too ([web.md](web.md#organization))
- Unknown organization → `Organization not found: https://github.com/<organization>`, exit code 1
