import { z } from 'zod';

/**
 * What a Loop can listen for inside Berry, and the filters it may put on it.
 *
 * Every event here is one Berry already writes to `outbox_events` in the
 * transaction that made the change; none is invented for Loops. A Loop event
 * type is either an outbox topic as it stands or a narrower reading of one
 * (`issue.status_changed` is `issue.updated` where the status moved), so a
 * person picks "Task status changed" rather than "updated, where changed
 * contains status".
 *
 * Approvals: Berry writes `approval.requested` when a gate opens. Decisions
 * are not written to the outbox, so there is no "approved" or "rejected"
 * event — a Loop offered one would never run.
 *
 * GitHub: Berry records one fact about pull requests, that a pull request
 * linked to a task changed (`github.pull_request.updated`). It does not say
 * which change, so there is no "opened" or "merged" event here — only a
 * filter on the state the pull request is in afterwards.
 *
 * Filters are deliberately small: at most eight, all or any, each a field in
 * (or not in) a list of values. No expressions and no step graph — a person
 * who needs judgement writes it in the instructions (see migration 036).
 */

export type EventSubject = 'issue' | 'comment' | 'project' | 'run' | 'approval' | 'pull_request';

export interface LoopEventType {
   /** The outbox topic it reads. */
   topic: string;
   subject: EventSubject;
   /** Narrows the topic to updates that changed this field. */
   requiresChanged?: string;
}

export const LOOP_EVENT_TYPES = {
   'issue.created': { topic: 'issue.created', subject: 'issue' },
   'issue.updated': { topic: 'issue.updated', subject: 'issue' },
   'issue.status_changed': { topic: 'issue.updated', subject: 'issue', requiresChanged: 'status' },
   'issue.assigned': { topic: 'issue.assigned', subject: 'issue' },
   'issue.started': { topic: 'issue.started', subject: 'issue' },
   'issue.completed': { topic: 'issue.completed', subject: 'issue' },
   'comment.created': { topic: 'comment.created', subject: 'comment' },
   'project.created': { topic: 'project.created', subject: 'project' },
   'project.updated': { topic: 'project.updated', subject: 'project' },
   'run.completed': { topic: 'run.completed', subject: 'run' },
   'run.failed': { topic: 'run.failed', subject: 'run' },
   'approval.requested': { topic: 'approval.requested', subject: 'approval' },
   'github.pull_request.updated': { topic: 'github.pull_request.updated', subject: 'pull_request' },
} as const satisfies Record<string, LoopEventType>;

export type LoopEventKey = keyof typeof LOOP_EVENT_TYPES;
export const LOOP_EVENT_KEYS = Object.keys(LOOP_EVENT_TYPES) as LoopEventKey[];

export function isLoopEventKey(value: string): value is LoopEventKey {
   return Object.prototype.hasOwnProperty.call(LOOP_EVENT_TYPES, value);
}

/** Every outbox topic some Loop event type reads; the worker reads only these. */
export const LOOP_TOPICS: readonly string[] = [...new Set(LOOP_EVENT_KEYS.map((key) => LOOP_EVENT_TYPES[key].topic))];

/** The Loop event types a topic can satisfy. */
export function eventKeysForTopic(topic: string): LoopEventKey[] {
   return LOOP_EVENT_KEYS.filter((key) => LOOP_EVENT_TYPES[key].topic === topic);
}

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

export const MAX_RULES = 8;
const MAX_VALUES = 20;

const ruleSchema = z.strictObject({
   field: z.enum(CONDITION_FIELDS),
   op: z.enum(['in', 'not_in']),
   values: z.array(z.string().trim().min(1).max(200)).min(1).max(MAX_VALUES),
});

export const conditionsSchema = z.strictObject({
   match: z.enum(['all', 'any']).default('all'),
   rules: z.array(ruleSchema).max(MAX_RULES).default([]),
});

export type ConditionRule = z.output<typeof ruleSchema>;
export type Conditions = z.output<typeof conditionsSchema>;

export const EMPTY_CONDITIONS: Conditions = { match: 'all', rules: [] };

export class InvalidConditions extends Error {
   override readonly name = 'InvalidConditions';
   readonly field: string;
   constructor(field: string, message: string) {
      super(message);
      this.field = field;
   }
}

/** Fields that only some event types can answer. Anything else is about the task. */
const ONLY_FOR: Partial<Record<ConditionField, (key: LoopEventKey) => boolean>> = {
   changed: (key) => key === 'issue.updated',
   previousStatus: (key) => key === 'issue.status_changed' || key === 'issue.updated' || key === 'issue.completed' || key === 'issue.started',
   pullRequestState: (key) => key === 'github.pull_request.updated',
};

/**
 * Parse filters for an event type, refusing ones that can never be true for
 * it. A filter on a field the event cannot state would silently never match,
 * which is a Loop that looks configured and never runs.
 */
export function parseConditions(eventType: LoopEventKey, raw: unknown): Conditions {
   const parsed = conditionsSchema.safeParse(raw ?? EMPTY_CONDITIONS);
   if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue ? `/conditions/${issue.path.map(String).join('/')}` : '/conditions';
      throw new InvalidConditions(path, issue?.message ?? 'The filters could not be read.');
   }
   const subject = LOOP_EVENT_TYPES[eventType].subject;
   for (const [index, rule] of parsed.data.rules.entries()) {
      const only = ONLY_FOR[rule.field];
      if (only && !only(eventType)) {
         throw new InvalidConditions(
            `/conditions/rules/${index}/field`,
            `"${rule.field}" is not something a ${eventType} event states.`
         );
      }
      if (subject === 'project' && TASK_FIELDS.has(rule.field)) {
         throw new InvalidConditions(
            `/conditions/rules/${index}/field`,
            `A project event is not about one task, so it cannot be filtered by "${rule.field}".`
         );
      }
   }
   return {
      match: parsed.data.match,
      rules: parsed.data.rules.map((rule) => ({ ...rule, values: [...new Set(rule.values)] })),
   };
}

const TASK_FIELDS = new Set<ConditionField>(['status', 'previousStatus', 'priority', 'label', 'assigneeType', 'assignee']);

/**
 * What an event states, normalised across topics. Built by the worker from
 * the outbox envelope (and, for labels and linked pull requests, a lookup).
 */
export interface EventFacts {
   topic: string;
   actor: { type: 'user' | 'agent' | 'system'; id: string | null } | null;
   /** The task the event is about, or that its comment, run or pull request is on. */
   issue: {
      id: string;
      projectId: string | null;
      status: string | null;
      previousStatus: string | null;
      priority: string | null;
      labels: string[];
      assignee: { type: string; id: string } | null;
      changedFields: string[];
   } | null;
   projectId: string | null;
   pullRequestState: string | null;
}

/** Whether a topic's event is one of this Loop event type's. */
export function eventTypeMatches(eventType: LoopEventKey, facts: EventFacts): boolean {
   const spec: LoopEventType = LOOP_EVENT_TYPES[eventType];
   if (spec.topic !== facts.topic) return false;
   if (spec.requiresChanged && !(facts.issue?.changedFields ?? []).includes(spec.requiresChanged)) return false;
   return true;
}

export function conditionsMatch(conditions: Conditions, facts: EventFacts): boolean {
   if (conditions.rules.length === 0) return true;
   const results = conditions.rules.map((rule) => ruleMatches(rule, facts));
   return conditions.match === 'all' ? results.every(Boolean) : results.some(Boolean);
}

/**
 * One rule. Values compare case-insensitively: a label typed "Bug" matches a
 * label named "bug". A fact the event does not have is an empty set, so
 * `in` fails and `not_in` holds — "not in done" is true of a project event.
 */
function ruleMatches(rule: ConditionRule, facts: EventFacts): boolean {
   const have = new Set(factValues(rule.field, facts).map(fold));
   const wanted = rule.values.map(fold);
   const any = wanted.some((value) => have.has(value));
   return rule.op === 'in' ? any : !any;
}

function factValues(field: ConditionField, facts: EventFacts): string[] {
   const issue = facts.issue;
   switch (field) {
      case 'project': {
         const project = issue?.projectId ?? facts.projectId;
         return project ? [project] : ['none'];
      }
      case 'status':
         return issue?.status ? [issue.status] : [];
      case 'previousStatus':
         return issue?.previousStatus ? [issue.previousStatus] : [];
      case 'priority':
         return issue?.priority ? [issue.priority] : [];
      case 'label':
         return issue?.labels ?? [];
      case 'assigneeType':
         return issue ? [issue.assignee?.type ?? 'none'] : [];
      case 'assignee':
         return issue ? [issue.assignee ? `${issue.assignee.type}:${issue.assignee.id}` : 'none'] : [];
      case 'actorType':
         return facts.actor ? [facts.actor.type] : [];
      case 'actor':
         return facts.actor?.id ? [`${facts.actor.type}:${facts.actor.id}`] : [];
      case 'changed':
         return issue?.changedFields ?? [];
      case 'pullRequestState':
         return facts.pullRequestState ? [facts.pullRequestState] : [];
   }
}

function fold(value: string): string {
   return value.trim().toLowerCase();
}

/**
 * The facts a run's prompt may quote: `{{event.issue.identifier}}` and so on.
 * Only identifiers and short fields — no description or comment body. Those
 * are written by whoever opened the task, and the agent reads them through
 * its tools, where they arrive marked as task content rather than as part of
 * the Loop's own instructions.
 */
export interface EventPayloadSummary {
   eventType: LoopEventKey;
   eventId: string;
   occurredAt: string;
   actor: EventFacts['actor'];
   issue: { id: string; identifier: string | null; title: string | null; status: string | null } | null;
   commentId: string | null;
   runId: string | null;
   projectId: string | null;
   pullRequestId: string | null;
   approvalId: string | null;
}
