import type { Sql } from '../db/pool.ts';
import type { RuntimeTarget, RuntimeTransport } from '../runtime/transport.ts';

/**
 * What a finished task no longer needs: its runtime sessions and its preview.
 *
 * A session belongs to an agent and a task, not to a run, and it is kept
 * between runs on purpose — a continuation, rework after a review and a
 * mention all land on it warm. That reason ends when the task does. Until now
 * nothing said so: a microVM, or locally a container, sat idle until its own
 * timer noticed, and a merged pull request's preview kept its containers up
 * for a quarter of an hour with nobody to look at it.
 *
 * Every session any agent ran on the task is stopped — the author's and the
 * reviewers' — and the preview environment with them. Best effort throughout:
 * the task is already closed, a session that would not stop is reaped by its
 * idle timer as before, and nothing here may turn a status change into an error.
 */

export interface SessionTeardownDeps {
   sql: Sql;
   transport: Pick<RuntimeTransport, 'stop'>;
   /** The runtime a run's session lives on: its own, the workspace's, or the deployment's. Null when there is none. */
   target(workspaceId: string, runtimeId: string | null): Promise<RuntimeTarget | null>;
   previews?: { stop(issueId: string): Promise<void> } | null;
   report?: (message: string, fields: Record<string, unknown>) => void;
}

export async function releaseTaskResources(deps: SessionTeardownDeps, issueId: string): Promise<{ sessions: number }> {
   const report = deps.report ?? (() => undefined);
   await deps.previews?.stop(issueId).catch((error: unknown) => report('the task preview did not stop', { issueId, error: message(error) }));

   // A task closed while something still runs on it (a person moved it) keeps
   // that session: stopping it is the run's cancellation, which has its own path.
   const [busy] = await deps.sql`SELECT 1 FROM runs WHERE issue_id = ${issueId} AND status IN ('queued', 'running') LIMIT 1`;
   if (busy) return { sessions: 0 };

   const rows = await deps.sql`
      SELECT DISTINCT runtime_session_id, workspace_id, runtime_id FROM runs
       WHERE issue_id = ${issueId} AND runtime_session_id IS NOT NULL`;
   let stopped = 0;
   await Promise.all(
      rows.map(async (row) => {
         try {
            const target = await deps.target(row.workspace_id as string, (row.runtime_id as string | null) ?? null);
            if (!target) return;
            await deps.transport.stop({ target, runtimeSessionId: row.runtime_session_id as string });
            stopped += 1;
         } catch (error) {
            // A local runtime without session control answers 404, and one that
            // already reaped the session has nothing to stop: both are fine.
            report('a runtime session did not confirm its stop', { issueId, session: row.runtime_session_id, error: message(error) });
         }
      })
   );
   return { sessions: stopped };
}

function message(error: unknown): string {
   return error instanceof Error ? error.message : String(error);
}
