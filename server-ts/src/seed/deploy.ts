import type { Queryable, Sql } from '../db/pool.ts';
import type { PackedSkill } from './skill-pack.ts';
import { loadPackedSkills } from './skills.ts';

/**
 * What every workspace carries after a deploy: the AgentCore skills pack in its
 * library, its role agents bound to the pack skills that match their name, and
 * its agents bound to the deployment's own runtime.
 *
 * Run at boot for every workspace, and when a workspace is created, so a fresh
 * deployment is usable without running the development seed. Additive only:
 * a skill already in the library is left as a person may have edited it, an
 * existing agent↔skill binding is left alone, and an agent a person bound to
 * another runtime keeps that binding.
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
): Promise<{ skills: number; skillBindings: number; bound: number }> {
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

   const skillBindings =
      (await bindRolePackSkills(sql, workspaceId)) +
      (await ensureCapabilitySkills(sql, workspaceId, now));

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

   return { skills: added, skillBindings, bound: bound.length };
}

/**
 * Each pack skill is labeled with a role agent name. Bind those skills to the
 * matching live role agents. Idempotent: a binding that already exists is left
 * alone, including one a person switched off.
 */
export async function bindRolePackSkills(q: Queryable, workspaceId: string): Promise<number> {
   const linked = await q`
      INSERT INTO agent_skills (agent_id, skill_id, workspace_id, enabled)
      SELECT a.id, s.id, ${workspaceId}, true
        FROM agents a
        JOIN skills s ON s.workspace_id = a.workspace_id AND a.name = ANY (s.labels)
       WHERE a.workspace_id = ${workspaceId}
         AND a.archived_at IS NULL
         AND a.role_key IS NOT NULL
      ON CONFLICT (agent_id, skill_id) DO NOTHING
      RETURNING 1`;
   return linked.length;
}

/**
 * Role agents with no catalogue skills yet (the Orchestrator today) get a thin
 * skill per capability tag, then the binding. Pack-backed roles already carry
 * their equivalents and are skipped.
 */
export async function ensureCapabilitySkills(
   q: Queryable,
   workspaceId: string,
   now: string
): Promise<number> {
   const unbound = await q<
      Array<{ id: string; name: string; capabilities: string[] | null }>
   >`
      SELECT a.id, a.name, a.capabilities
        FROM agents a
       WHERE a.workspace_id = ${workspaceId}
         AND a.archived_at IS NULL
         AND a.role_key IS NOT NULL
         AND NOT EXISTS (
            SELECT 1 FROM agent_skills b WHERE b.agent_id = a.id AND b.enabled
         )`;

   let linked = 0;
   for (const agent of unbound) {
      const caps = Array.isArray(agent.capabilities) ? agent.capabilities : [];
      for (const capability of caps) {
         if (!/^[a-z][a-z0-9-]{0,63}$/.test(capability)) continue;
         const description = `${agent.name} capability: ${capability}.`;
         const content =
            `# ${capability}\n\n` +
            `Use when acting as ${agent.name} for work that needs ${capability}.\n`;
         await q`
            INSERT INTO skills (
               workspace_id, name, description, content, labels,
               source_kind, source_url, imported_at, created_by, created_at, updated_at
            ) VALUES (
               ${workspaceId}, ${capability}, ${description}, ${content}, ${[agent.name]},
               'manual', 'seed://role-capability', ${now}, NULL, ${now}, ${now}
            )
            ON CONFLICT (workspace_id, name) DO NOTHING`;
         const [skill] = await q<Array<{ id: string }>>`
            SELECT id FROM skills WHERE workspace_id = ${workspaceId} AND name = ${capability}`;
         if (!skill) continue;
         const inserted = await q`
            INSERT INTO agent_skills (agent_id, skill_id, workspace_id, enabled)
            VALUES (${agent.id}, ${skill.id}, ${workspaceId}, true)
            ON CONFLICT (agent_id, skill_id) DO NOTHING
            RETURNING 1`;
         linked += inserted.length;
      }
   }
   return linked;
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
