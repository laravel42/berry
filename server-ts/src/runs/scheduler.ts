import { withinTx, type Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import { InvalidSchedule, nextFireAfter } from '../autopilots/cron.ts';
import type { FireFn, FireOutcome, RetryPendingFn } from '../autopilots/fire.ts';
import { writeAutopilotEvent } from '../autopilots/events.ts';

/**
 * What fires an autopilot's schedule.
 *
 * Lives beside the dispatcher and runs in the same process, for the same
 * reason: it is work the server does on its own clock, and it must be safe
 * with any number of servers doing it at once. The dispatcher gets that from
 * `SKIP LOCKED`; this gets it from `sys_cron_executions`, whose unique
 * `(trigger_id, slot)` lets exactly one insert win per slot. The winner
 * fires; everybody else moves on.
 *
 * Slot completion and schedule advancement commit together, after the firing
 * returns. The shared lock is not held across that firing: one slow slot
 * must not keep every other schedule from running. A per-slot lock, taken
 * only for the slot being fired and released when the firing returns, stops
 * a second firing of that same slot. A crash releases it with the connection.
 * A pending run that never got an agent run is retried. A firing that failed
 * before writing a run leaves the slot due.
 *
 * Missed slots (the server was down) collapse into one firing: the next slot
 * is computed from now, not from the last one. An autopilot that wakes up to
 * forty queued "daily summary" tasks is worse than one that skipped a few.
 */

const POLL_MS = 15_000;
const BATCH = 50;

export interface SchedulerOptions {
   sql: Sql;
   fire: FireFn;
   logger: Logger;
   pollMs?: number;
   batch?: number;
   clock?: () => Date;
   /** Leave a workspace's slot due until its selected execution is available. */
   canFire?: (workspaceId: string) => Promise<boolean>;
   /**
    * Continue a pending autopilot run that has no agent run. Without it, that
    * slot stays due rather than being marked failed.
    */
   retryPending?: RetryPendingFn;
}

export class AutopilotScheduler {
   readonly #sql: Sql;
   readonly #fire: FireFn;
   readonly #logger: Logger;
   readonly #pollMs: number;
   readonly #batch: number;
   readonly #clock: () => Date;
   readonly #canFire: (workspaceId: string) => Promise<boolean>;
   readonly #retryPending: RetryPendingFn | null;

   #running = false;
   #loop: Promise<void> | null = null;
   #wake: (() => void) | null = null;

   constructor(options: SchedulerOptions) {
      this.#sql = options.sql;
      this.#fire = options.fire;
      this.#logger = options.logger;
      this.#pollMs = options.pollMs ?? POLL_MS;
      this.#batch = options.batch ?? BATCH;
      this.#clock = options.clock ?? (() => new Date());
      this.#canFire = options.canFire ?? (async () => true);
      this.#retryPending = options.retryPending ?? null;
   }

   start(): void {
      if (this.#running) return;
      this.#running = true;
      this.#loop = this.#poll();
   }

   async stop(): Promise<void> {
      this.#running = false;
      this.#wake?.();
      await this.#loop?.catch(() => undefined);
      this.#loop = null;
   }

   async #poll(): Promise<void> {
      while (this.#running) {
         try {
            await this.tick();
         } catch (error) {
            this.#logger.error('autopilot schedule tick failed', { error: message(error) });
         }
         await this.#sleep(this.#pollMs);
      }
   }

   /** One pass over what is due. Public so tests drive it without a timer. */
   async tick(): Promise<number> {
      const now = this.#clock();
      // Old claims are history nobody reads; next_fire_at only moves forward,
      // so a pruned slot is never due again and cannot be claimed twice.
      await this.#sql`
         DELETE FROM sys_cron_executions
          WHERE id IN (
             SELECT id FROM sys_cron_executions
              WHERE claimed_at < ${now.toISOString()}::timestamptz - interval '30 days'
              ORDER BY claimed_at, id
              LIMIT 1000)`;
      const due = await this.#sql`
         SELECT trigger.id, trigger.workspace_id, trigger.autopilot_id,
                trigger.cron_expression, trigger.timezone, trigger.next_fire_at
           FROM autopilot_triggers AS trigger
           JOIN autopilots AS autopilot ON autopilot.id = trigger.autopilot_id
          WHERE trigger.kind = 'cron' AND trigger.enabled
            AND trigger.next_fire_at <= ${now.toISOString()}
            AND autopilot.status = 'active'
          ORDER BY trigger.next_fire_at ASC
          LIMIT ${this.#batch}`;

      let firedCount = 0;
      for (const row of due) {
         const triggerId = row.id as string;
         try {
            if (!(await this.#canFire(row.workspace_id as string))) continue;
            if (await this.#claimAndFire(row, now)) firedCount += 1;
         } catch (error) {
            this.#logger.error('autopilot slot failed', { triggerId, error: message(error) });
         }
      }
      return firedCount;
   }

   async #claimAndFire(row: Record<string, unknown>, now: Date): Promise<boolean> {
      const triggerId = row.id as string;
      const slotAt = String(row.next_fire_at);
      const slot = new Date(slotAt);

      let next: Date | null;
      try {
         next = nextFireAfter(row.cron_expression as string, row.timezone as string, now > slot ? now : slot);
      } catch (error) {
         if (!(error instanceof InvalidSchedule)) throw error;
         // Stored before a rule changed, or edited by hand. Retrying it every
         // tick would fill the log with one line forever.
         await this.#sql`UPDATE autopilot_triggers SET enabled = false WHERE id = ${triggerId}`;
         this.#logger.error('disabled an autopilot schedule that no longer reads', { triggerId });
         return false;
      }

      const slotKey = `berry:autopilot-slot:${triggerId}:${slotAt}`;
      const conn = await this.#sql.reserve();
      let locked = false;
      try {
         // Per slot, not process-wide. Held only while this slot fires, on
         // this connection, so a slow firing does not stall every schedule
         // and a second worker cannot fire the same slot.
         const [lock] = await conn`SELECT pg_try_advisory_lock(hashtextextended(${slotKey}, 0)) AS acquired`;
         locked = lock?.acquired === true;
         if (!locked) return false;

         const [current] = await this.#sql`
            SELECT next_fire_at FROM autopilot_triggers WHERE id = ${triggerId} AND enabled`;
         if (!current?.next_fire_at || Date.parse(String(current.next_fire_at)) !== slot.getTime()) return false;

         const existing = await this.#existingRun(triggerId, slotAt);
         if (existing && existing.status === 'pending' && (existing.queuedRunId || existing.runId)) {
            await this.#reconcileQueued(row, existing, now);
            await this.#advance(row, triggerId, slot, slotAt, next, existing.id, 'enqueued');
            return true;
         }
         if (existing && existing.status !== 'pending') {
            await this.#advance(row, triggerId, slot, slotAt, next, existing.id, existing.status);
            return true;
         }

         let outcome: FireOutcome;
         if (existing) {
            if (!this.#retryPending) {
               throw new Error('A pending scheduled run has no agent run, and no retry is configured.');
            }
            outcome = await this.#retryPending({ autopilotRunId: existing.id });
         } else {
            outcome = await this.#fire({
               autopilotId: row.autopilot_id as string,
               source: 'cron',
               triggerId,
               slot,
            });
         }
         await this.#advance(row, triggerId, slot, slotAt, next, outcome.autopilotRunId, outcome.status);
         return true;
      } finally {
         if (locked) {
            await conn`SELECT pg_advisory_unlock(hashtextextended(${slotKey}, 0))`.catch(() => undefined);
         }
         await conn.release();
      }
   }

   async #existingRun(triggerId: string, slotAt: string): Promise<{
      id: string;
      status: string;
      runId: string | null;
      queuedRunId: string | null;
      issueId: string | null;
      queuedIssueId: string | null;
   } | null> {
      const [existing] = await this.#sql`
         SELECT a.id, a.status, a.run_id, a.issue_id,
                r.id AS queued_run_id, r.issue_id AS queued_issue_id
           FROM autopilot_runs a
           LEFT JOIN runs r ON r.autopilot_run_id = a.id
          WHERE a.trigger_id = ${triggerId} AND a.slot = ${slotAt}::timestamptz
          ORDER BY a.created_at DESC
          LIMIT 1`;
      if (!existing) return null;
      return {
         id: existing.id as string,
         status: existing.status as string,
         runId: (existing.run_id as string | null) ?? null,
         queuedRunId: (existing.queued_run_id as string | null) ?? null,
         issueId: (existing.issue_id as string | null) ?? null,
         queuedIssueId: (existing.queued_issue_id as string | null) ?? null,
      };
   }

   /** A pending row whose enqueue already committed keeps that agent run. */
   async #reconcileQueued(
      row: Record<string, unknown>,
      existing: { id: string; runId: string | null; queuedRunId: string | null; issueId: string | null; queuedIssueId: string | null },
      now: Date
   ): Promise<void> {
      const runId = existing.queuedRunId ?? existing.runId;
      const issueId = existing.queuedIssueId ?? existing.issueId;
      await withinTx(this.#sql, async (tx) => {
         await tx`
            UPDATE autopilot_runs
               SET status = 'enqueued', run_id = ${runId}, issue_id = ${issueId},
                   reason_code = NULL, reason_message = NULL
             WHERE id = ${existing.id} AND status = 'pending'`;
         await writeAutopilotEvent(tx, {
            workspaceId: row.workspace_id as string,
            topic: 'autopilot.run.created',
            autopilotId: row.autopilot_id as string,
            payload: { autopilotRunId: existing.id, status: 'enqueued', reasonCode: null, runId, issueId },
            occurredAt: now.toISOString(),
         });
      });
   }

   async #advance(
      row: Record<string, unknown>,
      triggerId: string,
      slot: Date,
      slotAt: string,
      next: Date | null,
      autopilotRunId: string,
      status: string
   ): Promise<void> {
      let recorded = false;
      await withinTx(this.#sql, async (tx) => {
         const [advanced] = await tx`
            UPDATE autopilot_triggers
               SET next_fire_at = ${next ? next.toISOString() : null},
                   last_fired_at = ${slot.toISOString()}
             WHERE id = ${triggerId} AND next_fire_at = ${slotAt}::timestamptz
            RETURNING id`;
         if (!advanced) return;
         recorded = true;
         await tx`
            INSERT INTO sys_cron_executions (workspace_id, trigger_id, slot)
            VALUES (${row.workspace_id as string}, ${triggerId}, ${slotAt}::timestamptz)
            ON CONFLICT (trigger_id, slot) DO NOTHING`;
         await tx`
            UPDATE sys_cron_executions SET autopilot_run_id = ${autopilotRunId}
             WHERE trigger_id = ${triggerId} AND slot = ${slotAt}::timestamptz`;
      });
      if (recorded) this.#logger.info('autopilot slot recorded', { triggerId, slot: slot.toISOString(), status });
   }

   #sleep(ms: number): Promise<void> {
      return new Promise<void>((resolve) => {
         const timer = setTimeout(finish, ms);
         timer.unref?.();
         this.#wake = finish;

         function finish(): void {
            clearTimeout(timer);
            resolve();
         }
      });
   }
}

function message(error: unknown): string {
   return error instanceof Error ? error.message : String(error);
}
