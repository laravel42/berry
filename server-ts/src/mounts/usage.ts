import { Hono } from 'hono';
import type { SessionService } from '../auth/sessions.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { assertValid, fieldError } from '../http/body.ts';
import { ApiError, type FieldError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { toApiError } from '../identity/errors.ts';
import type { ScopedDb, ScopedQuery } from '../identity/workspace-context.ts';
import {
   agentUsage,
   boardInWorkspace,
   dashboardOverview,
   errorsOverview,
   issueInWorkspace,
   issueUsage,
   issueWork,
   projectInWorkspace,
   runtimeUsage,
   runtimeVisible,
   usageWindow,
   workOverview,
   workspaceUsage,
   type UsageFilter,
   type UsageWindow,
} from '../usage/queries.ts';
import { mountWorkspaceScope, pathId, type ScopedVariables } from './shared.ts';

/**
 * `/api/v1/usage` and `/api/v1/dashboard`.
 *
 * Read-only projections of `task_usage_hourly`, `task_usage`, `runs` and
 * `issues`. Both sit under `/:workspaceId/…`, so the workspace guard confirms
 * membership before a handler runs. Every nested id (agent, task, runtime,
 * board, project) is checked against that workspace too, so a foreign id is the
 * same 404 as an absent one.
 *
 * The workspace summary, the errors read and the dashboard take `boardId` and
 * `projectId` filters; `projectId` narrows to the tasks linked to that project.
 */

const DEFAULT_DAYS = 30;
/** Half a year. The runtime heatmap asks for 26 weeks, which is 182 days. */
const MAX_DAYS = 180;

export interface UsageMountOptions {
   sessions: SessionService;
   sql: Sql;
}

export function usageMounts(options: UsageMountOptions): Mount[] {
   return [
      { prefix: '/api/v1/usage', handler: usageRoute(options) },
      { prefix: '/api/v1/dashboard', handler: dashboardRoute(options) },
   ];
}

function usageRoute(options: UsageMountOptions): Hono<{ Variables: ScopedVariables }> {
   const route = new Hono<{ Variables: ScopedVariables }>();
   mountWorkspaceScope(route, options);

   route.get('/:workspaceId/summary', async (context) => {
      const db = context.get('scoped');
      const { window, scope } = await readWindow(context.req.url, db);
      const body = await scopedRead(db, (q) => workspaceUsage(q, window, filterOf(scope)));
      return json({ ...windowFields(window, scope), ...body });
   });

   // What the window's spend produced: tasks done, what was delivered, how long a task takes.
   route.get('/:workspaceId/work', async (context) => {
      const db = context.get('scoped');
      const { window, scope } = await readWindow(context.req.url, db);
      const body = await scopedRead(db, (q) => workOverview(q, window, filterOf(scope)));
      return json({ ...windowFields(window, scope), ...body });
   });

   // Time and money per task, for a task list's rows. Not windowed: a row shows a task's whole cost.
   route.get('/:workspaceId/issues', async (context) => {
      const db = context.get('scoped');
      const { scope } = await readWindow(context.req.url, db);
      const issues = await scopedRead(db, (q) => issueWork(q, filterOf(scope)));
      return json({ issues });
   });

   route.get('/:workspaceId/errors', async (context) => {
      const db = context.get('scoped');
      const { window, scope } = await readWindow(context.req.url, db);
      const body = await scopedRead(db, (q) => errorsOverview(q, window, filterOf(scope)));
      return json({ ...windowFields(window, scope), ...body });
   });

   route.get('/:workspaceId/agents/:agentId', async (context) => {
      const db = context.get('scoped');
      const { window } = await readWindow(context.req.url, db);
      const agentId = pathId(context.req.param('agentId'), 'Agent');
      try {
         await db.requireResource('agents', agentId);
      } catch (error) {
         throw toApiError(error, 'Agent');
      }
      const body = await scopedRead(db, (q) => agentUsage(q, agentId, window));
      return json({ ...windowFields(window, NO_SCOPE), ...body });
   });

   route.get('/:workspaceId/runtimes/:runtimeId', async (context) => {
      const db = context.get('scoped');
      const { window } = await readWindow(context.req.url, db);
      const raw = context.req.param('runtimeId');
      const runtimeId = raw === 'default' ? null : pathId(raw, 'Runtime');
      if (runtimeId !== null && !(await scopedRead(db, (q) => runtimeVisible(q, runtimeId)))) {
         throw ApiError.notFound('Runtime');
      }
      const body = await scopedRead(db, (q) => runtimeUsage(q, runtimeId, window));
      return json({ ...windowFields(window, NO_SCOPE), ...body });
   });

   route.get('/:workspaceId/issues/:issueId', async (context) => {
      parseQuery(context.req.url, false);
      const issueId = pathId(context.req.param('issueId'), 'Issue');
      const db = context.get('scoped');
      if (!(await scopedRead(db, (q) => issueInWorkspace(q, issueId)))) {
         throw ApiError.notFound('Issue');
      }
      const body = await scopedRead(db, (q) => issueUsage(q, issueId));
      return json({ currency: 'USD', ...body });
   });

   return route;
}

function dashboardRoute(options: UsageMountOptions): Hono<{ Variables: ScopedVariables }> {
   const route = new Hono<{ Variables: ScopedVariables }>();
   mountWorkspaceScope(route, options);

   route.get('/:workspaceId/overview', async (context) => {
      const db = context.get('scoped');
      const { window, scope } = await readWindow(context.req.url, db);
      const body = await scopedRead(db, (q) => dashboardOverview(q, window, filterOf(scope)));
      return json({ ...windowFields(window, scope), ...body });
   });

   return route;
}

/** Which board and project a read was narrowed to; `null` is every one. */
interface ReadScope {
   boardId: string | null;
   projectId: string | null;
}

const NO_SCOPE: ReadScope = { boardId: null, projectId: null };

function filterOf(scope: ReadScope): UsageFilter {
   return {
      ...(scope.boardId ? { boardId: scope.boardId } : {}),
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
   };
}

function windowFields(window: UsageWindow, scope: ReadScope) {
   return {
      currency: 'USD',
      days: window.days,
      from: window.from,
      to: window.to,
      timezone: window.timezone,
      boardId: scope.boardId,
      projectId: scope.projectId,
   };
}

/** A zone this deployment's ICU can actually cut days in. */
function knownTimezone(name: string): boolean {
   try {
      new Intl.DateTimeFormat('en-US', { timeZone: name });
      return true;
   } catch {
      return false;
   }
}

interface WindowQuery extends ReadScope {
   days: number;
   timezone: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The parameters of a windowed read: how far back, in whose days, and on which
 * board and project. An unrecognised parameter is a typo, and a read that ignored it
 * would answer a question nobody asked.
 */
function parseQuery(rawUrl: string, windowed: boolean): WindowQuery {
   const params = new URL(rawUrl).searchParams;
   const allowed = new Set(windowed ? ['days', 'tz', 'boardId', 'projectId'] : []);
   const errors: FieldError[] = [];
   for (const name of new Set(params.keys())) {
      if (!allowed.has(name)) {
         errors.push(fieldError(`/${name}`, 'unknown', `${name} is not a parameter of this read.`));
      }
   }

   let days = DEFAULT_DAYS;
   const rawDays = windowed ? params.get('days') : null;
   if (rawDays !== null) {
      const parsed = /^\d{1,3}$/.test(rawDays) ? Number(rawDays) : NaN;
      if (!(parsed >= 1 && parsed <= MAX_DAYS)) {
         errors.push(fieldError('/days', 'invalid_value', `days is a whole number from 1 to ${MAX_DAYS}.`));
      } else {
         days = parsed;
      }
   }

   let timezone = 'UTC';
   const rawZone = windowed ? params.get('tz') : null;
   if (rawZone !== null) {
      if (rawZone.length > 64 || !knownTimezone(rawZone)) {
         errors.push(fieldError('/tz', 'invalid_value', 'tz is an IANA time zone name, such as Europe/Rome.'));
      } else {
         timezone = rawZone;
      }
   }

   const idParam = (name: 'boardId' | 'projectId', what: string): string | null => {
      const raw = windowed ? params.get(name) : null;
      if (raw === null) return null;
      if (!UUID.test(raw)) {
         errors.push(fieldError(`/${name}`, 'invalid_value', `${name} names one ${what}.`));
         return null;
      }
      return raw.toLowerCase();
   };
   const boardId = idParam('boardId', 'board');
   const projectId = idParam('projectId', 'project');

   assertValid(errors);
   return { days, timezone, boardId, projectId };
}

/**
 * The window a read asked for, with its board and project confirmed to be this
 * workspace's — one from another workspace (or a deleted project) is the same
 * 404 as one that is not there, like every other id a route names.
 */
async function readWindow(
   rawUrl: string,
   db: ScopedDb
): Promise<{ window: UsageWindow; scope: ReadScope }> {
   const query = parseQuery(rawUrl, true);
   const { boardId, projectId } = query;
   if (boardId && !(await scopedRead(db, (q) => boardInWorkspace(q, boardId)))) {
      throw ApiError.notFound('Project');
   }
   if (projectId && !(await scopedRead(db, (q) => projectInWorkspace(q, projectId)))) {
      throw ApiError.notFound('Project');
   }
   return {
      window: usageWindow(query.days, new Date(), query.timezone),
      scope: { boardId, projectId },
   };
}

/** One scoped read that returns a value rather than rows. */
async function scopedRead<T>(db: ScopedDb, read: (q: ScopedQuery) => Promise<T>): Promise<T> {
   const [value] = await db.list(async (q) => [await read(q)]);
   if (value === undefined) throw new Error('a scoped read returned nothing');
   return value;
}
