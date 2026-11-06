import { Hono } from 'hono';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import { decodeCursor, encodeCursor, UPDATED_CURSOR_KEYS, type UpdatedCursor } from '../http/cursor.ts';
import { idempotent } from '../http/idempotent.ts';
import type { IdempotencyStore } from '../http/idempotency.ts';
import type { Broadcaster } from '../realtime/hub.ts';
import { Conflict, Forbidden, NotFound } from '../identity/errors.ts';
import type { Mount } from '../http/registry.ts';
import { cursorScope } from './projects.ts';
import type { IssueRepository } from '../core/issues.ts';
import type { ActorRef } from '../core/comments.ts';
import {
   isCycleStatus,
   serializeCycle as serializeCycleRow,
   type Cycle,
   type CycleEvent,
   type CycleProgress,
   type CycleRepository,
   type CycleStatus,
} from '../core/cycles.ts';

/** `/api/v1/cycles` — workspace timeboxes. */

const MAX_NAME = 500;
const MAX_QUERY = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const CREATE_FIELDS = new Set(['workspaceId', 'name', 'startsOn', 'endsOn', 'status']);
const UPDATE_FIELDS = new Set(['name', 'startsOn', 'endsOn', 'status']);

export interface CycleOptions {
   sessions: SessionService;
   cycles: CycleRepository;
   issues: IssueRepository;
   idempotency: IdempotencyStore;
   broadcaster?: Broadcaster | undefined;
   clock?: () => Date;
}

export function cycleMounts(options: CycleOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   const { cycles, issues } = options;
   const clock = options.clock ?? (() => new Date());

   route.get('/', async (context) => {
      const url = new URL(context.req.url);
      const page = parsePage(url, ['workspaceId', 'query', 'status']);
      const workspaceId = requiredUUID(url, 'workspaceId');
      const filter = parseFilter(url);

      await cycles
         .authorizeWorkspace(context.get('user').id, workspaceId, 'product.read')
         .catch(rethrow('Workspace'));

      const scope = cursorScope('cycles.list', [workspaceId, filter.query, filter.status ?? '']);
      const after =
         page.after === ''
            ? null
            : decodeCursor<UpdatedCursor>(page.after, scope, UPDATED_CURSOR_KEYS);

      const rows = await cycles.list(workspaceId, filter, after, page.first + 1);
      const hasNextPage = rows.length > page.first;
      const nodes = hasNextPage ? rows.slice(0, page.first) : rows;
      const [authors, progress] = await Promise.all([
         cycles.lookupAuthors(nodes.map((cycle) => cycle.createdBy ?? '')),
         cycles.progressMany(nodes.map((cycle) => cycle.id)),
      ]);
      const last = nodes.at(-1);
      return json({
         nodes: nodes.map((cycle) => serialize(cycle, authors, progress.get(cycle.id) ?? null)),
         pageInfo: {
            hasNextPage,
            endCursor: last
               ? encodeCursor(scope, { updatedAt: last.updatedAt, id: last.id })
               : null,
         },
      });
   });

   route.post('/', idempotent(options.idempotency), async (context) => {
      const body = await readBody(context.req.raw, CREATE_FIELDS);
      const workspaceId = requiredBodyUUID(body.workspaceId, 'workspaceId');
      await cycles
         .authorizeWorkspace(context.get('user').id, workspaceId, 'product.write')
         .catch(rethrow('Workspace'));

      const startsOn = requiredDate(body.startsOn, 'startsOn');
      const endsOn = requiredDate(body.endsOn, 'endsOn');
      if (endsOn < startsOn) {
         throw invalidField('/endsOn', 'endsOn must be on or after startsOn.');
      }
      const name = optionalName(body.name);
      const status = parseStatus(body.status) ?? 'upcoming';

      const created = await cycles
         .create({
            workspaceId,
            startsOn,
            endsOn,
            status,
            ...(name === undefined ? {} : { name }),
            createdBy: context.get('user').id,
            createdAt: clock().toISOString(),
         })
         .catch(rethrow('Cycle'));
      await publish(options, [created.event]);

      const authors = await cycles.lookupAuthors([created.cycle.createdBy ?? '']);
      return json(serialize(created.cycle, authors, null), 201);
   });

   route.get('/:cycleId', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      await cycles.authorize(context.get('user').id, cycleId, 'product.read').catch(rethrow('Cycle'));
      const cycle = await cycles.get(cycleId).catch(rethrow('Cycle'));
      const [authors, progress] = await Promise.all([
         cycles.lookupAuthors([cycle.createdBy ?? '']),
         cycles.progress(cycleId),
      ]);
      return json(serialize(cycle, authors, progress));
   });

   route.patch('/:cycleId', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      await cycles.authorize(context.get('user').id, cycleId, 'product.write').catch(rethrow('Cycle'));

      const body = await readBody(context.req.raw, UPDATE_FIELDS);
      const patch = {
         ...(body.name === undefined ? {} : { name: requiredName(body.name) }),
         ...('startsOn' in body
            ? { startsOn: requiredDate(body.startsOn, 'startsOn'), startsOnSet: true as const }
            : {}),
         ...('endsOn' in body
            ? { endsOn: requiredDate(body.endsOn, 'endsOn'), endsOnSet: true as const }
            : {}),
      };
      const status = parseStatus(body.status);
      if (Object.keys(patch).length === 0 && status === undefined) {
         throw invalidField('/', 'At least one field must be provided.', 'too_small');
      }

      const events: CycleEvent[] = [];
      const now = clock();
      let cycle: Cycle | null = null;
      if (Object.keys(patch).length > 0) {
         const updated = await cycles
            .update(cycleId, patch, context.get('user').id, now.toISOString())
            .catch(rethrow('Cycle'));
         cycle = updated.cycle;
         events.push(updated.event);
      }
      if (status !== undefined) {
         const at = new Date(now.getTime() + 1);
         const moved = await cycles
            .transition(cycleId, status, context.get('user').id, at.toISOString())
            .catch(rethrow('Cycle'));
         cycle = moved.cycle;
         if (moved.event) events.push(moved.event);
      }
      await publish(options, events);

      const resolved = cycle ?? (await cycles.get(cycleId).catch(rethrow('Cycle')));
      const [authors, progress] = await Promise.all([
         cycles.lookupAuthors([resolved.createdBy ?? '']),
         cycles.progress(cycleId),
      ]);
      return json(serialize(resolved, authors, progress));
   });

   route.delete('/:cycleId', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      await cycles.authorize(context.get('user').id, cycleId, 'settings.write').catch(rethrow('Cycle'));
      const event = await cycles
         .archive(cycleId, context.get('user').id, clock().toISOString())
         .catch(rethrow('Cycle'));
      await publish(options, [event]);
      return new Response(null, { status: 204 });
   });

   route.get('/:cycleId/issues', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      await cycles.authorize(context.get('user').id, cycleId, 'product.read').catch(rethrow('Cycle'));
      return json({ nodes: await cycles.listIssues(cycleId) });
   });

   route.put('/:cycleId/issues/:issueRef', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      const scope = await cycles
         .authorize(context.get('user').id, cycleId, 'product.write')
         .catch(rethrow('Cycle'));
      const issue = await resolveIssue(issues, context.req.param('issueRef'), context.get('user').id, scope.workspaceId);
      await issues
         .update({
            issueId: issue.id,
            actorId: context.get('user').id,
            patch: {
               descriptionSet: false,
               dueDateSet: false,
               assigneeSet: false,
               projectSet: false,
               cycleSet: true,
               cycleId,
            },
         })
         .catch(rethrow('Issue'));
      return new Response(null, { status: 204 });
   });

   route.delete('/:cycleId/issues/:issueRef', async (context) => {
      const cycleId = pathId(context.req.param('cycleId'));
      const scope = await cycles
         .authorize(context.get('user').id, cycleId, 'product.write')
         .catch(rethrow('Cycle'));
      const issue = await resolveIssue(issues, context.req.param('issueRef'), context.get('user').id, scope.workspaceId);
      if (issue.cycleId !== cycleId) throw ApiError.notFound('Issue');
      await issues
         .update({
            issueId: issue.id,
            actorId: context.get('user').id,
            patch: {
               descriptionSet: false,
               dueDateSet: false,
               assigneeSet: false,
               projectSet: false,
               cycleSet: true,
               cycleId: null,
            },
         })
         .catch(rethrow('Issue'));
      return new Response(null, { status: 204 });
   });

   return [{ prefix: '/api/v1/cycles', handler: route }];
}

async function resolveIssue(
   issues: IssueRepository,
   reference: string | undefined,
   userId: string,
   workspaceId: string
) {
   const issue = await issues.get(reference ?? '').catch(rethrow('Issue'));
   await issues.authorize(userId, issue.id, 'product.write').catch(rethrow('Issue'));
   if (issue.workspaceId !== workspaceId) throw ApiError.notFound('Issue');
   return issue;
}

function serialize(
   cycle: Cycle,
   authors: Map<string, ActorRef>,
   progress: CycleProgress | null
): Record<string, unknown> {
   return {
      ...serializeCycleRow(cycle),
      createdBy: cycle.createdBy
         ? (authors.get(cycle.createdBy) ?? {
              type: 'user',
              id: cycle.createdBy,
              name: 'Unknown user',
              avatarUrl: null,
           })
         : null,
      ...(progress ? { progress } : {}),
   };
}

function parseFilter(url: URL): { query: string; status: CycleStatus | null } {
   const query = (url.searchParams.get('query') ?? '').trim();
   if ([...query].length > MAX_QUERY) {
      throw invalidQuery('/query/query', `query is at most ${MAX_QUERY} characters.`);
   }
   const rawStatus = url.searchParams.get('status') ?? '';
   if (rawStatus !== '' && !isCycleStatus(rawStatus)) {
      throw invalidQuery('/query/status', 'status is not a cycle status.');
   }
   return {
      query,
      status: rawStatus === '' ? null : (rawStatus as CycleStatus),
   };
}

function parsePage(url: URL, allowed: string[]): { first: number; after: string } {
   const permitted = new Set(['first', 'after', ...allowed]);
   for (const name of url.searchParams.keys()) {
      if (!permitted.has(name)) throw invalidQuery(`/query/${name}`, 'Unknown query parameter.');
      if (url.searchParams.getAll(name).length !== 1) {
         throw invalidQuery(`/query/${name}`, 'Query parameter must appear once.');
      }
   }
   const raw = url.searchParams.get('first') ?? '';
   let first = 50;
   if (raw !== '') {
      first = Number(raw);
      if (!Number.isInteger(first) || first < 1 || first > 100) {
         throw invalidQuery('/query/first', 'first must be an integer from 1 to 100.');
      }
   }
   return { first, after: url.searchParams.get('after') ?? '' };
}

async function readBody(request: Request, allowed: Set<string>): Promise<Record<string, unknown>> {
   const raw = await request.text();
   let parsed: unknown;
   try {
      parsed = JSON.parse(raw === '' ? '{}' : raw);
   } catch {
      throw invalidBody('The request body is not valid JSON.');
   }
   if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw invalidBody('The request body is not valid JSON.');
   }
   for (const key of Object.keys(parsed)) {
      if (!allowed.has(key)) {
         throw invalidField('/', 'The request contains an unknown field or invalid value.', 'invalid_value');
      }
   }
   return parsed as Record<string, unknown>;
}

function parseStatus(value: unknown): CycleStatus | undefined {
   if (value === undefined) return undefined;
   if (typeof value !== 'string' || !isCycleStatus(value)) {
      throw invalidField('/status', 'status is not a cycle status.');
   }
   return value;
}

function optionalName(value: unknown): string | undefined {
   if (value === undefined || value === null) return undefined;
   return requiredName(value);
}

function requiredName(value: unknown): string {
   if (typeof value !== 'string' || value.trim() === '') {
      throw invalidField('/name', `name must contain 1 to ${MAX_NAME} characters.`);
   }
   const trimmed = value.trim();
   if ([...trimmed].length > MAX_NAME) {
      throw invalidField('/name', `name must contain 1 to ${MAX_NAME} characters.`);
   }
   return trimmed;
}

function requiredDate(value: unknown, field: string): string {
   if (typeof value !== 'string' || !DATE.test(value)) {
      throw invalidField(`/${field}`, `${field} must be a YYYY-MM-DD date.`);
   }
   return value;
}

function requiredBodyUUID(value: unknown, field: string): string {
   if (typeof value !== 'string' || !UUID.test(value)) {
      throw invalidField(`/${field}`, `${field} must be a canonical UUID.`);
   }
   return value;
}

function requiredUUID(url: URL, name: string): string {
   const value = url.searchParams.get(name) ?? '';
   if (!UUID.test(value)) throw invalidQuery(`/query/${name}`, `${name} must be a canonical UUID.`);
   return value;
}

function pathId(value: string | undefined): string {
   if (!value || !UUID.test(value)) throw ApiError.notFound('Cycle');
   return value;
}

async function publish(options: CycleOptions, events: CycleEvent[]): Promise<void> {
   if (!options.broadcaster) return;
   for (const event of events) {
      await options.broadcaster
         .publish({
            id: event.id,
            workspaceId: event.workspaceId,
            type: event.type,
            payload: event.payload,
            occurredAt: event.occurredAt,
         })
         .catch(() => undefined);
   }
}

function rethrow(resource: string) {
   return (error: unknown): never => {
      if (error instanceof NotFound) throw ApiError.notFound(resource);
      if (error instanceof Forbidden) {
         throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      if (error instanceof Conflict) {
         throw new ApiError(409, 'CONFLICT', 'This change conflicts with the current state.');
      }
      throw error;
   };
}

function invalidQuery(pointer: string, message: string): ApiError {
   return new ApiError(422, 'VALIDATION_FAILED', message, {
      fields: [{ pointer, code: 'invalid_value', message }],
   });
}

function invalidBody(message: string): ApiError {
   return new ApiError(422, 'VALIDATION_FAILED', message);
}

function invalidField(pointer: string, message: string, code = 'invalid_value'): ApiError {
   return new ApiError(422, 'VALIDATION_FAILED', message, {
      fields: [{ pointer, code, message }],
   });
}
