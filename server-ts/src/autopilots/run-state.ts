/**
 * Where a Loop run is, in one word a person can act on.
 *
 * Derived, never stored. A Loop run is a firing record (`autopilot_runs`)
 * plus, once admitted, an agent run the ledger owns (`runs`). The ledger is
 * the only writer of run state and already refuses transitions it does not
 * allow (`RunTerminal`); keeping a second status column here would be a copy
 * that could disagree with it. So the state is read off both rows each time.
 *
 *   firing pending, or agent run queued       → queued
 *   agent run running                         → running
 *   agent run succeeded, its task in review   → waiting_for_approval
 *   agent run succeeded otherwise             → succeeded
 *   agent run failed, or firing failed        → failed
 *   agent run cancelled after the time limit  → timed_out
 *   agent run cancelled otherwise             → canceled
 *   firing skipped (paused, quota, loop, …)   → skipped
 *
 * "Waiting for approval" is Berry's review gate: an agent's work lands in
 * review and stays there until a person releases it. No Loop moves it on.
 */

export const LOOP_RUN_STATES = [
   'queued',
   'running',
   'waiting_for_approval',
   'succeeded',
   'failed',
   'canceled',
   'timed_out',
   'skipped',
] as const;

export type LoopRunState = (typeof LOOP_RUN_STATES)[number];

export interface RunStateFacts {
   /** autopilot_runs.status */
   firing: 'pending' | 'enqueued' | 'skipped' | 'failed';
   /** runs.status of the agent run, when there is one. */
   task: string | null;
   /** issues.status of the task the run worked, as stored (snake_case). */
   issueStatus: string | null;
   timedOut: boolean;
}

export function loopRunState(facts: RunStateFacts): LoopRunState {
   if (facts.firing === 'skipped') return 'skipped';
   if (facts.firing === 'failed') return 'failed';
   if (facts.firing === 'pending') return 'queued';
   switch (facts.task) {
      case null:
      case 'queued':
         return 'queued';
      case 'running':
         return 'running';
      case 'succeeded':
         return facts.issueStatus === 'in_review' ? 'waiting_for_approval' : 'succeeded';
      case 'failed':
         return 'failed';
      case 'cancelled':
         return facts.timedOut ? 'timed_out' : 'canceled';
      default:
         // A status the ledger added after this was written. Not finished is
         // the safe reading: it keeps Cancel on offer and Retry off.
         return 'running';
   }
}

/** Still able to change on its own, so Cancel is meaningful. */
export function isActive(state: LoopRunState): boolean {
   return state === 'queued' || state === 'running';
}

/**
 * Retry is for runs that did not do their work. A run waiting for approval
 * or one that succeeded did; retrying it would do the work twice.
 */
export function isRetryable(state: LoopRunState): boolean {
   return state === 'failed' || state === 'canceled' || state === 'timed_out';
}
