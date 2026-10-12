import { withinTx, type Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import { InvalidSchedule, nextFireAfter } from '../autopilots/cron.ts';
import type { FireFn } from '../autopilots/fire.ts';
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
 * Slot completion and schedule advancement commit together. A short shared
 * lock prevents concurrent firings while the firing function writes its own
 * durable run. After a crash, that run is reconciled rather than fired twice.
 * A firing that failed before writing a run leaves the slot due for retry.
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
}

export class AutopilotScheduler {
   readonly #sql: Sql;
   readonly #fire: FireFn;
   readonly #logger: Logger;
   readonly #pollMs: number;
   readonly #batch: number;
   readonly #clock: () => Date;

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
            if (await this.#claimAndFire(row, now)) firedCount += 1;
         } catch (error) {
            this.#logger.error('autopilot slot failed', { triggerId, error: message(error) });
         }
      }
      return firedCount;
   }

   async #claimAndFire(row: Record<string, unknown>, now: Date): Promise<boolean> {
      const triggerId = row.id as string;
      const slot = new Date(String(row.next_fire_at));

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

      return withinTx(this.#sql, async (tx) => {
         // Read after acquiring the lock: another scheduler may have advanced
         // this slot since the due list was collected. The firing uses the
         // normal pool, so it must not share this transaction's connection.
         const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtextextended('berry:autopilots:schedule-firing', 0)) AS acquired`;
         if (lock?.acquired !== true) return false;
         const [current] = await tx`SELECT next_fire_at FROM autopilot_triggers WHERE id = ${triggerId} AND enabled`;
         if (!current?.next_fire_at || Date.parse(String(current.next_fire_at)) !== slot.getTime()) return false;

         await tx`
            INSERT INTO sys_cron_executions (workspace_id, trigger_id, slot)
            VALUES (${row.workspace_id as string}, ${triggerId}, ${slot.toISOString()})
            ON CONFLICT (trigger_id, slot) DO NOTHING`;

         // A crash can occur after fire persisted its run but before this
         // transaction committed. Recover that exact slot; never create a
         // second issue or charge another agent run for the same firing.
         const [existing] = await tx`
            SELECT a.id, a.status, a.reason_code, a.run_id, a.issue_id,
                   r.id AS queued_run_id, r.issue_id AS queued_issue_id
              FROM autopilot_runs a
              LEFT JOIN runs r ON r.autopilot_run_id = a.id
             WHERE a.trigger_id = ${triggerId} AND a.slot = ${slot.toISOString()}
             ORDER BY a.created_at DESC LIMIT 1`;
         let autopilotRunId: string;
         let status: string;
         if (existing) {
            autopilotRunId = existing.id as string;
            status = existing.status as string;
            if (status === 'pending') {
               // If enqueue committed, retain it. Otherwise the interrupted
               // attempt is explicitly failed, not silently lost or replayed.
               const runId = (existing.queued_run_id as string | null) ?? null;
               const issueId = (existing.queued_issue_id as string | null) ?? (existing.issue_id as string | null) ?? null;
               status = runId ? 'enqueued' : 'failed';
               const reasonCode = runId ? null : 'SCHEDULE_INTERRUPTED';
               await tx`
                  UPDATE autopilot_runs SET status = ${status}, run_id = ${runId}, issue_id = ${issueId},
                         reason_code = ${reasonCode},
                         reason_message = ${runId ? null : 'The scheduled firing was interrupted before its agent run was recorded. Run it again manually.'}
                   WHERE id = ${autopilotRunId}`;
               await writeAutopilotEvent(tx, {
                  workspaceId: row.workspace_id as string,
                  topic: 'autopilot.run.created', autopilotId: row.autopilot_id as string,
                  payload: { autopilotRunId, status, reasonCode, runId, issueId }, occurredAt: now.toISOString(),
               });
            }
         } else {
            const outcome = await this.#fire({
               autopilotId: row.autopilot_id as string, source: 'cron', triggerId, slot,
            });
            autopilotRunId = outcome.autopilotRunId;
            status = outcome.status;
         }

         await tx`
            UPDATE sys_cron_executions SET autopilot_run_id = ${autopilotRunId}
             WHERE trigger_id = ${triggerId} AND slot = ${slot.toISOString()}`;
         await tx`
            UPDATE autopilot_triggers
               SET next_fire_at = ${next ? next.toISOString() : null}, last_fired_at = ${slot.toISOString()}
             WHERE id = ${triggerId} AND next_fire_at = ${slot.toISOString()}`;
         this.#logger.info('autopilot slot recorded', { triggerId, slot: slot.toISOString(), status });
         return true;
      });
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
