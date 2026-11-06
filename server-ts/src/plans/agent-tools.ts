import { z } from 'zod';
import type { BoardRepository } from '../core/boards.ts';
import type { MilestoneRepository } from '../core/milestones.ts';
import type { Sql } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { startPlan, type PlanOptions } from '../mounts/plans.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from '../runtime/agent-tools/registry.ts';
import type { ScmSync } from '../scm/sync.ts';

/**
 * Milestones and plans, from a chat or a task.
 *
 * Both are filed in the name of the person who asked for the run, and only
 * when that person could have done it themselves: the agent is their hands,
 * not a way around their role. A plan stays a proposal — the tool opens and
 * generates it, and a person still presses Start Plan.
 */

export interface PlanningToolDeps {
   sql: Sql;
   milestones: Pick<MilestoneRepository, 'create'>;
   boards: Pick<BoardRepository, 'authorizeWorkspace'>;
   plans: PlanOptions;
   /** Mirrors a goal as a milestone. Absent when the deployment runs no git host. */
   scm?: ScmSync | null;
   clock?: () => Date;
}

/** The person this run is for; milestones and plans are never filed in nobody's name. */
async function requester(context: AgentToolContext, what: string): Promise<string> {
   const [run] = await context.sql`SELECT requested_by FROM runs WHERE id = ${context.task.runId}`;
   const userId = (run?.requested_by as string | null) ?? null;
   if (!userId) {
      throw new ApiError(403, 'NO_REQUESTER', `nobody asked for this run, so there is no one to file the ${what} for`);
   }
   return userId;
}

async function authorize(
   deps: PlanningToolDeps,
   userId: string,
   workspaceId: string,
   permission: 'product.write' | 'settings.write',
   what: string
): Promise<void> {
   await deps.boards.authorizeWorkspace(userId, workspaceId, permission).catch((error: unknown) => {
      if (error instanceof NotFound || error instanceof Forbidden) {
         throw new ApiError(403, 'REQUESTER_FORBIDDEN', `the person who asked cannot create a ${what} in this workspace`);
      }
      throw error;
   });
}

async function projectIn(context: AgentToolContext, projectId: string | undefined): Promise<string | null> {
   if (!projectId) return null;
   const [project] = await context.sql`
      SELECT id FROM projects
       WHERE id = ${projectId} AND workspace_id = ${context.task.workspaceId} AND deleted_at IS NULL`;
   if (!project) throw ApiError.notFound('Project');
   return project.id as string;
}

export function registerPlanningTools(deps: PlanningToolDeps): void {
   if (getAgentTool('create_milestone')) return;
   const clock = deps.clock ?? (() => new Date());

   registerAgentTool('create_milestone', {
      description:
         'Create a project milestone: a stage inside one project that tasks can link to. ' +
         'Requires projectId. Prefer create_plan when the work needs planning — Start Plan creates ' +
         'milestones from the plan; use this only for a stage that needs no plan.',
      scope: 'task:write',
      inputSchema: z.object({
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).optional(),
         projectId: z.uuid(),
         targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         const userId = await requester(context, 'milestone');
         await authorize(deps, userId, workspaceId, 'product.write', 'milestone');
         const projectId = await projectIn(context, input.projectId);
         if (!projectId) throw ApiError.notFound('Project');
         const { goal } = await deps.milestones.create({
            workspaceId,
            title: input.title,
            description: input.description ?? null,
            projectId,
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

   registerAgentTool('create_plan', {
      description:
         'Ask the planner to break a request into tasks. It generates the plan in the background; its milestones and ' +
         'tasks are created only when a person reviews it and presses Start Plan, so say that when you report ' +
         'it. Do not create a milestone first — pass `milestoneId` only to plan more work for a stage that already exists.',
      scope: 'task:write',
      inputSchema: z.object({
         prompt: z.string().trim().min(1).max(20_000).describe('What the plan is for, in the words a person would use.'),
         milestoneId: z.uuid().optional(),
         projectId: z.uuid().optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         const userId = await requester(context, 'plan');
         await authorize(deps, userId, workspaceId, 'product.write', 'plan');
         if (input.milestoneId) {
            const [goal] = await context.sql`
               SELECT id FROM milestones
                WHERE id = ${input.milestoneId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
            if (!goal) throw ApiError.notFound('Milestone');
         }
         const record = await startPlan(deps.plans, {
            workspaceId,
            prompt: input.prompt,
            milestoneId: input.milestoneId ?? null,
            projectId: await projectIn(context, input.projectId),
            boardId: null,
            createdBy: userId,
         });
         return {
            id: record.id,
            milestoneId: record.milestoneId,
            status: record.status,
            generation: 'running',
            next: 'A person reviews the plan and presses Start Plan; nothing exists on the board until then.',
         };
      },
   });
}
