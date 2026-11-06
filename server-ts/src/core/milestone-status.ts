import { randomUUID } from 'node:crypto';
import { toRFC3339, type Queryable } from '../db/pool.ts';

/**
 * A goal's status, taken from the tasks in it.
 *
 * ADR-0010: a goal is a group, and its status is derived when a task moves,
 * not stored as a person's choice and not maintained by a trigger. `planned`
 * is waiting, `active` is work underway or partly finished, `blocked` is
 * stuck with nothing still queued or in progress, and `completed` is every
 * task done or cancelled.
 */
export type DerivedMilestoneStatus = 'planned' | 'active' | 'blocked' | 'completed';

export interface MilestoneTaskCounts {
   total: number;
   /** backlog and todo. */
   waiting: number;
   /** in_progress and in_review. */
   working: number;
   blocked: number;
   /** done and cancelled. */
   finished: number;
}

export function derivedMilestoneStatus(counts: MilestoneTaskCounts): DerivedMilestoneStatus {
   if (counts.total === 0) return 'planned';
   if (counts.finished === counts.total) return 'completed';
   if (counts.blocked > 0 && counts.waiting === 0 && counts.working === 0) return 'blocked';
   if (counts.working > 0 || counts.finished > 0) return 'active';
   return 'planned';
}

/**
 * Recomputes one goal from its live tasks and writes the outbox row when the
 * status actually changes. Callers already hold the transaction that moved
 * the task.
 */
export async function refreshMilestone(sql: Queryable, milestoneId: string, now: string): Promise<void> {
   const [goal] = await sql<Array<{ status: string; started_at: string | null }>>`
      SELECT status, started_at FROM milestones
       WHERE id = ${milestoneId} AND deleted_at IS NULL
       FOR UPDATE`;
   if (!goal) return;

   const [counts] = await sql<
      Array<{ total: number; waiting: number; working: number; blocked: number; finished: number }>
   >`
      SELECT count(issue.id)::int AS total,
             count(issue.id) FILTER (WHERE issue.status IN ('backlog', 'todo'))::int AS waiting,
             count(issue.id) FILTER (WHERE issue.status IN ('in_progress', 'in_review'))::int AS working,
             count(issue.id) FILTER (WHERE issue.status = 'blocked')::int AS blocked,
             count(issue.id) FILTER (WHERE issue.status IN ('done', 'cancelled'))::int AS finished
        FROM milestone_issues AS link
        LEFT JOIN issues AS issue
          ON issue.id = link.issue_id AND issue.deleted_at IS NULL
       WHERE link.milestone_id = ${milestoneId}`;
   const next = derivedMilestoneStatus({
      total: Number(counts?.total ?? 0),
      waiting: Number(counts?.waiting ?? 0),
      working: Number(counts?.working ?? 0),
      blocked: Number(counts?.blocked ?? 0),
      finished: Number(counts?.finished ?? 0),
   });
   if (next === goal.status) return;

   const [row] = await sql<Array<Record<string, unknown>>>`
      UPDATE milestones
         SET status = ${next},
             started_at = CASE
                WHEN ${next} IN ('active', 'blocked') THEN COALESCE(started_at, ${now})
                ELSE started_at
             END,
             completed_at = CASE WHEN ${next} = 'completed' THEN COALESCE(completed_at, ${now}) ELSE NULL END,
             updated_at = ${now}
       WHERE id = ${milestoneId}
      RETURNING id, workspace_id, project_id, title, description, status, source,
                source_prompt, created_by, created_at, updated_at, started_at, completed_at`;
   if (!row) return;

   const firstStart = (next === 'active' || next === 'blocked') && goal.started_at == null;
   const topic =
      next === 'completed' ? 'milestone.completed' : firstStart ? 'milestone.started' : 'milestone.updated';
   const eventId = randomUUID();
   const occurredAt = toRFC3339(now) ?? now;
   const payload = {
      milestone: {
         id: row.id,
         workspaceId: row.workspace_id,
         projectId: row.project_id ?? null,
         title: row.title,
         description: row.description ?? null,
         status: row.status,
         source: row.source,
         sourcePrompt: row.source_prompt ?? null,
         createdBy: row.created_by ?? null,
         createdAt: toRFC3339(row.created_at as string) ?? '',
         updatedAt: toRFC3339(row.updated_at as string) ?? '',
         startedAt: toRFC3339(row.started_at as string | null),
         completedAt: toRFC3339(row.completed_at as string | null),
      },
      changedFields: ['status'],
   };
   const envelope = {
      id: eventId,
      type: topic,
      occurredAt,
      workspaceId: row.workspace_id,
      boardId: null,
      aggregateType: 'milestone',
      aggregateId: row.id,
      payload,
   };
   await sql`
      INSERT INTO outbox_events (
         id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
         payload, occurred_at, available_at
      ) VALUES (
         ${eventId}, ${topic}, 'milestone', ${row.id as string}, ${row.workspace_id as string}, NULL,
         ${sql.json(envelope as never)}, ${now}, ${now}
      )`;
}

/** Every goal the task belongs to, inside the caller's transaction. */
export async function refreshMilestonesForIssue(sql: Queryable, issueId: string, now: string): Promise<void> {
   const rows = await sql<Array<{ milestone_id: string }>>`
      SELECT milestone_id FROM milestone_issues WHERE issue_id = ${issueId}`;
   for (const row of rows) await refreshMilestone(sql, row.milestone_id, now);
}
