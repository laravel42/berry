import { z } from 'zod';
import { BerryApiError, apiFetch } from './api';
import { actorRefSchema, connectionSchema, newIdempotencyKey } from './api-schemas';

/**
 * Milestones: authored stages inside one project. A person (or `create_milestone`)
 * files one from the project; Start Plan also mints them from plan IR. Progress
 * percent is derived from linked issues.
 */

export const milestoneStatusSchema = z.enum(['planned', 'active', 'blocked', 'completed']);

const RETIRED_STATUS: Record<string, MilestoneStatus> = {
   draft: 'planned',
   cancelled: 'completed',
};

const wireMilestoneStatusSchema = z.preprocess(
   (value) =>
      typeof value === 'string' && value in RETIRED_STATUS ? RETIRED_STATUS[value] : value,
   milestoneStatusSchema
);

export const milestoneProgressSchema = z.object({
   issuesTotal: z.number(),
   issuesDone: z.number(),
   issuesCancelled: z.number().default(0),
   issuesWorking: z.number().default(0),
   approvalsPending: z.number(),
   percent: z.number().default(0),
});

export const milestoneSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   projectId: z.string().nullish(),
   title: z.string(),
   description: z.string().nullish(),
   status: wireMilestoneStatusSchema,
   targetDate: z.string().nullish(),
   sortOrder: z.number().default(0),
   createdBy: actorRefSchema.nullish(),
   createdAt: z.string(),
   updatedAt: z.string(),
   startedAt: z.string().nullish(),
   completedAt: z.string().nullish(),
   progress: milestoneProgressSchema.nullish(),
});

const goalConnectionSchema = connectionSchema(milestoneSchema);

export const milestoneIssueRefSchema = z.object({
   id: z.string(),
   identifier: z.string(),
   title: z.string(),
   status: z.string(),
   linkedAt: z.string().nullish(),
});

export const milestoneApprovalRefSchema = z.object({
   id: z.string(),
   kind: z.string(),
   risk: z.string().nullish(),
   title: z.string(),
   status: z.string(),
   issueId: z.string().nullish(),
   requestedAt: z.string().nullish(),
});

export const milestonePlanRefSchema = z.object({
   id: z.string(),
   status: z.string(),
   source: z.string().nullish(),
   version: z.number().nullish(),
   generationStatus: z.string().nullish(),
   validationStatus: z.string().nullish(),
   compileStatus: z.string().nullish(),
   createdAt: z.string(),
});

export type MilestoneStatus = z.infer<typeof milestoneStatusSchema>;
export type MilestoneProgress = z.infer<typeof milestoneProgressSchema>;
export type Milestone = z.infer<typeof milestoneSchema>;
export type MilestoneIssueRef = z.infer<typeof milestoneIssueRefSchema>;
export type MilestoneApprovalRef = z.infer<typeof milestoneApprovalRefSchema>;
export type MilestonePlanRef = z.infer<typeof milestonePlanRefSchema>;

function parseMilestone(json: unknown): Milestone {
   const parsed = milestoneSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Milestone response was not recognized');
   }
   return parsed.data;
}

export interface MilestonesQuery {
   query?: string;
   status?: MilestoneStatus;
   projectId?: string;
   first?: number;
}

export async function listWorkspaceMilestones(
   workspaceId: string,
   query: MilestonesQuery = {}
): Promise<Milestone[]> {
   const collected: Milestone[] = [];
   const limit = query.first ?? 200;
   let after: string | undefined;
   for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ workspaceId, first: String(Math.min(limit, 100)) });
      if (query.query) params.set('query', query.query);
      if (query.status) params.set('status', query.status);
      if (query.projectId) params.set('projectId', query.projectId);
      if (after) params.set('after', after);
      const json: unknown = await apiFetch(`/api/v1/milestones?${params.toString()}`);
      const parsed = goalConnectionSchema.safeParse(json);
      if (!parsed.success) {
         throw new Error('Milestone list was not recognized');
      }
      collected.push(...parsed.data.nodes);
      const { hasNextPage, endCursor } = parsed.data.pageInfo;
      if (!hasNextPage || !endCursor || parsed.data.nodes.length === 0) break;
      if (collected.length >= limit) break;
      after = endCursor;
   }
   return collected.slice(0, limit);
}

/** Milestones for the store; a failed read leaves the list empty rather than broken. */
export async function loadWorkspaceMilestones(workspaceId: string): Promise<Milestone[]> {
   if (!workspaceId) return [];
   try {
      return await listWorkspaceMilestones(workspaceId);
   } catch {
      return [];
   }
}

export async function getMilestone(milestoneId: string, signal?: AbortSignal): Promise<Milestone> {
   const json: unknown = await apiFetch(
      `/api/v1/milestones/${encodeURIComponent(milestoneId)}`,
      undefined,
      {
         signal,
      }
   );
   return parseMilestone(json);
}

/**
 * Title and description. Status stays a function of the work under the goal;
 * this does not send it. Needs `product.write`.
 */
export async function updateWorkspaceMilestone(
   milestoneId: string,
   patch: {
      title?: string;
      description?: string | null;
      targetDate?: string | null;
      sortOrder?: number;
   }
): Promise<Milestone> {
   const json: unknown = await apiFetch(`/api/v1/milestones/${encodeURIComponent(milestoneId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
   });
   return parseMilestone(json);
}

/** Files a milestone on a project. Needs `product.write` and `Idempotency-Key`. */
export async function createWorkspaceMilestone(input: {
   workspaceId: string;
   title: string;
   description?: string;
   projectId: string;
   targetDate?: string | null;
}): Promise<Milestone> {
   const body: Record<string, unknown> = {
      workspaceId: input.workspaceId,
      title: input.title,
      projectId: input.projectId,
   };
   if (input.description) body.description = input.description;
   if (input.targetDate) body.targetDate = input.targetDate;
   const json: unknown = await apiFetch('/api/v1/milestones', {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
   });
   return parseMilestone(json);
}

/** Sets delivery order for every milestone in a project. */
export async function reorderProjectMilestones(input: {
   workspaceId: string;
   projectId: string;
   milestoneIds: string[];
}): Promise<void> {
   await apiFetch('/api/v1/milestones/order', {
      method: 'PUT',
      body: JSON.stringify(input),
   });
}

/** First incomplete milestone in sort order, or null when all are done / empty. */
export function currentMilestoneId(milestones: Milestone[]): string | null {
   const ordered = [...milestones].sort(
      (left, right) =>
         (left.sortOrder ?? 0) - (right.sortOrder ?? 0) || left.id.localeCompare(right.id)
   );
   for (const milestone of ordered) {
      const percent = milestone.progress?.percent ?? 0;
      if (percent < 100) return milestone.id;
   }
   return null;
}

/**
 * Archives the goal; its tasks keep their links. Needs `settings.write`.
 */
export async function archiveMilestone(milestoneId: string): Promise<void> {
   await apiFetch(`/api/v1/milestones/${encodeURIComponent(milestoneId)}`, { method: 'DELETE' });
}

async function listNodes<T extends z.ZodType>(path: string, node: T): Promise<z.infer<T>[]> {
   const json: unknown = await apiFetch(path);
   const parsed = z.object({ nodes: z.array(node) }).safeParse(json);
   if (!parsed.success) return [];
   return parsed.data.nodes;
}

export function listMilestoneIssues(milestoneId: string): Promise<MilestoneIssueRef[]> {
   return listNodes(
      `/api/v1/milestones/${encodeURIComponent(milestoneId)}/issues`,
      milestoneIssueRefSchema
   );
}

export function listMilestoneApprovals(milestoneId: string): Promise<MilestoneApprovalRef[]> {
   return listNodes(
      `/api/v1/milestones/${encodeURIComponent(milestoneId)}/approvals`,
      milestoneApprovalRefSchema
   );
}

export function listMilestonePlans(milestoneId: string): Promise<MilestonePlanRef[]> {
   return listNodes(
      `/api/v1/milestones/${encodeURIComponent(milestoneId)}/plans`,
      milestonePlanRefSchema
   );
}

// ---------------------------------------------------------------------------
// Reading a goal

export function describeMilestoneStatus(status: string): string {
   switch (status) {
      case 'planned':
         return 'Planned';
      case 'active':
         return 'In Progress';
      case 'blocked':
         return 'Blocked';
      case 'completed':
         return 'Done';
      default:
         return status;
   }
}

/**
 * Why the goal is in that state. Nobody set it, so the page has to say what
 * the tasks are doing — otherwise "Blocked" looks like a decision someone made
 * and the reader goes looking for who made it.
 */
export function describeMilestoneStatusReason(status: string): string {
   switch (status) {
      case 'planned':
         return 'Every task is still waiting to start.';
      case 'active':
         return 'Work has started and some tasks are still open.';
      case 'blocked':
         return 'Every task still open is blocked, so nothing can move.';
      case 'completed':
         return 'Every task is done or cancelled.';
      default:
         return '';
   }
}

/** Human wording for a refused goal call. */
export function describeMilestoneFailure(error: unknown): string {
   if (error instanceof BerryApiError) {
      switch (error.code) {
         case 'PROJECT_NOT_FOUND':
            return 'That project does not exist in this workspace.';
         case 'MILESTONE_NOT_FOUND':
         case 'NOT_FOUND':
            return 'The milestone could not be found.';
         case 'FORBIDDEN':
            return 'You are not allowed to do that to this milestone.';
         case 'VALIDATION_FAILED': {
            const details = error.details as { fields?: { message?: string }[] } | null;
            const first = details?.fields?.[0]?.message;
            return first ?? error.message;
         }
         default:
            return error.message;
      }
   }
   return 'The goal request failed.';
}

/** "3 of 5 tasks done · 2 approvals pending". */
export function describeMilestoneProgress(progress: MilestoneProgress | null | undefined): string {
   if (!progress) return 'No tasks yet';
   const parts: string[] = [];
   parts.push(
      progress.issuesTotal === 0
         ? 'no tasks yet'
         : `${progress.issuesDone} of ${progress.issuesTotal} task${progress.issuesTotal === 1 ? '' : 's'} done`
   );
   if (progress.approvalsPending > 0) {
      parts.push(
         `${progress.approvalsPending} approval${progress.approvalsPending === 1 ? '' : 's'} pending`
      );
   }
   return parts.join(' · ');
}
