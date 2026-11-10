import type { Queryable } from '../db/pool.ts';

/**
 * What a Loop's run may do, on top of what its agent may do.
 *
 * A Loop never adds reach. Its run uses the agent's own contract, autonomy
 * ceiling and permissions, and the Loop's policy can only take away from
 * that: `act` takes nothing away, `recommend` takes away everything that
 * changes Berry or the repository beyond the run's own task. Both are
 * enforced on the server, where the tool is called (`agentToolAllowlist`),
 * and also in the envelope, so the agent is not told about tools it will be
 * refused.
 *
 * Neither mode can reach a merge or `done`/`cancelled`: no agent can, and
 * this is subtraction from that (AGENTS.md, "Hard boundaries").
 */

export const ACCESS_MODES = ['recommend', 'act'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const CONCURRENCY_POLICIES = ['skip_if_running', 'allow'] as const;
export type ConcurrencyPolicy = (typeof CONCURRENCY_POLICIES)[number];

/** The hard limit on Loop chains, whatever a Loop asks for. */
export const MAX_CHAIN_DEPTH = 3;

/**
 * Recommend mode: read what the agent could already read, say what it found,
 * and propose. A proposal (`propose_work`) is a request a person accepts or
 * declines; an escalation hands the decision up. Files are kept on the run's
 * own task, which is where its report is reviewed.
 *
 * Gone: creating, assigning, linking or moving tasks, delegating, starting
 * other agents, the shell, and any repository write.
 */
export const RECOMMEND_TOOLS: readonly string[] = [
   'read_task',
   'list_dependencies',
   'read_file',
   'list_files',
   'read_project_resources',
   'post_comment',
   'escalate',
   'list_agents',
   'list_tasks',
   'list_plans',
   'list_milestones',
   'list_projects',
   'fetch_url',
   'browse_repository',
   'read_repository_file',
   'read_skill',
   'propose_work',
   'write_file',
   'edit_file',
   'attach_file',
];

const RECOMMEND = new Set(RECOMMEND_TOOLS);

/** The only permission a recommend-mode run keeps: reading the repository. */
const RECOMMEND_PERMISSIONS = new Set(['read_repository']);

export interface LoopRunPolicy {
   autopilotId: string;
   autopilotRunId: string;
   accessMode: AccessMode;
   maxTurns: number | null;
}

/**
 * The agent's tools under a Loop's mode.
 *
 * `null` from the agent means "outside the organization; its permissions
 * govern it". Recommend mode cannot leave that open, so it becomes the
 * recommend list itself.
 */
export function ceilTools(agentTools: readonly string[] | null, mode: AccessMode): string[] | null {
   if (mode === 'act') return agentTools === null ? null : [...agentTools];
   if (agentTools === null) return [...RECOMMEND_TOOLS].sort();
   return agentTools.filter((tool) => RECOMMEND.has(tool)).sort();
}

export function ceilPermissions(permissions: readonly string[], mode: AccessMode): string[] {
   if (mode === 'act') return [...permissions];
   return permissions.filter((permission) => RECOMMEND_PERMISSIONS.has(permission));
}

/** The lower of the agent's turn limit and the Loop's; either may be absent. */
export function ceilTurns(agentMax: number | undefined, loopMax: number | null): number | undefined {
   if (loopMax === null) return agentMax;
   return agentMax === undefined ? loopMax : Math.min(agentMax, loopMax);
}

/**
 * The policy of the Loop that started this run, or null when no Loop did.
 * Only the run a Loop queued carries it; a run a person starts later on the
 * same task is that person's, under the agent's own contract.
 */
export async function loopPolicyForRun(sql: Queryable, runId: string): Promise<LoopRunPolicy | null> {
   const [row] = await sql`
      SELECT a.id AS autopilot_id, ar.id AS autopilot_run_id, a.access_mode, a.max_turns
        FROM runs AS r
        JOIN autopilot_runs AS ar ON ar.id = r.autopilot_run_id
        JOIN autopilots AS a ON a.id = ar.autopilot_id
       WHERE r.id = ${runId}`;
   if (!row) return null;
   return {
      autopilotId: row.autopilot_id as string,
      autopilotRunId: row.autopilot_run_id as string,
      accessMode: row.access_mode === 'act' ? 'act' : 'recommend',
      maxTurns: (row.max_turns as number | null) ?? null,
   };
}
