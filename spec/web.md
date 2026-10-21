# Web view
`./skill-atlas serve [--port <port>]`: a page at `http://127.0.0.1:<port>/`, port **3000** by default.
A *thin client* like the CLI: it scans on every request; *nothing is stored*, but the organizations scanned lately
([Organization](#organization)), in memory.
## Input
A **GitHub repository** URL, in the page's form: `GET /?repo=<URL>`
- GitHub only: the page *never reads local directories*
- Listens on `127.0.0.1` only, and answers only the `Host` `127.0.0.1:<port>` or `localhost:<port>`: no DNS rebinding;
  `GITHUB_TOKEN` as for the CLI
## Output
`<owner>/<repo> · N skills`, linked to the repository, with the scanned commit
- **Master-detail**: the skills in a *left column*, sorted by **name**: name, the description's *first sentence*, and when it
  was **last updated** ([analysis.md](analysis.md#details)), **relative**: `Updated 3 days ago`, as of when the page is served, no script;
  in its largest whole unit: `just now` (under a minute, or a time still to come), `N minutes`, `N hours`, `N days`,
  `N months` (30 days), `N years` (365 days), `1 day ago` not `1 days`; the date and time in *UTC*, `2026-10-20 15:05 UTC`, as its *tooltip*;
  nothing when not known;
  the *selected* skill on the right: name, the *whole* description, the link pinned to the commit,
  `also in <paths>` for copies, and its **content**: the SKILL.md after the front matter
- **Groups**: *similar* skills together in the list, each group under its name; on the right, the skills in the same order
  - Similar: they share a **keyword** of their **name** and **description**: a word of *3 letters or more*, ignoring case,
    but the common ones (`the`, `use`, `when`, `skill`…), its ending dropped: `-s`, `-es`, `-ed`, `-ing`, `-e`, and a doubled
    last letter: `commits`, `committing` → `commit`
  - The keyword shared by the *most* skills not in a group yet, *2* at least and *not every one of them*, makes a group of them; a tie:
    the keyword in more of their names, then the first one in alphabetical order; again, until no keyword is shared
  - Its name: the keyword as most of its skills write it, else the shortest, then the first; the groups sorted by **name**,
    then `Other`: the skills in no group; in a group, the skills sorted by name
  - No keyword shared → no groups: the list as it was, every skill sorted by name
  - The filter: a group with no skill shown is not shown either; the groups stay those of the whole list
- The *first* skill is selected by default, the first one of the first group; selecting another is `#skill-<name>`: *no new scan*, no script (CSS), a link to share
- In `<name>`, anything but letters, digits, `_` and `-` is `-`; the same anchor again gets `-2`, `-3`…
- Selecting a skill *does not move the page*: scrolled down, the list and the skill stay where they were, skills below the
  first screen too (warnings above them, say); at the top, the repository stays *in view*. A link to a skill: the page at the top
- No skills → `No skills found.`
- **Filter**: a text field *above the list*, *no button*; `&filter=<words>` shows only the skills whose **name**
  contains *every* word, in any order, ignoring case; words are separated by spaces; empty → every skill
  - **On the fly**: as the word is typed, the list and the skills follow, *no new request*, *no new scan*;
    the address keeps the words, a link to share. The page's *only* script; with it, Enter submits nothing;
    without it, Enter in the field submits the words, a new request
  - A video of it: [demo.md](demo.md)
  - The anchors stay those of the whole list; the *first matching* skill is selected by default,
    a link to a skill that does not match too
  - No skill matches → `No skills match “<words>”.`, the field still there
- Narrow screens: the list above the skill; selecting one scrolls to it
- Warnings on the page; the scan goes on
- Repository content is *text*, never markup: it is escaped, shown as written
## Organization
A **GitHub organization** URL in the same form: `GET /?repo=<organization URL>`, as in [analysis.md](analysis.md#organization)
- **Progress** as the page loads: what the scan is doing, `Listed 3 of 40 repositories of <organization>…`,
  `Read the skills of 2 of 5 repositories…`; only the latest one shown, none once the page has what it found; no script
- `<organization> · N repositories with skills`, linked to the organization; the warnings
- A **chooser** of the repositories with skills, sorted by **id**: `<owner>/<repo> · N skills`; nothing chosen yet.
  *No script*: a form, `Show skills` submits it
- Choosing one is `GET /?org=<organization URL>&repo=<repository URL>`: the chooser again, the repository chosen,
  then the repository's skills, as above; the filter keeps the organization
- Scanning the organization reads every repository's skills too, as a scan of it does, and **keeps** them, in memory:
  choosing a repository then shows its skills **at once**, *no request* to GitHub, the filter too; as they were scanned
  - Kept *10 minutes*, the *10* organizations scanned last; the organization's page always scans again
  - Not kept → listed, *not read*, kept again, and the repository scanned, as before: the others are read as they are
    chosen; without `GITHUB_TOKEN`, a request per repository of the organization; with it, two code searches or more
    (10 a minute); and when each skill was last updated, a request per skill
  - Kept, but a repository without its skills read, or not in it → only the repository scanned, *no new listing*;
    one of its repositories is kept with it, shown at once when chosen again; the organization's warnings stay those
    of its scan
  - A repository whose skills cannot be read → a *warning*; chosen, it is scanned. The rate limit while they are read →
    the reading stops, not the scan: the chooser all the same, a *warning* for those not read
  - As a scan of the repository shows it: its own warnings, a tree too large say, too
- The organization cannot be listed → the repository is still shown, a *warning* instead of the chooser;
  `org` not an organization URL → the clear message, status 400
- No repository with skills → `No repositories with skills found.`, no chooser
- A failure once the progress is on the page, the rate limit say → the clear message on the page, after it:
  the status is already 200
## Errors
- Not a GitHub URL, or an unreachable repository or organization → the clear message on the page, status 400
- Another host → 403; another path → 404, `//<path>` too
- `HEAD`: the headers only, *no scan*; another method → 405, with `Allow: GET, HEAD`
- A port that is not a number, is over 65535, or is taken → a clear message, exit code 1
