import type { Queryable } from '../db/pool.ts';

/**
 * Tasks `issueId` was blocking that nothing else still blocks.
 *
 * Only a task parked as blocked is released, and never one waiting on a
 * pending escalation: that task is held for a person's decision, not for the
 * work it depended on. The review gate and the issue-write hook share this
 * query so a hand close and an AutoGate close release the same tasks.
 */
export async function readyDependents(
   sql: Queryable,
   issueId: string
): Promise<Array<{ id: string; assigneeId: string | null; title: string }>> {
   const rows = await sql<Array<{ id: string; assignee_id: string | null; title: string }>>`
      SELECT dependent.id, dependent.assignee_id, dependent.title
        FROM issue_dependencies AS link
        JOIN issues AS dependent ON dependent.id = link.issue_id
       WHERE link.depends_on_issue_id = ${issueId}
         AND dependent.deleted_at IS NULL
         AND dependent.status = 'blocked'
         AND NOT EXISTS (
            SELECT 1 FROM issue_dependencies AS other
              JOIN issues AS blocker ON blocker.id = other.depends_on_issue_id
             WHERE other.issue_id = dependent.id
               AND blocker.deleted_at IS NULL
               AND blocker.status NOT IN ('done', 'cancelled'))
         AND NOT EXISTS (
            SELECT 1 FROM approvals AS approval
             WHERE approval.issue_id = dependent.id
               AND approval.kind = 'escalation' AND approval.status = 'pending')
       ORDER BY dependent.sort_order, dependent.id`;
   return rows.map((row) => ({
      id: row.id,
      assigneeId: row.assignee_id,
      title: row.title,
   }));
}
