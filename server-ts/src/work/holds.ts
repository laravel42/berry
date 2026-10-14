import type { Queryable } from '../db/pool.ts';

/**
 * Whether something in Berry is holding this task — an unfinished
 * dependency, a pending escalation, or a child still open.
 *
 * Blocked is that hold, not a parking place. A run that ends blocked
 * without one of these stays stuck: nothing will move it, and it cannot
 * be restarted. The same test gates `set_status blocked` and whether a
 * finished run is left blocked instead of going to review.
 */
export async function issueHasOpenHold(q: Queryable, issueId: string): Promise<boolean> {
   const [row] = await q<Array<{ held: boolean }>>`
      SELECT (
         EXISTS (
            SELECT 1 FROM issue_dependencies AS edge
              JOIN issues AS blocker ON blocker.id = edge.depends_on_issue_id
             WHERE edge.issue_id = ${issueId}
               AND blocker.deleted_at IS NULL
               AND blocker.status NOT IN ('done', 'cancelled')
         )
         OR EXISTS (
            SELECT 1 FROM approvals AS approval
             WHERE approval.issue_id = ${issueId}
               AND approval.kind = 'escalation' AND approval.status = 'pending'
         )
         OR EXISTS (
            SELECT 1 FROM issues AS child
             WHERE child.parent_id = ${issueId}
               AND child.deleted_at IS NULL
               AND child.status NOT IN ('done', 'cancelled')
         )
      ) AS held`;
   return Boolean(row?.held);
}
