import type { Sql } from '../db/pool.ts';
import { NotFound } from '../identity/errors.ts';
import { EnqueueRejected, enqueueTask, type TaskSource } from './queue.ts';
import { ActiveRunExists } from './repository.ts';

/**
 * A run stopped at its step limit carries on by itself.
 *
 * The limit exists to end a run that loops, and it cannot tell a loop from a
 * long task: a DevOps Engineer eighty productive steps into a storage module
 * was failed exactly like one going in circles, and its work sat on a branch
 * until a person pressed run again. The checkpoint is what tells the two
 * apart. The limit becomes the end of a segment and Berry queues the next
 * one. The next run is a new session: the conversation that filled the limit
 * is not restored, and a summary the agent wrote is its handover. A run that
 * left no new commit still continues — the summary is what the next run
 * starts from, and the branch is whatever was already checked out. The chain
 * is capped, so the most a task can spend unattended is a fixed number of
 * segments. None of this is posted on the task: the activity feed is for the
 * work, and a limit stop is not a result someone has to answer.
 */

export const LIMIT_CODE = 'RUN_LIMIT_REACHED';
export const DEFAULT_MAX_CONTINUATIONS = 3;

export type ContinuationOutcome =
   | { continued: true; runId: string; attempt: number; of: number; branch: string | null; commit: string | null }
   | { continued: false; reason: 'disabled' | 'not_a_limit_stop' | 'superseded' | 'no_progress' | 'cap_reached' | 'task_moved_on' | 'busy' };

export async function continueAfterLimit(
   sql: Sql,
   input: { runId: string; maxContinuations?: number; summary?: string }
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

   let limitStops = 0;
   for (const row of history) {
      if (row.failure_code !== LIMIT_CODE) break;
      limitStops += 1;
   }
   // `limitStops` counts this run: the first stop queues continuation 1.
   if (limitStops > max) return { continued: false, reason: 'cap_reached' };

   const commit = (run.head_commit as string | null) ?? null;
   try {
      const queued = await enqueueTask(sql, {
         workspaceId: run.workspace_id as string,
         issueId: run.issue_id as string,
         agentId: run.agent_id as string,
         kind: 'agent',
         source: 'assignment',
         prompt: continuationInstructions({
            branch: (run.branch as string | null) ?? null,
            commit,
            attempt: limitStops,
            of: max,
            ...(input.summary ? { summary: input.summary } : {}),
         }),
         origin: { runId: run.id as string, fresh: true },
         ...(run.requested_by ? { requestedBy: run.requested_by as string } : {}),
      });
      return {
         continued: true,
         runId: queued.runId,
         attempt: limitStops,
         of: max,
         branch: (run.branch as string | null) ?? null,
         commit,
      };
   } catch (error) {
      // Someone started the task again first, or it went away under us. Either
      // way the work is in hand or not wanted, and the failed run stands.
      if (error instanceof ActiveRunExists) return { continued: false, reason: 'busy' };
      if (error instanceof NotFound || error instanceof EnqueueRejected) return { continued: false, reason: 'task_moved_on' };
      throw error;
   }
}

/** What the next segment is told. Berry's words, so they go in as run instructions. */
export function continuationInstructions(input: {
   branch: string | null;
   commit: string | null;
   attempt: number;
   of: number;
   summary?: string;
}): string {
   const where = input.branch ? `branch ${input.branch}` : 'the task branch';
   const handover = input.summary
      ? `The previous run summarized its work before it stopped. This run starts with an empty conversation; that summary is the handover.\n\n${input.summary}\n\n`
      : '';
   const saved = input.commit
      ? `everything it had written is committed on ${where} (commit ${input.commit.slice(0, 7)}), which is what your workspace has checked out. `
      : `your workspace is ${where}. `;
   return (
      handover +
      `This is continuation ${input.attempt} of at most ${input.of}, and it is a fresh run: none of the previous ` +
      `conversation is here. The previous run was stopped at its step limit, not by an error, and ${saved}` +
      'Do not start over. First see what is already there (git log, git status, the files), in one or two ' +
      'commands; then do only what is still missing, check that it builds, and write your report. ' +
      'The report covers the whole task, including what the earlier run did.'
   );
}

/**
 * What a run stopped at its limit says once Berry has continued it: paused,
 * not failed, and nothing for a person to do. The runtime's own message tells
 * the reader to raise the limit or split the task, which is right only when
 * nobody carries the work on; read beside "Berry queued a fresh run" it
 * was a failure notice asking for an action that was already taken.
 */
export function continuedMessage(outcome: Extract<ContinuationOutcome, { continued: true }>): string {
   const where = outcome.branch ? `branch ${outcome.branch}` : 'the task branch';
   const saved = outcome.commit ? ` Its work is saved on ${where} (commit ${outcome.commit.slice(0, 7)}).` : '';
   return (
      `Paused at this agent's step limit.${saved} ` +
      `Berry is starting a fresh run (continuation ${outcome.attempt} of ${outcome.of}). Nothing needs to be done.`
   );
}

/** The sentence added to the failed run's comment, so a reader knows what happens next. */
export function continuationNote(outcome: ContinuationOutcome): string {
   if (outcome.continued) {
      return ` Berry queued a fresh run from that branch (${outcome.attempt} of ${outcome.of}); nothing needs to be done.`;
   }
   if (outcome.reason === 'cap_reached') {
      return ' It was not continued again: the task has reached its limit of automatic continuations. Split it into smaller tasks, or run it again yourself.';
   }
   if (outcome.reason === 'no_progress') {
      return ' It was not continued automatically, because the run left no new commit to continue from.';
   }
   return '';
}

/**
 * A run the infrastructure failed is tried once more, by itself.
 *
 * A retryable failure — the runtime unreachable, its stream cut, the process
 * holding the lease gone, a model provider that never answered — says nothing
 * about the task, only about the moment. It used to be recorded and left: the
 * task dropped back to To do, with no comment (retryable failures were not
 * reported), until a person noticed and pressed run. Now the task is queued
 * again once, with the instructions it had; a second fault in a row stands,
 * so a lasting outage costs one extra attempt, not a loop.
 */
/**
 * Whether a retryable fault still belongs to this task.
 *
 * `blocked` stays: the assignee has not changed and the work is paused, so a
 * dead process should start it again. Done, cancelled, and in review have
 * moved on, and a limit-stop continuation does not use this — that path is
 * the agent choosing to stop.
 */
export function taskStillHeld(status: string): boolean {
   return status === 'todo' || status === 'in_progress' || status === 'blocked';
}

/**
 * Statuses a person may restart.
 *
 * To do, In progress, and In review are still this agent's task. Done,
 * cancelled, backlog, and blocked are not: blocked stays for the automatic
 * retry, which is a process fault, and a person restarts from the board
 * states where the work is theirs to send again.
 */
export function taskCanBeRestarted(status: string): boolean {
   return status === 'todo' || status === 'in_progress' || status === 'in_review';
}

export type RetryOutcome =
   | { retried: true; runId: string }
   | { retried: false; reason: 'not_retryable' | 'already_retried' | 'superseded' | 'task_moved_on' | 'busy' };

export async function retryAfterFault(sql: Sql, input: { runId: string }): Promise<RetryOutcome> {
   const [run] = await sql`
      SELECT r.id, r.workspace_id, r.issue_id, r.agent_id, r.kind, r.status, r.failure_retryable,
             r.source, r.prompt, r.requested_by,
             i.status AS issue_status, i.assignee_type, i.assignee_id, i.deleted_at
        FROM runs r JOIN issues i ON i.id = r.issue_id
       WHERE r.id = ${input.runId}`;
   if (!run || run.kind !== 'agent' || run.status !== 'failed' || run.failure_retryable !== true) {
      return { retried: false, reason: 'not_retryable' };
   }
   // Blocked is a pause, not the task leaving this agent. A process stop
   // while it is paused is still the process's fault, and leaving it there
   // is how an abandoned run stayed dead.
   if (run.deleted_at || !taskStillHeld(String(run.issue_status)) || run.assignee_type !== 'agent' || run.assignee_id !== run.agent_id) {
      return { retried: false, reason: 'task_moved_on' };
   }

   const history = await sql`
      SELECT id, status, failure_retryable FROM runs
       WHERE issue_id = ${run.issue_id as string} AND kind = 'agent'
       ORDER BY created_at DESC, id DESC LIMIT 2`;
   if (history[0]?.id !== run.id) return { retried: false, reason: 'superseded' };
   // The run before this one failed the same way: this was the retry.
   const previous = history[1];
   if (previous && previous.status === 'failed' && previous.failure_retryable === true) {
      return { retried: false, reason: 'already_retried' };
   }

   try {
      const queued = await enqueueTask(sql, {
         workspaceId: run.workspace_id as string,
         issueId: run.issue_id as string,
         agentId: run.agent_id as string,
         kind: 'agent',
         source: run.source as TaskSource,
         ...(run.prompt ? { prompt: run.prompt as string } : {}),
         origin: { runId: run.id as string },
         ...(run.requested_by ? { requestedBy: run.requested_by as string } : {}),
      });
      return { retried: true, runId: queued.runId };
   } catch (error) {
      if (error instanceof ActiveRunExists) return { retried: false, reason: 'busy' };
      if (error instanceof NotFound || error instanceof EnqueueRejected) return { retried: false, reason: 'task_moved_on' };
      throw error;
   }
}

/** The sentence added to the failed run's comment when Berry tried again, or why it did not. */
export function retryNote(outcome: RetryOutcome): string {
   if (outcome.retried) return ' This was a fault outside the task, so Berry started it again; nothing needs to be done.';
   if (outcome.reason === 'already_retried') {
      return ' Berry had already tried again after the same kind of fault, so it stopped here. Run the task again once the service is back.';
   }
   return '';
}

/**
 * How long a running task may go without an event before it counts as quiet.
 *
 * The same window the model gateway uses before it calls a silent stream a
 * stall. Restart does not wait for it: a queued or running run is left alone.
 */
export const STALL_QUIET_MS = 120_000;

const TASK_SOURCES = new Set<TaskSource>([
   'assignment',
   'mention',
   'chat',
   'autopilot',
   'quick_action',
   'builder',
   'completion',
   'merge_fix',
]);

/**
 * A stalled run stopped outside the task, or went quiet while still marked running.
 *
 * A retryable failure already stopped: the process, the stream, or the model
 * went away. A run that is still marked running but has recorded nothing for
 * the quiet window has stopped too, whatever its row says. A queued run is
 * waiting for a slot, and a run that failed for a reason inside the task is
 * not a stall. Restart does not consult this: it starts any idle agent task
 * in To do, In progress, or In review.
 */
export function runIsStalled(input: {
   status: string;
   retryable: boolean;
   lastActivityAt: Date | null;
   now: Date;
   quietMs?: number;
}): boolean {
   if (input.status === 'failed' && input.retryable) return true;
   if (input.status !== 'running' || input.lastActivityAt === null) return false;
   const quietMs = input.quietMs ?? STALL_QUIET_MS;
   return input.now.getTime() - input.lastActivityAt.getTime() >= quietMs;
}

/**
 * What the recovering run is told.
 *
 * The session is the same one, when the runtime still has it, so this does
 * not claim the conversation is gone. It does say the work already on the
 * branch is the starting point. Instructions the previous run was given are
 * kept, so a mention or a person's note is not dropped on the way back.
 */
export function recoveryInstructions(input: {
   branch: string | null;
   commit: string | null;
   prior?: string | null;
}): string {
   const where = input.commit
      ? input.branch
         ? `branch ${input.branch} (commit ${input.commit.slice(0, 7)})`
         : `commit ${input.commit.slice(0, 7)}`
      : input.branch
         ? `branch ${input.branch}`
         : null;
   const saved = where
      ? `What it had written is on ${where}, which is what your workspace has checked out. `
      : '';
   const leadStart = 'This run starts again from the work already saved.';
   const lead =
      `${leadStart} Do not start over. ` +
      saved +
      'First see what is already there (git status, git log, the files), in one or two commands; then do only what is still missing.';
   const prior = input.prior?.trim() ?? '';
   if (!prior || prior.startsWith(leadStart)) return lead;
   const room = 20_000 - lead.length - 2;
   return room > 0 ? `${lead}\n\n${prior.slice(0, room)}` : lead;
}

export type RestartOutcome =
   | { restarted: true; runId: string }
   | { restarted: false; reason: 'task_moved_on' | 'busy' };

/**
 * A person starts an agent's task again.
 *
 * The task is assigned to an agent and sits in To do, In progress, or In
 * review, and nothing is queued or running on it. A task that has never run
 * is queued for its assignee. One that has is queued for the assignee it has
 * now, from the branch and commit the last agent run left, in the same
 * session when the runtime still holds it. A live run is left as it is.
 */
export async function restartTask(
   sql: Sql,
   input: { issueId: string; requestedBy: string }
): Promise<RestartOutcome> {
   const [issue] = await sql`
      SELECT i.status::text AS issue_status, i.assignee_type, i.assignee_id, i.deleted_at,
             b.workspace_id
        FROM issues i JOIN boards b ON b.id = i.board_id
       WHERE i.id = ${input.issueId}`;
   if (!issue || issue.deleted_at) return { restarted: false, reason: 'task_moved_on' };
   const agentId = issue.assignee_id as string | null;
   if (!taskCanBeRestarted(String(issue.issue_status)) || issue.assignee_type !== 'agent' || !agentId) {
      return { restarted: false, reason: 'task_moved_on' };
   }

   const [live] = await sql`
      SELECT id FROM runs
       WHERE issue_id = ${input.issueId} AND status IN ('queued', 'running')
       LIMIT 1`;
   if (live) return { restarted: false, reason: 'busy' };

   const [run] = await sql`
      SELECT id, source, prompt, instructions, branch, head_commit
        FROM runs
       WHERE issue_id = ${input.issueId} AND kind = 'agent'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`;
   const source = run && TASK_SOURCES.has(run.source as TaskSource) ? (run.source as TaskSource) : 'assignment';
   const prior = run ? ((run.prompt as string | null) || (run.instructions as string | null)) : null;
   try {
      const queued = await enqueueTask(sql, {
         workspaceId: issue.workspace_id as string,
         issueId: input.issueId,
         agentId,
         kind: 'agent',
         source,
         ...(run
            ? {
                 prompt: recoveryInstructions({
                    branch: (run.branch as string | null) ?? null,
                    commit: (run.head_commit as string | null) ?? null,
                    prior,
                 }),
                 origin: { runId: run.id as string },
              }
            : {}),
         requestedBy: input.requestedBy,
      });
      return { restarted: true, runId: queued.runId };
   } catch (error) {
      if (error instanceof ActiveRunExists) return { restarted: false, reason: 'busy' };
      if (error instanceof NotFound || error instanceof EnqueueRejected) return { restarted: false, reason: 'task_moved_on' };
      throw error;
   }
}
