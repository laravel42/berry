import { z } from 'zod';
import type { BoardRepository } from '../core/boards.ts';
import type { GoalRepository } from '../core/goals.ts';
import type { Sql } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { startPlan, type PlanOptions } from '../mounts/plans.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from '../runtime/agent-tools/registry.ts';
import type { ScmSync } from '../scm/sync.ts';

/**
 * Goals and plans, from a chat or a task.
 *
 * Both are filed in the name of the person who asked for the run, and only
 * when that person could have done it themselves: the agent is their hands,
 * not a way around their role. A plan stays a proposal — the tool opens and
 * generates it, and a person still presses Start Plan.
 */

export interface PlanningToolDeps {
   sql: Sql;
   goals: Pick<GoalRepository, 'create'>;
   boards: Pick<BoardRepository, 'authorizeWorkspace'>;
   plans: PlanOptions;
   /** Mirrors a goal as a milestone. Absent when the deployment runs no git host. */
   scm?: ScmSync | null;
   clock?: () => Date;
}

/** The person this run is for; goals and plans are never filed in nobody's name. */
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
   if (getAgentTool('create_goal')) return;
   const clock = deps.clock ?? (() => new Date());

   registerAgentTool('create_goal', {
      description:
         'Create a goal in this workspace: an outcome tasks and plans work towards. It starts as a draft. ' +
         'Use it when someone asks for a goal, rather than describing one you did not create.',
      scope: 'task:write',
      inputSchema: z.object({
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).optional(),
         projectId: z.uuid().optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         const userId = await requester(context, 'goal');
         await authorize(deps, userId, workspaceId, 'settings.write', 'goal');
         const projectId = await projectIn(context, input.projectId);
         const { goal } = await deps.goals.create({
            workspaceId,
            title: input.title,
            description: input.description ?? null,
            projectId,
            createdBy: userId,
            createdAt: clock().toISOString(),
         });
         // As the goals route does: the milestone mirrors the goal, and its
         // outcome is recorded on the goal's link rather than failing the call.
         deps.scm?.guard('goal.created', deps.scm.goalCreated(goal.id));
         return { id: goal.id, title: goal.title, status: goal.status, projectId: goal.projectId };
      },
   });

   registerAgentTool('create_plan', {
      description:
         'Ask the planner to break a request into tasks. It opens a plan for a goal (a new one unless `goalId` ' +
         'names one) and generates it in the background. Nothing is created on the board until a person ' +
         'reviews the plan and presses Start Plan, so say that when you report it.',
      scope: 'task:write',
      inputSchema: z.object({
         prompt: z.string().trim().min(1).max(20_000).describe('What the plan is for, in the words a person would use.'),
         goalId: z.uuid().optional(),
         projectId: z.uuid().optional(),
      }),
      handler: async (context, input) => {
         const workspaceId = context.task.workspaceId;
         const userId = await requester(context, 'plan');
         await authorize(deps, userId, workspaceId, 'product.write', 'plan');
         if (input.goalId) {
            const [goal] = await context.sql`
               SELECT id FROM goals
                WHERE id = ${input.goalId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
            if (!goal) throw ApiError.notFound('Goal');
         }
         const record = await startPlan(deps.plans, {
            workspaceId,
            prompt: input.prompt,
            goalId: input.goalId ?? null,
            projectId: await projectIn(context, input.projectId),
            boardId: null,
            createdBy: userId,
         });
         return {
            id: record.id,
            goalId: record.goalId,
            status: record.status,
            generation: 'running',
            next: 'A person reviews the plan and presses Start Plan; nothing exists on the board until then.',
         };
      },
   });
}
