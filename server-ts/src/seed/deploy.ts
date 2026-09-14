import type { Sql } from '../db/pool.ts';
import type { PackedSkill } from './skill-pack.ts';
import { loadPackedSkills } from './skills.ts';

/**
 * What every workspace carries after a deploy: the AgentCore skills pack in its
 * library, and its agents bound to the deployment's own runtime.
 *
 * Run at boot for every workspace, and when a workspace is created, so a fresh
 * deployment is usable without running the development seed. Additive only:
 * a skill already in the library is left as a person may have edited it, and
 * an agent a person bound to another runtime keeps that binding.
 */

/** The committed skills pack, or none when it cannot be read: agents still get seeded. */
export function loadDeploySkills(onError: (error: unknown) => void): PackedSkill[] {
   try {
      return loadPackedSkills();
   } catch (error) {
      onError(error);
      return [];
   }
}

export async function seedWorkspaceDefaults(
   sql: Sql,
   workspaceId: string,
   skills: PackedSkill[]
): Promise<{ skills: number; bound: number }> {
   const now = new Date().toISOString();
   let added = 0;
   for (const skill of skills) {
      const inserted = await sql`
         INSERT INTO skills (
            workspace_id, name, description, content, labels,
            source_kind, source_url, imported_at, created_by, created_at, updated_at
         ) VALUES (
            ${workspaceId}, ${skill.name}, ${skill.description}, ${skill.content}, ${skill.labels},
            'zip', 'seed://berry-agentcore-deep-skills-100', ${now}, NULL, ${now}, ${now}
         )
         ON CONFLICT (workspace_id, name) DO NOTHING
         RETURNING 1`;
      added += inserted.length;
   }

   // The platform row is the deployment's own runtime (syncPlatformRuntime).
   // Without one there is nothing to bind to, and the agents stay unbound.
   const bound = await sql`
      UPDATE agents AS agent
         SET runtime_id = platform.id, updated_at = now()
        FROM agent_runtimes AS platform
       WHERE platform.workspace_id = ${workspaceId} AND platform.kind = 'platform'
         AND agent.workspace_id = ${workspaceId}
         AND agent.archived_at IS NULL AND agent.runtime_id IS NULL
      RETURNING agent.id`;

   return { skills: added, bound: bound.length };
}

/** The same for every workspace; one workspace failing never stops the rest, or the boot. */
export async function seedDefaultsEverywhere(
   sql: Sql,
   skills: PackedSkill[],
   onError: (workspaceId: string, error: unknown) => void
): Promise<void> {
   const workspaces = await sql<Array<{ id: string }>>`SELECT id FROM workspaces WHERE deleted_at IS NULL`;
   for (const workspace of workspaces) {
      await seedWorkspaceDefaults(sql, workspace.id, skills).catch((error: unknown) => onError(workspace.id, error));
   }
}
