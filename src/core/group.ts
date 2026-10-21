// Similar skills, together: as a model groups them (clusterSkills), else the skills that share a keyword
// of their names and descriptions (groupSkills).
import type { Skill } from './model.ts';

/** A group of similar skills: its name, or `Other` for those left. */
export type Group = { name: string; skills: Skill[] };

/**
 * Groups the skills, told as their names and descriptions: its answer should be groups of their numbers,
 * their indexes, each with a name. Anything else is checked, and dropped, by clusterSkills.
 */
export type Cluster = (skills: { name: string; description: string }[]) => Promise<unknown>;

/** The longest name of a group: a model's answer is cut there. */
const LONGEST = 40;

/**
 * The skills, sorted, in the groups `cluster` answers, once checked: a group's name is its text, its
 * whitespace collapsed, cut at LONGEST letters; a skill is in its first group only, one it does not
 * know is dropped; the groups with the same name, ignoring case, are one; a group of fewer than two
 * skills, unnamed, or `Other`, is none, nor is one of every skill. The groups sorted by name, `Other`
 * last, with the skills in no group; none when no group is left. Fails as `cluster` does, or when
 * its answer is not a list.
 */
export async function clusterSkills(skills: Skill[], cluster: Cluster): Promise<Group[]> {
  const answer = await cluster(skills.map(({ name, description }) => ({ name, description })));
  if (!Array.isArray(answer)) throw new Error('the groups are not a list');
  const taken = new Set<number>();
  const named = new Map<string, { name: string; members: number[] }>();
  for (const group of answer as { name?: unknown; skills?: unknown }[]) {
    const name = typeof group?.name === 'string' ? group.name.replace(/\s+/g, ' ').trim().slice(0, LONGEST).trim() : '';
    if (!name || name.toLowerCase() === 'other' || !Array.isArray(group.skills)) continue;
    const members: number[] = [];
    for (const index of group.skills) {
      if (!Number.isInteger(index) || index < 0 || index >= skills.length || taken.has(index)) continue;
      taken.add(index);
      members.push(index);
    }
    const same = named.get(name.toLowerCase());
    if (same) same.members.push(...members);
    else named.set(name.toLowerCase(), { name, members });
  }
  const groups = [...named.values()].filter(({ members }) => members.length >= 2 && members.length < skills.length);
  if (!groups.length) return [];
  const sorted = (members: number[]) => members.sort((a, b) => compare(skills[a].name, skills[b].name) || a - b).map((index) => skills[index]);
  const result = groups.map(({ name, members }) => ({ name, skills: sorted(members) })).sort((a, b) => compare(a.name, b.name));
  const grouped = new Set(groups.flatMap(({ members }) => members));
  const left = skills.map((_, index) => index).filter((index) => !grouped.has(index));
  if (left.length) result.push({ name: 'Other', skills: sorted(left) });
  return result;
}

/** Words too common to make two skills similar. */
const STOPWORDS = new Set(
  `about above after again against all also always and any are because been before being below between both but can
  could did does doing done each either etc every for from had has have having her here hers him his how into its just
  like make makes many may more most must need needs never not now off once only other our out over own per same
  she should since some such than that the their them then there these they this those through too under until upon
  use used uses using very via was way well were what when where whether which while who whom why will with within
  without would yet you your skill skills`.split(/\s+/),
);

/**
 * The skills, sorted, in groups: the keyword shared by the most skills not in a group yet, two at least
 * and not every one of them, makes a group of them; a tie goes to the keyword in more of their names, then to
 * the first one in alphabetical order; again, until no keyword is shared. Keywords are the words of the
 * name and the description, ignoring case, of three letters or more but common ones, with their endings
 * (`-s`, `-es`, `-ed`, `-ing`, `-e`) dropped: `commits` and `committing` are the same keyword.
 * The groups are sorted by name, `Other` last, with the skills in no group; none when no keyword is shared.
 */
export function groupSkills(skills: Skill[]): Group[] {
  const keywords = skills.map((skill) => ({ name: words(skill.name), all: words(`${skill.name} ${skill.description}`) }));
  const left = new Set(skills.map((_, index) => index));
  const groups: Group[] = [];
  for (;;) {
    const sharing = new Map<string, number[]>();
    for (const index of left) for (const stem of keywords[index].all.keys()) sharing.set(stem, [...(sharing.get(stem) ?? []), index]);
    const named = (stem: string) => sharing.get(stem)!.filter((index) => keywords[index].name.has(stem)).length;
    const [best] = [...sharing.keys()]
      .filter((stem) => sharing.get(stem)!.length >= 2 && sharing.get(stem)!.length < left.size)
      .sort((a, b) => sharing.get(b)!.length - sharing.get(a)!.length || named(b) - named(a) || compare(a, b));
    if (!best) break;
    const members = sharing.get(best)!;
    for (const index of members) left.delete(index);
    groups.push({ name: label(members.map((index) => keywords[index].all.get(best)!)), skills: members.map((index) => skills[index]) });
  }
  if (!groups.length) return [];
  groups.sort((a, b) => compare(a.name, b.name));
  if (left.size) groups.push({ name: 'Other', skills: [...left].map((index) => skills[index]) });
  return groups;
}

/** The keywords of a text, each with the ways it is written there. */
function words(text: string): Map<string, Set<string>> {
  const keywords = new Map<string, Set<string>>();
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 3 || /^\d+$/.test(word) || STOPWORDS.has(word)) continue;
    const key = stem(word);
    keywords.set(key, (keywords.get(key) ?? new Set()).add(word));
  }
  return keywords;
}

/** The word without its ending: `testing`, `tests` → `test`; `committing`, `commits` → `commit`. */
function stem(word: string): string {
  const ending = ['ing', 'ed', 'es', 's', 'e'].find((ending) => word.endsWith(ending) && word.length - ending.length >= 3);
  const stem = ending ? word.slice(0, -ending.length) : word;
  return /([b-df-hj-np-tv-z])\1$/.test(stem) ? stem.slice(0, -1) : stem;
}

/** A group's name: the way its keyword is written in most of its skills, else the shortest, then the first. */
function label(writings: Set<string>[]): string {
  const counts = new Map<string, number>();
  for (const words of writings) for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const [name] = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.length - b.length || compare(a, b));
  return name;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
