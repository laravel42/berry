import { z } from 'zod';
import { parseSkillMarkdown } from '../skills/frontmatter.ts';
import { SkillImportError } from '../skills/github-import.ts';

/** One skill from a committed pack, ready to upsert. */
export interface PackedSkill {
   name: string;
   description: string;
   content: string;
   labels: string[];
   /** The pack it came from, recorded as the skill's `source_url`. */
   source: string;
}

/** Eight skills for each software role, the Orchestrator, Planner and Reviewer included. */
export const SOFTWARE_PACK_SOURCE = 'seed://berry-software-skills';
/** Eight skills for each specialist beyond software. */
export const WORK_PACK_SOURCE = 'seed://berry-work-skills';

/** How many skills each catalogue role carries, and so each role agent is bound to. */
export const SKILLS_PER_ROLE = 8;

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const entrySchema = z.object({
   name: z.string().regex(NAME),
   role: z.string().min(1).max(40),
   description: z.string().min(1).max(1024),
   path: z.string().min(1),
});

const manifestSchema = z.array(entrySchema).min(1);

/**
 * A pack's files by path relative to its root: `manifest.json` plus each
 * entry's `SKILL.md`.
 *
 * Name, role and description come from the manifest: the software pack's
 * SKILL.md files fold their description across lines, and the catalogue
 * parser only reads one-line keys. The body is the instructions an agent
 * follows.
 */
export function skillsFromFiles(byPath: ReadonlyMap<string, string>, source: string): PackedSkill[] {
   const raw = byPath.get('manifest.json');
   if (!raw) throw new SkillImportError('SKILL_MANIFEST_MISSING', 'The pack has no manifest.json.');
   let parsed: unknown;
   try {
      parsed = JSON.parse(raw);
   } catch {
      throw new SkillImportError('SKILL_ARCHIVE_INVALID', 'The pack manifest is not JSON.');
   }
   const manifest = manifestSchema.parse(parsed);
   return manifest.map((entry) => {
      const markdown = byPath.get(entry.path);
      if (!markdown) {
         throw new SkillImportError(
            'SKILL_MANIFEST_MISSING',
            `${entry.name} has no ${entry.path} in the pack.`
         );
      }
      const { body } = parseSkillMarkdown(markdown);
      if (body.trim() === '') {
         throw new SkillImportError('SKILL_MANIFEST_MISSING', `${entry.name} has an empty SKILL.md.`);
      }
      return {
         name: entry.name,
         description: entry.description,
         content: body,
         labels: [entry.role],
         source,
      };
   });
}
