import { z } from 'zod';
import { parseSkillMarkdown } from '../skills/frontmatter.ts';
import { SkillImportError } from '../skills/github-import.ts';
import { readZip } from '../skills/zip.ts';

/** One skill from the AgentCore deep-skills pack, ready to upsert. */
export interface PackedSkill {
   name: string;
   description: string;
   content: string;
   labels: string[];
}

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

const entrySchema = z.object({
   name: z.string().regex(NAME),
   role: z.string().min(1).max(40),
   description: z.string().min(1).max(1024),
   path: z.string().min(1),
});

const manifestSchema = z.array(entrySchema).min(1);

/**
 * The 100-skill pack is a zip of folders, each with a SKILL.md, plus a
 * manifest. Berry's zip import is one skill per archive, so the seeder splits
 * the pack here rather than posting it at `/skills/import/zip`.
 *
 * Name and description come from the manifest: every SKILL.md folds its
 * description across lines, and the catalogue parser only reads one-line keys.
 * The body is still the instructions an agent should follow.
 */
export function skillsFromPack(bytes: Buffer): PackedSkill[] {
   // One skill archive is 100 files / 1 MiB; this pack is 100 skills plus a
   // manifest and a README, so the seeder asks for a larger envelope.
   const files = unwrap(readZip(bytes, { maxFiles: 512, maxBytes: 4 << 20 }));
   const byPath = new Map(files.map((file) => [file.path, file.content]));
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
      };
   });
}

function unwrap(entries: { path: string; content: Buffer }[]): { path: string; content: string }[] {
   const text = entries.filter((entry) => !entry.content.includes(0) && !entry.path.startsWith('__MACOSX/'));
   const tops = new Set(text.map((entry) => entry.path.split('/')[0]));
   const [only] = [...tops];
   const strip =
      tops.size === 1 && only !== undefined && !text.some((entry) => entry.path === only) ? `${only}/` : '';
   return text
      .map((entry) => ({ path: entry.path.slice(strip.length), content: entry.content.toString('utf8') }))
      .filter((file) => file.path !== '');
}
