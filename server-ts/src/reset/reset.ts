import { installStarterLabels } from '../core/starter-labels.ts';
import { withinTx, type Sql } from '../db/pool.ts';

/**
 * Empties a development database of everything but its setup.
 *
 * What stays is what a person would have to set up again: users and their
 * sign-in, workspaces and their members and boards, agents with their
 * configuration, skills, and autopilots with their versions and triggers.
 * Everything else — work, plans, runs, conversations, integrations, GitHub
 * links, plugins, pins, catalogues and operational bookkeeping — goes.
 *
 * Two lists, both explicit. A table in neither is still emptied, in a final
 * sweep, and named in the result: a new table is cleaned on the day it lands
 * rather than on the day someone notices it survived a reset.
 */

export interface ResetCounts {
   projects: number;
   goals: number;
   issues: number;
   runs: number;
   plans: number;
   conversations: number;
   outboxEvents: number;
   /** Rows removed from every other emptied table, together. */
   other: number;
   /** Tables emptied by the sweep because neither list names them. */
   unlisted: string[];
   /** Starter labels put back, across all workspaces. */
   starterLabels: number;
}

export class NotABerryDatabase extends Error {
   override readonly name = 'NotABerryDatabase';
}

/**
 * The tables a reset leaves alone.
 *
 * The five things asked to survive, and the rows they are made of: a user's
 * sign-in and tokens, a workspace's members and boards (an agent belongs to a
 * board, so a board cannot go while agents stay), an agent's runtime, skills,
 * avatar, MCP servers, role and quick actions, and an autopilot's versions,
 * triggers and members.
 */
export const KEPT_TABLES: ReadonlySet<string> = new Set([
   'berry_schema_migrations',
   // users
   'users',
   'auth_accounts',
   'auth_sessions',
   'auth_verifications',
   'sessions',
   'personal_api_tokens',
   'notification_preferences',
   'user_channel_identities',
   // workspaces
   'workspaces',
   'workspace_memberships',
   'workspace_invitations',
   'workspace_join_links',
   'boards',
   // agents
   'agents',
   'agent_access_members',
   'agent_avatars',
   'agent_runtimes',
   'runtime_profiles',
   'agent_skills',
   'mcp_servers',
   'model_role_agents',
   'quick_action_definitions',
   // skills
   'skills',
   'skill_files',
   // autopilots
   'autopilots',
   'autopilot_versions',
   'autopilot_triggers',
   'autopilot_members',
]);

/**
 * The tables a reset empties, in the order it empties them.
 *
 * Most rows would go by cascade from the work they hang off, but the order
 * here is chosen so no delete trips over a `RESTRICT` or `NO ACTION` key
 * (change evidence before contracts, inbox items before what they name) and
 * so the counts describe what was there rather than what a cascade already
 * took. Tables that hold only cascaded rows are listed all the same, so the
 * sweep has nothing left to guess about.
 */
export const EMPTIED_TABLES: readonly string[] = [
   // Names a goal, plan, task and approval at once; each SET NULL rewrites
   // the row and re-checks its other keys against rows already gone.
   'inbox_items',
   'inbox_projection_events',
   'outbox_events',
   // Change tracking references runs and contracts with NO ACTION.
   'change_evidence',
   'change_campaign_steps',
   'change_campaigns',
   'change_contracts',
   // Runs and what they wrote.
   'task_tokens',
   'task_usage',
   'task_usage_hourly',
   'run_artifacts',
   'run_events',
   'run_exchanges',
   'run_followups',
   'run_provider_events',
   'run_repository_snapshots',
   'issue_auto_reviews',
   'adk_session_events',
   'adk_sessions',
   'runs',
   // Conversations and the agent's own asks and drafts.
   'call_sessions',
   'conversation_messages',
   'conversation_participants',
   'conversations',
   'agent_asks',
   'agent_builder_drafts',
   'agent_builder_sessions',
   'agent_env_audit',
   // Plans, then the work.
   'plan_answers',
   'plan_issues',
   'plan_versions',
   'planner_events',
   'approvals',
   'work_proposals',
   'plans',
   'goal_issues',
   'goals',
   'reviews',
   'assignments',
   'attachments',
   'comment_reactions',
   'comment_run_triggers',
   'comments',
   'issue_reactions',
   'issue_subscribers',
   'issue_dependencies',
   'issue_label_memberships',
   'issue_milestone_links',
   'issue_project_links',
   'issue_property_values',
   'issues',
   'milestones',
   'project_resources',
   // A project's sealed build variables (migration 204) go with the project.
   'project_preview_env',
   'project_updates',
   'projects',
   // Catalogues a person made while trying things out. Starter labels are
   // put back afterwards.
   'issue_labels',
   'issue_status_definitions',
   'issue_property_definitions',
   'saved_issue_views',
   'issue_view_preferences',
   'user_pins',
   'user_pinned_agents',
   // Autopilot runs and their deliveries; the autopilots themselves stay.
   'sys_cron_executions',
   'webhook_deliveries',
   'autopilot_runs',
   // Integrations, GitHub and plugins.
   'integration_audit_events',
   'integration_permissions',
   'integration_oauth_states',
   'integration_webhook_deliveries',
   'integration_connections',
   'github_pull_request_links',
   'github_pull_requests',
   'github_checks',
   'github_granted_repositories',
   'github_install_offers',
   'github_installations',
   'github_workspace_settings',
   'github_apps',
   'workspace_repositories',
   'scm_links',
   'plugin_event_cursor',
   'plugin_files',
   'plugin_hook_state',
   'plugin_invocations',
   'plugin_secrets',
   'plugin_storage',
   'plugin_tokens',
   'plugin_tool_approvals',
   'plugin_installations',
   // Bookkeeping.
   'idempotency_records',
];

/**
 * Refuses a database that is not Berry's.
 *
 * A destructive command pointed at the wrong server is the failure worth
 * spending a query on. `DATABASE_URL` is easy to inherit from a shell, a
 * second PostgreSQL is easy to have listening on the same port, and both
 * answer to the same database name — so what is checked is the schema, which
 * only Berry's migrations produce.
 */
export async function assertBerryDatabase(sql: Sql): Promise<void> {
   const [row] = await sql<Array<{ ledger: string | null; projects: string | null }>>`
      SELECT to_regclass('public.berry_schema_migrations')::text AS ledger,
             to_regclass('public.projects')::text AS projects`;
   if (!row?.ledger || !row.projects) {
      const [where] = await sql<Array<{ db: string; host: string | null }>>`
         SELECT current_database() AS db, inet_server_addr()::text AS host`;
      throw new NotABerryDatabase(
         `the database "${where?.db ?? '?'}" at ${where?.host ?? 'this server'} has no Berry ` +
            'schema — refusing to delete from it'
      );
   }
}

/** Every base table in the public schema, as the database has it now. */
export async function listTables(sql: Sql): Promise<string[]> {
   const rows = await sql<Array<{ name: string }>>`
      SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`;
   return rows.map((row) => row.name);
}

/**
 * The tables the database has that neither list names: what the sweep will
 * empty, and what the lists should be taught about.
 */
export function unlistedTables(tables: readonly string[]): string[] {
   const listed = new Set(EMPTIED_TABLES);
   return tables.filter((table) => !KEPT_TABLES.has(table) && !listed.has(table));
}

const COUNTED: Record<keyof Omit<ResetCounts, 'other' | 'unlisted' | 'starterLabels'>, string> = {
   projects: 'projects',
   goals: 'goals',
   issues: 'issues',
   runs: 'runs',
   plans: 'plans',
   conversations: 'conversations',
   outboxEvents: 'outbox_events',
};

/**
 * Deletes everything but the setup, in one transaction.
 *
 * The outbox goes with it. It is the replay buffer the realtime stream serves
 * on reconnect, so events about rows that no longer exist would arrive at a
 * browser as tasks and runs it then has to be told again to forget.
 */
export async function apply(sql: Sql): Promise<ResetCounts> {
   await assertBerryDatabase(sql);

   return withinTx(sql, async (tx) => {
      const present = new Set(await listTables(tx));
      const unlisted = unlistedTables([...present]);

      const removed: Record<string, number> = {};
      const empty = async (table: string): Promise<void> => {
         // A table the migrations no longer create is not an error; the list
         // outlives a drop so an older database still resets.
         if (!present.has(table)) return;
         const rows = await tx.unsafe(`DELETE FROM "${table}" RETURNING 1`);
         removed[table] = rows.length;
      };

      for (const table of EMPTIED_TABLES) await empty(table);
      // Last, once the rows they most likely reference are gone.
      for (const table of unlisted) await empty(table);

      const counted = new Set(Object.values(COUNTED));
      let other = 0;
      for (const [table, count] of Object.entries(removed)) {
         if (!counted.has(table)) other += count;
      }

      // A workspace without its starter labels is not the workspace a person
      // set up; those are installed at creation and nowhere else.
      const workspaces = await tx<Array<{ id: string }>>`SELECT id FROM workspaces`;
      const now = new Date().toISOString();
      let starterLabels = 0;
      for (const workspace of workspaces) {
         starterLabels += await installStarterLabels(tx, workspace.id, null, now);
      }

      return {
         projects: removed[COUNTED.projects] ?? 0,
         goals: removed[COUNTED.goals] ?? 0,
         issues: removed[COUNTED.issues] ?? 0,
         runs: removed[COUNTED.runs] ?? 0,
         plans: removed[COUNTED.plans] ?? 0,
         conversations: removed[COUNTED.conversations] ?? 0,
         outboxEvents: removed[COUNTED.outboxEvents] ?? 0,
         other,
         unlisted,
         starterLabels,
      };
   });
}
