import type { Sql } from '../db/pool.ts';
import { blockedByEarlierStage } from '../work/hierarchy.ts';
import { AiRuntimeSelectionError } from '../runtime/ai-runtimes.ts';
import { enqueueTask, EnqueueRejected } from './queue.ts';
import { ActiveRunExists } from './repository.ts';

/**
 * A todo task already assigned to an agent, with no run.
 *
 * Assignment is supposed to start that work (`assign_task`, a person's
 * create/edit). When enqueue is skipped or refused after the assignee is
 * written, the task sits ready and nobody comes for it. This is the
 * catch-up: the same admission assignment uses, so the dispatcher has a
 * row to claim. A task whose last run ended in failure is not that case.
 */
export async function pickupReadyAgentTasks(
   sql: Sql,
   options: { workspaceIds?: readonly string[] | null; limit?: number } = {}
): Promise<number> {
   const limit = Math.max(1, Math.min(32, Math.floor(options.limit ?? 8)));
   const ids = options.workspaceIds;
   const scoped = ids && ids.length > 0;
   const rows = await sql<
      Array<{
         id: string;
         workspace_id: string;
         assignee_id: string;
         requested_by: string;
      }>
   >`
      SELECT i.id, b.workspace_id, i.assignee_id,
             COALESCE(i.created_by, (
                SELECT r.requested_by FROM runs AS r
                 WHERE r.issue_id = i.id AND r.requested_by IS NOT NULL
                 ORDER BY r.created_at DESC LIMIT 1
             )) AS requested_by
        FROM issues AS i
        JOIN boards AS b ON b.id = i.board_id
       WHERE i.deleted_at IS NULL
         AND i.status = 'todo'
         AND i.assignee_type = 'agent'
         AND i.assignee_id IS NOT NULL
         AND i.active_run_id IS NULL
         AND NOT EXISTS (
            SELECT 1 FROM issue_dependencies AS edge
              JOIN issues AS blocker ON blocker.id = edge.depends_on_issue_id
             WHERE edge.issue_id = i.id AND blocker.deleted_at IS NULL
               AND blocker.status NOT IN ('done', 'cancelled')
         )
         AND NOT EXISTS (
            SELECT 1 FROM approvals
             WHERE issue_id = i.id AND kind = 'escalation' AND status = 'pending'
         )
         -- Not a task whose last run just failed or was stopped. Ending a run
         -- puts the task back in todo with no run, which is exactly what this
         -- looks for: picked up again, a failure that repeats became a new
         -- run on every tick (68 in 18 seconds). A retryable failure gets its
         -- one bounded retry from retryAfterFault; anything else waits for a
         -- person. Any edit after the end (reassign, move, restart) moves
         -- updated_at past it, and the task is eligible again.
         AND NOT EXISTS (
            SELECT 1 FROM (
               SELECT r.status, r.completed_at FROM runs AS r
                WHERE r.issue_id = i.id
                ORDER BY r.created_at DESC
                LIMIT 1
            ) AS latest
             WHERE latest.status IN ('failed', 'cancelled')
               AND latest.completed_at >= i.updated_at
         )
         ${scoped ? sql`AND b.workspace_id IN ${sql(ids)}` : sql``}
       ORDER BY i.updated_at ASC
       LIMIT ${limit}`;

   let started = 0;
   for (const row of rows) {
      if (await blockedByEarlierStage(sql, row.id)) continue;
      const requestedBy = row.requested_by;
      if (!requestedBy) continue;
      try {
         await enqueueTask(sql, {
            workspaceId: row.workspace_id,
            agentId: row.assignee_id,
            issueId: row.id,
            kind: 'agent',
            source: 'assignment',
            requestedBy,
            runtimeAuthorizedBy: requestedBy,
         });
         started += 1;
      } catch (error) {
         if (
            error instanceof ActiveRunExists ||
            error instanceof EnqueueRejected ||
            error instanceof AiRuntimeSelectionError
         ) {
            continue;
         }
         throw error;
      }
   }
   return started;
}
