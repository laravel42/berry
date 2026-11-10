import { z } from 'zod';
import { BerryApiError, apiFetch } from './api';
import { newIdempotencyKey } from './api-schemas';
import type { EventEnvelope } from './events';

/**
 * Loops (stored and served as autopilots): an agent, instructions, and what
 * makes it run — a schedule, an event in Berry, a signed webhook, or a person
 * pressing "Run now". Each firing becomes one agent task. Shapes mirror
 * `server-ts/src/mounts/autopilots.ts`; see docs/adr/0020-loops.md.
 */

export const ASSIGNEE_TYPES = ['agent'] as const;
export const EXECUTION_MODES = ['create_issue', 'fixed_issue'] as const;
export const QUOTA_PERIODS = ['none', 'hour', 'day', 'week'] as const;
export const ACCESS_MODES = ['recommend', 'act'] as const;
export const CONCURRENCY_POLICIES = ['skip_if_running', 'allow'] as const;
export const TRIGGER_KINDS = ['cron', 'webhook', 'event'] as const;
export const RUN_SOURCES = ['cron', 'webhook', 'manual', 'replay', 'event', 'retry'] as const;
export const LOOP_RUN_STATES = [
   'queued',
   'running',
   'waiting_for_approval',
   'succeeded',
   'failed',
   'canceled',
   'timed_out',
   'skipped',
] as const;
export type LoopRunState = (typeof LOOP_RUN_STATES)[number];
export type AccessMode = (typeof ACCESS_MODES)[number];
export type ConcurrencyPolicy = (typeof CONCURRENCY_POLICIES)[number];

/** Events a Loop can listen for — exactly the ones the server emits. */
export const LOOP_EVENT_TYPES = [
   'issue.created',
   'issue.updated',
   'issue.status_changed',
   'issue.assigned',
   'issue.started',
   'issue.completed',
   'comment.created',
   'project.created',
   'project.updated',
   'run.completed',
   'run.failed',
   'approval.requested',
   'github.pull_request.updated',
] as const;
export type LoopEventType = (typeof LOOP_EVENT_TYPES)[number];

export const CONDITION_FIELDS = [
   'project',
   'status',
   'previousStatus',
   'priority',
   'label',
   'assigneeType',
   'assignee',
   'actorType',
   'actor',
   'changed',
   'pullRequestState',
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const conditionRuleSchema = z.object({
   field: z.enum(CONDITION_FIELDS),
   op: z.enum(['in', 'not_in']),
   values: z.array(z.string()),
});
export const conditionsSchema = z.object({
   match: z.enum(['all', 'any']).default('all'),
   rules: z.array(conditionRuleSchema).default([]),
});
export type ConditionRule = z.infer<typeof conditionRuleSchema>;
export type Conditions = z.infer<typeof conditionsSchema>;
export const EMPTY_CONDITIONS: Conditions = { match: 'all', rules: [] };

const runStateSchema = z.enum(LOOP_RUN_STATES);

/** What the list shows about each Loop's activity, without a request per row. */
export const activitySchema = z.object({
   lastRun: z.object({ id: z.string(), state: runStateSchema, createdAt: z.string() }).nullable(),
   nextFireAt: z.string().nullable(),
   runsLast7Days: z.number(),
   failedLast7Days: z.number(),
   eventTypes: z.array(z.string()),
});
export type LoopActivity = z.infer<typeof activitySchema>;
const NO_ACTIVITY: LoopActivity = {
   lastRun: null,
   nextFireAt: null,
   runsLast7Days: 0,
   failedLast7Days: 0,
   eventTypes: [],
};

export const autopilotSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   name: z.string(),
   description: z.string().nullable(),
   assigneeType: z.enum(ASSIGNEE_TYPES),
   assigneeId: z.string(),
   promptTemplate: z.string(),
   executionMode: z.enum(EXECUTION_MODES),
   boardId: z.string().nullable(),
   projectId: z.string().nullable().default(null),
   issueId: z.string().nullable(),
   status: z.enum(['active', 'paused', 'archived']),
   version: z.number(),
   quotaPeriod: z.enum(QUOTA_PERIODS),
   quotaMax: z.number().nullable(),
   accessMode: z.enum(ACCESS_MODES).default('act'),
   concurrencyPolicy: z.enum(CONCURRENCY_POLICIES).default('allow'),
   maxTurns: z.number().nullable().default(null),
   maxDurationMinutes: z.number().nullable().default(null),
   maxChainDepth: z.number().default(0),
   allowAgentEvents: z.boolean().default(false),
   templateKey: z.string().nullable().default(null),
   activity: activitySchema.default(NO_ACTIVITY),
   createdBy: z.string().nullable(),
   /** What makes it run, without fetching each autopilot's triggers in turn. */
   triggerKinds: z.array(z.enum(TRIGGER_KINDS)).default([]),
   createdAt: z.string(),
   updatedAt: z.string(),
   archivedAt: z.string().nullable().default(null),
});

export const autopilotTriggerSchema = z.object({
   id: z.string(),
   autopilotId: z.string(),
   kind: z.enum(TRIGGER_KINDS),
   enabled: z.boolean(),
   eventType: z.enum(LOOP_EVENT_TYPES).nullable().default(null),
   conditions: conditionsSchema.default(EMPTY_CONDITIONS),
   cronExpression: z.string().nullable(),
   timezone: z.string().nullable(),
   nextFireAt: z.string().nullable(),
   lastFiredAt: z.string().nullable(),
   tokenHint: z.string().nullable(),
   eventFilters: z.array(z.string()),
   createdAt: z.string(),
   updatedAt: z.string(),
});

export const autopilotDetailSchema = autopilotSchema.extend({
   triggers: z.array(autopilotTriggerSchema),
   members: z.array(
      z.object({
         userId: z.string(),
         role: z.enum(['collaborator', 'subscriber']),
         createdAt: z.string(),
      })
   ),
});

export const webhookSecretsSchema = z.object({
   token: z.string(),
   signingSecret: z.string(),
   ingressPath: z.string(),
});

export const autopilotRunSchema = z.object({
   id: z.string(),
   autopilotId: z.string(),
   autopilotVersion: z.number(),
   triggerId: z.string().nullable(),
   source: z.enum(RUN_SOURCES),
   status: z.enum(['pending', 'enqueued', 'skipped', 'failed']),
   /** Derived on the server from this record and the agent run. */
   state: runStateSchema.default('queued'),
   reasonCode: z.string().nullable(),
   reasonMessage: z.string().nullable(),
   issueId: z.string().nullable(),
   issueIdentifier: z.string().nullable().default(null),
   runId: z.string().nullable(),
   taskStatus: z.string().nullable(),
   agentId: z.string().nullable().default(null),
   triggerEventId: z.string().nullable().default(null),
   parentAutopilotRunId: z.string().nullable().default(null),
   depth: z.number().default(0),
   retryOf: z.string().nullable().default(null),
   retriedBy: z.string().nullable().default(null),
   timedOutAt: z.string().nullable().default(null),
   startedAt: z.string().nullable().default(null),
   completedAt: z.string().nullable().default(null),
   summary: z.string().nullable().default(null),
   slot: z.string().nullable(),
   requestedBy: z.string().nullable(),
   createdAt: z.string(),
});

export const loopRunDetailSchema = autopilotRunSchema.extend({
   autopilotName: z.string(),
   triggerKind: z.enum(TRIGGER_KINDS).nullable(),
   triggerPayload: z.unknown(),
   failureCode: z.string().nullable(),
   failureMessage: z.string().nullable(),
   usage: z
      .object({
         inputTokens: z.number(),
         outputTokens: z.number(),
         totalTokens: z.number(),
         costMicros: z.number().nullable(),
         currency: z.string().nullable(),
      })
      .nullable(),
   model: z.object({ runtime: z.string().nullable(), model: z.string().nullable() }).nullable(),
   children: z.array(
      z.object({
         id: z.string(),
         autopilotId: z.string(),
         autopilotName: z.string(),
         state: runStateSchema,
         createdAt: z.string(),
      })
   ),
});
export type LoopRunDetail = z.infer<typeof loopRunDetailSchema>;

export const workspaceRunSchema = autopilotRunSchema.extend({ autopilotName: z.string() });
export type WorkspaceLoopRun = z.infer<typeof workspaceRunSchema>;

export const eventReceiptSchema = z.object({
   id: z.string(),
   triggerId: z.string(),
   eventId: z.string(),
   topic: z.string(),
   status: z.enum(['pending', 'processing', 'fired', 'filtered', 'skipped', 'failed']),
   reasonCode: z.string().nullable(),
   autopilotRunId: z.string().nullable(),
   occurredAt: z.string(),
   receivedAt: z.string(),
});
export type EventReceipt = z.infer<typeof eventReceiptSchema>;

const suggestedAgentSchema = z
   .object({ id: z.string(), name: z.string(), roleKey: z.string() })
   .nullable();

const templateTriggerSchema = z.discriminatedUnion('kind', [
   z.object({ kind: z.literal('cron'), expression: z.string(), description: z.string() }),
   z.object({
      kind: z.literal('event'),
      eventType: z.enum(LOOP_EVENT_TYPES),
      conditions: conditionsSchema,
      description: z.string(),
   }),
]);
export type TemplateTrigger = z.infer<typeof templateTriggerSchema>;

export const loopTemplateSchema = z.object({
   key: z.string(),
   name: z.string(),
   description: z.string(),
   category: z.string(),
   instructions: z.string(),
   trigger: templateTriggerSchema,
   roles: z.array(z.string()),
   requires: z.array(z.string()),
   accessMode: z.enum(ACCESS_MODES),
   allowAgentEvents: z.boolean(),
   suggestedAgent: suggestedAgentSchema,
});
export type LoopTemplate = z.infer<typeof loopTemplateSchema>;

export const loopDraftSchema = z.object({
   name: z.string(),
   instructions: z.string(),
   trigger: templateTriggerSchema.nullable(),
   roles: z.array(z.string()),
   accessMode: z.literal('recommend'),
   allowAgentEvents: z.boolean(),
   notes: z.array(z.string()),
   source: z.enum(['model', 'rules']),
   suggestedAgent: suggestedAgentSchema,
});
export type LoopDraftSuggestion = z.infer<typeof loopDraftSchema>;

export const webhookDeliverySchema = z.object({
   id: z.string(),
   autopilotId: z.string(),
   triggerId: z.string().nullable(),
   event: z.string().nullable(),
   status: z.enum(['accepted', 'filtered', 'rejected', 'failed']),
   failureReason: z.string().nullable(),
   autopilotRunId: z.string().nullable(),
   replayOf: z.string().nullable(),
   receivedAt: z.string(),
});

export const fireOutcomeSchema = z.object({
   autopilotRunId: z.string(),
   status: z.enum(['enqueued', 'skipped', 'failed']),
   reasonCode: z.string().nullable(),
   runId: z.string().nullable(),
   issueId: z.string().nullable(),
});

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

export type Autopilot = z.infer<typeof autopilotSchema>;
export type AutopilotDetail = z.infer<typeof autopilotDetailSchema>;
export type AutopilotTrigger = z.infer<typeof autopilotTriggerSchema>;
export type AutopilotRun = z.infer<typeof autopilotRunSchema>;
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;
export type WebhookSecrets = z.infer<typeof webhookSecretsSchema>;
export type FireOutcome = z.infer<typeof fireOutcomeSchema>;

export interface AutopilotDraft {
   name: string;
   description: string | null;
   assigneeType: (typeof ASSIGNEE_TYPES)[number];
   assigneeId: string;
   promptTemplate: string;
   executionMode: (typeof EXECUTION_MODES)[number];
   boardId: string | null;
   projectId: string | null;
   issueId: string | null;
   quotaPeriod: (typeof QUOTA_PERIODS)[number];
   quotaMax: number | null;
   accessMode?: AccessMode;
   concurrencyPolicy?: ConcurrencyPolicy;
   maxTurns?: number | null;
   maxDurationMinutes?: number | null;
   maxChainDepth?: number;
   allowAgentEvents?: boolean;
   templateKey?: string | null;
}

export type AutopilotPatch = Partial<AutopilotDraft> & { status?: 'active' | 'paused' };

function parse<T extends z.ZodTypeAny>(schema: T, json: unknown, what: string): z.infer<T> {
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error(`${what} was not recognized`);
   return parsed.data;
}

const base = '/api/v1/autopilots';
const at = (id: string) => `${base}/${encodeURIComponent(id)}`;

function send(method: string, body: unknown, idempotent = false): RequestInit {
   return {
      method,
      headers: {
         'content-type': 'application/json',
         ...(idempotent ? { 'Idempotency-Key': newIdempotencyKey() } : {}),
      },
      body: JSON.stringify(body),
   };
}

export async function listAutopilots(
   workspaceId: string,
   options: { archived?: boolean; projectId?: string } = {}
): Promise<Autopilot[]> {
   const query = new URLSearchParams({ workspaceId });
   if (options.archived) query.set('archived', 'true');
   if (options.projectId) query.set('projectId', options.projectId);
   const json: unknown = await apiFetch(`${base}?${query.toString()}`);
   return parse(z.object({ nodes: z.array(autopilotSchema) }), json, 'Autopilot list').nodes;
}

export async function getAutopilot(id: string, signal?: AbortSignal): Promise<AutopilotDetail> {
   const json: unknown = await apiFetch(at(id), undefined, { signal });
   return parse(autopilotDetailSchema, json, 'Autopilot');
}

export async function createAutopilot(
   workspaceId: string,
   draft: AutopilotDraft,
   options: { status?: 'active' | 'paused' } = {}
): Promise<Autopilot> {
   const json: unknown = await apiFetch(
      base,
      send(
         'POST',
         { workspaceId, ...draft, ...(options.status ? { status: options.status } : {}) },
         true
      )
   );
   return parse(autopilotSchema, json, 'Created autopilot');
}

export async function updateAutopilot(id: string, patch: AutopilotPatch): Promise<Autopilot> {
   const json: unknown = await apiFetch(at(id), send('PATCH', patch));
   return parse(autopilotSchema, json, 'Updated autopilot');
}

export async function archiveAutopilot(id: string): Promise<void> {
   await apiFetch(at(id), { method: 'DELETE' });
}

export async function restoreAutopilot(id: string): Promise<Autopilot> {
   const json: unknown = await apiFetch(`${at(id)}/restore`, send('POST', {}));
   return parse(autopilotSchema, json, 'Restored autopilot');
}

export async function runAutopilot(id: string): Promise<FireOutcome> {
   const json: unknown = await apiFetch(`${at(id)}/run`, send('POST', {}, true));
   return parse(fireOutcomeSchema, json, 'Run');
}

export async function previewCron(
   expression: string,
   timezone: string,
   count = 5
): Promise<string[]> {
   const params = new URLSearchParams({ expression, timezone, count: String(count) });
   const json: unknown = await apiFetch(`${base}/cron-preview?${params.toString()}`);
   return parse(z.object({ times: z.array(z.string()) }), json, 'Schedule preview').times;
}

export async function addCronTrigger(
   id: string,
   input: { expression: string; timezone: string }
): Promise<AutopilotTrigger> {
   const json: unknown = await apiFetch(
      `${at(id)}/triggers`,
      send('POST', { kind: 'cron', ...input })
   );
   return parse(z.object({ trigger: autopilotTriggerSchema }), json, 'Schedule').trigger;
}

/** The secrets come back once. The caller must show them now; nothing can fetch them again. */
export async function addWebhookTrigger(
   id: string,
   eventFilters: string[]
): Promise<{ trigger: AutopilotTrigger; secrets: WebhookSecrets }> {
   const json: unknown = await apiFetch(
      `${at(id)}/triggers`,
      send('POST', { kind: 'webhook', eventFilters })
   );
   return parse(
      z.object({ trigger: autopilotTriggerSchema, secrets: webhookSecretsSchema }),
      json,
      'Webhook'
   );
}

export async function updateTrigger(
   id: string,
   triggerId: string,
   patch: {
      enabled?: boolean;
      expression?: string;
      timezone?: string;
      eventFilters?: string[];
      eventType?: LoopEventType;
      conditions?: Conditions;
   }
): Promise<AutopilotTrigger> {
   const json: unknown = await apiFetch(
      `${at(id)}/triggers/${encodeURIComponent(triggerId)}`,
      send('PATCH', patch)
   );
   return parse(autopilotTriggerSchema, json, 'Trigger');
}

export async function deleteTrigger(id: string, triggerId: string): Promise<void> {
   await apiFetch(`${at(id)}/triggers/${encodeURIComponent(triggerId)}`, { method: 'DELETE' });
}

export async function rotateWebhook(
   id: string,
   triggerId: string
): Promise<{ trigger: AutopilotTrigger; secrets: WebhookSecrets }> {
   const json: unknown = await apiFetch(
      `${at(id)}/triggers/${encodeURIComponent(triggerId)}/rotate`,
      send('POST', {})
   );
   return parse(
      z.object({ trigger: autopilotTriggerSchema, secrets: webhookSecretsSchema }),
      json,
      'Rotated webhook'
   );
}

/**
 * Who is kept in the loop. A collaborator may change the autopilot; a
 * subscriber only hears about it. The list replaces what was there.
 */
export async function setAutopilotMembers(
   id: string,
   members: Array<{ userId: string; role: 'collaborator' | 'subscriber' }>
): Promise<void> {
   await apiFetch(`${at(id)}/members`, send('PUT', { members }));
}

export async function listAutopilotRuns(id: string): Promise<AutopilotRun[]> {
   return (await listLoopRunsPage(id, { first: 50 })).nodes;
}

/** A page of a Loop's runs, newest first. Pass `endCursor` back as `after`. */
export async function listLoopRunsPage(
   id: string,
   page: { first?: number; after?: string | null } = {}
): Promise<{
   nodes: AutopilotRun[];
   pageInfo: { hasNextPage: boolean; endCursor: string | null };
}> {
   const query = new URLSearchParams();
   if (page.first) query.set('first', String(page.first));
   if (page.after) query.set('after', page.after);
   const suffix = query.toString() ? `?${query.toString()}` : '';
   const json: unknown = await apiFetch(`${at(id)}/runs${suffix}`);
   const parsed = parse(
      z.object({
         nodes: z.array(autopilotRunSchema),
         pageInfo: pageInfoSchema.default({ hasNextPage: false, endCursor: null }),
      }),
      json,
      'Runs'
   );
   return parsed;
}

export async function getLoopRun(
   id: string,
   runId: string,
   signal?: AbortSignal
): Promise<LoopRunDetail> {
   const json: unknown = await apiFetch(`${at(id)}/runs/${encodeURIComponent(runId)}`, undefined, {
      signal,
   });
   return parse(loopRunDetailSchema, json, 'Loop run');
}

/** Retry once, on the same task. A second press answers 409 ALREADY_RETRIED. */
export async function retryLoopRun(id: string, runId: string): Promise<FireOutcome> {
   const json: unknown = await apiFetch(
      `${at(id)}/runs/${encodeURIComponent(runId)}/retry`,
      send('POST', {})
   );
   return parse(fireOutcomeSchema, json, 'Retry');
}

export async function cancelLoopRun(id: string, runId: string): Promise<AutopilotRun> {
   const json: unknown = await apiFetch(
      `${at(id)}/runs/${encodeURIComponent(runId)}/cancel`,
      send('POST', {})
   );
   return parse(autopilotRunSchema, json, 'Cancelled run');
}

export async function listEventReceipts(id: string): Promise<EventReceipt[]> {
   const json: unknown = await apiFetch(`${at(id)}/receipts`);
   return parse(z.object({ nodes: z.array(eventReceiptSchema) }), json, 'Events').nodes;
}

export async function duplicateAutopilot(id: string): Promise<Autopilot> {
   const json: unknown = await apiFetch(`${at(id)}/duplicate`, send('POST', {}, true));
   return parse(autopilotSchema, json, 'Duplicated loop');
}

export async function listLoopTemplates(workspaceId: string): Promise<LoopTemplate[]> {
   const query = new URLSearchParams({ workspaceId });
   const json: unknown = await apiFetch(`${base}/templates?${query.toString()}`);
   return parse(z.object({ nodes: z.array(loopTemplateSchema) }), json, 'Templates').nodes;
}

/** A suggested configuration for a sentence. Nothing is saved. */
export async function draftLoop(
   workspaceId: string,
   prompt: string,
   signal?: AbortSignal
): Promise<LoopDraftSuggestion> {
   const json: unknown = await apiFetch(`${base}/draft`, {
      ...send('POST', { workspaceId, prompt }),
      signal,
   });
   return parse(loopDraftSchema, json, 'Loop draft');
}

export async function listLoopActivity(
   workspaceId: string,
   options: { attention?: boolean } = {}
): Promise<WorkspaceLoopRun[]> {
   const query = new URLSearchParams({ workspaceId });
   if (options.attention) query.set('attention', 'true');
   const json: unknown = await apiFetch(`${base}/activity?${query.toString()}`);
   return parse(z.object({ nodes: z.array(workspaceRunSchema) }), json, 'Activity').nodes;
}

export async function addEventTrigger(
   id: string,
   input: { eventType: LoopEventType; conditions: Conditions }
): Promise<AutopilotTrigger> {
   const json: unknown = await apiFetch(
      `${at(id)}/triggers`,
      send('POST', { kind: 'event', ...input })
   );
   return parse(z.object({ trigger: autopilotTriggerSchema }), json, 'Event trigger').trigger;
}

/** Checks an event type and its filters as the server will store them. */
export async function validateEventTrigger(
   eventType: LoopEventType,
   conditions: Conditions
): Promise<Conditions> {
   const json: unknown = await apiFetch(
      `${base}/validate-trigger`,
      send('POST', { kind: 'event', eventType, conditions })
   );
   return parse(z.object({ conditions: conditionsSchema }), json, 'Trigger check').conditions;
}

export async function listWebhookDeliveries(id: string): Promise<WebhookDelivery[]> {
   const json: unknown = await apiFetch(`${at(id)}/deliveries`);
   return parse(z.object({ nodes: z.array(webhookDeliverySchema) }), json, 'Deliveries').nodes;
}

export const webhookDeliveryDetailSchema = webhookDeliverySchema.extend({ payload: z.unknown() });
export type WebhookDeliveryDetail = z.infer<typeof webhookDeliveryDetailSchema>;

export async function getWebhookDelivery(
   id: string,
   deliveryId: string
): Promise<WebhookDeliveryDetail> {
   const json: unknown = await apiFetch(`${at(id)}/deliveries/${encodeURIComponent(deliveryId)}`);
   return parse(webhookDeliveryDetailSchema, json, 'Delivery');
}

export async function replayDelivery(id: string, deliveryId: string): Promise<FireOutcome> {
   const json: unknown = await apiFetch(
      `${at(id)}/deliveries/${encodeURIComponent(deliveryId)}/replay`,
      send('POST', {}, true)
   );
   return parse(fireOutcomeSchema, json, 'Replay');
}

/** A message a person can act on; the thrown error keeps the detail. */
export function describeAutopilotFailure(error: unknown): string {
   if (error instanceof BerryApiError) {
      if (error.status === 404) return 'This loop does not exist, or is in another workspace.';
      if (error.status === 403) return 'Your role cannot change loops in this workspace.';
      if (error.code === 'ALREADY_RETRIED') return 'This run was already retried.';
      if (error.code === 'RUN_NOT_RETRYABLE') return error.message;
      if (error.code === 'RUN_TERMINAL') return 'This run has already finished.';
      if (error.code === 'INTEGRATIONS_NOT_CONFIGURED') {
         return 'This server has no encryption key, so it cannot keep a webhook secret.';
      }
      return error.message;
   }
   return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Whether a stream frame is about autopilots — and, given an id, about that one. */
export function isAutopilotEvent(event: EventEnvelope, autopilotId?: string): boolean {
   if (!event.type.startsWith('autopilot.')) return false;
   if (!autopilotId) return true;
   const payload = event.payload;
   if (typeof payload !== 'object' || payload === null) return false;
   return (payload as { autopilotId?: unknown }).autopilotId === autopilotId;
}

/** Reads a stored reason code the way the run history shows it. */
export function describeReason(code: string | null): string {
   switch (code) {
      case null:
         return '';
      case 'PAUSED':
         return 'Paused';
      case 'ARCHIVED':
         return 'Archived';
      case 'QUOTA_EXCEEDED':
         return 'Over quota';
      case 'ASSIGNEE_UNAVAILABLE':
         return 'No agent assigned';
      case 'TARGET_MISSING':
         return 'Task or board gone';
      case 'ENQUEUE_FAILED':
         return 'Could not queue';
      case 'ALREADY_RUNNING':
         return 'Already running';
      case 'CHAIN_TOO_DEEP':
         return 'Chain limit';
      case 'RATE_LIMITED':
         return 'Too many events';
      case 'LOOP_CYCLE':
         return 'Its own work';
      case 'AGENT_EVENT':
         return 'Caused by an agent';
      case 'FILTERS':
         return 'Filtered out';
      case 'OTHER_CHANGE':
         return 'Other change';
      case 'TRIGGER_OFF':
         return 'Trigger off';
      case 'EVENT_GONE':
         return 'Event expired';
      case 'INVALID_FILTERS':
         return 'Filters invalid';
      case 'GAVE_UP':
         return 'Gave up';
      default:
         return code;
   }
}
