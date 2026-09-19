import { z } from 'zod';
import { apiFetch } from './api';

/**
 * The prompt log: what Berry sent a model for a workspace, and what came back.
 *
 * A model call (the planner, triage, the review gate, chat titles, the editor)
 * is one system prompt, optional earlier turns, a user prompt and, for a
 * structured call, the JSON schema the answer had to fit. An agent run is a
 * loop inside the runtime whose own model calls never pass through Berry: its
 * row shows what the loop started from — the system prompt, the task prompt,
 * earlier turns and what it could reach — and its events.
 */

export const LOG_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

export const LOG_KINDS = ['agent', 'completion'] as const;
export type LogKind = (typeof LOG_KINDS)[number];

const summarySchema = z.object({
   id: z.string(),
   kind: z.enum(LOG_KINDS).default('completion'),
   purpose: z.string(),
   agentName: z.string().nullable().default(null),
   issueIdentifier: z.string().nullable().default(null),
   model: z.string().nullable(),
   status: z.string(),
   structured: z.boolean(),
   promptPreview: z.string(),
   inputTokens: z.number(),
   outputTokens: z.number(),
   costMicros: z.number().nullable(),
   durationMs: z.number().nullable(),
   failureCode: z.string().nullable(),
   createdAt: z.string(),
});

const pageSchema = z.object({
   nodes: z.array(summarySchema),
   pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
});

const headersSchema = z.record(z.string(), z.string());

/**
 * What went over the wire to the runtime and back, secrets already redacted
 * by the server. Null for a call made before exchanges were recorded.
 */
const exchangeSchema = z.object({
   request: z.object({ method: z.string(), url: z.string(), headers: headersSchema }).nullable(),
   payload: z.unknown(),
   response: z
      .union([
         z.object({ status: z.number(), headers: headersSchema }),
         z.object({ error: z.string() }),
      ])
      .nullable(),
   events: z.array(z.object({ at: z.string(), event: z.looseObject({ type: z.string() }) })),
});

const detailSchema = summarySchema.extend({
   system: z.string(),
   prompt: z.string(),
   transcript: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })),
   /** An agent run's reach; null on a model call. `tools: null` is every tool its token allows. */
   reach: z
      .object({
         tools: z.array(z.string()).nullable(),
         mcpServers: z.array(z.string()),
         skills: z.array(z.string()),
      })
      .nullable()
      .default(null),
   jsonSchema: z.record(z.string(), z.unknown()).nullable(),
   response: z.object({ text: z.string(), structured: z.unknown() }).nullable(),
   failureMessage: z.string().nullable(),
   startedAt: z.string().nullable(),
   completedAt: z.string().nullable(),
   exchange: exchangeSchema.nullable().default(null),
});

export type PromptLogSummary = z.infer<typeof summarySchema>;
export type PromptLogPage = z.infer<typeof pageSchema>;
export type PromptLogDetail = z.infer<typeof detailSchema>;
export type PromptLogExchange = z.infer<typeof exchangeSchema>;

export interface PromptLogFilter {
   kind: LogKind | null;
   status: LogStatus | null;
   purpose: string | null;
   structured: boolean | null;
   /** Only the model calls made while generating this plan. */
   planId?: string | null;
}

function base(workspaceId: string): string {
   return `/api/v1/logs/${encodeURIComponent(workspaceId)}`;
}

async function read<T>(path: string, schema: z.ZodType<T>): Promise<T> {
   const json: unknown = await apiFetch(path);
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error('Logs response was not recognized');
   return parsed.data;
}

export function listPromptLogs(
   workspaceId: string,
   filter: PromptLogFilter,
   after: string | null = null
): Promise<PromptLogPage> {
   const params = new URLSearchParams({ first: '50' });
   if (filter.kind) params.set('kind', filter.kind);
   if (filter.status) params.set('status', filter.status);
   if (filter.purpose) params.set('purpose', filter.purpose);
   if (filter.structured !== null) params.set('structured', String(filter.structured));
   if (filter.planId) params.set('planId', filter.planId);
   if (after) params.set('after', after);
   return read(`${base(workspaceId)}/prompts?${params.toString()}`, pageSchema);
}

export function getPromptLog(workspaceId: string, runId: string): Promise<PromptLogDetail> {
   return read(`${base(workspaceId)}/prompts/${encodeURIComponent(runId)}`, detailSchema);
}

export async function listPromptLogPurposes(workspaceId: string): Promise<string[]> {
   const body = await read(
      `${base(workspaceId)}/purposes`,
      z.object({ purposes: z.array(z.string()) })
   );
   return body.purposes;
}

export function formatMs(ms: number): string {
   if (ms < 1000) return `${ms} ms`;
   const seconds = ms / 1000;
   return seconds < 60
      ? `${seconds.toFixed(1)} s`
      : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
