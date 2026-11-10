import type { Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import { resolveEvent, resolveLineage, summaryFor, type OutboxEvent } from './event-facts.ts';
import {
   conditionsMatch,
   eventKeysForTopic,
   eventTypeMatches,
   InvalidConditions,
   isLoopEventKey,
   LOOP_EVENT_TYPES,
   parseConditions,
} from './event-triggers.ts';
import { AlreadyFired, type FireFn, type FireOutcome, type RetryPendingFn } from './fire.ts';
import { MAX_CHAIN_DEPTH } from './policy.ts';

/**
 * The part of Loops that runs on Berry's own clock, beside the dispatcher and
 * the schedule: answering events and holding runs to their time limit.
 *
 * Events, in two steps, both safe with any number of servers:
 *
 * 1. Receive. One cursor row follows `outbox_events`, locked FOR UPDATE SKIP
 *    LOCKED so one server reads each batch, two seconds behind now so a
 *    transaction that commits a little late is not stepped over (the plugin
 *    hook runner's rule). Every event whose topic an enabled event trigger in
 *    its workspace listens for becomes a receipt — in the same transaction
 *    that moves the cursor, so a crash loses nothing and repeats nothing.
 *
 * 2. Process. Receipts are claimed with SKIP LOCKED, filtered, checked for
 *    lineage, and fired. `autopilot_runs (trigger_id, trigger_event_id)` is
 *    unique, so however two workers race on a receipt, one run exists. A
 *    receipt left `processing` by a crash is claimed again after five
 *    minutes; one that keeps failing gives up after five attempts.
 *
 * Time limits: a Loop with `max_duration_minutes` has runs that have been
 * queued or running longer than that cancelled through the ledger — the same
 * call a person's Cancel makes — and the record marked timed out.
 */

const POLL_MS = 5_000;
const RECEIVE_BATCH = 200;
const PROCESS_BATCH = 25;
const MAX_ATTEMPTS = 5;
const RETENTION_DAYS = 30;

export interface CancelRun {
   (runId: string): Promise<unknown>;
}

export interface LoopWorkerOptions {
   sql: Sql;
   fire: FireFn;
   retryPending: RetryPendingFn;
   cancelRun: CancelRun;
   logger: Logger;
   pollMs?: number;
   receiveBatch?: number;
   processBatch?: number;
   /** How far behind now the cursor reads, for commits that land late. Tests set 0. */
   lagMs?: number;
}

export interface TickResult {
   received: number;
   processed: number;
   timedOut: number;
}

export class LoopWorker {
   readonly #options: LoopWorkerOptions;
   #timer: NodeJS.Timeout | null = null;
   #running: Promise<unknown> | null = null;

   constructor(options: LoopWorkerOptions) {
      this.#options = options;
   }

   start(): void {
      if (this.#timer) return;
      // The migration seeds the cursor; a reset empties it. Starting from now
      // is right either way: a Loop hears what happens after it is listening.
      void this.#options.sql`INSERT INTO autopilot_event_cursor (id) VALUES (1) ON CONFLICT DO NOTHING`.catch((error: unknown) =>
         this.#options.logger.error('loop event cursor init failed', { error: message(error) })
      );
      this.#timer = setInterval(() => {
         if (this.#running) return;
         this.#running = this.tick()
            .catch((error: unknown) => this.#options.logger.error('loop worker tick failed', { error: message(error) }))
            .finally(() => {
               this.#running = null;
            });
      }, this.#options.pollMs ?? POLL_MS);
      this.#timer.unref();
   }

   async stop(): Promise<void> {
      if (this.#timer) clearInterval(this.#timer);
      this.#timer = null;
      await this.#running;
   }

   /** One pass. Public so tests drive it without a timer. */
   async tick(): Promise<TickResult> {
      const received = await this.receive();
      const processed = await this.process();
      const timedOut = await this.enforceTimeouts();
      await this.#prune();
      return { received, processed, timedOut };
   }

   /** Step 1: outbox → receipts. Returns how many receipts were written. */
   async receive(): Promise<number> {
      const { sql } = this.#options;
      const batch = this.#options.receiveBatch ?? RECEIVE_BATCH;
      return sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [cursor] = await tx`
            SELECT occurred_at, event_id FROM autopilot_event_cursor WHERE id = 1 FOR UPDATE SKIP LOCKED`;
         if (!cursor) return 0;
         const lagMs = this.#options.lagMs ?? 2_000;
         const [clock] = await tx`SELECT now() - make_interval(secs => ${lagMs / 1000}) AS horizon`;
         const horizon = clock?.horizon as string;

         // Only topics an enabled event trigger of an active Loop listens for:
         // the outbox also carries run.output.delta and friends, and reading
         // them would fill every batch.
         const listening = await tx`
            SELECT DISTINCT t.event_type FROM autopilot_triggers AS t
              JOIN autopilots AS a ON a.id = t.autopilot_id
             WHERE t.kind = 'event' AND t.enabled AND a.status = 'active'`;
         const topics = [
            ...new Set(
               listening
                  .map((row) => row.event_type as string)
                  .filter(isLoopEventKey)
                  .map((key) => LOOP_EVENT_TYPES[key].topic)
            ),
         ];
         const found =
            topics.length === 0
               ? []
               : await tx`
                  SELECT id, topic, workspace_id, occurred_at FROM outbox_events
                   WHERE (occurred_at, id) > (${cursor.occurred_at as string}::timestamptz, ${cursor.event_id as string}::uuid)
                     AND occurred_at <= ${horizon}::timestamptz
                     AND workspace_id IS NOT NULL
                     AND topic = ANY(${tx.array(topics)}::text[])
                   ORDER BY occurred_at, id
                   LIMIT ${batch}`;

         let written = 0;
         if (found.length > 0) {
            // Event type keys per topic, as two parallel arrays the query unnests.
            const pairs = topics.flatMap((topic) => eventKeysForTopic(topic).map((key) => [topic, key] as const));
            const inserted = await tx`
               INSERT INTO autopilot_event_receipts (workspace_id, autopilot_id, trigger_id, event_id, topic, occurred_at)
               SELECT t.workspace_id, t.autopilot_id, t.id, e.id, e.topic, e.occurred_at
                 FROM outbox_events AS e
                 JOIN unnest(${tx.array(pairs.map((pair) => pair[0]))}::text[], ${tx.array(pairs.map((pair) => pair[1]))}::text[])
                      AS k(topic, event_type) ON k.topic = e.topic
                 JOIN autopilot_triggers AS t
                      ON t.workspace_id = e.workspace_id AND t.kind = 'event' AND t.enabled
                     AND t.event_type = k.event_type
                     -- A trigger hears what happened after it was made, not before.
                     AND t.created_at <= e.occurred_at
                 JOIN autopilots AS a ON a.id = t.autopilot_id AND a.status = 'active'
                WHERE e.id = ANY(${tx.array(found.map((row) => row.id as string))}::uuid[])
               ON CONFLICT (trigger_id, event_id) DO NOTHING
               RETURNING id`;
            written = inserted.length;
         }

         const last = found.at(-1);
         if (last && found.length === batch) {
            await tx`
               UPDATE autopilot_event_cursor SET occurred_at = ${last.occurred_at as string}, event_id = ${last.id as string}
                WHERE id = 1`;
         } else {
            // Everything listened for up to the horizon has been read. The
            // all-f uuid sorts after every id at that instant.
            await tx`
               UPDATE autopilot_event_cursor
                  SET occurred_at = ${horizon}::timestamptz, event_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
                WHERE id = 1`;
         }
         return written;
      }) as Promise<number>;
   }

   /** Step 2: receipts → runs. Returns how many receipts were settled. */
   async process(): Promise<number> {
      const { sql } = this.#options;
      await sql`
         UPDATE autopilot_event_receipts
            SET status = 'failed', reason_code = 'GAVE_UP', processed_at = now()
          WHERE status IN ('pending', 'processing') AND attempts >= ${MAX_ATTEMPTS}`;
      const claimed = await sql`
         UPDATE autopilot_event_receipts
            SET status = 'processing', claimed_at = now(), attempts = attempts + 1
          WHERE id IN (
             SELECT id FROM autopilot_event_receipts
              WHERE (status = 'pending' OR (status = 'processing' AND claimed_at < now() - interval '5 minutes'))
                AND attempts < ${MAX_ATTEMPTS}
              ORDER BY received_at, id
              LIMIT ${this.#options.processBatch ?? PROCESS_BATCH}
              FOR UPDATE SKIP LOCKED)
          RETURNING id, workspace_id, autopilot_id, trigger_id, event_id`;
      let settled = 0;
      for (const receipt of claimed) {
         try {
            await this.#processOne({
               id: receipt.id as string,
               workspaceId: receipt.workspace_id as string,
               autopilotId: receipt.autopilot_id as string,
               triggerId: receipt.trigger_id as string,
               eventId: receipt.event_id as string,
            });
            settled += 1;
         } catch (error) {
            // Left `processing`; claimed again once the five minutes pass.
            this.#options.logger.error('loop event receipt failed', { receiptId: receipt.id as string, error: message(error) });
         }
      }
      return settled;
   }

   async #processOne(receipt: { id: string; workspaceId: string; autopilotId: string; triggerId: string; eventId: string }): Promise<void> {
      const { sql } = this.#options;
      const settle = (status: 'fired' | 'filtered' | 'skipped' | 'failed', reasonCode: string | null, autopilotRunId: string | null = null) =>
         sql`
            UPDATE autopilot_event_receipts
               SET status = ${status}, reason_code = ${reasonCode}, autopilot_run_id = ${autopilotRunId}, processed_at = now()
             WHERE id = ${receipt.id}`;

      // Fired already (a crash after the firing, before this settle)?
      const [existing] = await sql`
         SELECT id, status FROM autopilot_runs
          WHERE trigger_id = ${receipt.triggerId} AND trigger_event_id = ${receipt.eventId}`;
      if (existing) {
         const outcome =
            existing.status === 'pending' ? await this.#options.retryPending({ autopilotRunId: existing.id as string }) : null;
         await settle(outcome?.status === 'skipped' ? 'skipped' : 'fired', outcome?.reasonCode ?? null, existing.id as string);
         return;
      }

      const [trigger] = await sql`
         SELECT t.event_type, t.conditions, t.enabled, a.status, a.allow_agent_events, a.max_chain_depth
           FROM autopilot_triggers AS t JOIN autopilots AS a ON a.id = t.autopilot_id
          WHERE t.id = ${receipt.triggerId} AND t.workspace_id = ${receipt.workspaceId}`;
      if (!trigger || !trigger.enabled || trigger.status !== 'active') return void (await settle('skipped', 'TRIGGER_OFF'));
      const eventType = trigger.event_type as string;
      if (!isLoopEventKey(eventType)) return void (await settle('failed', 'UNKNOWN_EVENT_TYPE'));
      let conditions;
      try {
         conditions = parseConditions(eventType, trigger.conditions);
      } catch (error) {
         if (!(error instanceof InvalidConditions)) throw error;
         return void (await settle('failed', 'INVALID_FILTERS'));
      }

      const [row] = await sql`
         SELECT id, topic, workspace_id, occurred_at, payload FROM outbox_events
          WHERE id = ${receipt.eventId} AND workspace_id = ${receipt.workspaceId}`;
      if (!row) return void (await settle('failed', 'EVENT_GONE'));
      const event: OutboxEvent = {
         id: row.id as string,
         topic: row.topic as string,
         workspaceId: row.workspace_id as string,
         occurredAt: new Date(row.occurred_at as string).toISOString(),
         envelope: (row.payload as Record<string, unknown> | null) ?? {},
      };

      const resolved = await resolveEvent(sql, event);
      if (!eventTypeMatches(eventType, resolved.facts)) return void (await settle('filtered', 'OTHER_CHANGE'));
      if (!conditionsMatch(conditions, resolved.facts)) return void (await settle('filtered', 'FILTERS'));
      if (resolved.agentCaused && trigger.allow_agent_events !== true) return void (await settle('skipped', 'AGENT_EVENT'));

      const lineage = await resolveLineage(sql, receipt.workspaceId, event.topic, resolved);
      // A Loop never answers its own work, however many hops away.
      if (lineage.ancestry.has(receipt.autopilotId)) return void (await settle('skipped', 'LOOP_CYCLE'));
      const depth = lineage.parentAutopilotRunId ? lineage.parentDepth + 1 : 0;
      const limit = Math.min(MAX_CHAIN_DEPTH, (trigger.max_chain_depth as number | null) ?? 0);
      if (depth > limit) return void (await settle('skipped', 'CHAIN_TOO_DEEP'));

      let outcome: FireOutcome;
      try {
         outcome = await this.#options.fire({
            autopilotId: receipt.autopilotId,
            source: 'event',
            triggerId: receipt.triggerId,
            triggerEventId: receipt.eventId,
            payload: summaryFor(eventType, resolved),
            parentAutopilotRunId: lineage.parentAutopilotRunId,
            depth,
         });
      } catch (error) {
         if (error instanceof AlreadyFired) return void (await settle('fired', null, error.autopilotRunId));
         throw error;
      }
      await settle(outcome.status === 'skipped' ? 'skipped' : 'fired', outcome.reasonCode, outcome.autopilotRunId);
   }

   /** Cancel runs past their Loop's limit. Returns how many were stopped. */
   async enforceTimeouts(): Promise<number> {
      const { sql, cancelRun, logger } = this.#options;
      const overdue = await sql`
         UPDATE autopilot_runs AS ar SET timed_out_at = now()
          WHERE ar.id IN (
             SELECT ar2.id FROM autopilot_runs AS ar2
               JOIN autopilots AS a ON a.id = ar2.autopilot_id
               JOIN runs AS r ON r.id = ar2.run_id
              WHERE a.max_duration_minutes IS NOT NULL
                AND ar2.timed_out_at IS NULL
                AND r.status IN ('queued', 'running')
                AND COALESCE(r.started_at, r.created_at) < now() - make_interval(mins => a.max_duration_minutes)
              LIMIT 50
              FOR UPDATE OF ar2 SKIP LOCKED)
          RETURNING ar.id, ar.run_id`;
      let stopped = 0;
      for (const row of overdue) {
         try {
            await cancelRun(row.run_id as string);
            stopped += 1;
         } catch (error) {
            // Finished in the meantime: it was not cut short, so it did not time out.
            await sql`UPDATE autopilot_runs SET timed_out_at = NULL WHERE id = ${row.id as string}`;
            logger.info('loop run finished before its time limit was enforced', { autopilotRunId: row.id as string, error: message(error) });
         }
      }
      return stopped;
   }

   async #prune(): Promise<void> {
      await this.#options.sql`
         DELETE FROM autopilot_event_receipts
          WHERE id IN (
             SELECT id FROM autopilot_event_receipts
              WHERE received_at < now() - make_interval(days => ${RETENTION_DAYS})
                AND status NOT IN ('pending', 'processing')
              ORDER BY received_at, id
              LIMIT 1000)`;
   }
}

function message(error: unknown): string {
   return error instanceof Error ? error.message : String(error);
}
