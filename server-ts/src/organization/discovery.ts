import type { AutopilotRepository } from '../autopilots/repository.ts';
import type { IssueRepository } from '../core/issues.ts';
import { withinTx, type Sql } from '../db/pool.ts';
import { defaultBoardId } from '../work/batch.ts';
import { parseContract, type RoleContract } from './contract.ts';

/**
 * Weekly discovery: every role whose contract carries a `discovery` block
 * gets a standing task and a weekly autopilot that runs `propose_work`
 * findings against it. `ensureDiscovery` is idempotent per role, keyed on
 * `autopilots.discovery_role`, so a second call after the first creates
 * nothing.
 */

export const MAX_PROPOSALS_PER_RUN = 5;

export function discoveryPrompt(contract: RoleContract): string {
   const discovery = contract.discovery;
   if (!discovery) throw new Error(`${contract.id} has no discovery`);
   return [
      `Weekly discovery for the ${contract.role}.`,
      `Inspect this workspace's projects, repositories and tasks from your profession's perspective. Focus on:`,
      ...discovery.focus.map((item) => `- ${item}`),
      `Look for evidence in: ${discovery.evidence_sources.join('; ')}.`,
      `File at most ${MAX_PROPOSALS_PER_RUN} findings with propose_work. Every finding needs concrete evidence (file and line, run, dependency version, metric or task).`,
      'File nothing you cannot evidence. If nothing is worth proposing, post a one-line comment saying what you inspected and stop.',
      'Do not implement anything in this run.',
   ].join('\n');
}

/** An existing autopilot a failed prior run left behind: created, but never marked as this role's discovery. */
async function findOrphan(
   tx: Sql,
   workspaceId: string,
   agentId: string,
   name: string
): Promise<{ id: string } | null> {
   const [row] = await tx<Array<{ id: string }>>`
      SELECT id FROM autopilots
       WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND discovery_role IS NULL
         AND assignee_type = 'agent' AND assignee_id = ${agentId}
         AND execution_mode = 'fixed_issue' AND name = ${name}
       LIMIT 1`;
   return row ?? null;
}

export async function ensureDiscovery(
   sql: Sql,
   workspaceId: string,
   deps: { autopilots: AutopilotRepository; issues: IssueRepository }
): Promise<{ created: string[] }> {
   // Held for the whole pass: two concurrent calls for the same workspace (the
   // workspace-create hook racing the boot loop, or two instances booting)
   // must not both find a role "missing" and both create it. `deps.issues`
   // and `deps.autopilots` still open their own transactions per call — that
   // is fine, and unavoidable, since neither takes a `tx` — but the check and
   // the `discovery_role` write that make a role "done" happen on this one
   // locked connection, so the second caller's re-check sees the first
   // caller's committed work.
   return withinTx(sql, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`berry.discovery:${workspaceId}`}, 0))`;

      const [workspace] = await tx<Array<{ created_by: string | null; discovery_enabled: boolean }>>`
         SELECT created_by, discovery_enabled FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL`;
      const owner = workspace?.created_by;
      if (!owner) return { created: [] };
      // A workspace that switched discovery off gets no Discovery tasks: not
      // paused ones, none. Switching it back on provisions them.
      if (workspace.discovery_enabled === false) return { created: [] };
      const agents = await tx<Array<{ id: string; role_key: string; role_contract: unknown }>>`
         SELECT a.id, a.role_key, a.role_contract FROM agents a
          WHERE a.workspace_id = ${workspaceId} AND a.role_key IS NOT NULL AND a.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM autopilots p WHERE p.workspace_id = a.workspace_id
                             AND p.discovery_role = a.role_key AND p.archived_at IS NULL)`;
      const created: string[] = [];
      if (agents.length === 0) return { created };
      const boardId = await defaultBoardId(tx, workspaceId);
      for (const agent of agents) {
         const contract = parseContract(agent.role_contract);
         if (!contract?.discovery) continue;
         const name = `Discovery: ${contract.name}`;

         const orphan = await findOrphan(tx, workspaceId, agent.id, name);
         if (orphan) {
            // A prior run created the task and the autopilot but never got to
            // mark it (or crashed between the two, or lost the race for this
            // very lock): finish the job rather than creating a duplicate.
            //
            // Both writes go through `sql`, not `tx`: `addCronTrigger` opens
            // its own transaction and takes `FOR UPDATE` on this same
            // autopilot row, and a still-open `UPDATE ... discovery_role`
            // inside `tx` would hold that row locked until this whole
            // function returns — blocking `addCronTrigger` forever on a
            // connection this same call is waiting on. The advisory lock
            // already serialises concurrent `ensureDiscovery` calls; these
            // writes only need to land before `tx` releases it, not run on
            // its connection.
            const [trigger] = await tx<Array<{ id: string }>>`
               SELECT id FROM autopilot_triggers WHERE autopilot_id = ${orphan.id} AND kind = 'cron' LIMIT 1`;
            if (!trigger) {
               await deps.autopilots.addCronTrigger(workspaceId, orphan.id, {
                  expression: contract.discovery.cron,
                  timezone: 'UTC',
                  enabled: true,
               });
            }
            await sql`UPDATE autopilots SET discovery_role = ${contract.id} WHERE id = ${orphan.id}`;
            created.push(contract.id);
            continue;
         }

         const { issue } = await deps.issues.create({
            boardId,
            title: name,
            description: `Where the ${contract.role}'s weekly discovery runs. Findings arrive as proposals.`,
            status: 'backlog',
            priority: 'none',
            sortOrder: 0,
            dueDate: null,
            assignee: { type: 'agent', id: agent.id },
            project: null,
            createdBy: owner,
         });
         const autopilot = await deps.autopilots.create(
            workspaceId,
            {
               name,
               description: `Weekly inspection by the ${contract.role}.`,
               assigneeType: 'agent',
               assigneeId: agent.id,
               promptTemplate: discoveryPrompt(contract),
               executionMode: 'fixed_issue',
               boardId: null,
               issueId: issue.id,
               quotaPeriod: 'week',
               quotaMax: 1,
            },
            owner
         );
         // Same reasoning as the orphan path above: both go through `sql`,
         // never `tx`, so neither blocks on a row lock this call's own
         // advisory-lock connection is still holding open.
         await deps.autopilots.addCronTrigger(workspaceId, autopilot.id, { expression: contract.discovery.cron, timezone: 'UTC', enabled: true });
         await sql`UPDATE autopilots SET discovery_role = ${contract.id} WHERE id = ${autopilot.id}`;
         created.push(contract.id);
      }
      return { created };
   });
}

/**
 * `ensureDiscovery` for every workspace, at boot. A separate pass from
 * `ensureOrganizationEverywhere`: discovery needs `AutopilotRepository` and
 * `IssueRepository`, which are not yet built at the point in `index.ts`
 * where the organization is provisioned, so this runs later in boot, after
 * both exist.
 */
export async function ensureDiscoveryEverywhere(
   sql: Sql,
   deps: { autopilots: AutopilotRepository; issues: IssueRepository },
   onError: (workspaceId: string, error: unknown) => void
): Promise<void> {
   const workspaces = await sql<Array<{ id: string }>>`SELECT id FROM workspaces WHERE deleted_at IS NULL`;
   for (const workspace of workspaces) {
      await ensureDiscovery(sql, workspace.id, deps).catch((error: unknown) => onError(workspace.id, error));
   }
}
