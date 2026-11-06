import type { Queryable, Sql } from '../db/pool.ts';
import { ensureOrganizationAgents } from '../organization/provision.ts';
import type { PackedSkill } from './skill-pack.ts';
import { loadPackedSkills } from './skills.ts';
import { CATALOG } from '../organization/catalog.ts';

/**
 * What every workspace carries after a deploy: the committed skill packs (the
 * AgentCore software skills and the work skills beyond software) in its library, its role agents bound to the pack skills that match their name, and
 * its agents bound to the deployment's own runtime.
 *
 * Run at boot for every workspace, and when a workspace is created, so a fresh
 * deployment is usable without running the development seed. Additive only:
 * a skill already in the library is left as a person may have edited it, an
 * existing agent↔skill binding is left alone, and an agent a person bound to
 * another runtime keeps that binding.
 */

/** The committed skill packs, or none when they cannot be read: agents still get seeded. */
export function loadDeploySkills(onError: (error: unknown) => void): PackedSkill[] {
   try {
      return loadPackedSkills();
   } catch (error) {
      onError(error);
      return [];
   }
}

export interface AutoseedWorkspaceOptions {
   skills: PackedSkill[];
   /** Best-effort platform runtime row; a failure must not skip skills. */
   syncRuntime?: () => Promise<void>;
   onError?: (step: 'organization' | 'runtime' | 'skills', error: unknown) => void;
}

/**
 * Everything a brand-new workspace needs before a person opens it: the role
 * organization, the skill packs (and bindings) and the platform runtime
 * binding. No autopilots: weekly discovery is switched on by a person, which
 * is what provisions it (organization/discovery.ts).
 *
 * Idempotent. Each step is independent — a missing runtime never blocks
 * skills. Called from workspace create and safe to re-run on boot.
 */
export async function autoseedWorkspace(
   sql: Sql,
   workspaceId: string,
   options: AutoseedWorkspaceOptions
): Promise<void> {
   const fail = (step: 'organization' | 'runtime' | 'skills', error: unknown) => {
      options.onError?.(step, error);
   };

   await ensureOrganizationAgents(sql, workspaceId).catch((error: unknown) => fail('organization', error));

   if (options.syncRuntime) {
      await options.syncRuntime().catch((error: unknown) => fail('runtime', error));
   }

   await seedWorkspaceDefaults(sql, workspaceId, options.skills).catch((error: unknown) =>
      fail('skills', error)
   );
}

export async function seedWorkspaceDefaults(
   sql: Sql,
   workspaceId: string,
   skills: PackedSkill[]
): Promise<{ skills: number; skillBindings: number; skillLabels: number; bound: number }> {
   const now = new Date().toISOString();
   let added = 0;
   for (const skill of skills) {
      const inserted = await sql`
         INSERT INTO skills (
            workspace_id, name, description, content, labels,
            source_kind, source_url, imported_at, created_by, created_at, updated_at
         ) VALUES (
            ${workspaceId}, ${skill.name}, ${skill.description}, ${skill.content}, ${skill.labels},
            'zip', ${skill.source}, ${now}, NULL, ${now}, ${now}
         )
         ON CONFLICT (workspace_id, name) WHERE archived_at IS NULL DO NOTHING
         RETURNING 1`;
      added += inserted.length;
   }

   const skillBindings = await bindRolePackSkills(sql, workspaceId);

   // After the pack skills exist, so their labels are all named.
   const skillLabels = await ensureSkillLabelCatalog(sql, workspaceId);

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

   return { skills: added, skillBindings, skillLabels, bound: bound.length };
}

/**
 * Settings → Skill labels lists the `skill_labels` catalogue, not the names
 * skills happen to carry. Migration 237 built that catalogue only for the
 * workspaces that existed then, so a workspace created later opened with
 * labelled pack skills and an empty catalogue. Give every label a live skill
 * carries a row, coloured the way its chip already is.
 *
 * Additive, and it never brings back a label a person retired: the unique
 * index covers only active rows, so a name with any row, archived or not, is
 * skipped rather than inserted again.
 */
export async function ensureSkillLabelCatalog(q: Queryable, workspaceId: string): Promise<number> {
   const inserted = await q`
      INSERT INTO skill_labels (workspace_id, name, color, created_by)
      SELECT ${workspaceId}, used.label, berry_skill_label_color(used.label), NULL
        FROM (
           SELECT DISTINCT ON (lower(label)) label
             FROM skills AS s, unnest(s.labels) AS label
            WHERE s.workspace_id = ${workspaceId}
              AND s.archived_at IS NULL
              AND char_length(label) BETWEEN 1 AND 40
            ORDER BY lower(label), label
        ) AS used
       WHERE NOT EXISTS (
          SELECT 1 FROM skill_labels AS existing
           WHERE existing.workspace_id = ${workspaceId}
             AND lower(existing.name) = lower(used.label)
       )
      ON CONFLICT (workspace_id, lower(name)) WHERE archived_at IS NULL DO NOTHING
      RETURNING 1`;
   return inserted.length;
}

/**
 * Each pack skill is labelled with a role agent name, and every catalogue role
 * has eight. Bind a live role agent to exactly those: a core role no longer
 * takes on the skills of the specialists it stands in for (ADR-0018 keeps the
 * delegation, not the skills). Idempotent: a binding that already exists is
 * left alone, including one a person switched off.
 */
export async function bindRolePackSkills(q: Queryable, workspaceId: string): Promise<number> {
   // By role key, not the agent's name, so a renamed role agent keeps its skills.
   const keys = CATALOG.map((role) => role.id);
   const names = CATALOG.map((role) => role.name);
   const linked = await q`
      INSERT INTO agent_skills (agent_id, skill_id, workspace_id, enabled)
      SELECT a.id, s.id, ${workspaceId}, true
        FROM agents a
        JOIN unnest(${keys}::text[], ${names}::text[]) AS role (key, name) ON role.key = a.role_key
        JOIN skills s ON s.workspace_id = a.workspace_id AND role.name = ANY (s.labels)
       WHERE a.workspace_id = ${workspaceId}
         AND a.archived_at IS NULL
         AND a.role_key IS NOT NULL
         AND s.archived_at IS NULL
         AND s.source_url LIKE 'seed://%'
      ON CONFLICT (agent_id, skill_id) DO NOTHING
      RETURNING 1`;
   return linked.length;
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
