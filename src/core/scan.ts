import { findSkills, type SkillFile } from './find.ts';
import { AtlasError } from './errors.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** When the file was last updated, as an ISO time, empty if it has no commit; none for a local directory. */
  updated?(path: string): Promise<string>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  // A skill whose last update cannot be read is still a skill: one warning for all of them.
  const unknown = results.flatMap((result) => (result.skill && result.unknown ? [result.unknown] : []));
  const updates = unknown.length
    ? [`the last update of ${unknown.length} ${unknown.length === 1 ? 'skill' : 'skills'} cannot be read: ${unknown[0].message}`]
    : [];
  return {
    repository: source.repository,
    skills: sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : []))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : [])), ...updates],
  };
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warning?: string; unknown?: AtlasError }> {
  // Both at once: on GitHub, each one is a request.
  const [bytes, updated] = await Promise.all([
    source.read(file.path),
    (source.updated?.(file.path) ?? Promise.resolve('')).catch((error: unknown) => {
      if (error instanceof AtlasError) return error;
      throw error;
    }),
  ]);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    body: parsed.body,
    commit: source.repository.commit,
    updated: typeof updated === 'string' ? updated : '',
    copies: file.copies,
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}`, unknown: typeof updated === 'string' ? undefined : updated };
}
