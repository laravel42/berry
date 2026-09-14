import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from '../db/pool.ts';
import { skillsFromPack, type PackedSkill } from './skill-pack.ts';

const PACK = join(dirname(fileURLToPath(import.meta.url)), 'data', 'berry-agentcore-deep-skills-100.zip');

/** Load the committed AgentCore deep-skills pack from disk. */
export function loadPackedSkills(path: string = PACK): PackedSkill[] {
   return skillsFromPack(readFileSync(path));
}

/**
 * The 100 AgentCore deep skills, into every workspace that exists.
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
            'zip', 'seed://berry-agentcore-deep-skills-100', ${now}, ${createdBy}, ${now}, ${now}
         )
         ON CONFLICT (workspace_id, name) DO UPDATE SET
            description = EXCLUDED.description,
            content = EXCLUDED.content,
            labels = EXCLUDED.labels,
            source_kind = EXCLUDED.source_kind,
            source_url = EXCLUDED.source_url,
            imported_at = EXCLUDED.imported_at,
            updated_at = EXCLUDED.updated_at
      `;
   }
}
