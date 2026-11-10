import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { InvalidSchedule, nextFireTimes } from '../autopilots/cron.ts';
import { AlreadyFired, NotRetryable, type FireFn, type FireOutcome } from '../autopilots/fire.ts';
import type { LoopDrafter } from '../autopilots/draft.ts';
import {
   InvalidConditions,
   isLoopEventKey,
   LOOP_EVENT_KEYS,
   LOOP_EVENT_TYPES,
   parseConditions,
} from '../autopilots/event-triggers.ts';
import { ACCESS_MODES, CONCURRENCY_POLICIES, MAX_CHAIN_DEPTH, RECOMMEND_TOOLS } from '../autopilots/policy.ts';
import { isActive, LOOP_RUN_STATES } from '../autopilots/run-state.ts';
import { LOOP_TEMPLATES } from '../autopilots/templates.ts';
import { decodeTimeCursor, encodeCursor, parsePageQuery } from '../http/cursor.ts';
import {
   ASSIGNEE_TYPES,
   EXECUTION_MODES,
   InvalidAutopilot,
   QUOTA_PERIODS,
   type Autopilot,
   type AutopilotRepository,
   type AutopilotRunRecord,
   type AutopilotTrigger,
   type WebhookSecrets,
} from '../autopilots/repository.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { assertValid, fieldError } from '../http/body.ts';
import { ApiError } from '../http/errors.ts';
import { idempotent } from '../http/idempotent.ts';
import type { IdempotencyStore } from '../http/idempotency.ts';
import type { Mount } from '../http/registry.ts';
import { toApiError } from '../identity/errors.ts';
import type { Permission } from '../identity/roles.ts';
import { SealingUnavailable } from '../integrations/sealing.ts';
import { owned, pathId, resolveScoped, resolveScopedResource } from './shared.ts';

/**
 * `/api/v1/autopilots`.
 *
 * Workspace-scoped through `resolveScoped`, the same gate `/search` and
 * `/views` use for a query-parameter workspace. Routes that name an
 * autopilot find its workspace first and then gate on it; a caller who is
 * not a member gets the answer a random id gets, so an id from another
 * workspace cannot be told apart from one that does not exist.
 *
 * Trigger creation and rotation are the only places a token or signing
 * secret leaves the server, and they are deliberately not idempotent: the
 * idempotency store keeps response bodies, and a secret must not be kept.
 */

export interface AutopilotMountOptions {
   sessions: SessionService;
   sql: Sql;
   autopilots: AutopilotRepository;
   fire: FireFn;
   idempotency: IdempotencyStore;
   clock?: () => Date;
   /** Retry a Loop run (fire.ts `retryAutopilotRun`). Absent: retry answers 501. */
   retry?: (input: { workspaceId: string; autopilotId: string; autopilotRunId: string; requestedBy: string }) => Promise<FireOutcome>;
   /** Cancel an agent run through the ledger, as the runs mount does. */
   cancelRun?: (runId: string) => Promise<unknown>;
   /** Drafts a Loop from a sentence. Absent: the draft route answers 501. */
   drafter?: LoopDrafter;
   /** Whether this workspace can run a completion, so a draft may use a model. */
   canUseModel?: (workspaceId: string) => Promise<boolean>;
}

const UUID = z
   .string()
   .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
   .transform((value) => value.toLowerCase());
const EVENT_NAME = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);

const draftFields = {
   name: z.string().trim().min(1).max(200),
   description: z.string().max(5000).nullable(),
   assigneeType: z.enum(ASSIGNEE_TYPES),
   assigneeId: UUID,
   promptTemplate: z.string().min(1).max(20000),
   executionMode: z.enum(EXECUTION_MODES),
   boardId: UUID.nullable(),
   projectId: UUID.nullable(),
   issueId: UUID.nullable(),
   quotaPeriod: z.enum(QUOTA_PERIODS),
   quotaMax: z.number().int().min(1).max(10000).nullable(),
   accessMode: z.enum(ACCESS_MODES),
   concurrencyPolicy: z.enum(CONCURRENCY_POLICIES),
   maxTurns: z.number().int().min(1).max(500).nullable(),
   maxDurationMinutes: z.number().int().min(1).max(1440).nullable(),
   maxChainDepth: z.number().int().min(0).max(MAX_CHAIN_DEPTH),
   allowAgentEvents: z.boolean(),
   templateKey: z.string().regex(/^[a-z0-9-]{1,64}$/).nullable(),
};

const createSchema = z.strictObject({
   workspaceId: UUID,
   ...draftFields,
   description: draftFields.description.default(null),
   boardId: draftFields.boardId.default(null),
   projectId: draftFields.projectId.default(null),
   issueId: draftFields.issueId.default(null),
   quotaPeriod: draftFields.quotaPeriod.default('none'),
   quotaMax: draftFields.quotaMax.default(null),
   // A new Loop starts safe; every one of these is the person's to loosen.
   accessMode: draftFields.accessMode.default('recommend'),
   concurrencyPolicy: draftFields.concurrencyPolicy.default('skip_if_running'),
   maxTurns: draftFields.maxTurns.default(null),
   maxDurationMinutes: draftFields.maxDurationMinutes.default(null),
   maxChainDepth: draftFields.maxChainDepth.default(0),
   allowAgentEvents: draftFields.allowAgentEvents.default(false),
   templateKey: draftFields.templateKey.default(null),
   /** Create it paused, to review before it runs. */
   status: z.enum(['active', 'paused']).default('active'),
});

const patchSchema = z
   .strictObject({ ...draftFields, status: z.enum(['active', 'paused']) })
   .partial();

const triggerSchema = z.discriminatedUnion('kind', [
   z.strictObject({
      kind: z.literal('cron'),
      expression: z.string().min(1).max(200),
      timezone: z.string().min(1).max(100),
      enabled: z.boolean().default(true),
   }),
   z.strictObject({
      kind: z.literal('webhook'),
      eventFilters: z.array(EVENT_NAME).max(50).default([]),
      enabled: z.boolean().default(true),
   }),
   z.strictObject({
      kind: z.literal('event'),
      eventType: z.string().min(1).max(100),
      conditions: z.unknown().optional(),
      enabled: z.boolean().default(true),
   }),
]);

const validateSchema = z.discriminatedUnion('kind', [
   z.strictObject({ kind: z.literal('cron'), expression: z.string().min(1).max(200), timezone: z.string().min(1).max(100) }),
   z.strictObject({ kind: z.literal('event'), eventType: z.string().min(1).max(100), conditions: z.unknown().optional() }),
]);

const draftSchema = z.strictObject({
   workspaceId: UUID,
   prompt: z.string().trim().min(3).max(4000),
});

const triggerPatchSchema = z
   .strictObject({
      enabled: z.boolean(),
      expression: z.string().min(1).max(200),
      timezone: z.string().min(1).max(100),
      eventFilters: z.array(EVENT_NAME).max(50),
      eventType: z.string().min(1).max(100),
      conditions: z.unknown(),
   })
   .partial();

const membersSchema = z.strictObject({
   members: z
      .array(z.strictObject({ userId: UUID, role: z.enum(['collaborator', 'subscriber']) }))
      .max(200),
});

export function autopilotMounts(options: AutopilotMountOptions): Mount[] {
   const route = new Hono<{ Variables: AuthVariables }>();
   route.use('*', requireSession(options.sessions));
   const { autopilots } = options;
   const clock = options.clock ?? (() => new Date());

   /**
    * The workspace an autopilot belongs to, once the caller is proven a member
    * with `required`. A trigger the route names is found in that workspace
    * before the permission is checked, so an absent or foreign trigger id is
    * the same 404 for every role, and a 403 only speaks of rows the caller
    * could already see.
    */
   async function scopeOf(
      context: Context<{ Variables: AuthVariables }>,
      autopilotId: string,
      required: Permission,
      triggerId?: string
   ): Promise<string> {
      const workspaceId = await autopilots.workspaceOf(autopilotId).catch(mapError);
      try {
         await resolveScopedResource(options.sql, context.get('user').id, workspaceId, required, async (db) => {
            if (triggerId) await owned('autopilot_triggers', triggerId, 'Autopilot')(db);
         });
      } catch (error) {
         // "Workspace not found" would say the autopilot exists somewhere.
         if (error instanceof ApiError && error.status === 404) throw ApiError.notFound('Autopilot');
         throw error;
      }
      return workspaceId;
   }

   route.get('/cron-preview', (context) => {
      const url = new URL(context.req.url);
      const expression = url.searchParams.get('expression') ?? '';
      const timezone = url.searchParams.get('timezone') ?? 'UTC';
      const count = Number(url.searchParams.get('count') ?? '5');
      try {
         const times = nextFireTimes(expression, timezone, clock(), count);
         return json({ expression, timezone, times: times.map((time) => time.toISOString()) });
      } catch (error) {
         return mapError(error);
      }
   });

   route.get('/', async (context) => {
      const url = new URL(context.req.url);
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      if (!workspaceId) assertValid([fieldError('/workspaceId', 'required', 'workspaceId is required.')]);
      const archived = url.searchParams.get('archived');
      if (archived !== null && archived !== 'true' && archived !== 'false') {
         throw ApiError.badRequest('archived is true or false.');
      }
      const projectId = url.searchParams.get('projectId');
      if (projectId !== null && !UUID.safeParse(projectId).success) {
         assertValid([fieldError('/projectId', 'invalid_value', 'projectId is not an identifier.')]);
      }
      const scoped = await resolveScoped(options.sql, context.get('user').id, workspaceId);
      const nodes = await autopilots.list(scoped.ctx.workspaceId, {
         ...(archived === 'true' ? { archived: true } : {}),
         ...(projectId ? { projectId: projectId.toLowerCase() } : {}),
      });
      return json({ nodes: nodes.map(serializeAutopilot) });
   });

   /**
    * The template catalogue, with the agent each would suggest in this
    * workspace. A template fills a form; it creates nothing.
    */
   route.get('/templates', async (context) => {
      const workspaceId = new URL(context.req.url).searchParams.get('workspaceId') ?? '';
      if (!workspaceId) assertValid([fieldError('/workspaceId', 'required', 'workspaceId is required.')]);
      const scoped = await resolveScoped(options.sql, context.get('user').id, workspaceId);
      const nodes = await Promise.all(
         LOOP_TEMPLATES.map(async (template) => ({
            ...template,
            suggestedAgent: await autopilots.suggestAgent(scoped.ctx.workspaceId, template.roles),
         }))
      );
      return json({ nodes });
   });

   /** The events a Loop can listen for, and what each recommend-mode run may use. */
   route.get('/events', () =>
      json({
         nodes: LOOP_EVENT_KEYS.map((key) => ({ key, topic: LOOP_EVENT_TYPES[key].topic, subject: LOOP_EVENT_TYPES[key].subject })),
         recommendTools: RECOMMEND_TOOLS,
         maxChainDepth: MAX_CHAIN_DEPTH,
         runStates: LOOP_RUN_STATES,
      })
   );

   /**
    * Check a trigger without saving it: a schedule's next times, or an event
    * type and its filters as the server will store them.
    */
   route.post('/validate-trigger', async (context) => {
      const body = await readJson(context, validateSchema);
      if (body.kind === 'cron') {
         try {
            const times = nextFireTimes(body.expression, body.timezone, clock(), 5);
            return json({ valid: true, kind: 'cron', expression: body.expression.trim(), timezone: body.timezone, nextTimes: times.map((time) => time.toISOString()) });
         } catch (error) {
            return mapError(error);
         }
      }
      if (!isLoopEventKey(body.eventType)) {
         assertValid([fieldError('/eventType', 'invalid_value', 'That is not an event a loop can listen for.')]);
         throw ApiError.badRequest('The request is invalid.');
      }
      try {
         return json({ valid: true, kind: 'event', eventType: body.eventType, conditions: parseConditions(body.eventType, body.conditions) });
      } catch (error) {
         return mapError(error);
      }
   });

   /**
    * A draft from a sentence, for the creation form. Nothing is stored. A
    * model reads it when the workspace has one connected; otherwise the
    * rules do, and the draft says which.
    */
   route.post('/draft', async (context) => {
      if (!options.drafter) throw new ApiError(501, 'DRAFT_UNAVAILABLE', 'Drafting loops is not available on this server.');
      const body = await readJson(context, draftSchema);
      const scoped = await resolveScoped(options.sql, context.get('user').id, body.workspaceId, 'product.write');
      const workspaceId = scoped.ctx.workspaceId;
      const useModel = options.canUseModel ? await options.canUseModel(workspaceId).catch(() => false) : false;
      const draft = await options.drafter.draft({ workspaceId, prompt: body.prompt, useModel, signal: context.req.raw.signal });
      return json({ ...draft, suggestedAgent: await autopilots.suggestAgent(workspaceId, draft.roles) });
   });

   /** Runs across the workspace's Loops: recent activity, or what needs attention. */
   route.get('/activity', async (context) => {
      const url = new URL(context.req.url);
      const workspaceId = url.searchParams.get('workspaceId') ?? '';
      if (!workspaceId) assertValid([fieldError('/workspaceId', 'required', 'workspaceId is required.')]);
      const attention = url.searchParams.get('attention') === 'true';
      const scoped = await resolveScoped(options.sql, context.get('user').id, workspaceId);
      const nodes = await autopilots.workspaceRuns(scoped.ctx.workspaceId, { needsAttention: attention, limit: attention ? 20 : 15 });
      return json({ nodes: nodes.map((run) => ({ ...serializeRun(run), autopilotName: run.autopilotName })) });
   });

   route.post('/', idempotent(options.idempotency), async (context) => {
      const body = await readJson(context, createSchema);
      const scoped = await resolveScoped(options.sql, context.get('user').id, body.workspaceId, 'product.write');
      const { workspaceId: _ignored, status, ...draft } = body;
      const created = await autopilots
         .create(scoped.ctx.workspaceId, draft, context.get('user').id, { status })
         .catch(mapError);
      return json(serializeAutopilot(await autopilots.get(scoped.ctx.workspaceId, created.id)), 201);
   });

   route.get('/:autopilotId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      const [autopilot, triggers, members] = await Promise.all([
         autopilots.get(workspaceId, id),
         autopilots.triggers(workspaceId, id),
         autopilots.members(workspaceId, id),
      ]).catch(mapError);
      return json({ ...serializeAutopilot(autopilot), triggers: triggers.map(serializeTrigger), members });
   });

   route.patch('/:autopilotId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      const patch = await readJson(context, patchSchema);
      await autopilots.update(workspaceId, id, patch, context.get('user').id).catch(mapError);
      return json(serializeAutopilot(await autopilots.get(workspaceId, id)));
   });

   route.delete('/:autopilotId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      await autopilots.archive(workspaceId, id, context.get('user').id).catch(mapError);
      return new Response(null, { status: 204 });
   });

   route.post('/:autopilotId/restore', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      const restored = await autopilots
         .restore(workspaceId, id, context.get('user').id)
         .catch(mapError);
      return json(serializeAutopilot(restored));
   });

   /** A paused copy to adjust, with its schedule and event triggers. */
   route.post('/:autopilotId/duplicate', idempotent(options.idempotency), async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      const copy = await autopilots.duplicate(workspaceId, id, context.get('user').id).catch(mapError);
      return json(serializeAutopilot(copy), 201);
   });

   route.post('/:autopilotId/run', idempotent(options.idempotency), async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      await scopeOf(context, id, 'runs.dispatch');
      const outcome = await options
         .fire({ autopilotId: id, source: 'manual', requestedBy: context.get('user').id })
         .catch(mapError);
      return json(outcome, 202);
   });

   route.get('/:autopilotId/versions', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      return json({ nodes: await autopilots.versions(workspaceId, id).catch(mapError) });
   });

   route.put('/:autopilotId/members', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      const body = await readJson(context, membersSchema);
      return json({ nodes: await autopilots.setMembers(workspaceId, id, body.members).catch(mapError) });
   });

   route.post('/:autopilotId/triggers', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write');
      const body = await readJson(context, triggerSchema);
      if (body.kind === 'cron') {
         const trigger = await autopilots
            .addCronTrigger(workspaceId, id, {
               expression: body.expression,
               timezone: body.timezone,
               enabled: body.enabled,
            })
            .catch(mapError);
         return json({ trigger: serializeTrigger(trigger) }, 201);
      }
      if (body.kind === 'event') {
         const trigger = await autopilots
            .addEventTrigger(workspaceId, id, { eventType: body.eventType, conditions: body.conditions, enabled: body.enabled })
            .catch(mapError);
         return json({ trigger: serializeTrigger(trigger) }, 201);
      }
      const made = await autopilots
         .addWebhookTrigger(workspaceId, id, { eventFilters: body.eventFilters, enabled: body.enabled })
         .catch(mapError);
      return secretResponse(made.trigger, made.secrets, 201);
   });

   route.patch('/:autopilotId/triggers/:triggerId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const triggerId = pathId(context.req.param('triggerId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write', triggerId);
      const patch = await readJson(context, triggerPatchSchema);
      const trigger = await autopilots.updateTrigger(workspaceId, id, triggerId, patch).catch(mapError);
      return json(serializeTrigger(trigger));
   });

   route.delete('/:autopilotId/triggers/:triggerId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const triggerId = pathId(context.req.param('triggerId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write', triggerId);
      await autopilots.deleteTrigger(workspaceId, id, triggerId).catch(mapError);
      return new Response(null, { status: 204 });
   });

   route.post('/:autopilotId/triggers/:triggerId/rotate', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const triggerId = pathId(context.req.param('triggerId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.write', triggerId);
      const made = await autopilots.rotateWebhook(workspaceId, id, triggerId).catch(mapError);
      return secretResponse(made.trigger, made.secrets, 200);
   });

   route.get('/:autopilotId/runs', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      const url = new URL(context.req.url);
      const page = parsePageQuery(url);
      const cursorScope = `autopilot-runs.${id}`;
      const after = page.after === '' ? null : decodeTimeCursor(page.after, cursorScope);
      const rows = await autopilots.runs(workspaceId, id, { after, limit: page.first + 1 });
      const hasNextPage = rows.length > page.first;
      const nodes = hasNextPage ? rows.slice(0, page.first) : rows;
      const last = nodes.at(-1);
      return json({
         nodes: nodes.map(serializeRun),
         pageInfo: {
            hasNextPage,
            endCursor: last && hasNextPage ? encodeCursor(cursorScope, { createdAt: last.createdAt, id: last.id }) : null,
         },
      });
   });

   route.get('/:autopilotId/runs/:runId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const runId = pathId(context.req.param('runId'), 'Loop run');
      const workspaceId = await scopeOf(context, id, 'product.read');
      const detail = await autopilots.runDetail(workspaceId, id, runId).catch(mapRunError);
      return json({
         ...serializeRun(detail),
         autopilotName: detail.autopilotName,
         triggerKind: detail.triggerKind,
         triggerPayload: detail.triggerPayload,
         failureCode: detail.failureCode,
         failureMessage: detail.failureMessage,
         usage: detail.usage,
         model: detail.model,
         children: detail.children,
      });
   });

   /**
    * Retry a run that did not do its work, once. Same trigger facts, same
    * task; a second press answers 409 with the retry that already exists.
    */
   route.post('/:autopilotId/runs/:runId/retry', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const runId = pathId(context.req.param('runId'), 'Loop run');
      const workspaceId = await scopeOf(context, id, 'runs.dispatch');
      if (!options.retry) throw new ApiError(501, 'RETRY_UNAVAILABLE', 'Retrying loop runs is not available on this server.');
      try {
         const outcome = await options.retry({ workspaceId, autopilotId: id, autopilotRunId: runId, requestedBy: context.get('user').id });
         return json(outcome, 202);
      } catch (error) {
         if (error instanceof AlreadyFired) {
            throw new ApiError(409, 'ALREADY_RETRIED', 'This run was already retried.', { autopilotRunId: error.autopilotRunId });
         }
         if (error instanceof NotRetryable) {
            throw new ApiError(409, 'RUN_NOT_RETRYABLE', error.message, { state: error.state });
         }
         return mapRunError(error);
      }
   });

   /** Cancel the agent run behind a Loop run, through the ledger. */
   route.post('/:autopilotId/runs/:runId/cancel', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const runId = pathId(context.req.param('runId'), 'Loop run');
      const workspaceId = await scopeOf(context, id, 'product.write');
      if (!options.cancelRun) throw new ApiError(501, 'CANCEL_UNAVAILABLE', 'Cancelling loop runs is not available on this server.');
      const detail = await autopilots.runDetail(workspaceId, id, runId).catch(mapRunError);
      if (!detail.runId || !isActive(detail.state)) {
         throw new ApiError(409, 'RUN_TERMINAL', 'This run has already finished.');
      }
      try {
         await options.cancelRun(detail.runId);
      } catch (error) {
         if (error instanceof Error && error.name === 'RunTerminal') {
            throw new ApiError(409, 'RUN_TERMINAL', 'This run has already finished.');
         }
         throw error;
      }
      const after = await autopilots.runDetail(workspaceId, id, runId);
      return json(serializeRun(after), 202);
   });

   /** What the Loop's event triggers saw, and what became of each. */
   route.get('/:autopilotId/receipts', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      return json({ nodes: await autopilots.receipts(workspaceId, id) });
   });

   route.get('/:autopilotId/deliveries', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      return json({ nodes: await autopilots.deliveries(workspaceId, id) });
   });

   /** One delivery with the payload it carried, for the deliveries tab. */
   route.get('/:autopilotId/deliveries/:deliveryId', async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const deliveryId = pathId(context.req.param('deliveryId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'product.read');
      const { delivery, payload } = await autopilots.deliveryPayload(workspaceId, id, deliveryId).catch(mapError);
      return json({ ...delivery, payload });
   });

   /**
    * Fires again with what the delivery carried. The signature was checked
    * when it first arrived; a replay is a member of the workspace asking,
    * which is why it needs `runs.dispatch` rather than the secret.
    */
   route.post('/:autopilotId/deliveries/:deliveryId/replay', idempotent(options.idempotency), async (context) => {
      const id = pathId(context.req.param('autopilotId'), 'Autopilot');
      const deliveryId = pathId(context.req.param('deliveryId'), 'Autopilot');
      const workspaceId = await scopeOf(context, id, 'runs.dispatch');
      const { delivery, payload } = await autopilots.deliveryPayload(workspaceId, id, deliveryId).catch(mapError);
      // A rejected delivery was refused at the door — a bad signature, a body
      // that was not a JSON object, or a disabled trigger. Replaying the
      // first would fire on the word of an unverified sender, and the others
      // were refused on purpose. Refused here, not only hidden in the UI.
      if (delivery.status === 'rejected') {
         throw new ApiError(
            409,
            'DELIVERY_NOT_REPLAYABLE',
            'This delivery was refused before it was read, so there is nothing to replay.'
         );
      }
      const replayId = await autopilots.recordDelivery({
         workspaceId,
         autopilotId: id,
         triggerId: delivery.triggerId,
         event: delivery.event,
         status: 'accepted',
         payload,
         failureReason: null,
         replayOf: deliveryId,
      });
      const outcome = await options
         .fire({
            autopilotId: id,
            source: 'replay',
            triggerId: delivery.triggerId,
            payload,
            requestedBy: context.get('user').id,
         })
         .catch(async (error: unknown) => {
            // The replay row exists already; it must not claim `accepted`
            // for a firing that never happened.
            await autopilots.linkDelivery(replayId, null, 'failed');
            return mapError(error);
         });
      await autopilots.linkDelivery(replayId, outcome.autopilotRunId, outcome.status === 'failed' ? 'failed' : 'accepted');
      return json(outcome, 202);
   });

   return [{ prefix: '/api/v1/autopilots', handler: route }];
}

export function serializeAutopilot(autopilot: Autopilot): Record<string, unknown> {
   return {
      id: autopilot.id,
      workspaceId: autopilot.workspaceId,
      name: autopilot.name,
      description: autopilot.description,
      assigneeType: autopilot.assigneeType,
      assigneeId: autopilot.assigneeId,
      promptTemplate: autopilot.promptTemplate,
      executionMode: autopilot.executionMode,
      boardId: autopilot.boardId,
      projectId: autopilot.projectId,
      issueId: autopilot.issueId,
      status: autopilot.status,
      version: autopilot.version,
      quotaPeriod: autopilot.quotaPeriod,
      quotaMax: autopilot.quotaMax,
      accessMode: autopilot.accessMode,
      concurrencyPolicy: autopilot.concurrencyPolicy,
      maxTurns: autopilot.maxTurns,
      maxDurationMinutes: autopilot.maxDurationMinutes,
      maxChainDepth: autopilot.maxChainDepth,
      allowAgentEvents: autopilot.allowAgentEvents,
      templateKey: autopilot.templateKey,
      activity: autopilot.activity,
      createdBy: autopilot.createdBy,
      triggerKinds: autopilot.triggerKinds,
      createdAt: autopilot.createdAt,
      updatedAt: autopilot.updatedAt,
      archivedAt: autopilot.archivedAt,
   };
}

function serializeTrigger(trigger: AutopilotTrigger): Record<string, unknown> {
   return {
      id: trigger.id,
      autopilotId: trigger.autopilotId,
      kind: trigger.kind,
      enabled: trigger.enabled,
      eventType: trigger.eventType,
      conditions: trigger.conditions,
      cronExpression: trigger.cronExpression,
      timezone: trigger.timezone,
      nextFireAt: trigger.nextFireAt,
      lastFiredAt: trigger.lastFiredAt,
      tokenHint: trigger.tokenHint,
      eventFilters: trigger.eventFilters,
      createdAt: trigger.createdAt,
      updatedAt: trigger.updatedAt,
   };
}

/** A run record on the wire. Additive: every field the history tab read is still here. */
function serializeRun(run: AutopilotRunRecord): Record<string, unknown> {
   return {
      id: run.id,
      autopilotId: run.autopilotId,
      autopilotVersion: run.autopilotVersion,
      triggerId: run.triggerId,
      source: run.source,
      status: run.status,
      state: run.state,
      reasonCode: run.reasonCode,
      reasonMessage: run.reasonMessage,
      issueId: run.issueId,
      issueIdentifier: run.issueIdentifier,
      runId: run.runId,
      taskStatus: run.taskStatus,
      agentId: run.agentId,
      triggerEventId: run.triggerEventId,
      parentAutopilotRunId: run.parentAutopilotRunId,
      depth: run.depth,
      retryOf: run.retryOf,
      retriedBy: run.retriedBy,
      timedOutAt: run.timedOutAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      summary: run.summary,
      slot: run.slot,
      requestedBy: run.requestedBy,
      createdAt: run.createdAt,
   };
}

function mapRunError(error: unknown): never {
   throw toApiError(error, 'Loop run');
}

function secretResponse(trigger: AutopilotTrigger, secrets: WebhookSecrets, status: number): Response {
   const response = json(
      {
         trigger: serializeTrigger(trigger),
         secrets: {
            token: secrets.token,
            signingSecret: secrets.signingSecret,
            ingressPath: `/api/webhooks/autopilots/${secrets.token}`,
         },
      },
      status
   );
   response.headers.set('cache-control', 'no-store');
   return response;
}

async function readJson<T extends z.ZodType>(
   context: Context<{ Variables: AuthVariables }>,
   schema: T
): Promise<z.output<T>> {
   let raw: unknown;
   try {
      raw = await context.req.json();
   } catch {
      throw ApiError.badRequest('Request body must be one JSON object.');
   }
   const result = schema.safeParse(raw);
   if (!result.success) {
      assertValid(
         result.error.issues.map((issue) =>
            fieldError(`/${issue.path.map(String).join('/')}`, 'invalid_value', issue.message)
         )
      );
      throw ApiError.badRequest('The request is invalid.');
   }
   return result.data;
}

/** Every domain failure mapped once, here. */
function mapError(error: unknown): never {
   if (error instanceof InvalidAutopilot) {
      assertValid([fieldError(error.field, 'invalid_value', error.message)]);
   }
   if (error instanceof InvalidSchedule) {
      assertValid([fieldError('/expression', 'invalid_value', error.message)]);
   }
   if (error instanceof InvalidConditions) {
      assertValid([fieldError(error.field, 'invalid_value', error.message)]);
   }
   if (error instanceof SealingUnavailable) {
      throw new ApiError(
         412,
         'INTEGRATIONS_NOT_CONFIGURED',
         'This server has no encryption key, so it cannot hold a webhook signing secret.'
      );
   }
   throw toApiError(error, 'Autopilot');
}
