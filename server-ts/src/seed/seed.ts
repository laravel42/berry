import type { Sql } from '../db/pool.ts';
import { withinTx } from '../db/pool.ts';
import { installStarterLabels } from '../core/starter-labels.ts';
import { ensureOrganizationAgents } from '../organization/provision.ts';
import {
   AgentModelName,
   AgentModelProvider,
   BoardID,
   BoardName,
   BoardSlug,
   UserEmail,
   UserID,
   UserName,
   WorkspaceID,
   WorkspaceName,
   WorkspaceSlug,
} from './ids.ts';
import { loadPackedSkills, upsertPackedSkills } from './skills.ts';
import { bindRolePackSkills, ensureCapabilitySkills } from './deploy.ts';

/**
 * The local development dataset.
 *
 * Every step is idempotent, so the command is safe to run after migrations on
 * every boot. The fixed ids are what make that true: a second run updates the
 * same rows rather than creating a second workspace nobody asked for.
 */
export interface SeedOptions {
   /**
    * Whether the demo tasks and projects are written. On by default, so a
    * clean volume has something to look at; off for a developer who wants
    * the identity, workspace and board but an empty product to work in —
    * and who does not want the demo rows coming back on every boot after
    * deleting them.
    */
   demoWork?: boolean;
}

export async function apply(
   sql: Sql,
   now: string = new Date().toISOString(),
   options: SeedOptions = {}
): Promise<void> {
   await withinTx(sql, async (tx) => {
      await upsertUser(tx, now);
      await upsertWorkspace(tx, now);
      await upsertMembership(tx, now);
      await setUserLastWorkspace(tx, now);
      await upsertBoard(tx, now);
      await upsertLabels(tx, now);
      await upsertSkills(tx, now);
      const workspaces = await tx`SELECT id FROM workspaces WHERE deleted_at IS NULL`;
      for (const workspace of workspaces) {
         await ensureOrganizationAgents(tx, workspace.id as string);
         await bindRolePackSkills(tx, workspace.id as string);
         await ensureCapabilitySkills(tx, workspace.id as string, now);
      }
      if (options.demoWork ?? true) {
         await upsertIssues(tx, now);
         await labelIssues(tx, now);
         await upsertProjects(tx, now);
      }
      await assignAgentModels(tx, now);
   });
}

/**
 * Gives the workspace's agents a model to run on.
 *
 * Berry does not create agents here — a trigger inserts the protected
 * Orchestrator when the workspace appears, and it inserts it with no model. The
 * effect in a fresh environment is an agent that exists, can be assigned an
 * issue, and then cannot run, because the picker shows no model and nothing
 * chose one. This closes that gap for local development.
 *
 * Only rows with no model are touched. An agent someone deliberately pointed at
 * a different model keeps it: a seed that runs on every boot must not quietly
 * undo a choice a developer made, and `COALESCE` in a single statement would do
 * exactly that on the next run.
 */
async function assignAgentModels(tx: Sql, now: string): Promise<void> {
   await tx`
      UPDATE agents
         SET model_provider = ${AgentModelProvider},
             model_name = ${AgentModelName},
             updated_at = ${now}
       WHERE workspace_id = ${WorkspaceID}
         AND archived_at IS NULL
         AND (model_provider IS NULL OR model_name IS NULL)
   `;
}

// The seeded user has no credential of its own: locally it signs in through
// POST /api/v1/auth/dev-login (development only), and anywhere else by
// linking a GitHub account whose verified email matches UserEmail.
async function upsertUser(tx: Sql, now: string): Promise<void> {
   // A different user already holding this email would fail the unique index
   // below. Renaming theirs is deliberate: this is a development fixture, and
   // the seeded identity is the one the login flow expects to find.
   await tx`
      UPDATE users
         SET email = 'replaced-' || id::text || '@berry.test'
       WHERE lower(email) = lower(${UserEmail})
         AND id <> ${UserID}
   `;
   await tx`
      INSERT INTO users (
         id, email, name, role, settings, onboarding_state,
         onboarding_completed_at, last_workspace_id, created_at, updated_at
      ) VALUES (
         ${UserID}, ${UserEmail}, ${UserName}, 'admin',
         '{"theme":"system","timezone":"UTC","reducedMotion":false}'::jsonb,
         '{"version":1,"step":"complete","answers":{},"skipped":false,"completed":true}'::jsonb,
         ${now}, NULL, ${now}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         updated_at = EXCLUDED.updated_at
   `;
}

async function setUserLastWorkspace(tx: Sql, now: string): Promise<void> {
   // Set after the workspace exists: the column is a foreign key, so the
   // insert above has to leave it NULL.
   await tx`
      UPDATE users
         SET last_workspace_id = ${WorkspaceID}, updated_at = ${now}
       WHERE id = ${UserID}
   `;
}

async function upsertWorkspace(tx: Sql, now: string): Promise<void> {
   await tx`
      UPDATE workspaces
         SET slug = 'replaced-' || id::text
       WHERE lower(slug) = lower(${WorkspaceSlug})
         AND id <> ${WorkspaceID}
         AND deleted_at IS NULL
   `;
   await tx`
      INSERT INTO workspaces (
         id, name, slug, description, settings, created_by, created_at, updated_at
      ) VALUES (
         ${WorkspaceID}, ${WorkspaceName}, ${WorkspaceSlug}, 'Local Berry workspace',
         '{"issuePrefix":"BER","defaultRole":"member","allowMemberInvites":false}'::jsonb,
         ${UserID}, ${now}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         description = EXCLUDED.description,
         updated_at = EXCLUDED.updated_at
   `;
}

async function upsertMembership(tx: Sql, now: string): Promise<void> {
   await tx`
      INSERT INTO workspace_memberships (
         workspace_id, user_id, role, joined_at, updated_at
      ) VALUES (${WorkspaceID}, ${UserID}, 'owner', ${now}, ${now})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET
         role = EXCLUDED.role,
         updated_at = EXCLUDED.updated_at
   `;
}

async function upsertBoard(tx: Sql, now: string): Promise<void> {
   await tx`
      UPDATE boards
         SET slug = 'replaced-' || id::text
       WHERE lower(slug) = lower(${BoardSlug})
         AND id <> ${BoardID}
   `;
   await tx`
      INSERT INTO boards (
         id, workspace_id, name, slug, description, columns, issue_counter,
         created_by, created_at, updated_at
      ) VALUES (
         ${BoardID}, ${WorkspaceID}, ${BoardName}, ${BoardSlug},
         'Default development crew board', '[]'::jsonb, 3,
         ${UserID}, ${now}, ${now}
      )
      ON CONFLICT (id) DO UPDATE SET
         workspace_id = EXCLUDED.workspace_id,
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         description = EXCLUDED.description,
         updated_at = EXCLUDED.updated_at
   `;
}

/**
 * The starter labels, into every workspace that exists.
 *
 * Creation installs them for new workspaces; the seed backfills the ones
 * from before that, so a developer's own workspace has them too and not only
 * the demo one.
 */
async function upsertLabels(tx: Sql, now: string): Promise<void> {
   const workspaces = await tx`SELECT id, created_by FROM workspaces WHERE deleted_at IS NULL`;
   for (const workspace of workspaces) {
      await installStarterLabels(tx, workspace.id as string, (workspace.created_by as string | null) ?? null, now);
   }
}

/**
 * The AgentCore deep-skills pack, into every workspace that exists.
 *
 * Creation does not install these — they are a development catalogue, the way
 * the demo tasks are. The pack is committed next to this seeder so a machine
 * without the original zip still gets the same 100 skills.
 */
async function upsertSkills(tx: Sql, now: string): Promise<void> {
   const skills = loadPackedSkills();
   const workspaces = await tx`SELECT id, created_by FROM workspaces WHERE deleted_at IS NULL`;
   for (const workspace of workspaces) {
      await upsertPackedSkills(
         tx,
         workspace.id as string,
         (workspace.created_by as string | null) ?? null,
         now,
         skills
      );
   }
}

/** Which starter labels the demo tasks carry, by issue id and label name. */
const ISSUE_LABELS: Record<string, readonly string[]> = {
   '11111111-1111-4111-8111-111111111201': ['feature', 'performance'],
   '11111111-1111-4111-8111-111111111202': ['improvement', 'design'],
   '11111111-1111-4111-8111-111111111203': ['chore', 'good first task'],
};

async function labelIssues(tx: Sql, now: string): Promise<void> {
   for (const [issueId, names] of Object.entries(ISSUE_LABELS)) {
      for (const name of names) {
         await tx`
            INSERT INTO issue_label_memberships (workspace_id, issue_id, label_id, assigned_by, created_at)
            SELECT ${WorkspaceID}, ${issueId}, id, ${UserID}, ${now}
              FROM issue_labels
             WHERE workspace_id = ${WorkspaceID} AND lower(name) = ${name} AND archived_at IS NULL
            ON CONFLICT DO NOTHING
         `;
      }
   }
}

const ISSUES = [
   {
      id: '11111111-1111-4111-8111-111111111201',
      number: 1,
      title: 'Wire agent runtime probes',
      status: 'todo',
      priority: 'high',
      sort: 1000,
   },
   {
      id: '11111111-1111-4111-8111-111111111202',
      number: 2,
      title: 'Match projects board to issues Kanban',
      status: 'in_progress',
      priority: 'medium',
      sort: 2000,
   },
   {
      id: '11111111-1111-4111-8111-111111111203',
      number: 3,
      title: 'Seed local development data',
      status: 'done',
      priority: 'low',
      sort: 3000,
   },
] as const;

async function upsertIssues(tx: Sql, now: string): Promise<void> {
   for (const issue of ISSUES) {
      await tx`
         INSERT INTO issues (
            id, board_id, number, title, description, status, priority, sort_order,
            created_by, created_at, updated_at
         ) VALUES (
            ${issue.id}, ${BoardID}, ${issue.number}, ${issue.title},
            'Seeded for local Berry development.',
            ${issue.status}::issue_status, ${issue.priority}::issue_priority, ${issue.sort},
            ${UserID}, ${now}, ${now}
         )
         ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            sort_order = EXCLUDED.sort_order,
            updated_at = EXCLUDED.updated_at
      `;
   }
}

const PROJECTS = [
   {
      id: '11111111-1111-4111-8111-111111111301',
      name: 'Agent runtime',
      status: 'active',
      priority: 'high',
   },
   {
      id: '11111111-1111-4111-8111-111111111302',
      name: 'Projects parity',
      status: 'planned',
      priority: 'medium',
   },
   {
      id: '11111111-1111-4111-8111-111111111303',
      name: 'Workspace bootstrap',
      status: 'completed',
      priority: 'low',
   },
] as const;

async function upsertProjects(tx: Sql, now: string): Promise<void> {
   for (const project of PROJECTS) {
      await tx`
         INSERT INTO projects (
            id, workspace_id, name, description, status, priority,
            start_date, target_date, created_by, created_at, updated_at
         ) VALUES (
            ${project.id}, ${WorkspaceID}, ${project.name},
            'Seeded for local Berry development.',
            ${project.status}, ${project.priority},
            CURRENT_DATE - 7, CURRENT_DATE + 21, ${UserID}, ${now}, ${now}
         )
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            status = EXCLUDED.status,
            priority = EXCLUDED.priority,
            updated_at = EXCLUDED.updated_at
      `;
   }
}
