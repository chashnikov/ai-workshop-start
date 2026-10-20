# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.claude/skills/code-style` | the same skill in another root: a copy |
| `agent/skills/testing` | a skill in the `agent` root |
| `.agents/skills/release-checklist` | malformed front matter |
| `SKILL.md` | not a skill: at the repository root |
| `docs/skills/not-a-skill` | not a skill: not in a skill root |
| `nested/.claude/skills/not-a-skill` | not a skill: the root is not at the repository root |
| `.claude/SKILL.md` | not a skill: not in `skills/<name>` |
| `.claude/skills/SKILL.md` | not a skill: not in `skills/<name>` |
| `.claude/skills/not-a-skill/nested` | not a skill: too deep |
| `.claude/skills/not-a-skill/skill.md` | not a skill: not named exactly `SKILL.md` |
