import type { Sql } from '../db/pool.ts';
import type { MilestoneRepository } from './milestones.ts';

/**
 * The narrow slice of goal linking the issue mount depends on.
 *
 * The mount only ever wants to clear an issue's goal or link it to one, so it
 * takes this two-method contract rather than the whole `MilestoneRepository`. It is
 * defined here, beside the adapter that implements it, so the dependency runs
 * mount → core (an HTTP adapter depending on a domain contract) rather than
 * the other way round.
 */
export interface MilestoneLinker {
   clearIssueGoal(issueId: string): Promise<void>;
   /** False when the goal is not in this workspace. */
   linkIssue(
      workspaceId: string,
      milestoneId: string,
      issueId: string,
      actorId: string
   ): Promise<boolean>;
}

/**
 * Adapts the goal repository to the narrow `MilestoneLinker` the issue mount needs.
 *
 * The issue mount only ever wants to clear an issue's goal or link it to one,
 * and the link must be refused when the goal belongs to another workspace —
 * `milestoneId` on an issue is otherwise accepted and silently discarded. This lives
 * here rather than inline in the composition root because it is domain logic
 * (it reads and writes `milestones`/`milestone_issues`), not wiring; the root should only
 * construct it.
 */
export function createMilestoneLinker(sql: Sql, milestones: MilestoneRepository): MilestoneLinker {
   return {
      async clearIssueGoal(issueId: string): Promise<void> {
         await sql`DELETE FROM milestone_issues WHERE issue_id = ${issueId}`;
      },

      async linkIssue(
         workspaceId: string,
         milestoneId: string,
         issueId: string,
         actorId: string
      ): Promise<boolean> {
         // Scoped here rather than trusted: a goal from another workspace must
         // read as missing, not be linked across the boundary.
         const [goal] = await sql`
            SELECT id FROM milestones
             WHERE id = ${milestoneId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
         if (!goal) return false;
         await milestones.linkIssue({
            workspaceId,
            milestoneId,
            issueId,
            actorId,
            now: new Date().toISOString(),
         });
         return true;
      },
   };
}
