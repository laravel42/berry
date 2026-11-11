import type { ScmSync } from '../scm/sync.ts';
import { Hono } from 'hono';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import { UPDATED_CURSOR_KEYS, decodeCursor, encodeCursor, type UpdatedCursor } from '../http/cursor.ts';
import { idempotent } from '../http/idempotent.ts';
import type { IdempotencyStore } from '../http/idempotency.ts';
import type { Broadcaster } from '../realtime/hub.ts';
import { Conflict, Forbidden, NotFound } from '../identity/errors.ts';
import type { Mount } from '../http/registry.ts';
import { cursorScope } from './projects.ts';
import type { IssueRepository } from '../core/issues.ts';
import type { ActorRef } from '../core/comments.ts';
import {
   InvalidMilestoneTransition,
   isMilestoneStatus,
   type Milestone,
   type MilestoneEvent,
   type MilestoneRepository,
   type MilestoneStatus,
   type Progress,
} from '../core/milestones.ts';

/**
 * `/api/v1/milestones`.
 *
 * Two of its sub-lists read tables no mount here owns — approvals and
 * approvals belong to AUTOMATE, plans to the planner. They are served anyway
 * because they depend on those *tables* and not on that code: a goal has to
 * be able to say what points at it without owning any of it.
 */

const MAX_TITLE = 500;
const MAX_DESCRIPTION = 20_000;
const MAX_QUERY = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CREATE_FIELDS = new Set(['workspaceId', 'title', 'description', 'projectId', 'targetDate']);
const UPDATE_FIELDS = new Set(['title', 'description', 'status', 'projectId', 'targetDate', 'sortOrder']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MilestoneOptions {
   sessions: SessionService;
   milestones: MilestoneRepository;
   issues: IssueRepository;
   idempotency: IdempotencyStore;
   /** Mirrors a goal as a milestone. Absent when the deployment runs no git host. */
   scm?: ScmSync | null;
   broadcaster?: Broadcaster | undefined;
   clock?: () => Date;
}

export function milestoneMounts(options: MilestoneOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));

   const { milestones, issues } = options;
   const clock = options.clock ?? (() => new Date());

   route.get('/', async (context) => {
      const url = new URL(context.req.url);
      const page = parsePage(url, ['workspaceId', 'query', 'status', 'projectId']);
      const workspaceId = requiredUUID(url, 'workspaceId');
      const filter = parseFilter(url);

      await milestones
         .authorizeWorkspace(context.get('user').id, workspaceId, 'product.read')
         .catch(rethrow('Workspace'));

      const scope = cursorScope('milestones.list', [
         workspaceId,
         filter.query,
         filter.status ?? '',
         url.searchParams.get('projectId') ?? '',
      ]);
      const after =
         page.after === ''
            ? null
            : decodeCursor<UpdatedCursor>(page.after, scope, UPDATED_CURSOR_KEYS);

      const rows = await milestones.list(workspaceId, filter, after, page.first + 1);
      const hasNextPage = rows.length > page.first;
      const nodes = hasNextPage ? rows.slice(0, page.first) : rows;
      const [authors, progress] = await Promise.all([
         milestones.lookupAuthors(nodes.map((goal) => goal.createdBy ?? '')),
         milestones.progressMany(nodes.map((goal) => goal.id)),
      ]);
      const last = nodes.at(-1);
      return json({
         nodes: nodes.map((goal) => serializeMilestone(goal, authors, progress.get(goal.id) ?? null)),
         pageInfo: {
            hasNextPage,
            endCursor: last ? encodeCursor(scope, { updatedAt: last.updatedAt, id: last.id }) : null,
         },
      });
   });

   route.post('/', idempotent(options.idempotency), async (context) => {
      const body = await readBody(context.req.raw, CREATE_FIELDS);
      const workspaceId = requiredBodyUUID(body.workspaceId, 'workspaceId');
      await milestones
         .authorizeWorkspace(context.get('user').id, workspaceId, 'product.write')
         .catch(rethrow('Workspace'));

      const title = requiredText(body.title, 'title', MAX_TITLE);
      const description = optionalText(body, 'description', MAX_DESCRIPTION);
      const projectId = requiredBodyUUID(body.projectId, 'projectId');
      const targetDate = optionalDate(body, 'targetDate');

      const created = await milestones
         .create({
            workspaceId,
            title,
            projectId,
            ...(description === undefined ? {} : { description }),
            ...(targetDate === undefined ? {} : { targetDate }),
            createdBy: context.get('user').id,
            createdAt: clock().toISOString(),
         })
         .catch(rethrow('Milestone'));
      await publish(options, [created.event]);

      // Not awaited: the goal exists and is the answer to this request. The
      // milestone is a mirror of it, and its outcome is recorded on the goal's
      // link rather than held against the response.
      options.scm?.guard('milestone.created', options.scm.goalCreated(created.goal.id));

      const authors = await milestones.lookupAuthors([created.goal.createdBy ?? '']);
      return json(serializeMilestone(created.goal, authors, null), 201);
   });

   route.put('/order', async (context) => {
      const body = await readBody(context.req.raw, new Set(['workspaceId', 'projectId', 'milestoneIds']));
      const workspaceId = requiredBodyUUID(body.workspaceId, 'workspaceId');
      const projectId = requiredBodyUUID(body.projectId, 'projectId');
      await milestones
         .authorizeWorkspace(context.get('user').id, workspaceId, 'product.write')
         .catch(rethrow('Workspace'));
      const milestoneIds = requiredIdList(body.milestoneIds, 'milestoneIds');
      const events = await milestones
         .reorder(workspaceId, projectId, milestoneIds, context.get('user').id, clock().toISOString())
         .catch(rethrow('Milestone'));
      await publish(options, events);
      return json({ ok: true });
   });

   route.get('/:milestoneId', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      await milestones.authorize(context.get('user').id, milestoneId, 'product.read').catch(rethrow('Milestone'));
      const goal = await milestones.get(milestoneId).catch(rethrow('Milestone'));
      const [authors, progress] = await Promise.all([
         milestones.lookupAuthors([goal.createdBy ?? '']),
         milestones.progress(milestoneId),
      ]);
      return json(serializeMilestone(goal, authors, progress));
   });

   /**
    * A patch and a transition in one request.
    *
    * They are separate operations underneath — the fields move under a lock,
    * the status moves through the lifecycle — and each writes its own event,
    * so a client that renamed a goal and started it sees both facts.
    */
   route.patch('/:milestoneId', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      await milestones.authorize(context.get('user').id, milestoneId, 'product.write').catch(rethrow('Milestone'));

      const body = await readBody(context.req.raw, UPDATE_FIELDS);
      const patch = {
         ...(body.title === undefined ? {} : { title: patchTitle(body.title) }),
         ...('description' in body
            ? { description: optionalText(body, 'description', MAX_DESCRIPTION) ?? null, descriptionSet: true }
            : {}),
         ...('projectId' in body ? { projectId: optionalUUID(body, 'projectId') ?? null, projectSet: true } : {}),
         ...('targetDate' in body
            ? { targetDate: optionalDate(body, 'targetDate') ?? null, targetDateSet: true }
            : {}),
         ...(body.sortOrder === undefined ? {} : { sortOrder: requiredSortOrder(body.sortOrder) }),
      };
      // Status PATCH remains for SCM/debug; project UX uses progress percent.
      const status = parseStatus(body.status);
      if (Object.keys(patch).length === 0 && status === undefined) {
         throw invalidField('/', 'At least one field must be provided.', 'too_small');
      }

      const events: MilestoneEvent[] = [];
      const now = clock();
      let goal: Milestone | null = null;
      if (Object.keys(patch).length > 0) {
         const updated = await milestones
            .update(milestoneId, patch, context.get('user').id, now.toISOString())
            .catch(rethrow('Milestone'));
         goal = updated.goal;
         events.push(updated.event);
      }
      if (status !== undefined) {
         // A microsecond later, so the two facts order stably: a consumer
         // replaying by time must not see the status change before the rename
         // that shared its request.
         const at = new Date(now.getTime() + 1);
         const moved = await milestones
            .transition(milestoneId, status, context.get('user').id, at.toISOString())
            .catch(rethrow('Milestone'));
         goal = moved.goal;
         if (moved.event) events.push(moved.event);
      }
      await publish(options, events);

      const resolved = goal ?? (await milestones.get(milestoneId).catch(rethrow('Milestone')));
      const [authors, progress] = await Promise.all([
         milestones.lookupAuthors([resolved.createdBy ?? '']),
         milestones.progress(milestoneId),
      ]);
      return json(serializeMilestone(resolved, authors, progress));
   });

   route.delete('/:milestoneId', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      await milestones.authorize(context.get('user').id, milestoneId, 'settings.write').catch(rethrow('Milestone'));
      const event = await milestones
         .archive(milestoneId, context.get('user').id, clock().toISOString())
         .catch(rethrow('Milestone'));
      await publish(options, [event]);
      return new Response(null, { status: 204 });
   });

   route.get('/:milestoneId/issues', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      await milestones.authorize(context.get('user').id, milestoneId, 'product.read').catch(rethrow('Milestone'));
      return json({ nodes: await milestones.listIssues(milestoneId) });
   });

   route.put('/:milestoneId/issues/:issueRef', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      const scope = await milestones
         .authorize(context.get('user').id, milestoneId, 'product.write')
         .catch(rethrow('Milestone'));
      const issue = await resolveIssue(issues, context.req.param('issueRef'), context.get('user').id, scope.workspaceId);

      await milestones
         .linkIssue({
            workspaceId: scope.workspaceId,
            milestoneId,
            issueId: issue.id,
            actorId: context.get('user').id,
            now: clock().toISOString(),
         })
         .catch(rethrow('Issue'));
      return new Response(null, { status: 204 });
   });

   route.delete('/:milestoneId/issues/:issueRef', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      const scope = await milestones
         .authorize(context.get('user').id, milestoneId, 'product.write')
         .catch(rethrow('Milestone'));
      const issue = await resolveIssue(issues, context.req.param('issueRef'), context.get('user').id, scope.workspaceId);
      await milestones.unlinkIssue(milestoneId, issue.id).catch(rethrow('Issue'));
      return new Response(null, { status: 204 });
   });

   route.get('/:milestoneId/approvals', async (context) => {
      const milestoneId = pathId(context.req.param('milestoneId'));
      const scope = await milestones
         .authorize(context.get('user').id, milestoneId, 'product.read')
         .catch(rethrow('Milestone'));
      return json({ nodes: await milestones.listApprovals(milestoneId, scope.workspaceId) });
   });

   return [{ prefix: '/api/v1/milestones', handler: route }];
}

/**
 * The issue named in the path, inside the goal's workspace.
 *
 * The workspace check is what stops a goal linking an issue somebody can see
 * in another workspace: the caller may reach both, and the link would still be
 * wrong.
 */
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

function serializeMilestone(
   goal: Milestone,
   authors: Map<string, ActorRef>,
   progress: Progress | null
): Record<string, unknown> {
   return {
      id: goal.id,
      workspaceId: goal.workspaceId,
      projectId: goal.projectId,
      title: goal.title,
      description: goal.description,
      status: goal.status,
      source: goal.source,
      sourcePrompt: goal.sourcePrompt,
      targetDate: goal.targetDate,
      sortOrder: goal.sortOrder,
      createdBy: goal.createdBy
         ? (authors.get(goal.createdBy) ?? {
              type: 'user',
              id: goal.createdBy,
              name: 'Unknown user',
              avatarUrl: null,
           })
         : null,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      startedAt: goal.startedAt,
      completedAt: goal.completedAt,
      ...(progress ? { progress } : {}),
   };
}

function parseFilter(url: URL): { query: string; status: MilestoneStatus | null; projectId: string | null } {
   const query = (url.searchParams.get('query') ?? '').trim();
   if ([...query].length > MAX_QUERY) {
      throw invalidQuery('/query/query', `query is at most ${MAX_QUERY} characters.`);
   }
   const rawStatus = url.searchParams.get('status') ?? '';
   if (rawStatus !== '' && !isMilestoneStatus(rawStatus)) {
      throw invalidQuery('/query/status', 'status is not a goal status.');
   }
   const rawProject = url.searchParams.get('projectId') ?? '';
   if (rawProject !== '' && !UUID.test(rawProject)) {
      throw invalidQuery('/query/projectId', 'projectId must be a canonical UUID.');
   }
   return {
      query,
      status: rawStatus === '' ? null : (rawStatus as MilestoneStatus),
      projectId: rawProject === '' ? null : rawProject,
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

/**
 * A title on a patch may not be null.
 *
 * Absent means "leave it"; null would have to mean "clear it", and a goal with
 * no title is not something the product can render — so it is refused with its
 * own code rather than folded into "invalid".
 */
function patchTitle(value: unknown): string {
   if (value === null) throw invalidField('/title', 'title cannot be null.', 'invalid_type');
   return requiredText(value, 'title', MAX_TITLE);
}

function requiredText(value: unknown, field: string, limit: number): string {
   if (typeof value !== 'string' || value.trim() === '') {
      throw invalidField(`/${field}`, `${field} must contain 1 to ${limit} characters.`);
   }
   const trimmed = value.trim();
   if ([...trimmed].length > limit) {
      throw invalidField(`/${field}`, `${field} must contain 1 to ${limit} characters.`);
   }
   return trimmed;
}

/** Absent leaves the field alone; null or empty clears it. */
function optionalText(
   body: Record<string, unknown>,
   field: string,
   limit: number
): string | null | undefined {
   if (!(field in body)) return undefined;
   if (body[field] === null) return null;
   if (typeof body[field] !== 'string') throw invalidField(`/${field}`, `${field} must be a string.`);
   const trimmed = (body[field] as string).trim();
   if ([...trimmed].length > limit) {
      throw invalidField(`/${field}`, `${field} must contain at most ${limit} characters.`, 'too_big');
   }
   return trimmed === '' ? null : trimmed;
}

function optionalUUID(body: Record<string, unknown>, field: string): string | null | undefined {
   if (!(field in body)) return undefined;
   if (body[field] === null) return null;
   if (typeof body[field] !== 'string' || !UUID.test(body[field] as string)) {
      throw invalidField(`/${field}`, `${field} must be a canonical UUID.`);
   }
   return body[field] as string;
}

function requiredBodyUUID(value: unknown, field: string): string {
   if (typeof value !== 'string' || !UUID.test(value)) {
      throw invalidField(`/${field}`, `${field} must be a canonical UUID.`);
   }
   return value;
}

function optionalDate(body: Record<string, unknown>, field: string): string | null | undefined {
   if (!(field in body)) return undefined;
   if (body[field] === null || body[field] === '') return null;
   if (typeof body[field] !== 'string' || !DATE.test(body[field] as string)) {
      throw invalidField(`/${field}`, `${field} must be a YYYY-MM-DD date.`);
   }
   return body[field] as string;
}

function requiredSortOrder(value: unknown): number {
   const n = typeof value === 'number' ? value : Number(value);
   if (!Number.isFinite(n) || n < 0) {
      throw invalidField('/sortOrder', 'sortOrder must be a non-negative number.');
   }
   return n;
}

function requiredIdList(value: unknown, field: string): string[] {
   if (!Array.isArray(value) || value.length === 0) {
      throw invalidField(`/${field}`, `${field} must be a non-empty array of UUIDs.`);
   }
   const ids: string[] = [];
   for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'string' || !UUID.test(entry)) {
         throw invalidField(`/${field}/${index}`, 'Each id must be a canonical UUID.');
      }
      ids.push(entry);
   }
   return ids;
}

/**
 * The statuses a caller may ask for.
 *
 * `blocked` is missing on purpose: it is the dispatcher's, set when a goal's
 * work waits on something a person must do, and letting a client set it would
 * let them claim a goal is blocked by nothing.
 */
function parseStatus(value: unknown): MilestoneStatus | undefined {
   if (value === undefined) return undefined;
   if (typeof value !== 'string' || !isMilestoneStatus(value) || value === 'blocked') {
      throw invalidField(
         '/status',
         'status is draft, planned, active, completed or cancelled.',
         'invalid_enum_value'
      );
   }
   return value;
}

function requiredUUID(url: URL, name: string): string {
   const raw = url.searchParams.get(name) ?? '';
   if (!UUID.test(raw)) throw invalidQuery(`/query/${name}`, `${name} must be a canonical UUID.`);
   return raw;
}

function pathId(raw: string | undefined): string {
   if (!raw || !UUID.test(raw)) throw ApiError.notFound('Milestone');
   return raw.toLowerCase();
}

function invalidQuery(path: string, message: string): ApiError {
   return new ApiError(400, 'INVALID_REQUEST', 'The request query is invalid.', {
      fields: [{ path, code: 'invalid', message }],
   });
}

function invalidField(path: string, message: string, code = 'invalid'): ApiError {
   return new ApiError(422, 'VALIDATION_FAILED', 'The request is invalid.', {
      fields: [{ path, code, message }],
   });
}

function invalidBody(message: string): ApiError {
   return new ApiError(400, 'INVALID_REQUEST', message);
}

function rethrow(resource: string): (error: unknown) => never {
   return (error: unknown) => {
      if (error instanceof InvalidMilestoneTransition) {
         throw new ApiError(
            422,
            'MILESTONE_TRANSITION_INVALID',
            `A goal cannot move from "${error.from}" to "${error.to}".`,
            { from: error.from, to: error.to }
         );
      }
      if (error instanceof NotFound) throw ApiError.notFound(resource);
      if (error instanceof Forbidden) {
         throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      // A conflict on a goal write is always the project: it is the only
      // foreign key a caller supplies, so "conflict" here means they named one
      // that is not in this workspace.
      if (error instanceof Conflict) {
         throw new ApiError(
            422,
            'PROJECT_NOT_FOUND',
            'That project does not exist in this workspace.'
         );
      }
      throw error;
   };
}

async function publish(options: MilestoneOptions, events: MilestoneEvent[]): Promise<void> {
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
