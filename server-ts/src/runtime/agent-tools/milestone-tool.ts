import { z } from 'zod';
import type { BoardRepository } from '../../core/boards.ts';
import type { MilestoneRepository } from '../../core/milestones.ts';
import type { Sql } from '../../db/pool.ts';
import { ApiError } from '../../http/errors.ts';
import { Forbidden, NotFound } from '../../identity/errors.ts';
import type { ScmSync } from '../../scm/sync.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from './registry.ts';

/**
 * `create_milestone`, from a chat or a task.
 *
 * Filed in the name of the person who asked for the run, and only when that
 * person could have done it themselves: the agent is their hands, not a way
 * around their role.
 */

export interface MilestoneToolDeps {
   sql: Sql;
   milestones: Pick<MilestoneRepository, 'create'>;
   boards: Pick<BoardRepository, 'authorizeWorkspace'>;
   /** Mirrors a goal as a milestone. Absent when the deployment runs no git host. */
   scm?: ScmSync | null;
   clock?: () => Date;
}

/** The person this run is for; a milestone is never filed in nobody's name. */
async function requester(context: AgentToolContext): Promise<string> {
   const [run] = await context.sql`SELECT requested_by FROM runs WHERE id = ${context.task.runId}`;
   const userId = (run?.requested_by as string | null) ?? null;
   if (!userId) {
      throw new ApiError(403, 'NO_REQUESTER', 'nobody asked for this run, so there is no one to file the milestone for');
   }
   return userId;
}

export function registerMilestoneTool(deps: MilestoneToolDeps): void {
   if (getAgentTool('create_milestone')) return;
   const clock = deps.clock ?? (() => new Date());

   registerAgentTool('create_milestone', {
      description: 'Create a project milestone: a stage inside one project that tasks can link to. Requires projectId.',
      scope: 'task:write',
      inputSchema: z.object({
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).optional(),
         projectId: z.uuid(),
         targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         const userId = await requester(context);
         await deps.boards.authorizeWorkspace(userId, workspaceId, 'product.write').catch((error: unknown) => {
            if (error instanceof NotFound || error instanceof Forbidden) {
               throw new ApiError(403, 'REQUESTER_FORBIDDEN', 'the person who asked cannot create a milestone in this workspace');
            }
            throw error;
         });
         const [project] = await context.sql`
            SELECT id FROM projects
             WHERE id = ${input.projectId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
         if (!project) throw ApiError.notFound('Project');
         const { goal } = await deps.milestones.create({
            workspaceId,
            title: input.title,
            description: input.description ?? null,
            projectId: project.id as string,
            ...(input.targetDate ? { targetDate: input.targetDate } : {}),
            createdBy: userId,
            createdAt: clock().toISOString(),
         });
         deps.scm?.guard('milestone.created', deps.scm.goalCreated(goal.id));
         return {
            id: goal.id,
            title: goal.title,
            status: goal.status,
            projectId: goal.projectId,
            targetDate: goal.targetDate,
            sortOrder: goal.sortOrder,
         };
      },
   });
}
