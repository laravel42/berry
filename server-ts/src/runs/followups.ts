import { createHash, randomUUID } from 'node:crypto';
import type { Sql } from '../db/pool.ts';
import type { Logger } from '../observability/log.ts';
import { enqueueTask } from './queue.ts';
import { ActiveRunExists } from './repository.ts';

export async function scheduleReview(sql: Sql, runId: string): Promise<void> {
   await sql`INSERT INTO run_followups (run_id, kind, dedupe_key)
      VALUES (${runId}, 'review', ${`review:${runId}`}) ON CONFLICT (dedupe_key) DO NOTHING`;
}

export async function scheduleMention(sql: Sql, runId: string, targetAgentId: string, message: string): Promise<string> {
   const key = createHash('sha256').update(JSON.stringify([runId, targetAgentId, message])).digest('hex');
   const [row] = await sql`INSERT INTO run_followups (run_id, kind, dedupe_key, target_agent_id, message)
      VALUES (${runId}, 'mention', ${`mention:${key}`}, ${targetAgentId}, ${message})
      ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key RETURNING id`;
   if (!row) throw new Error('Could not persist the handoff');
   return row.id as string;
}

/** Downstream work owns its capacity; it never occupies an execution slot while waiting for a completion. */
export class FollowupWorker {
   readonly #sql: Sql;
   readonly #review: (runId: string) => Promise<unknown>;
   readonly #logger: Logger;
   readonly #workspaceIds: readonly string[] | null;
   #timer: ReturnType<typeof setTimeout> | undefined;
   #running = false;
   #working: Promise<void> | null = null;

   constructor(options: { sql: Sql; review: (runId: string) => Promise<unknown>; logger: Logger; workspaceIds?: readonly string[] }) {
      this.#sql = options.sql;
      this.#review = options.review;
      this.#logger = options.logger;
      this.#workspaceIds = options.workspaceIds ?? null;
   }

   start(): void {
      if (this.#running) return;
      this.#running = true;
      const poll = () => {
         if (!this.#running) return;
         this.#working = this.tick().catch((error: unknown) => {
            this.#logger.error('followup worker failed', { error: error instanceof Error ? error.message : String(error) });
         }).finally(() => {
            this.#working = null;
            if (this.#running) { this.#timer = setTimeout(poll, 2000); this.#timer.unref(); }
         });
      };
      poll();
   }

   async stop(): Promise<void> {
      this.#running = false;
      clearTimeout(this.#timer);
      await this.#working;
   }

   async tick(): Promise<void> {
      const sql = this.#sql;
      const scope = this.#workspaceIds ? sql`AND r.workspace_id IN ${sql([...this.#workspaceIds])}` : sql``;
      await sql`UPDATE run_followups AS f SET status = 'cancelled', completed_at = now()
         FROM runs AS r WHERE f.run_id = r.id AND f.status = 'pending'
           AND r.status IN ('failed', 'cancelled') ${scope}`;
      const claim = randomUUID();
      const [job] = await sql`
         WITH picked AS MATERIALIZED (
            SELECT f.id FROM run_followups AS f JOIN runs AS r ON r.id = f.run_id
             WHERE r.status = 'succeeded' AND f.available_at <= now()
               ${scope}
               AND (f.status = 'pending' OR (f.status = 'running' AND f.lease_until < now()))
             ORDER BY f.created_at LIMIT 1 FOR UPDATE OF f SKIP LOCKED
         )
         UPDATE run_followups AS f SET status = 'running', claim_id = ${claim},
            attempts = attempts + 1, lease_until = now() + interval '5 minutes'
         FROM picked WHERE f.id = picked.id RETURNING f.*`;
      if (!job) return;
      const id = job.id as string;
      const heartbeat = setInterval(() => {
         void sql`UPDATE run_followups SET lease_until = now() + interval '5 minutes'
            WHERE id = ${id} AND claim_id = ${claim} AND status = 'running'`.catch(() => undefined);
      }, 15_000);
      heartbeat.unref();
      try {
         if (job.kind === 'review') {
            await this.#review(job.run_id as string);
            await sql`UPDATE run_followups SET status = 'succeeded', completed_at = now(), lease_until = NULL
               WHERE id = ${id} AND claim_id = ${claim}`;
         } else {
            // The task and acknowledgement commit together, so a retry cannot dispatch twice.
            await sql.begin(async (transaction) => {
               const tx = transaction as unknown as Sql;
               const [owned] = await tx`SELECT id FROM run_followups WHERE id = ${id} AND claim_id = ${claim} FOR UPDATE`;
               if (!owned) return;
               const [parent] = await tx`SELECT workspace_id, issue_id, requested_by FROM runs WHERE id = ${job.run_id as string}`;
               if (!parent?.issue_id) throw new Error('Handoff requires an issue');
               const result = await enqueueTask(tx, {
                  workspaceId: parent.workspace_id as string, issueId: parent.issue_id as string,
                  agentId: job.target_agent_id as string, kind: 'agent', source: 'mention', prompt: job.message as string,
                  ...(parent.requested_by ? { requestedBy: parent.requested_by as string } : {}),
               });
               await tx`UPDATE run_followups SET status = 'succeeded', result_run_id = ${result.runId}, completed_at = now(), lease_until = NULL
                  WHERE id = ${id} AND claim_id = ${claim}`;
            });
         }
      } catch (error) {
         const busy = error instanceof ActiveRunExists;
         const terminal = !busy && Number(job.attempts) >= 5;
         await sql`UPDATE run_followups SET status = ${terminal ? 'failed' : 'pending'},
            attempts = attempts - ${busy ? 1 : 0}, lease_until = NULL,
            available_at = now() + interval '10 seconds',
            error = ${busy ? 'Waiting for the active run' : 'Followup failed; inspect the server log'},
            completed_at = ${terminal ? new Date().toISOString() : null}
            WHERE id = ${id} AND claim_id = ${claim}`;
         if (!busy) this.#logger.error('run followup failed', { id, runId: job.run_id, error: error instanceof Error ? error.message : String(error) });
      } finally { clearInterval(heartbeat); }
   }
}
