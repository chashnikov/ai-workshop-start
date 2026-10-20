/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/**
 * Every `<root>/skills/<name>/SKILL.md`, named after its directory; nothing else is a skill.
 * The same name in other roots is the same skill: the first path is the skill, the rest its copies.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const skills = new Map<string, SkillFile>();
  for (const path of [...paths].sort()) {
    const segments = path.split('/');
    if (segments.length !== 4 || segments[3] !== 'SKILL.md') continue;
    if (!SKILL_ROOTS.includes(`${segments[0]}/${segments[1]}`)) continue;
    const name = segments[2];
    const skill = skills.get(name);
    if (skill) skill.copies.push(path);
    else skills.set(name, { path, name, copies: [] });
  }
  return [...skills.values()];
}
