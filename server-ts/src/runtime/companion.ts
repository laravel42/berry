import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Sql } from '../db/pool.ts';
import { canonicalJSON } from '../http/canonical-json.ts';
import { ApiError } from '../http/errors.ts';
import { notifyRunTerminal } from '../runs/terminal-hooks.ts';
import { RunLedger, RunTerminal, type Run, type Usage } from '../runs/ledger.ts';
import { lifecycleEventSchema } from './lifecycle.ts';
import { revokeTaskTokens } from './agent-tools/tokens.ts';
import type { RuntimeTaskExecutor } from './task-executor.ts';

export const folderSchema = z.strictObject({ path: z.string().min(1).max(4096), repositories: z.array(z.string().max(256)).max(32) });
export type Folder = z.infer<typeof folderSchema>;
export function folderForRepository(folders: Folder[], repository: string | null): string | null {
   const matches = repository ? folders.filter(folder => folder.repositories.some(remote => remote.toLowerCase() === repository.toLowerCase())) : folders;
   const match = matches.length === 1 ? matches[0] : undefined;
   return match?.path ?? null;
}
const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: null, currency: null });
const stateSchema = z.object({ companion: z.object({ id: z.string(), claim: z.string(), cursor: z.number().int(), usageEventIds: z.array(z.string()).default([]), fingerprint: z.string().optional(), model: z.string(), usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number(), costMicros: z.number().nullable(), currency: z.string().nullable() }) }) });

/** Run ownership and ordered event ingestion survive routing to another server process. */
export class Companion {
   constructor(privateSql: Sql, executor: RuntimeTaskExecutor) { this.sql = privateSql; this.executor = executor; }
   private readonly sql: Sql;
   private readonly executor: RuntimeTaskExecutor;

   async claim(userId: string, id: string, folders: Folder[]) {
      // The advisory lock serializes claims for one companion across tabs/processes.
      const picked = await this.sql.begin(async transaction => {
         const tx = transaction as unknown as Sql;
         await tx`SELECT pg_advisory_xact_lock(hashtextextended('berry:runs:dispatch-capacity', 0))`;
         await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`companion:${userId}:${id}`}, 0))`;
         const [busy] = await tx`SELECT id FROM runs WHERE ai_runtime_user_id = ${userId}
            AND runtime_resume->'companion'->>'id' = ${id} AND dispatch_lease_until > now()`;
         if (busy) return null;
         const [run] = await tx`SELECT r.id, COALESCE(project.github_repo_full_name, r.origin->>'repository') AS repository FROM runs r
            JOIN ai_runtime_connections c ON c.id = r.ai_runtime_connection_id AND c.workspace_id = r.workspace_id AND c.runtime_key = r.ai_runtime_key
            JOIN workspace_memberships m ON m.workspace_id = r.workspace_id AND m.user_id = ${userId}
            LEFT JOIN issues i ON i.id = r.issue_id
            LEFT JOIN issue_project_links link ON link.issue_id = i.id
            LEFT JOIN projects project ON project.id = link.project_id AND project.deleted_at IS NULL
            WHERE r.ai_runtime_user_id = ${userId} AND c.user_id = ${userId} AND c.status = 'connected'
              AND c.metadata->>'companionId' = ${id} AND r.status = 'queued' AND r.dispatch_state = 'pending'
              AND r.dispatch_lease_until IS NULL
              AND NOT EXISTS (SELECT 1 FROM runs active WHERE active.agent_id = r.agent_id AND active.status IN ('queued', 'running') AND (active.dispatch_state <> 'pending' OR active.dispatch_lease_until > now()))
            ORDER BY r.priority DESC, r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`;
         if (!run) return null;
         const claim = randomUUID();
         const state = { companion: { id, claim, cursor: 0, model: '', usage: zeroUsage() } };
         await tx`UPDATE runs SET dispatch_lease_until = now() + interval '60 seconds', runtime_resume = ${tx.json(state as never)} WHERE id = ${run.id}`;
         return { runId: String(run.id), claim, folder: folderForRepository(folders, run.repository as string | null) };
      });
      if (!picked) return null;
      const ledger = new RunLedger({ sql: this.sql });
      if (!picked.folder) {
         await ledger.fail({ runId: picked.runId, failure: { code: 'COMPANION_FOLDER_REQUIRED', message: 'Open the project folder in the VS Code companion (a unique matching git remote, or a single open folder when the project has no repository).', retryable: false } });
         return null;
      }
      try {
         const built = await this.executor.prepareCompanion(picked.runId);
         const accepted = await this.sql`UPDATE runs SET runtime_resume = jsonb_set(runtime_resume, '{companion,model}', ${this.sql.json(built.model)}), runtime_session_id = ${built.envelope.runtimeSessionId}
            WHERE id = ${picked.runId} AND status = 'queued' AND dispatch_state = 'dispatching'
              AND dispatch_lease_until > now() AND runtime_resume->'companion'->>'claim' = ${picked.claim}`;
         if (accepted.count !== 1) { await revokeTaskTokens(this.sql, picked.runId); return null; }
         // The PAT never enters this object. Only the freshly minted task token does.
         return { ...picked, envelope: built.envelope, leaseMs: 60_000 };
      } catch {
         await ledger.fail({ runId: picked.runId, failure: { code: 'COMPANION_PREPARE_FAILED', message: 'Could not prepare this subscription run. Reconnect the CLI in the VS Code companion.', retryable: false } }).catch(error => { if (!(error instanceof RunTerminal)) throw error; });
         await revokeTaskTokens(this.sql, picked.runId);
         return null;
      }
   }

   async update(userId: string, runId: string, claim: string, input: { sequence?: number; event?: z.infer<typeof lifecycleEventSchema>; cancelled?: boolean }) {
      const terminal: Run[] = [];
      const result = await this.sql.begin(async transaction => {
         const tx = transaction as unknown as Sql;
         // Ledger transactions join this transaction; event and cursor are atomic.
         const scoped: Sql = new Proxy(tx, { get(target, key, receiver) {
            if (key === 'begin') return async (work: (sql: Sql) => Promise<unknown>) => work(scoped);
            return Reflect.get(target, key, receiver);
         } });
         const ledger = new RunLedger({ sql: scoped, notifyTerminal: async run => { terminal.push(run); } });
         const [row] = await tx`SELECT r.status, r.runtime_resume, r.dispatch_lease_until > now() AS live
            FROM runs r JOIN workspace_memberships m ON m.workspace_id = r.workspace_id AND m.user_id = ${userId}
            JOIN ai_runtime_connections c ON c.id = r.ai_runtime_connection_id AND c.workspace_id = r.workspace_id AND c.runtime_key = r.ai_runtime_key AND c.user_id = ${userId}
            WHERE r.id = ${runId} AND r.ai_runtime_user_id = ${userId} FOR UPDATE OF r`;
         const parsed = stateSchema.safeParse(row?.runtime_resume);
         if (!row || !parsed.success || parsed.data.companion.claim !== claim) throw ApiError.notFound('Run');
         const state = parsed.data;
         const cancel = row.status === 'cancelled';
         if (cancel || row.status === 'failed' || row.status === 'succeeded') {
            if (input.cancelled) await tx`UPDATE runs SET dispatch_lease_until = NULL WHERE id = ${runId}`;
            return { cancel: true, nextSequence: state.companion.cursor };
         }
         if (!row.live) throw new ApiError(409, 'COMPANION_LEASE_EXPIRED', 'Stop this CLI child; its lease expired.');
         if (input.event) {
            const fingerprint = createHash('sha256').update(canonicalJSON(input.event)).digest('hex');
            if (input.sequence === state.companion.cursor) {
               const usageEvents = new Set(state.companion.usageEventIds);
               await this.executor.companionEvent(scoped, ledger, runId, input.event, state.companion.cursor, state.companion.usage, state.companion.model, row.status === 'running', usageEvents);
               state.companion.usageEventIds = [...usageEvents];
               state.companion.cursor++;
               state.companion.fingerprint = fingerprint;
               await tx`UPDATE runs SET runtime_resume = ${tx.json(state as never)} WHERE id = ${runId}`;
               if (input.event.type === 'task.completed' || input.event.type === 'task.failed') {
                  await revokeTaskTokens(scoped, runId);
                  await tx`UPDATE runs SET dispatch_lease_until = NULL WHERE id = ${runId}`;
               }
            } else if (input.sequence !== state.companion.cursor - 1 || state.companion.fingerprint !== fingerprint) {
               throw new ApiError(409, 'COMPANION_EVENT_ORDER', 'Post lifecycle events in sequence.');
            }
         }
         await tx`UPDATE runs SET dispatch_lease_until = now() + interval '60 seconds' WHERE id = ${runId} AND status IN ('queued', 'running')`;
         return { cancel: false, nextSequence: state.companion.cursor };
      });
      for (const run of terminal) await notifyRunTerminal(run);
      return result;
   }

   async sweep() {
      const terminal: Run[] = [];
      await this.sql.begin(async transaction => {
         const tx = transaction as unknown as Sql;
         const scoped: Sql = new Proxy(tx, { get(target, key, receiver) {
            if (key === 'begin') return async (work: (sql: Sql) => Promise<unknown>) => work(scoped);
            return Reflect.get(target, key, receiver);
         } });
         const rows = await tx`SELECT r.id FROM runs r JOIN ai_runtime_connections c ON c.id = r.ai_runtime_connection_id AND c.workspace_id = r.workspace_id AND c.runtime_key = r.ai_runtime_key
            WHERE c.metadata ? 'companionId' AND r.status IN ('queued', 'running')
              AND ((r.dispatch_lease_until IS NOT NULL AND r.dispatch_lease_until < now())
                OR (r.dispatch_lease_until IS NULL AND r.created_at < now() - interval '2 minutes'))
            LIMIT 100 FOR UPDATE OF r SKIP LOCKED`;
         const ledger = new RunLedger({ sql: scoped, notifyTerminal: async run => { terminal.push(run); } });
         for (const row of rows) {
            await ledger.fail({ runId: String(row.id), failure: {
               code: 'COMPANION_UNAVAILABLE', message: 'Connect the VS Code companion on the machine that has the folder and CLI login.', retryable: false,
            } });
            await revokeTaskTokens(scoped, String(row.id));
         }
      });
      for (const run of terminal) await notifyRunTerminal(run);
   }
}
