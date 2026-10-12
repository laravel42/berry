import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Enabled skills, laid out in the task workspace.
 *
 * Runs inside the container, so it imports nothing from outside
 * `agents/runtime/`. Files go under `.berry/skills/` for `read_skill` and
 * for a shell that opens them. They must not sit in a directory a host CLI
 * scans — Claude (`.claude/skills`), Codex (`.codex/skills`, `.agents/skills`)
 * or Kiro (`.kiro/skills`) — because those attach a listing, and often the
 * bodies, to every model turn. Bedrock and Kilo never scan the disk; they
 * only see what `read_skill` returns.
 */

/** Workspace root no current runtime provider treats as a skill catalogue. */
export const BERRY_SKILL_ROOT = '.berry/skills';

/**
 * Directories a host CLI discovers on its own. Berry never writes a skill
 * here, for any provider.
 */
export const HOST_SKILL_ROOTS = ['.claude/skills', '.codex/skills', '.agents/skills', '.kiro/skills'] as const;

/** Structurally A's `SkillRef`: the server already rendered SKILL.md into `files`. */
export interface EnvelopeSkillLike {
   name: string;
   files: { path: string; content: string }[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

export function skillFileTree(skills: EnvelopeSkillLike[]): { path: string; content: string }[] {
   const out: { path: string; content: string }[] = [];
   for (const skill of skills) {
      if (!NAME.test(skill.name)) {
         throw new Error(`skill name ${JSON.stringify(skill.name)} is not a directory name`);
      }
      if (!skill.files.some((file) => file.path === 'SKILL.md')) {
         throw new Error(`skill ${JSON.stringify(skill.name)} has no SKILL.md`);
      }
      const base = `${BERRY_SKILL_ROOT}/${skill.name}`;
      for (const file of skill.files) {
         const segments = file.path.split('/');
         if (!PATH.test(file.path) || segments.includes('..') || segments.includes('.')) {
            throw new Error(`skill file ${JSON.stringify(file.path)} would leave its directory`);
         }
         out.push({ path: `${base}/${file.path}`, content: file.content });
      }
   }
   return out;
}

/** Writes one file, making its directories. The default is the runtime's own filesystem access. */
export type SkillWriter = (target: string, content: string) => Promise<void>;

const writeDirectly: SkillWriter = async (target, content) => {
   await mkdir(dirname(target), { recursive: true });
   await writeFile(target, content, 'utf8');
};

/**
 * `write` is the session's own writer when sessions are isolated: the skills
 * directory sits in a workspace the agent controls, and the runtime must not
 * follow whatever is there with its own permissions.
 */
export async function writeSkills(root: string, skills: EnvelopeSkillLike[], write: SkillWriter = writeDirectly): Promise<string[]> {
   const base = resolve(root);
   const written: string[] = [];
   for (const file of skillFileTree(skills)) {
      const target = resolve(base, file.path);
      // Belt and braces over the patterns: resolved, it must still be inside root.
      if (!target.startsWith(base + sep)) throw new Error(`refusing to write outside ${base}`);
      await write(target, file.content);
      written.push(file.path);
   }
   return written;
}
