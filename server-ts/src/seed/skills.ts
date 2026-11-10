import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from '../db/pool.ts';
import { skillsFromFiles, SOFTWARE_PACK_SOURCE, WORK_PACK_SOURCE, type PackedSkill } from './skill-pack.ts';

const DATA = join(dirname(fileURLToPath(import.meta.url)), 'data');
export const SOFTWARE_PACK = join(DATA, 'berry-software-skills');
export const WORK_PACK = join(DATA, 'berry-work-skills');

/**
 * Every committed pack: eight skills for each catalogue role, software roles
 * in one pack and the specialists beyond software in the other. Names are
 * unique across both, which the pack tests hold.
 */
export function loadPackedSkills(): PackedSkill[] {
   return [...loadSkillFolder(SOFTWARE_PACK, SOFTWARE_PACK_SOURCE), ...loadSkillFolder(WORK_PACK, WORK_PACK_SOURCE)];
}

/** A pack committed as plain folders: `manifest.json` and `<name>/SKILL.md`. */
export function loadSkillFolder(root: string, source: string): PackedSkill[] {
   const byPath = new Map<string, string>();
   for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const full = join(entry.parentPath, entry.name);
      byPath.set(relative(root, full).split(sep).join('/'), readFileSync(full, 'utf8'));
   }
   return skillsFromFiles(byPath, source);
}

/**
 * The committed packs' skills, into one workspace.
 *
 * Idempotent on `(workspace_id, name)`: a second seed refreshes the copy the
 * pack currently holds rather than creating a duplicate catalogue.
 */
export async function upsertPackedSkills(
   tx: Sql,
   workspaceId: string,
   createdBy: string | null,
   now: string,
   skills: PackedSkill[]
): Promise<void> {
   for (const skill of skills) {
      await tx`
         INSERT INTO skills (
            workspace_id, name, description, content, labels,
            source_kind, source_url, imported_at, created_by, created_at, updated_at
         ) VALUES (
            ${workspaceId}, ${skill.name}, ${skill.description}, ${skill.content}, ${skill.labels},
            'zip', ${skill.source}, ${now}, ${createdBy}, ${now}, ${now}
         )
         ON CONFLICT (workspace_id, name) WHERE archived_at IS NULL DO UPDATE SET
            description = EXCLUDED.description,
            content = EXCLUDED.content,
            labels = EXCLUDED.labels,
            source_kind = EXCLUDED.source_kind,
            source_url = EXCLUDED.source_url,
            imported_at = EXCLUDED.imported_at,
            updated_at = EXCLUDED.updated_at
      `;
   }
   const labels = [...new Set(skills.flatMap((skill) => skill.labels))];
   if (labels.length === 0) return;
   await tx`
      INSERT INTO skill_labels (workspace_id, name, color, created_by)
      SELECT ${workspaceId}, label, berry_skill_label_color(label), ${createdBy}
        FROM unnest(${labels}::text[]) AS label
      ON CONFLICT (workspace_id, lower(name)) WHERE archived_at IS NULL DO NOTHING
   `;
}
