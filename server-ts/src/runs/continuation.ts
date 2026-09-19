import type { Sql } from '../db/pool.ts';
import { NotFound } from '../identity/errors.ts';
import { EnqueueRejected, enqueueTask } from './queue.ts';
import { ActiveRunExists } from './repository.ts';

/**
 * A run stopped at its step limit carries on by itself.
 *
 * The limit exists to end a run that loops, and it cannot tell a loop from a
 * long task: a DevOps Engineer eighty productive steps into a storage module
 * was failed exactly like one going in circles, and its work sat on a branch
 * until a person pressed run again. The checkpoint is what tells the two
 * apart. A run that was stopped but left new commits behind was working, so
 * the limit becomes the end of a segment and Berry queues the next one from
 * that branch; a run that left nothing new was not getting anywhere, and
 * stays failed. The chain is capped, so the most a task can spend unattended
 * is a fixed number of segments.
 */

export const LIMIT_CODE = 'RUN_LIMIT_REACHED';
export const DEFAULT_MAX_CONTINUATIONS = 3;

export type ContinuationOutcome =
   | { continued: true; runId: string; attempt: number; of: number }
   | { continued: false; reason: 'disabled' | 'not_a_limit_stop' | 'superseded' | 'no_progress' | 'cap_reached' | 'task_moved_on' | 'busy' };

export async function continueAfterLimit(
   sql: Sql,
   input: { runId: string; maxContinuations?: number }
): Promise<ContinuationOutcome> {
   const max = input.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
   if (max <= 0) return { continued: false, reason: 'disabled' };

   const [run] = await sql`
      SELECT r.id, r.workspace_id, r.issue_id, r.agent_id, r.kind, r.status, r.failure_code,
             r.head_commit, r.branch, r.requested_by, r.created_at,
             i.status AS issue_status, i.assignee_type, i.assignee_id, i.deleted_at
        FROM runs r JOIN issues i ON i.id = r.issue_id
       WHERE r.id = ${input.runId}`;
   if (!run || run.kind !== 'agent' || run.status !== 'failed' || run.failure_code !== LIMIT_CODE) {
      return { continued: false, reason: 'not_a_limit_stop' };
   }
   // The task is still this agent's to finish: nobody reassigned, closed or
   // deleted it while the run was working. A failed run hands an in-progress
   // task back to `todo`, which is where a continuation picks it up.
   const open = run.issue_status === 'todo' || run.issue_status === 'in_progress';
   if (run.deleted_at || !open || run.assignee_type !== 'agent' || run.assignee_id !== run.agent_id) {
      return { continued: false, reason: 'task_moved_on' };
   }

   // Newest first: this run, then what came before it on the task.
   const history = await sql`
      SELECT id, failure_code, head_commit FROM runs
       WHERE issue_id = ${run.issue_id as string} AND kind = 'agent'
       ORDER BY created_at DESC, id DESC LIMIT ${max + 2}`;
   if (history[0]?.id !== run.id) return { continued: false, reason: 'superseded' };

   // Progress is a checkpoint commit the run before did not already have.
   const previous = history[1];
   if (!run.head_commit || run.head_commit === previous?.head_commit) {
      return { continued: false, reason: 'no_progress' };
   }

   let limitStops = 0;
   for (const row of history) {
      if (row.failure_code !== LIMIT_CODE) break;
      limitStops += 1;
   }
   // `limitStops` counts this run: the first stop queues continuation 1.
   if (limitStops > max) return { continued: false, reason: 'cap_reached' };

   try {
      const queued = await enqueueTask(sql, {
         workspaceId: run.workspace_id as string,
         issueId: run.issue_id as string,
         agentId: run.agent_id as string,
         kind: 'agent',
         source: 'assignment',
         prompt: continuationInstructions({
            branch: (run.branch as string | null) ?? null,
            commit: run.head_commit as string,
            attempt: limitStops,
            of: max,
         }),
         origin: { runId: run.id as string },
         ...(run.requested_by ? { requestedBy: run.requested_by as string } : {}),
      });
      return { continued: true, runId: queued.runId, attempt: limitStops, of: max };
   } catch (error) {
      // Someone started the task again first, or it went away under us. Either
      // way the work is in hand or not wanted, and the failed run stands.
      if (error instanceof ActiveRunExists) return { continued: false, reason: 'busy' };
      if (error instanceof NotFound || error instanceof EnqueueRejected) return { continued: false, reason: 'task_moved_on' };
      throw error;
   }
}

/** What the next segment is told. Berry's words, so they go in as run instructions. */
export function continuationInstructions(input: { branch: string | null; commit: string; attempt: number; of: number }): string {
   const where = input.branch ? `branch ${input.branch}` : 'the task branch';
   return (
      `This is continuation ${input.attempt} of at most ${input.of}. Your previous run on this task was stopped at its ` +
      `step limit, not by an error, and everything it had written is committed on ${where} ` +
      `(commit ${input.commit.slice(0, 7)}), which is what your workspace has checked out. ` +
      'Do not start over. First see what is already there (git log, git status, the files), in one or two ' +
      'commands; then do only what is still missing, check that it builds, and write your report. ' +
      'The report covers the whole task, including what the earlier run did.'
   );
}

/** The sentence added to the failed run's comment, so a reader knows what happens next. */
export function continuationNote(outcome: ContinuationOutcome): string {
   if (outcome.continued) {
      return ` Berry queued a continuation from that branch (${outcome.attempt} of ${outcome.of}); nothing needs to be done.`;
   }
   if (outcome.reason === 'cap_reached') {
      return ' It was not continued again: the task has reached its limit of automatic continuations. Split it into smaller tasks, or run it again yourself.';
   }
   if (outcome.reason === 'no_progress') {
      return ' It was not continued automatically, because the run left no new commit to continue from.';
   }
   return '';
}
