import type { Sql } from '../db/pool.ts';

/**
 * A run that failed before its agent did anything, for a reason the task
 * itself carries.
 *
 * The envelope could not be built: a repository Berry cannot check out, an AI
 * runtime that is gone or cannot run the task. Running it again changes
 * nothing, and something always ran it again: every path that starts work on
 * a ready task (assignment, pickup, an agent's handoff) saw a task in todo
 * with no run, and a task on prod posted the same failure tens of times.
 * Such a task is moved to blocked instead, and stays there until a person
 * changes it. `AI_RUNTIME_AUTH_REQUIRED` and `AI_RUNTIME_AUTH_EXPIRED` are not
 * here: reconnecting fixes them without touching the task.
 */
const HOLDING_FAILURES: ReadonlySet<string> = new Set([
   'TASK_PREPARATION_FAILED',
   'AI_RUNTIME_INCOMPATIBLE',
   'AI_RUNTIME_UNAVAILABLE',
   'AI_RUNTIME_MODEL_REQUIRED',
]);

export function holdsTask(failure: { code: string; retryable: boolean }): boolean {
   return !failure.retryable && HOLDING_FAILURES.has(failure.code);
}

/** What the failure comment adds when the task was held. */
export const HELD_NOTE = ' The task is now blocked: fix this, then move it back to To do to run it again.';

/**
 * The failure holding `issueId`, or null. Held while the task is blocked and
 * its latest agent run failed that way after the task was last changed: an
 * edit (a person moving it, changing its repository) releases it.
 */
export async function heldFailure(
   sql: Sql,
   issueId: string
): Promise<{ code: string; message: string } | null> {
   const [row] = await sql`
      SELECT latest.failure_code, latest.failure_message, latest.failure_retryable
        FROM issues AS issue
        JOIN LATERAL (
           SELECT r.status, r.failure_code, r.failure_message, r.failure_retryable, r.updated_at
             FROM runs AS r
            WHERE r.issue_id = issue.id AND r.kind = 'agent'
            ORDER BY r.created_at DESC
            LIMIT 1
        ) AS latest ON true
       WHERE issue.id = ${issueId}
         AND issue.status = 'blocked'
         AND latest.status = 'failed'
         -- Trigger-set on both rows in the ledger's transaction, so equal
         -- until someone edits the task (see pickup.ts).
         AND latest.updated_at >= issue.updated_at`;
   if (!row) return null;
   const failure = {
      code: (row.failure_code as string | null) ?? '',
      retryable: row.failure_retryable === true,
   };
   if (!holdsTask(failure)) return null;
   return { code: failure.code, message: (row.failure_message as string | null) ?? '' };
}
