import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { SessionService } from '../auth/sessions.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { assertValid, fieldError } from '../http/body.ts';
import { decodeTimeCursor, encodeCursor, parsePageQuery } from '../http/cursor.ts';
import { ApiError, type FieldError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import type { ScopedDb, ScopedQuery } from '../identity/workspace-context.ts';
import {
   listPromptLogs,
   PROMPT_LOG_STATUSES,
   promptLog,
   promptLogPurposes,
   type PromptLogFilter,
   type PromptLogStatus,
   type PromptLogSummary,
} from '../usage/prompt-logs.ts';
import { mountWorkspaceScope, pathId, type ScopedVariables } from './shared.ts';

/**
 * `/api/v1/logs`: what Berry asked a model and what it answered.
 *
 * Read-only, under `/:workspaceId/…` so the workspace guard confirms
 * membership first. A call from another workspace is the same 404 as one that
 * was never made. Nothing here is billed or written; see `usage/prompt-logs.ts`.
 */

const FILTERS = ['kind', 'planId', 'status', 'purpose', 'structured'] as const;
const MAX_PURPOSE = 100;

export interface LogsMountOptions {
   sessions: SessionService;
   sql: Sql;
}

export function logsMounts(options: LogsMountOptions): Mount[] {
   return [{ prefix: '/api/v1/logs', handler: logsRoute(options) }];
}

function logsRoute(options: LogsMountOptions): Hono<{ Variables: ScopedVariables }> {
   const route = new Hono<{ Variables: ScopedVariables }>();
   mountWorkspaceScope(route, options);

   route.get('/:workspaceId/prompts', async (context) => {
      const db = context.get('scoped');
      const url = new URL(context.req.url);
      const page = parsePageQuery(url, FILTERS);
      const filter = parseFilter(url);
      const scope = filterScope(`logs.${db.ctx.workspaceId}`, filter);
      const after = page.after === '' ? null : decodeTimeCursor(page.after, scope);
      const rows = await db.list((q) => listPromptLogs(q, filter, after, page.first + 1));
      return json(connection(rows, page.first, scope));
   });

   route.get('/:workspaceId/prompts/:runId', async (context) => {
      const db = context.get('scoped');
      const runId = pathId(context.req.param('runId'), 'Log');
      const detail = await scopedRead(db, (q) => promptLog(q, runId));
      if (!detail) throw ApiError.notFound('Log');
      return json(detail);
   });

   route.get('/:workspaceId/purposes', async (context) => {
      const db = context.get('scoped');
      const purposes = await db.list((q) => promptLogPurposes(q));
      return json({ purposes });
   });

   return route;
}

function parseFilter(url: URL): PromptLogFilter {
   const errors: FieldError[] = [];
   const filter: PromptLogFilter = {};
   const kind = url.searchParams.get('kind');
   if (kind !== null) {
      if (kind === 'completion' || kind === 'agent') filter.kind = kind;
      else errors.push(fieldError('/kind', 'invalid_value', 'kind is completion or agent.'));
   }
   const planId = url.searchParams.get('planId');
   if (planId !== null) {
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId)) filter.planId = planId.toLowerCase();
      else errors.push(fieldError('/planId', 'invalid_value', 'planId is a plan id.'));
   }
   const status = url.searchParams.get('status');
   if (status !== null) {
      if ((PROMPT_LOG_STATUSES as readonly string[]).includes(status)) filter.status = status as PromptLogStatus;
      else errors.push(fieldError('/status', 'invalid_value', 'status is not a run status.'));
   }
   const purpose = url.searchParams.get('purpose');
   if (purpose !== null) {
      if (purpose.length >= 1 && purpose.length <= MAX_PURPOSE) filter.purpose = purpose;
      else errors.push(fieldError('/purpose', 'invalid_value', `purpose is 1 to ${MAX_PURPOSE} characters.`));
   }
   const structured = url.searchParams.get('structured');
   if (structured !== null) {
      if (structured === 'true' || structured === 'false') filter.structured = structured === 'true';
      else errors.push(fieldError('/structured', 'invalid_value', 'structured is true or false.'));
   }
   assertValid(errors);
   return filter;
}

/**
 * A cursor names the filter it was minted under, so a page of one filter
 * cannot continue another. The scope alphabet is narrow and capped at 100
 * characters, and the filters together (a purpose is free text, a plan id is
 * 36) do not fit it as text — a scope that does not fit mints no cursor, which
 * silently ended the list. So the filters go in as a short digest: same
 * filters, same scope; any change, a different one.
 */
function filterScope(base: string, filter: PromptLogFilter): string {
   const parts = [
      filter.kind ?? '',
      filter.planId ?? '',
      filter.status ?? '',
      filter.structured === undefined ? '' : filter.structured ? '1' : '0',
      filter.purpose ?? '',
   ];
   if (parts.every((part) => part === '')) return base;
   return `${base}.f-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24)}`;
}

function connection(rows: PromptLogSummary[], first: number, scope: string): Record<string, unknown> {
   const hasNextPage = rows.length > first;
   const nodes = hasNextPage ? rows.slice(0, first) : rows;
   const last = nodes.at(-1);
   return {
      nodes,
      pageInfo: {
         hasNextPage,
         endCursor: last ? encodeCursor(scope, { createdAt: last.createdAt, id: last.id }) : null,
      },
   };
}

/** One scoped read that returns a value rather than rows. */
async function scopedRead<T>(db: ScopedDb, read: (q: ScopedQuery) => Promise<T>): Promise<T> {
   const [value] = await db.list(async (q) => [await read(q)]);
   if (value === undefined) throw new Error('a scoped read returned nothing');
   return value;
}
