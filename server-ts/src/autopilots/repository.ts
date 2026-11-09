import { toRFC3339, type Sql } from '../db/pool.ts';
import { NotFound } from '../identity/errors.ts';
import type { Sealer } from '../integrations/sealing.ts';
import { assertSchedule, nextFireAfter } from './cron.ts';
import { writeAutopilotEvent } from './events.ts';
import {
   EMPTY_CONDITIONS,
   InvalidConditions,
   isLoopEventKey,
   parseConditions,
   type Conditions,
   type LoopEventKey,
} from './event-triggers.ts';
import { MAX_CHAIN_DEPTH, type AccessMode, type ConcurrencyPolicy } from './policy.ts';
import { loopRunState, type LoopRunState } from './run-state.ts';
import type { TimeCursor } from '../http/cursor.ts';
import { hashToken, newSigningSecret, newWebhookToken, tokenHint } from './signing.ts';

/**
 * Autopilots, their triggers, and the record of what they did.
 *
 * Every method takes the workspace the caller was confirmed in and puts it in
 * the WHERE clause, so a row in another workspace is simply not there
 * (`NotFound`), never "there but forbidden".
 *
 * Secrets: a webhook's token is kept as a hash and its signing secret sealed.
 * Both are returned in plaintext exactly once — from the call that made them
 * — and no read path can produce them again.
 */

export const ASSIGNEE_TYPES = ['agent'] as const;
export const EXECUTION_MODES = ['create_issue', 'fixed_issue'] as const;
export const QUOTA_PERIODS = ['none', 'hour', 'day', 'week'] as const;

export type AssigneeType = (typeof ASSIGNEE_TYPES)[number];
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];
export type AutopilotStatus = 'active' | 'paused' | 'archived';
export type RunSource = 'cron' | 'webhook' | 'manual' | 'replay' | 'event' | 'retry';
export type TriggerKind = 'cron' | 'webhook' | 'event';
export type RunStatus = 'pending' | 'enqueued' | 'skipped' | 'failed';
export type DeliveryStatus = 'accepted' | 'filtered' | 'rejected' | 'failed';
export type MemberRole = 'collaborator' | 'subscriber';

export interface AutopilotDraft {
   name: string;
   description: string | null;
   assigneeType: AssigneeType;
   assigneeId: string;
   promptTemplate: string;
   executionMode: ExecutionMode;
   boardId: string | null;
   /** create_issue: the project each run's task is filed under, or none. */
   projectId: string | null;
   issueId: string | null;
   quotaPeriod: QuotaPeriod;
   quotaMax: number | null;
   /** recommend: report and propose; act: the agent's own reach. Never more. */
   accessMode: AccessMode;
   concurrencyPolicy: ConcurrencyPolicy;
   maxTurns: number | null;
   maxDurationMinutes: number | null;
   maxChainDepth: number;
   allowAgentEvents: boolean;
   templateKey: string | null;
}

type PolicyKey =
   | 'accessMode'
   | 'concurrencyPolicy'
   | 'maxTurns'
   | 'maxDurationMinutes'
   | 'maxChainDepth'
   | 'allowAgentEvents'
   | 'templateKey';

/** A draft as a caller may give it: the Loop policy fields default to the safe ones. */
export type AutopilotDraftInput = Omit<AutopilotDraft, PolicyKey> & Partial<Pick<AutopilotDraft, PolicyKey>>;

/**
 * The defaults a new Loop gets: recommend, one run at a time, no chains, no
 * agent-caused events, no extra limits. Existing autopilots kept what they
 * had when migration 257 added these (act, allow).
 */
export function withLoopDefaults(input: AutopilotDraftInput): AutopilotDraft {
   return {
      ...input,
      accessMode: input.accessMode ?? 'recommend',
      concurrencyPolicy: input.concurrencyPolicy ?? 'skip_if_running',
      maxTurns: input.maxTurns ?? null,
      maxDurationMinutes: input.maxDurationMinutes ?? null,
      maxChainDepth: input.maxChainDepth ?? 0,
      allowAgentEvents: input.allowAgentEvents ?? false,
      templateKey: input.templateKey ?? null,
   };
}

/** What the list shows about a Loop's activity, read with the Loop in one query. */
export interface AutopilotActivity {
   lastRun: { id: string; state: LoopRunState; createdAt: string } | null;
   nextFireAt: string | null;
   runsLast7Days: number;
   failedLast7Days: number;
   eventTypes: string[];
}

export interface Autopilot extends AutopilotDraft {
   id: string;
   workspaceId: string;
   status: AutopilotStatus;
   version: number;
   createdBy: string | null;
   /**
    * What makes it run, so a list can be filtered by it without asking after
    * each autopilot's triggers in turn. Empty when only a person can fire it.
    */
   triggerKinds: TriggerKind[];
   activity: AutopilotActivity;
   createdAt: string;
   updatedAt: string;
   archivedAt: string | null;
}

/**
 * A partial change. `undefined` means "not given", the same as absent: a
 * parsed request body carries every optional key it did not receive.
 */
export interface AutopilotPatch {
   name?: string | undefined;
   description?: string | null | undefined;
   assigneeType?: AssigneeType | undefined;
   assigneeId?: string | undefined;
   promptTemplate?: string | undefined;
   executionMode?: ExecutionMode | undefined;
   boardId?: string | null | undefined;
   projectId?: string | null | undefined;
   issueId?: string | null | undefined;
   quotaPeriod?: QuotaPeriod | undefined;
   quotaMax?: number | null | undefined;
   accessMode?: AccessMode | undefined;
   concurrencyPolicy?: ConcurrencyPolicy | undefined;
   maxTurns?: number | null | undefined;
   maxDurationMinutes?: number | null | undefined;
   maxChainDepth?: number | undefined;
   allowAgentEvents?: boolean | undefined;
   templateKey?: string | null | undefined;
   status?: 'active' | 'paused' | undefined;
}

export interface AutopilotVersion {
   version: number;
   snapshot: AutopilotDraft;
   createdBy: string | null;
   createdAt: string;
}

export interface AutopilotMember {
   userId: string;
   role: MemberRole;
   createdAt: string;
}

export interface AutopilotTrigger {
   id: string;
   autopilotId: string;
   kind: TriggerKind;
   /** Event triggers: the Loop event type, and the filters on it. */
   eventType: LoopEventKey | null;
   conditions: Conditions;
   enabled: boolean;
   cronExpression: string | null;
   timezone: string | null;
   nextFireAt: string | null;
   lastFiredAt: string | null;
   tokenHint: string | null;
   eventFilters: string[];
   createdAt: string;
   updatedAt: string;
}

export interface TriggerPatch {
   enabled?: boolean | undefined;
   expression?: string | undefined;
   timezone?: string | undefined;
   eventFilters?: string[] | undefined;
   eventType?: string | undefined;
   conditions?: unknown;
}

export interface WebhookSecrets {
   token: string;
   signingSecret: string;
}

export interface AutopilotRunRecord {
   id: string;
   autopilotId: string;
   autopilotVersion: number;
   triggerId: string | null;
   source: RunSource;
   status: RunStatus;
   reasonCode: string | null;
   reasonMessage: string | null;
   issueId: string | null;
   runId: string | null;
   taskStatus: string | null;
   /** Derived from this record and the agent run (run-state.ts). */
   state: LoopRunState;
   triggerEventId: string | null;
   parentAutopilotRunId: string | null;
   depth: number;
   retryOf: string | null;
   retriedBy: string | null;
   timedOutAt: string | null;
   issueIdentifier: string | null;
   agentId: string | null;
   startedAt: string | null;
   completedAt: string | null;
   summary: string | null;
   slot: string | null;
   requestedBy: string | null;
   createdAt: string;
}

/** One run with what its inspection page shows beside the transcript. */
export interface AutopilotRunDetail extends AutopilotRunRecord {
   autopilotName: string;
   triggerKind: TriggerKind | null;
   triggerPayload: unknown;
   failureCode: string | null;
   failureMessage: string | null;
   usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costMicros: number | null;
      currency: string | null;
   } | null;
   model: { runtime: string | null; model: string | null } | null;
   children: Array<{ id: string; autopilotId: string; autopilotName: string; state: LoopRunState; createdAt: string }>;
}

/** A run across every Loop of a workspace, for the overview's activity and attention lists. */
export interface WorkspaceRunRecord extends AutopilotRunRecord {
   autopilotName: string;
}

export interface EventReceiptRecord {
   id: string;
   triggerId: string;
   eventId: string;
   topic: string;
   status: 'pending' | 'processing' | 'fired' | 'filtered' | 'skipped' | 'failed';
   reasonCode: string | null;
   autopilotRunId: string | null;
   occurredAt: string;
   receivedAt: string;
}

export interface WebhookDeliveryRecord {
   id: string;
   autopilotId: string;
   triggerId: string | null;
   event: string | null;
   status: DeliveryStatus;
   failureReason: string | null;
   autopilotRunId: string | null;
   replayOf: string | null;
   receivedAt: string;
}

/** A definition this workspace cannot hold. `field` is a JSON pointer into the request. */
export class InvalidAutopilot extends Error {
   override readonly name = 'InvalidAutopilot';
   readonly field: string;

   constructor(field: string, message: string) {
      super(message);
      this.field = field;
   }
}

const HISTORY_LIMIT = 100;

type Row = Record<string, unknown>;

export class AutopilotRepository {
   readonly #sql: Sql;
   readonly #sealer: Sealer;
   readonly #clock: () => Date;

   constructor(options: { sql: Sql; sealer: Sealer; clock?: () => Date }) {
      this.#sql = options.sql;
      this.#sealer = options.sealer;
      this.#clock = options.clock ?? (() => new Date());
   }

   /** The workspace an autopilot belongs to, for a route that only has its id. */
   async workspaceOf(autopilotId: string): Promise<string> {
      const [row] = await this.#sql`SELECT workspace_id FROM autopilots WHERE id = ${autopilotId}`;
      if (!row) throw new NotFound();
      return row.workspace_id as string;
   }

   async list(workspaceId: string, filter: { archived?: boolean; projectId?: string | null } = {}): Promise<Autopilot[]> {
      const rows = await this.#sql`
         SELECT a.*, ${this.#sql.unsafe(TRIGGER_KINDS)}, ${this.#sql.unsafe(ACTIVITY)} FROM autopilots AS a
          WHERE a.workspace_id = ${workspaceId}
            AND (${filter.archived ?? false}::boolean = (a.archived_at IS NOT NULL))
            AND (${filter.projectId ?? null}::uuid IS NULL OR a.project_id = ${filter.projectId ?? null}::uuid)
          ORDER BY a.updated_at DESC, a.id DESC
          LIMIT 500`;
      return rows.map(toAutopilot);
   }

   async get(workspaceId: string, autopilotId: string): Promise<Autopilot> {
      const [row] = await this.#sql`
         SELECT a.*, ${this.#sql.unsafe(TRIGGER_KINDS)}, ${this.#sql.unsafe(ACTIVITY)} FROM autopilots AS a
          WHERE a.workspace_id = ${workspaceId} AND a.id = ${autopilotId}`;
      if (!row) throw new NotFound();
      return toAutopilot(row);
   }

   async create(
      workspaceId: string,
      input: AutopilotDraftInput,
      actorId: string,
      options: { status?: 'active' | 'paused' } = {}
   ): Promise<Autopilot> {
      const draft = withLoopDefaults(input);
      const now = this.#clock().toISOString();
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         await validateDraft(tx, workspaceId, draft);
         const [row] = await tx`
            INSERT INTO autopilots (
               workspace_id, name, description, assignee_type, assignee_id, prompt_template,
               execution_mode, board_id, project_id, issue_id, quota_period, quota_max, created_by,
               created_at, updated_at, access_mode, concurrency_policy, max_turns, max_duration_minutes,
               max_chain_depth, allow_agent_events, template_key, status
            ) VALUES (
               ${workspaceId}, ${draft.name}, ${draft.description}, ${draft.assigneeType},
               ${draft.assigneeId}, ${draft.promptTemplate}, ${draft.executionMode},
               ${draft.boardId}, ${draft.projectId}, ${draft.issueId}, ${draft.quotaPeriod}, ${draft.quotaMax},
               ${actorId}, ${now}, ${now}, ${draft.accessMode}, ${draft.concurrencyPolicy}, ${draft.maxTurns},
               ${draft.maxDurationMinutes}, ${draft.maxChainDepth}, ${draft.allowAgentEvents}, ${draft.templateKey},
               ${options.status ?? 'active'}
            ) RETURNING *`;
         if (!row) throw new Error('autopilot insert returned no row');
         const autopilot = toAutopilot(row);
         await writeVersion(tx, autopilot, actorId, now);
         await writeAutopilotEvent(tx, {
            workspaceId,
            topic: 'autopilot.created',
            autopilotId: autopilot.id,
            payload: { name: autopilot.name, version: autopilot.version },
            occurredAt: now,
         });
         return autopilot;
      }) as Promise<Autopilot>;
   }

   /**
    * A definition change and a status change in one call.
    *
    * Only the definition bumps the version: pausing is an operating decision,
    * not a new rule, and the versions list is a history of what the
    * autopilot was told to do.
    */
   async update(
      workspaceId: string,
      autopilotId: string,
      patch: AutopilotPatch,
      actorId: string
   ): Promise<Autopilot> {
      const now = this.#clock().toISOString();
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [locked] = await tx`
            SELECT * FROM autopilots
             WHERE workspace_id = ${workspaceId} AND id = ${autopilotId} AND archived_at IS NULL
             FOR UPDATE`;
         if (!locked) throw new NotFound();
         const current = toAutopilot(locked);
         const before = draftOf(current);
         const next: AutopilotDraft = {
            name: patch.name ?? before.name,
            description: patch.description === undefined ? before.description : patch.description,
            assigneeType: patch.assigneeType ?? before.assigneeType,
            assigneeId: patch.assigneeId ?? before.assigneeId,
            promptTemplate: patch.promptTemplate ?? before.promptTemplate,
            executionMode: patch.executionMode ?? before.executionMode,
            boardId: patch.boardId === undefined ? before.boardId : patch.boardId,
            projectId: patch.projectId === undefined ? before.projectId : patch.projectId,
            issueId: patch.issueId === undefined ? before.issueId : patch.issueId,
            quotaPeriod: patch.quotaPeriod ?? before.quotaPeriod,
            quotaMax: patch.quotaMax === undefined ? before.quotaMax : patch.quotaMax,
            accessMode: patch.accessMode ?? before.accessMode,
            concurrencyPolicy: patch.concurrencyPolicy ?? before.concurrencyPolicy,
            maxTurns: patch.maxTurns === undefined ? before.maxTurns : patch.maxTurns,
            maxDurationMinutes: patch.maxDurationMinutes === undefined ? before.maxDurationMinutes : patch.maxDurationMinutes,
            maxChainDepth: patch.maxChainDepth ?? before.maxChainDepth,
            allowAgentEvents: patch.allowAgentEvents ?? before.allowAgentEvents,
            templateKey: patch.templateKey === undefined ? before.templateKey : patch.templateKey,
         };
         const changed = JSON.stringify(next) !== JSON.stringify(before);
         if (changed) await validateDraft(tx, workspaceId, next);
         const status = patch.status ?? current.status;
         const version = changed ? current.version + 1 : current.version;

         const [row] = await tx`
            UPDATE autopilots
               SET name = ${next.name}, description = ${next.description},
                   assignee_type = ${next.assigneeType}, assignee_id = ${next.assigneeId},
                   prompt_template = ${next.promptTemplate}, execution_mode = ${next.executionMode},
                   board_id = ${next.boardId}, project_id = ${next.projectId}, issue_id = ${next.issueId},
                   quota_period = ${next.quotaPeriod}, quota_max = ${next.quotaMax},
                   access_mode = ${next.accessMode}, concurrency_policy = ${next.concurrencyPolicy},
                   max_turns = ${next.maxTurns}, max_duration_minutes = ${next.maxDurationMinutes},
                   max_chain_depth = ${next.maxChainDepth}, allow_agent_events = ${next.allowAgentEvents},
                   template_key = ${next.templateKey},
                   status = ${status}, version = ${version}, updated_at = ${now}
             WHERE id = ${autopilotId}
             RETURNING *`;
         if (!row) throw new NotFound();
         const updated = toAutopilot(row);
         if (changed) await writeVersion(tx, updated, actorId, now);
         // Resuming starts the schedule from now. Without this, every slot
         // that passed while paused would look due, and the first tick after
         // resume would fire one of them as if it were on time.
         if (current.status === 'paused' && status === 'active') {
            await rescheduleCron(tx, autopilotId, new Date(now));
         }
         await writeAutopilotEvent(tx, {
            workspaceId,
            topic: 'autopilot.updated',
            autopilotId,
            payload: { version, status },
            occurredAt: now,
         });
         return updated;
      }) as Promise<Autopilot>;
   }

   async archive(workspaceId: string, autopilotId: string, actorId: string): Promise<void> {
      const now = this.#clock().toISOString();
      await this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [row] = await tx`
            UPDATE autopilots SET status = 'archived', archived_at = ${now}, updated_at = ${now}
             WHERE workspace_id = ${workspaceId} AND id = ${autopilotId} AND archived_at IS NULL
             RETURNING id`;
         if (!row) throw new NotFound();
         await writeAutopilotEvent(tx, {
            workspaceId,
            topic: 'autopilot.archived',
            autopilotId,
            payload: { archivedBy: actorId },
            occurredAt: now,
         });
      });
   }

   /**
    * Comes back paused so it does not fire the first slot that passed while
    * it was archived. A person turns it on again.
    */
   async restore(workspaceId: string, autopilotId: string, actorId: string): Promise<Autopilot> {
      const now = this.#clock().toISOString();
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [row] = await tx`
            UPDATE autopilots SET status = 'paused', archived_at = NULL, updated_at = ${now}
             WHERE workspace_id = ${workspaceId} AND id = ${autopilotId} AND archived_at IS NOT NULL
             RETURNING *`;
         if (!row) throw new NotFound();
         await writeAutopilotEvent(tx, {
            workspaceId,
            topic: 'autopilot.updated',
            autopilotId,
            payload: { status: 'paused', restoredBy: actorId },
            occurredAt: now,
         });
         return toAutopilot(row);
      }) as Promise<Autopilot>;
   }

   async versions(workspaceId: string, autopilotId: string): Promise<AutopilotVersion[]> {
      await this.get(workspaceId, autopilotId);
      const rows = await this.#sql`
         SELECT version, snapshot, created_by, created_at FROM autopilot_versions
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
          ORDER BY version DESC`;
      return rows.map((row) => ({
         version: row.version as number,
         snapshot: row.snapshot as AutopilotDraft,
         createdBy: (row.created_by as string | null) ?? null,
         createdAt: toRFC3339(row.created_at as string) ?? '',
      }));
   }

   async members(workspaceId: string, autopilotId: string): Promise<AutopilotMember[]> {
      const rows = await this.#sql`
         SELECT user_id, role, created_at FROM autopilot_members
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
          ORDER BY created_at, user_id`;
      return rows.map(toMember);
   }

   /** Replaces the whole list: the settings form edits it as one thing. */
   async setMembers(
      workspaceId: string,
      autopilotId: string,
      members: { userId: string; role: MemberRole }[]
   ): Promise<AutopilotMember[]> {
      const byUser = new Map(members.map((member) => [member.userId, member.role]));
      const ids = [...byUser.keys()];
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         await lockOwned(tx, workspaceId, autopilotId);
         if (ids.length > 0) {
            const found = await tx`
               SELECT user_id FROM workspace_memberships
                WHERE workspace_id = ${workspaceId} AND user_id = ANY(${ids}::uuid[])`;
            if (found.length !== ids.length) {
               throw new InvalidAutopilot('/members', 'Every member must belong to this workspace.');
            }
         }
         await tx`DELETE FROM autopilot_members WHERE autopilot_id = ${autopilotId}`;
         for (const [userId, role] of byUser) {
            await tx`
               INSERT INTO autopilot_members (workspace_id, autopilot_id, user_id, role)
               VALUES (${workspaceId}, ${autopilotId}, ${userId}, ${role})`;
         }
         const rows = await tx`
            SELECT user_id, role, created_at FROM autopilot_members
             WHERE autopilot_id = ${autopilotId} ORDER BY created_at, user_id`;
         return rows.map(toMember);
      }) as Promise<AutopilotMember[]>;
   }

   async triggers(workspaceId: string, autopilotId: string): Promise<AutopilotTrigger[]> {
      const rows = await this.#sql`
         SELECT * FROM autopilot_triggers
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
          ORDER BY created_at, id`;
      return rows.map(toTrigger);
   }

   async addCronTrigger(
      workspaceId: string,
      autopilotId: string,
      input: { expression: string; timezone: string; enabled: boolean }
   ): Promise<AutopilotTrigger> {
      const expression = input.expression.trim();
      assertSchedule(expression, input.timezone);
      const next = input.enabled ? nextFireAfter(expression, input.timezone, this.#clock()) : null;
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         await lockOwned(tx, workspaceId, autopilotId);
         const [row] = await tx`
            INSERT INTO autopilot_triggers (
               workspace_id, autopilot_id, kind, enabled, cron_expression, timezone, next_fire_at
            ) VALUES (
               ${workspaceId}, ${autopilotId}, 'cron', ${input.enabled}, ${expression},
               ${input.timezone}, ${next ? next.toISOString() : null}
            ) RETURNING *`;
         if (!row) throw new Error('trigger insert returned no row');
         return toTrigger(row);
      }) as Promise<AutopilotTrigger>;
   }

   async addWebhookTrigger(
      workspaceId: string,
      autopilotId: string,
      input: { eventFilters: string[]; enabled: boolean }
   ): Promise<{ trigger: AutopilotTrigger; secrets: WebhookSecrets }> {
      const secrets = { token: newWebhookToken(), signingSecret: newSigningSecret() };
      // Sealed before anything is written: a server with no key refuses here
      // (SealingUnavailable) rather than after a half-made trigger exists.
      const sealed = this.#sealer.seal(secrets.signingSecret);
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         await lockOwned(tx, workspaceId, autopilotId);
         const [row] = await tx`
            INSERT INTO autopilot_triggers (
               workspace_id, autopilot_id, kind, enabled, webhook_token_hash,
               webhook_token_hint, signing_secret_sealed, event_filters
            ) VALUES (
               ${workspaceId}, ${autopilotId}, 'webhook', ${input.enabled},
               ${hashToken(secrets.token)}, ${tokenHint(secrets.token)}, ${sealed},
               ${input.eventFilters}::text[]
            ) RETURNING *`;
         if (!row) throw new Error('trigger insert returned no row');
         return { trigger: toTrigger(row), secrets };
      }) as Promise<{ trigger: AutopilotTrigger; secrets: WebhookSecrets }>;
   }

   async updateTrigger(
      workspaceId: string,
      autopilotId: string,
      triggerId: string,
      patch: TriggerPatch
   ): Promise<AutopilotTrigger> {
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [locked] = await tx`
            SELECT * FROM autopilot_triggers
             WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId} AND id = ${triggerId}
             FOR UPDATE`;
         if (!locked) throw new NotFound();
         const current = toTrigger(locked);
         const enabled = patch.enabled ?? current.enabled;

         if (current.kind === 'cron') {
            if (patch.eventType !== undefined || patch.conditions !== undefined) {
               throw new InvalidAutopilot('/eventType', 'A schedule has no event.');
            }
            if (patch.eventFilters !== undefined) {
               throw new InvalidAutopilot('/eventFilters', 'A schedule has no event filters.');
            }
            const expression = (patch.expression ?? current.cronExpression ?? '').trim();
            const timezone = patch.timezone ?? current.timezone ?? 'UTC';
            assertSchedule(expression, timezone);
            const next = enabled ? nextFireAfter(expression, timezone, this.#clock()) : null;
            const [row] = await tx`
               UPDATE autopilot_triggers
                  SET enabled = ${enabled}, cron_expression = ${expression}, timezone = ${timezone},
                      next_fire_at = ${next ? next.toISOString() : null}
                WHERE id = ${triggerId} RETURNING *`;
            if (!row) throw new NotFound();
            return toTrigger(row);
         }

         if (current.kind === 'event') {
            if (patch.expression !== undefined || patch.timezone !== undefined || patch.eventFilters !== undefined) {
               throw new InvalidAutopilot('/expression', 'An event trigger has no schedule and no webhook filters.');
            }
            const eventType = patch.eventType ?? current.eventType ?? '';
            if (!isLoopEventKey(eventType)) {
               throw new InvalidAutopilot('/eventType', 'That is not an event a loop can listen for.');
            }
            const conditions = conditionsOrInvalid(eventType, patch.conditions === undefined ? current.conditions : patch.conditions);
            const [row] = await tx`
               UPDATE autopilot_triggers
                  SET enabled = ${enabled}, event_type = ${eventType}, conditions = ${tx.json(conditions as never)}
                WHERE id = ${triggerId} RETURNING *`;
            if (!row) throw new NotFound();
            return toTrigger(row);
         }

         if (patch.eventType !== undefined || patch.conditions !== undefined) {
            throw new InvalidAutopilot('/eventType', 'Only an event trigger has an event type.');
         }
         if (patch.expression !== undefined || patch.timezone !== undefined) {
            throw new InvalidAutopilot('/expression', 'A webhook has no schedule.');
         }
         const [row] = await tx`
            UPDATE autopilot_triggers
               SET enabled = ${enabled},
                   event_filters = ${patch.eventFilters ?? current.eventFilters}::text[]
             WHERE id = ${triggerId} RETURNING *`;
         if (!row) throw new NotFound();
         return toTrigger(row);
      }) as Promise<AutopilotTrigger>;
   }

   /** New token and new secret together: a leaked URL and a leaked secret are the same incident. */
   async rotateWebhook(
      workspaceId: string,
      autopilotId: string,
      triggerId: string
   ): Promise<{ trigger: AutopilotTrigger; secrets: WebhookSecrets }> {
      const secrets = { token: newWebhookToken(), signingSecret: newSigningSecret() };
      const sealed = this.#sealer.seal(secrets.signingSecret);
      const [row] = await this.#sql`
         UPDATE autopilot_triggers
            SET webhook_token_hash = ${hashToken(secrets.token)},
                webhook_token_hint = ${tokenHint(secrets.token)},
                signing_secret_sealed = ${sealed}
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
            AND id = ${triggerId} AND kind = 'webhook'
          RETURNING *`;
      if (!row) throw new NotFound();
      return { trigger: toTrigger(row), secrets };
   }

   async deleteTrigger(workspaceId: string, autopilotId: string, triggerId: string): Promise<void> {
      const rows = await this.#sql`
         DELETE FROM autopilot_triggers
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId} AND id = ${triggerId}
          RETURNING id`;
      if (rows.length === 0) throw new NotFound();
   }

   /**
    * A Loop's runs, newest first, a page at a time. `limit` defaults to the
    * history the detail page has always shown.
    */
   async runs(
      workspaceId: string,
      autopilotId: string,
      page: { after?: TimeCursor | null; limit?: number } = {}
   ): Promise<AutopilotRunRecord[]> {
      const after = page.after ?? null;
      const rows = await this.#sql`
         SELECT ${this.#sql.unsafe(RUN_COLUMNS)}
           ${this.#sql.unsafe(RUN_SOURCE)}
          WHERE ar.workspace_id = ${workspaceId} AND ar.autopilot_id = ${autopilotId}
            AND (${after === null} OR (ar.created_at, ar.id) < (${after?.createdAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
          ORDER BY ar.created_at DESC, ar.id DESC
          LIMIT ${page.limit ?? HISTORY_LIMIT}`;
      return rows.map(toRun);
   }

   /**
    * Recent runs across every Loop in the workspace — the overview's
    * activity list, or, with `needsAttention`, the failures nobody has
    * retried yet.
    */
   async workspaceRuns(
      workspaceId: string,
      options: { needsAttention?: boolean; limit?: number } = {}
   ): Promise<WorkspaceRunRecord[]> {
      const attention = options.needsAttention === true;
      const rows = await this.#sql`
         SELECT ${this.#sql.unsafe(RUN_COLUMNS)}, a.name AS autopilot_name
           ${this.#sql.unsafe(RUN_SOURCE)}
           JOIN autopilots AS a ON a.id = ar.autopilot_id
          WHERE ar.workspace_id = ${workspaceId} AND a.archived_at IS NULL
            AND (${!attention} OR (
                 (ar.status = 'failed' OR r.status IN ('failed', 'cancelled'))
                 AND NOT EXISTS (SELECT 1 FROM autopilot_runs AS retry WHERE retry.retry_of = ar.id)
                 AND ar.created_at >= now() - interval '7 days'))
          ORDER BY ar.created_at DESC, ar.id DESC
          LIMIT ${Math.min(Math.max(options.limit ?? 20, 1), 100)}`;
      return rows
         .map((row) => ({ ...toRun(row), autopilotName: row.autopilot_name as string }))
         // A cancel a person pressed is not a failure that needs anyone.
         .filter((run) => !attention || run.state === 'failed' || run.state === 'timed_out');
   }

   async runDetail(workspaceId: string, autopilotId: string, autopilotRunId: string): Promise<AutopilotRunDetail> {
      const [row] = await this.#sql`
         SELECT ${this.#sql.unsafe(RUN_COLUMNS)}, a.name AS autopilot_name, t.kind AS trigger_kind,
                ar.trigger_payload, r.failure_code, r.failure_message,
                r.input_tokens, r.output_tokens, r.total_tokens, r.cost_micros, r.currency,
                r.ai_runtime_key, r.ai_model_id
           ${this.#sql.unsafe(RUN_SOURCE)}
           JOIN autopilots AS a ON a.id = ar.autopilot_id
           LEFT JOIN autopilot_triggers AS t ON t.id = ar.trigger_id
          WHERE ar.workspace_id = ${workspaceId} AND ar.autopilot_id = ${autopilotId} AND ar.id = ${autopilotRunId}`;
      if (!row) throw new NotFound();
      const children = await this.#sql`
         SELECT ${this.#sql.unsafe(RUN_COLUMNS)}, a.name AS autopilot_name
           ${this.#sql.unsafe(RUN_SOURCE)}
           JOIN autopilots AS a ON a.id = ar.autopilot_id
          WHERE ar.workspace_id = ${workspaceId} AND ar.parent_autopilot_run_id = ${autopilotRunId}
          ORDER BY ar.created_at, ar.id LIMIT 50`;
      const record = toRun(row);
      return {
         ...record,
         autopilotName: row.autopilot_name as string,
         triggerKind: (row.trigger_kind as TriggerKind | null) ?? null,
         triggerPayload: row.trigger_payload ?? null,
         failureCode: (row.failure_code as string | null) ?? null,
         failureMessage: (row.failure_message as string | null) ?? null,
         usage: record.runId
            ? {
                 inputTokens: Number(row.input_tokens ?? 0),
                 outputTokens: Number(row.output_tokens ?? 0),
                 totalTokens: Number(row.total_tokens ?? 0),
                 costMicros: row.cost_micros === null || row.cost_micros === undefined ? null : Number(row.cost_micros),
                 currency: (row.currency as string | null) ?? null,
              }
            : null,
         model: record.runId
            ? { runtime: (row.ai_runtime_key as string | null) ?? null, model: (row.ai_model_id as string | null) ?? null }
            : null,
         children: children.map((child) => {
            const run = toRun(child);
            return { id: run.id, autopilotId: run.autopilotId, autopilotName: child.autopilot_name as string, state: run.state, createdAt: run.createdAt };
         }),
      };
   }

   /**
    * The first live agent of this workspace holding one of `roles`, in that
    * order of preference. Null when none does — then the person chooses.
    */
   async suggestAgent(workspaceId: string, roles: readonly string[]): Promise<{ id: string; name: string; roleKey: string } | null> {
      if (roles.length === 0) return null;
      // The Orchestrator is the protected agent. The workspace trigger makes
      // it before provisioning gives it a role key, so it is found by that.
      const rows = await this.#sql`
         SELECT id, name, CASE WHEN protected THEN 'orchestrator' ELSE role_key END AS role_key FROM agents
          WHERE workspace_id = ${workspaceId} AND archived_at IS NULL
            AND (role_key = ANY(${[...roles]}::text[]) OR protected)`;
      for (const role of roles) {
         const found = rows.find((row) => row.role_key === role);
         if (found) return { id: found.id as string, name: found.name as string, roleKey: role };
      }
      return null;
   }

   /** What the event triggers saw: fired, filtered out, or skipped and why. */
   async receipts(workspaceId: string, autopilotId: string): Promise<EventReceiptRecord[]> {
      const rows = await this.#sql`
         SELECT id, trigger_id, event_id, topic, status, reason_code, autopilot_run_id, occurred_at, received_at
           FROM autopilot_event_receipts
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
          ORDER BY received_at DESC, id DESC
          LIMIT ${HISTORY_LIMIT}`;
      return rows.map((row) => ({
         id: row.id as string,
         triggerId: row.trigger_id as string,
         eventId: row.event_id as string,
         topic: row.topic as string,
         status: row.status as EventReceiptRecord['status'],
         reasonCode: (row.reason_code as string | null) ?? null,
         autopilotRunId: (row.autopilot_run_id as string | null) ?? null,
         occurredAt: toRFC3339(row.occurred_at as string) ?? '',
         receivedAt: toRFC3339(row.received_at as string) ?? '',
      }));
   }

   /**
    * A copy to adjust: the definition and its schedule and event triggers,
    * paused so it does not start running beside the original. Webhook
    * triggers are not copied — a new one needs its own URL and secret,
    * which only the call that makes it can show.
    */
   async duplicate(workspaceId: string, autopilotId: string, actorId: string): Promise<Autopilot> {
      const source = await this.get(workspaceId, autopilotId);
      const triggers = await this.triggers(workspaceId, autopilotId);
      const copy = await this.create(
         workspaceId,
         { ...draftOf(source), name: `${source.name} (copy)`.slice(0, 200) },
         actorId,
         { status: 'paused' }
      );
      for (const trigger of triggers) {
         if (trigger.kind === 'cron' && trigger.cronExpression && trigger.timezone) {
            await this.addCronTrigger(workspaceId, copy.id, {
               expression: trigger.cronExpression,
               timezone: trigger.timezone,
               enabled: trigger.enabled,
            });
         } else if (trigger.kind === 'event' && trigger.eventType) {
            await this.addEventTrigger(workspaceId, copy.id, {
               eventType: trigger.eventType,
               conditions: trigger.conditions,
               enabled: trigger.enabled,
            });
         }
      }
      return this.get(workspaceId, copy.id);
   }

   async addEventTrigger(
      workspaceId: string,
      autopilotId: string,
      input: { eventType: string; conditions: unknown; enabled: boolean }
   ): Promise<AutopilotTrigger> {
      if (!isLoopEventKey(input.eventType)) {
         throw new InvalidAutopilot('/eventType', 'That is not an event a loop can listen for.');
      }
      const conditions = conditionsOrInvalid(input.eventType, input.conditions);
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         await lockOwned(tx, workspaceId, autopilotId);
         const [row] = await tx`
            INSERT INTO autopilot_triggers (workspace_id, autopilot_id, kind, enabled, event_type, conditions)
            VALUES (${workspaceId}, ${autopilotId}, 'event', ${input.enabled}, ${input.eventType},
                    ${tx.json(conditions as never)})
            RETURNING *`;
         if (!row) throw new Error('trigger insert returned no row');
         return toTrigger(row);
      }) as Promise<AutopilotTrigger>;
   }

   async deliveries(workspaceId: string, autopilotId: string): Promise<WebhookDeliveryRecord[]> {
      const rows = await this.#sql`
         SELECT id, autopilot_id, trigger_id, event, status, failure_reason,
                autopilot_run_id, replay_of, received_at
           FROM webhook_deliveries
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId}
          ORDER BY received_at DESC, id DESC
          LIMIT ${HISTORY_LIMIT}`;
      return rows.map(toDelivery);
   }

   async deliveryPayload(
      workspaceId: string,
      autopilotId: string,
      deliveryId: string
   ): Promise<{ delivery: WebhookDeliveryRecord; payload: unknown }> {
      const [row] = await this.#sql`
         SELECT * FROM webhook_deliveries
          WHERE workspace_id = ${workspaceId} AND autopilot_id = ${autopilotId} AND id = ${deliveryId}`;
      if (!row) throw new NotFound();
      return { delivery: toDelivery(row), payload: row.payload ?? null };
   }

   /**
    * The trigger a public webhook URL names, with its secret opened.
    *
    * Deliberately not scoped by workspace: the token is the only thing the
    * caller has, and it identifies exactly one trigger by its hash.
    */
   async webhookByToken(
      token: string
   ): Promise<{ trigger: AutopilotTrigger; workspaceId: string; signingSecret: string } | null> {
      const [row] = await this.#sql`
         SELECT * FROM autopilot_triggers
          WHERE webhook_token_hash = ${hashToken(token)} AND kind = 'webhook'`;
      if (!row) return null;
      const signingSecret = this.#sealer.open(Buffer.from(row.signing_secret_sealed as Buffer));
      return { trigger: toTrigger(row), workspaceId: row.workspace_id as string, signingSecret };
   }

   async recordDelivery(input: {
      workspaceId: string;
      autopilotId: string;
      triggerId: string | null;
      event: string | null;
      status: DeliveryStatus;
      payload: unknown;
      failureReason: string | null;
      replayOf: string | null;
   }): Promise<string> {
      const now = this.#clock().toISOString();
      return this.#sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const [row] = await tx`
            INSERT INTO webhook_deliveries (
               workspace_id, autopilot_id, trigger_id, event, status, payload,
               failure_reason, replay_of, received_at
            ) VALUES (
               ${input.workspaceId}, ${input.autopilotId}, ${input.triggerId},
               ${input.event === null ? null : input.event.slice(0, 100)}, ${input.status},
               ${input.payload === null || input.payload === undefined ? null : tx.json(input.payload as never)},
               ${input.failureReason}, ${input.replayOf}, ${now}
            ) RETURNING id`;
         if (!row) throw new Error('delivery insert returned no row');
         await writeAutopilotEvent(tx, {
            workspaceId: input.workspaceId,
            topic: 'autopilot.delivery.received',
            autopilotId: input.autopilotId,
            payload: { deliveryId: row.id as string, status: input.status },
            occurredAt: now,
         });
         return row.id as string;
      }) as Promise<string>;
   }

   /**
    * Settles a delivery and points it at the run its firing produced.
    *
    * The run is linked only if its record exists. `fire` is injected, and a
    * delivery must still settle its status when the id it was handed names
    * no autopilot_runs row, rather than failing on the foreign key.
    */
   async linkDelivery(deliveryId: string, autopilotRunId: string | null, status: DeliveryStatus): Promise<void> {
      await this.#sql`
         UPDATE webhook_deliveries
            SET autopilot_run_id = (SELECT id FROM autopilot_runs WHERE id = ${autopilotRunId}),
                status = ${status}
          WHERE id = ${deliveryId}`;
   }
}

async function lockOwned(tx: Sql, workspaceId: string, autopilotId: string): Promise<void> {
   const [row] = await tx`
      SELECT id FROM autopilots
       WHERE workspace_id = ${workspaceId} AND id = ${autopilotId} AND archived_at IS NULL
       FOR UPDATE`;
   if (!row) throw new NotFound();
}

/**
 * The checks a CHECK constraint cannot make: that the agent, board or
 * task named belongs to this workspace. A foreign key would accept one from
 * any workspace.
 */
async function validateDraft(tx: Sql, workspaceId: string, draft: AutopilotDraft): Promise<void> {
   if (draft.assigneeType !== 'agent') {
      throw new InvalidAutopilot('/assigneeType', 'An autopilot is assigned to an agent.');
   }
   const [agent] = await tx`
      SELECT 1 FROM agents
       WHERE id = ${draft.assigneeId} AND workspace_id = ${workspaceId} AND archived_at IS NULL`;
   if (!agent) throw new InvalidAutopilot('/assigneeId', 'That agent is not in this workspace.');

   if (draft.executionMode === 'create_issue') {
      if (!draft.boardId || draft.issueId) {
         throw new InvalidAutopilot(
            '/boardId',
            'An autopilot that opens a task per run needs a board, and no fixed task.'
         );
      }
      const [board] = await tx`
         SELECT 1 FROM boards WHERE id = ${draft.boardId} AND workspace_id = ${workspaceId}`;
      if (!board) throw new InvalidAutopilot('/boardId', 'That board is not in this workspace.');
      if (draft.projectId) {
         const [project] = await tx`
            SELECT 1 FROM projects
             WHERE id = ${draft.projectId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL`;
         if (!project) {
            throw new InvalidAutopilot('/projectId', 'That project is not in this workspace.');
         }
      }
   } else {
      if (!draft.issueId || draft.boardId) {
         throw new InvalidAutopilot(
            '/issueId',
            'An autopilot that works on one task needs that task, and no board.'
         );
      }
      if (draft.projectId) {
         throw new InvalidAutopilot(
            '/projectId',
            'An autopilot that works on one task takes that task\u2019s project, not its own.'
         );
      }
      const [issue] = await tx`
         SELECT 1 FROM issues AS issue JOIN boards AS board ON board.id = issue.board_id
          WHERE issue.id = ${draft.issueId} AND board.workspace_id = ${workspaceId}
            AND issue.deleted_at IS NULL`;
      if (!issue) throw new InvalidAutopilot('/issueId', 'That task is not in this workspace.');
   }

   if ((draft.quotaPeriod === 'none') !== (draft.quotaMax === null)) {
      throw new InvalidAutopilot('/quotaMax', 'A quota needs both a period and a limit.');
   }
   if (draft.maxChainDepth < 0 || draft.maxChainDepth > MAX_CHAIN_DEPTH) {
      throw new InvalidAutopilot('/maxChainDepth', `A loop answers chains of at most ${MAX_CHAIN_DEPTH}.`);
   }
}

async function writeVersion(tx: Sql, autopilot: Autopilot, actorId: string, now: string): Promise<void> {
   await tx`
      INSERT INTO autopilot_versions (workspace_id, autopilot_id, version, snapshot, created_by, created_at)
      VALUES (${autopilot.workspaceId}, ${autopilot.id}, ${autopilot.version},
              ${tx.json(draftOf(autopilot) as never)}, ${actorId}, ${now})`;
}

async function rescheduleCron(tx: Sql, autopilotId: string, now: Date): Promise<void> {
   const rows = await tx`
      SELECT id, cron_expression, timezone FROM autopilot_triggers
       WHERE autopilot_id = ${autopilotId} AND kind = 'cron' AND enabled`;
   for (const row of rows) {
      const next = nextFireAfter(row.cron_expression as string, row.timezone as string, now);
      await tx`
         UPDATE autopilot_triggers SET next_fire_at = ${next ? next.toISOString() : null}
          WHERE id = ${row.id as string}`;
   }
}

function draftOf(autopilot: Autopilot): AutopilotDraft {
   return {
      name: autopilot.name,
      description: autopilot.description,
      assigneeType: autopilot.assigneeType,
      assigneeId: autopilot.assigneeId,
      promptTemplate: autopilot.promptTemplate,
      executionMode: autopilot.executionMode,
      boardId: autopilot.boardId,
      projectId: autopilot.projectId,
      issueId: autopilot.issueId,
      quotaPeriod: autopilot.quotaPeriod,
      quotaMax: autopilot.quotaMax,
      accessMode: autopilot.accessMode,
      concurrencyPolicy: autopilot.concurrencyPolicy,
      maxTurns: autopilot.maxTurns,
      maxDurationMinutes: autopilot.maxDurationMinutes,
      maxChainDepth: autopilot.maxChainDepth,
      allowAgentEvents: autopilot.allowAgentEvents,
      templateKey: autopilot.templateKey,
   };
}

/**
 * The distinct kinds of trigger an autopilot has, as a column.
 *
 * Unsafe-interpolated into two reads that already name their workspace in the
 * WHERE clause; it carries no request value of its own, only the row's own id.
 */
const TRIGGER_KINDS = `COALESCE((SELECT array_agg(DISTINCT t.kind)
     FROM autopilot_triggers t WHERE t.autopilot_id = a.id), '{}') AS trigger_kinds`;

/**
 * What the list shows about each Loop's activity, as columns. Interpolated
 * like TRIGGER_KINDS: it names only the row's own id.
 */
const ACTIVITY = `
   (SELECT row_to_json(last) FROM (
       SELECT ar.id, ar.status, ar.created_at, r.status AS task_status, i.status::text AS issue_status, ar.timed_out_at
         FROM autopilot_runs ar
         LEFT JOIN runs r ON r.id = ar.run_id
         LEFT JOIN issues i ON i.id = ar.issue_id
        WHERE ar.autopilot_id = a.id
        ORDER BY ar.created_at DESC, ar.id DESC LIMIT 1) AS last) AS last_run,
   (SELECT min(t.next_fire_at) FROM autopilot_triggers t
     WHERE t.autopilot_id = a.id AND t.kind = 'cron' AND t.enabled) AS next_fire_at,
   (SELECT count(*)::int FROM autopilot_runs ar
     WHERE ar.autopilot_id = a.id AND ar.status <> 'skipped' AND ar.created_at >= now() - interval '7 days') AS runs_7d,
   (SELECT count(*)::int FROM autopilot_runs ar LEFT JOIN runs r ON r.id = ar.run_id
     WHERE ar.autopilot_id = a.id AND ar.created_at >= now() - interval '7 days'
       AND (ar.status = 'failed' OR r.status = 'failed')) AS failed_7d,
   COALESCE((SELECT array_agg(DISTINCT t.event_type) FROM autopilot_triggers t
     WHERE t.autopilot_id = a.id AND t.kind = 'event'), '{}') AS event_types`;

/** A run record joined to its agent run and task. */
const RUN_COLUMNS = `ar.*, r.status AS task_status, r.agent_id, r.started_at AS task_started_at,
   r.completed_at AS task_completed_at, r.summary AS task_summary, i.status::text AS issue_status,
   berry_issue_identifier(b.workspace_id, i.number) AS issue_identifier,
   (SELECT retry.id FROM autopilot_runs AS retry WHERE retry.retry_of = ar.id) AS retried_by`;
const RUN_SOURCE = `FROM autopilot_runs AS ar
   LEFT JOIN runs AS r ON r.id = ar.run_id
   LEFT JOIN issues AS i ON i.id = ar.issue_id
   LEFT JOIN boards AS b ON b.id = i.board_id`;

function toActivity(row: Row): AutopilotActivity {
   const last = row.last_run as Row | null | undefined;
   return {
      lastRun: last
         ? {
              id: last.id as string,
              state: loopRunState({
                 firing: last.status as RunStatus,
                 task: (last.task_status as string | null) ?? null,
                 issueStatus: (last.issue_status as string | null) ?? null,
                 timedOut: last.timed_out_at !== null && last.timed_out_at !== undefined,
              }),
              createdAt: toRFC3339(last.created_at as string) ?? '',
           }
         : null,
      nextFireAt: toRFC3339((row.next_fire_at as string | null | undefined) ?? null),
      runsLast7Days: (row.runs_7d as number | null | undefined) ?? 0,
      failedLast7Days: (row.failed_7d as number | null | undefined) ?? 0,
      eventTypes: (row.event_types as string[] | null | undefined) ?? [],
   };
}

function storedConditions(row: Row): Conditions {
   const eventType = row.event_type;
   if (typeof eventType !== 'string' || !isLoopEventKey(eventType)) return EMPTY_CONDITIONS;
   try {
      return parseConditions(eventType, row.conditions);
   } catch {
      // Stored before a rule changed. Shown as no filters rather than failing
      // the read; the worker refuses to fire it (worker.ts).
      return EMPTY_CONDITIONS;
   }
}

function conditionsOrInvalid(eventType: LoopEventKey, raw: unknown): Conditions {
   try {
      return parseConditions(eventType, raw);
   } catch (error) {
      if (error instanceof InvalidConditions) throw new InvalidAutopilot(error.field, error.message);
      throw error;
   }
}

function toAutopilot(row: Row): Autopilot {
   return {
      triggerKinds: ((row.trigger_kinds as string[] | null) ?? []) as TriggerKind[],
      activity: toActivity(row),
      accessMode: row.access_mode === 'act' ? 'act' : 'recommend',
      concurrencyPolicy: row.concurrency_policy === 'allow' ? 'allow' : 'skip_if_running',
      maxTurns: (row.max_turns as number | null) ?? null,
      maxDurationMinutes: (row.max_duration_minutes as number | null) ?? null,
      maxChainDepth: (row.max_chain_depth as number | null) ?? 0,
      allowAgentEvents: row.allow_agent_events === true,
      templateKey: (row.template_key as string | null) ?? null,
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      name: row.name as string,
      description: (row.description as string | null) ?? null,
      assigneeType: row.assignee_type as AssigneeType,
      assigneeId: row.assignee_id as string,
      promptTemplate: row.prompt_template as string,
      executionMode: row.execution_mode as ExecutionMode,
      boardId: (row.board_id as string | null) ?? null,
      projectId: (row.project_id as string | null) ?? null,
      issueId: (row.issue_id as string | null) ?? null,
      status: row.status as AutopilotStatus,
      version: row.version as number,
      quotaPeriod: row.quota_period as QuotaPeriod,
      quotaMax: (row.quota_max as number | null) ?? null,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
      archivedAt: toRFC3339(row.archived_at as string | null),
   };
}

function toTrigger(row: Row): AutopilotTrigger {
   return {
      id: row.id as string,
      autopilotId: row.autopilot_id as string,
      kind: row.kind as TriggerKind,
      eventType: typeof row.event_type === 'string' && isLoopEventKey(row.event_type) ? row.event_type : null,
      conditions: storedConditions(row),
      enabled: row.enabled as boolean,
      cronExpression: (row.cron_expression as string | null) ?? null,
      timezone: (row.timezone as string | null) ?? null,
      nextFireAt: toRFC3339(row.next_fire_at as string | null),
      lastFiredAt: toRFC3339(row.last_fired_at as string | null),
      tokenHint: (row.webhook_token_hint as string | null) ?? null,
      eventFilters: (row.event_filters as string[] | null) ?? [],
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

function toMember(row: Row): AutopilotMember {
   return {
      userId: row.user_id as string,
      role: row.role as MemberRole,
      createdAt: toRFC3339(row.created_at as string) ?? '',
   };
}

function toRun(row: Row): AutopilotRunRecord {
   return {
      id: row.id as string,
      autopilotId: row.autopilot_id as string,
      autopilotVersion: row.autopilot_version as number,
      triggerId: (row.trigger_id as string | null) ?? null,
      source: row.source as RunSource,
      status: row.status as RunStatus,
      reasonCode: (row.reason_code as string | null) ?? null,
      reasonMessage: (row.reason_message as string | null) ?? null,
      issueId: (row.issue_id as string | null) ?? null,
      runId: (row.run_id as string | null) ?? null,
      taskStatus: (row.task_status as string | null) ?? null,
      state: loopRunState({
         firing: row.status as RunStatus,
         task: (row.task_status as string | null) ?? null,
         issueStatus: (row.issue_status as string | null) ?? null,
         timedOut: row.timed_out_at !== null && row.timed_out_at !== undefined,
      }),
      triggerEventId: (row.trigger_event_id as string | null) ?? null,
      parentAutopilotRunId: (row.parent_autopilot_run_id as string | null) ?? null,
      depth: (row.depth as number | null) ?? 0,
      retryOf: (row.retry_of as string | null) ?? null,
      retriedBy: (row.retried_by as string | null) ?? null,
      timedOutAt: toRFC3339(row.timed_out_at as string | null),
      issueIdentifier: (row.issue_identifier as string | null) ?? null,
      agentId: (row.agent_id as string | null) ?? null,
      startedAt: toRFC3339(row.task_started_at as string | null),
      completedAt: toRFC3339(row.task_completed_at as string | null),
      summary: (row.task_summary as string | null) ?? null,
      slot: toRFC3339(row.slot as string | null),
      requestedBy: (row.requested_by as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
   };
}

function toDelivery(row: Row): WebhookDeliveryRecord {
   return {
      id: row.id as string,
      autopilotId: row.autopilot_id as string,
      triggerId: (row.trigger_id as string | null) ?? null,
      event: (row.event as string | null) ?? null,
      status: row.status as DeliveryStatus,
      failureReason: (row.failure_reason as string | null) ?? null,
      autopilotRunId: (row.autopilot_run_id as string | null) ?? null,
      replayOf: (row.replay_of as string | null) ?? null,
      receivedAt: toRFC3339(row.received_at as string) ?? '',
   };
}
