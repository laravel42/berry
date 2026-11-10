import { z } from 'zod';
import { BerryApiError, apiFetch } from './api';
import { actorRefSchema, connectionSchema, newIdempotencyKey } from './api-schemas';
import { formatRange } from './cycle-math';

/** Workspace cycles: timeboxed iterations. Progress is derived from linked issues. */

export const cycleStatusSchema = z.enum(['upcoming', 'active', 'completed']);

export const cycleProgressSchema = z.object({
   issuesTotal: z.number(),
   issuesDone: z.number(),
   issuesCancelled: z.number().default(0),
   issuesWorking: z.number().default(0),
   percent: z.number().default(0),
});

export const cycleSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   number: z.number(),
   name: z.string(),
   startsOn: z.string(),
   endsOn: z.string(),
   status: cycleStatusSchema,
   createdBy: actorRefSchema.nullish(),
   createdAt: z.string(),
   updatedAt: z.string(),
   progress: cycleProgressSchema.nullish(),
});

const cycleConnectionSchema = connectionSchema(cycleSchema);

export const cycleIssueRefSchema = z.object({
   id: z.string(),
   identifier: z.string(),
   title: z.string(),
   /** API `IssueStatus`. */
   status: z.string(),
   assignee: actorRefSchema.nullish(),
   /** When a done task was completed; null otherwise. */
   completedAt: z.string().nullish(),
});

export type CycleStatus = z.infer<typeof cycleStatusSchema>;
export type CycleProgress = z.infer<typeof cycleProgressSchema>;
export type Cycle = z.infer<typeof cycleSchema>;
export type CycleIssueRef = z.infer<typeof cycleIssueRefSchema>;

function parseCycle(json: unknown): Cycle {
   const parsed = cycleSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Cycle response was not recognized');
   }
   return parsed.data;
}

export interface CyclesQuery {
   query?: string;
   status?: CycleStatus;
   first?: number;
}

export async function listWorkspaceCycles(
   workspaceId: string,
   query: CyclesQuery = {}
): Promise<Cycle[]> {
   const collected: Cycle[] = [];
   const limit = query.first ?? 200;
   let after: string | undefined;
   for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ workspaceId, first: String(Math.min(limit, 100)) });
      if (query.query) params.set('query', query.query);
      if (query.status) params.set('status', query.status);
      if (after) params.set('after', after);
      const json: unknown = await apiFetch(`/api/v1/cycles?${params.toString()}`);
      const parsed = cycleConnectionSchema.safeParse(json);
      if (!parsed.success) {
         throw new Error('Cycle list was not recognized');
      }
      collected.push(...parsed.data.nodes);
      const { hasNextPage, endCursor } = parsed.data.pageInfo;
      if (!hasNextPage || !endCursor || parsed.data.nodes.length === 0) break;
      if (collected.length >= limit) break;
      after = endCursor;
   }
   return collected.slice(0, limit);
}

export async function loadWorkspaceCycles(workspaceId: string): Promise<Cycle[]> {
   if (!workspaceId) return [];
   try {
      return await listWorkspaceCycles(workspaceId);
   } catch {
      return [];
   }
}

export async function getCycle(cycleId: string, signal?: AbortSignal): Promise<Cycle> {
   const json: unknown = await apiFetch(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}`,
      undefined,
      { signal }
   );
   return parseCycle(json);
}

export async function createWorkspaceCycle(input: {
   workspaceId: string;
   startsOn: string;
   endsOn: string;
   name?: string;
   status?: CycleStatus;
}): Promise<Cycle> {
   const body: Record<string, unknown> = {
      workspaceId: input.workspaceId,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
   };
   if (input.name) body.name = input.name;
   if (input.status) body.status = input.status;
   const json: unknown = await apiFetch('/api/v1/cycles', {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
   });
   return parseCycle(json);
}

export async function updateWorkspaceCycle(
   cycleId: string,
   patch: {
      name?: string;
      startsOn?: string;
      endsOn?: string;
      status?: CycleStatus;
   }
): Promise<Cycle> {
   const json: unknown = await apiFetch(`/api/v1/cycles/${encodeURIComponent(cycleId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
   });
   return parseCycle(json);
}

export async function archiveCycle(cycleId: string): Promise<void> {
   await apiFetch(`/api/v1/cycles/${encodeURIComponent(cycleId)}`, { method: 'DELETE' });
}

export async function listCycleIssues(
   cycleId: string,
   signal?: AbortSignal
): Promise<CycleIssueRef[]> {
   const json: unknown = await apiFetch(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/issues`,
      undefined,
      { signal }
   );
   const parsed = z.object({ nodes: z.array(cycleIssueRefSchema) }).safeParse(json);
   if (!parsed.success) throw new Error('Cycle issues were not recognized');
   return parsed.data.nodes;
}

export async function setIssueCycle(cycleId: string, issueRef: string): Promise<void> {
   await apiFetch(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/issues/${encodeURIComponent(issueRef)}`,
      { method: 'PUT' }
   );
}

export async function clearIssueCycle(cycleId: string, issueRef: string): Promise<void> {
   await apiFetch(
      `/api/v1/cycles/${encodeURIComponent(cycleId)}/issues/${encodeURIComponent(issueRef)}`,
      { method: 'DELETE' }
   );
}

/** "Nov 2 → Nov 15, 2026". */
export function formatCycleRange(cycle: Pick<Cycle, 'startsOn' | 'endsOn'>): string {
   return formatRange(cycle);
}

/**
 * What the server said, for the second line of a failure toast: the generic
 * "could not be saved" alone hides a refused origin or a validation error.
 */
export function cycleFailureDetail(error: unknown): { description: string } | undefined {
   if (error instanceof BerryApiError && error.message) return { description: error.message };
   return undefined;
}

export function isCyclesUnavailable(error: unknown): boolean {
   return error instanceof BerryApiError && (error.status === 404 || error.status === 503);
}
