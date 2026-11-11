import { toRFC3339 } from '../db/pool.ts';
import type { ScopedQuery } from '../identity/workspace-context.ts';
import type { TranscriptMessage } from '../runtime/envelope.ts';
import type { CompletionSpec } from '../runtime/envelope-builder.ts';

/**
 * The prompt log: what Berry sent a model for a workspace, and what came back.
 *
 * Two kinds of row, both projections of `runs`:
 *   - A completion (`kind: 'completion'`, `runtime/completion.ts`) is one call.
 *     The row holds what was sent — the system prompt, the JSON schema a
 *     structured call asked for and any prior turns in `completion_spec`, the
 *     user turn in `prompt` — and what came back in `result`.
 *   - An agent run (`kind: 'agent'`) is a loop inside the runtime, which calls
 *     the model many times; those calls never pass through Berry. What Berry
 *     does hold is what the loop started from: the envelope in `run_exchanges`
 *     — the agent's system prompt, the task prompt, the prior turns and the
 *     tools it may reach — and the shape of its stream (tools, commands, token
 *     use per call, the end).
 *
 * Every predicate is on `q.workspaceId`, so another workspace's call is the
 * same nothing as one that does not exist.
 */

export const PROMPT_LOG_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const;
export type PromptLogStatus = (typeof PROMPT_LOG_STATUSES)[number];

export type PromptLogKind = 'completion' | 'agent';

export interface PromptLogFilter {
   kind?: PromptLogKind;
   status?: PromptLogStatus;
   purpose?: string;
   /** true: only calls that asked for a JSON shape; false: only free text. */
   structured?: boolean;
}

export interface PromptLogCursor {
   createdAt: string;
   id: string;
}

/** How much of the user turn a list row carries; the detail read has all of it. */
const PREVIEW_CHARS = 240;

export interface PromptLogSummary {
   id: string;
   kind: PromptLogKind;
   /** A completion's purpose (`chat_title`, `plan`, ...); an agent run's trigger (`agent_assignment`, ...). */
   purpose: string;
   /** The agent that ran, and the task it ran on (agent runs on a task only). */
   agentName: string | null;
   issueIdentifier: string | null;
   model: string | null;
   status: string;
   structured: boolean;
   promptPreview: string;
   inputTokens: number;
   outputTokens: number;
   costMicros: number | null;
   durationMs: number | null;
   failureCode: string | null;
   createdAt: string;
}

export interface PromptLogDetail extends PromptLogSummary {
   system: string;
   prompt: string;
   transcript: TranscriptMessage[];
   /**
    * What an agent run could reach: its Berry tools (null means every tool its
    * token allows), MCP servers and skills. Null on a completion.
    */
   reach: { tools: string[] | null; mcpServers: string[]; skills: string[] } | null;
   jsonSchema: Record<string, unknown> | null;
   response: { text: string; structured: unknown } | null;
   failureMessage: string | null;
   startedAt: string | null;
   completedAt: string | null;
   /**
    * What went over the wire to the runtime and back (`run_exchanges`), with
    * secrets already redacted; null for a call made before it was recorded.
    */
   exchange: PromptLogExchange | null;
}

export interface PromptLogExchange {
   request: { method: string; url: string; headers: Record<string, string> } | null;
   payload: unknown;
   response: { status: number; headers: Record<string, string> } | { error: string } | null;
   events: Array<{ at: string; event: unknown }>;
}

/** A spec's JSON schema is `null` in jsonb when the call asked for text. */
function selectColumns(q: ScopedQuery) {
   return q.sql`
      r.id, r.status::text AS status, r.input_tokens, r.output_tokens,
      r.failure_code, r.created_at, r.started_at, r.completed_at, r.kind::text AS kind,
      CASE WHEN r.kind = 'agent' THEN 'agent_' || r.source::text
           ELSE COALESCE(r.completion_spec->>'purpose', 'completion') END AS purpose,
      a.name AS agent_name,
      CASE WHEN i.id IS NULL THEN NULL ELSE berry_issue_identifier(r.workspace_id, i.number) END AS issue_identifier,
      COALESCE(u.model, r.completion_spec->>'model') AS model,
      COALESCE(jsonb_typeof(r.completion_spec->'jsonSchema') = 'object', false) AS structured,
      u.cost_micros,
      (EXTRACT(EPOCH FROM (r.completed_at - r.started_at)) * 1000)::bigint AS duration_ms`;
}

/** The run's purpose, as the filter names it: a completion's own, or `agent_<source>`. */
function purposeOf(q: ScopedQuery) {
   return q.sql`(CASE WHEN r.kind = 'agent' THEN 'agent_' || r.source::text
                      ELSE COALESCE(r.completion_spec->>'purpose', 'completion') END)`;
}

/** What the run was billed, summed across its usage rows; the model is the last one reported. */
function usageJoin(q: ScopedQuery) {
   return q.sql`
      LEFT JOIN agents a ON a.id = r.agent_id
      LEFT JOIN issues i ON i.id = r.issue_id
      LEFT JOIN LATERAL (
         SELECT SUM(t.cost_micros)::bigint AS cost_micros,
                (ARRAY_AGG(t.model ORDER BY t.occurred_at DESC))[1] AS model
           FROM task_usage t
          WHERE t.run_id = r.id
      ) u ON true`;
}

export async function listPromptLogs(
   q: ScopedQuery,
   filter: PromptLogFilter,
   after: PromptLogCursor | null,
   limit: number
): Promise<PromptLogSummary[]> {
   const rows = await q.sql`
      SELECT ${selectColumns(q)},
             left(COALESCE(NULLIF(r.prompt, ''), NULLIF(r.instructions, ''), i.title, ''), ${PREVIEW_CHARS}) AS prompt_preview
        FROM runs r
        ${usageJoin(q)}
       WHERE r.workspace_id = ${q.workspaceId}
         AND r.kind IN ('completion', 'agent')
         AND (${filter.kind == null} OR r.kind::text = ${filter.kind ?? null})
         AND (${filter.status == null} OR r.status = ${filter.status ?? null}::run_status)
         AND (${filter.purpose == null} OR ${purposeOf(q)} = ${filter.purpose ?? null})
         AND (${filter.structured == null}
              OR COALESCE(jsonb_typeof(r.completion_spec->'jsonSchema') = 'object', false) = ${filter.structured ?? null}::boolean)
         AND (${after === null}
              OR (r.created_at, r.id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ${limit}`;
   return rows.map((row) => ({ ...toSummary(row), promptPreview: (row.prompt_preview as string) ?? '' }));
}

export async function promptLog(q: ScopedQuery, runId: string): Promise<PromptLogDetail | null> {
   const [row] = await q.sql`
      SELECT ${selectColumns(q)}, r.prompt, r.completion_spec, r.result, r.failure_message,
             x.run_id AS exchange_run_id, x.request AS exchange_request, x.payload AS exchange_payload,
             x.response AS exchange_response, x.events AS exchange_events
        FROM runs r
        ${usageJoin(q)}
        LEFT JOIN run_exchanges x ON x.run_id = r.id AND x.workspace_id = r.workspace_id
       WHERE r.workspace_id = ${q.workspaceId} AND r.kind IN ('completion', 'agent') AND r.id = ${runId}`;
   if (!row) return null;
   const spec = (row.completion_spec as Partial<CompletionSpec> | null) ?? {};
   const result = row.result as { text?: string; structured?: unknown } | null;
   const agent = row.kind === 'agent';
   // An agent run's prompt is the envelope it started from; one that ran
   // before envelopes were kept falls back to what the run row holds.
   const envelope = agent ? envelopeParts(row.exchange_payload) : null;
   const prompt = envelope?.prompt ?? (row.prompt as string | null) ?? '';
   return {
      ...toSummary(row),
      promptPreview: prompt.slice(0, PREVIEW_CHARS),
      system: agent ? (envelope?.system ?? '') : (spec.system ?? ''),
      prompt,
      transcript: agent ? (envelope?.transcript ?? []) : (spec.transcript ?? []),
      reach: agent ? (envelope?.reach ?? null) : null,
      jsonSchema: spec.jsonSchema ?? null,
      response: result ? { text: result.text ?? '', structured: result.structured ?? null } : null,
      failureMessage: (row.failure_message as string | null) ?? null,
      startedAt: toRFC3339(row.started_at as string | null),
      completedAt: toRFC3339(row.completed_at as string | null),
      exchange: row.exchange_run_id
         ? {
              request: (row.exchange_request as PromptLogExchange['request']) ?? null,
              payload: row.exchange_payload,
              response: (row.exchange_response as PromptLogExchange['response']) ?? null,
              events: (row.exchange_events as PromptLogExchange['events'] | null) ?? [],
           }
         : null,
   };
}

/** The purposes this workspace has called with, for the filter. */
export async function promptLogPurposes(q: ScopedQuery): Promise<string[]> {
   const rows = await q.sql`
      SELECT DISTINCT ${purposeOf(q)} AS purpose
        FROM runs r
       WHERE r.workspace_id = ${q.workspaceId} AND r.kind IN ('completion', 'agent')
       ORDER BY purpose`;
   return rows.map((row) => row.purpose as string);
}

function toSummary(row: Record<string, unknown>): Omit<PromptLogSummary, 'promptPreview'> {
   const cost = row.cost_micros as string | number | null;
   const duration = row.duration_ms as string | number | null;
   return {
      id: row.id as string,
      kind: row.kind === 'agent' ? 'agent' : 'completion',
      purpose: row.purpose as string,
      agentName: (row.agent_name as string | null) ?? null,
      issueIdentifier: (row.issue_identifier as string | null) ?? null,
      model: (row.model as string | null) ?? null,
      status: row.status as string,
      structured: Boolean(row.structured),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      costMicros: cost === null ? null : Number(cost),
      durationMs: duration === null ? null : Number(duration),
      failureCode: (row.failure_code as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
   };
}

/**
 * The parts of a kept (already redacted) envelope a reader wants: the agent's
 * system prompt, the task prompt, prior turns and what it could reach. Read
 * loosely: an envelope from an older build that lacks a field degrades to
 * less, rather than failing the whole detail.
 */
function envelopeParts(payload: unknown): {
   system: string;
   prompt: string;
   transcript: TranscriptMessage[];
   reach: { tools: string[] | null; mcpServers: string[]; skills: string[] };
} | null {
   if (typeof payload !== 'object' || payload === null) return null;
   const envelope = payload as {
      agent?: { instructions?: unknown; tools?: unknown; mcpServers?: unknown; skills?: unknown };
      task?: { prompt?: unknown };
      transcript?: unknown;
   };
   const names = (list: unknown) =>
      Array.isArray(list)
         ? list.map((entry) => (entry as { name?: unknown })?.name).filter((name): name is string => typeof name === 'string')
         : [];
   return {
      system: typeof envelope.agent?.instructions === 'string' ? envelope.agent.instructions : '',
      prompt: typeof envelope.task?.prompt === 'string' ? envelope.task.prompt : '',
      transcript: Array.isArray(envelope.transcript) ? (envelope.transcript as TranscriptMessage[]) : [],
      reach: {
         tools: Array.isArray(envelope.agent?.tools)
            ? (envelope.agent.tools as unknown[]).filter((tool): tool is string => typeof tool === 'string')
            : null,
         mcpServers: names(envelope.agent?.mcpServers),
         skills: names(envelope.agent?.skills),
      },
   };
}
