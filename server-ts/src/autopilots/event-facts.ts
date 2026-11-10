import type { Queryable } from '../db/pool.ts';
import type { EventFacts, EventPayloadSummary, LoopEventKey } from './event-triggers.ts';

/**
 * Reading an outbox event as a Loop needs it: what it is about, who caused
 * it, and whether a Loop's own work caused it.
 *
 * Envelopes differ by family (core/issues.ts, core/comments.ts, runs/ledger.ts,
 * core/projects.ts, approvals/notify.ts, scm/pull-requests.ts), so each is
 * read where its writer puts things. Anything missing is left empty rather
 * than guessed: a filter on a fact the event did not state does not match.
 */

type Json = Record<string, unknown>;

export interface OutboxEvent {
   id: string;
   topic: string;
   workspaceId: string;
   occurredAt: string;
   envelope: Json;
}

function obj(value: unknown): Json | null {
   return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

function str(value: unknown): string | null {
   return typeof value === 'string' && value !== '' ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): string | null {
   const text = str(value);
   return text && UUID.test(text) ? text : null;
}

/** The stored status, as the wire spells it (`in_review` → `inReview`). */
function apiStatus(status: string | null): string | null {
   if (!status) return null;
   return status.replace(/_([a-z])/g, (_whole, letter: string) => letter.toUpperCase());
}

interface Parsed {
   issueId: string | null;
   runId: string | null;
   commentId: string | null;
   projectId: string | null;
   approvalId: string | null;
   pullRequestId: string | null;
   actor: EventFacts['actor'];
   snapshot: Json | null;
   changedFields: string[];
   previousStatus: string | null;
}

function parse(event: OutboxEvent): Parsed {
   const envelope = event.envelope;
   const payload = obj(envelope.payload) ?? {};
   const snapshot = obj(payload.issue);
   const comment = obj(payload.comment);
   const actorRaw = obj(payload.actor) ?? obj(comment?.author);
   const actorType = str(actorRaw?.type);
   const actor: EventFacts['actor'] =
      actorType === 'user' || actorType === 'agent'
         ? { type: actorType, id: uuid(actorRaw?.id) }
         : null;
   const family = event.topic.split('.')[0];
   return {
      issueId: uuid(envelope.issueId) ?? uuid(snapshot?.id) ?? uuid(comment?.issueId) ?? uuid(payload.issueId),
      runId: uuid(envelope.runId) ?? uuid(comment?.runId),
      commentId: uuid(comment?.id),
      projectId: family === 'project' ? uuid(envelope.aggregateId) : null,
      approvalId: uuid(payload.approvalId),
      pullRequestId: uuid(payload.pullRequestId),
      actor,
      snapshot,
      changedFields: Array.isArray(payload.changedFields)
         ? payload.changedFields.filter((field): field is string => typeof field === 'string')
         : [],
      previousStatus: apiStatus(str(payload.previousStatus)),
   };
}

export interface ResolvedEvent {
   facts: EventFacts;
   /** True when an agent, or the run of one, caused the event. */
   agentCaused: boolean;
   runId: string | null;
   issueId: string | null;
   summary: Omit<EventPayloadSummary, 'eventType'>;
}

/**
 * Facts for one event. Status and priority come from the event's own
 * snapshot when it has one — the task may have moved again since — and from
 * the task as it is now otherwise. Labels always come from the task: no
 * envelope carries them.
 */
export async function resolveEvent(sql: Queryable, event: OutboxEvent): Promise<ResolvedEvent> {
   const parsed = parse(event);
   let actor = parsed.actor;

   // A ledger write names no actor but names its run: the run's agent did it.
   if (!actor && parsed.runId) {
      const [run] = await sql`SELECT agent_id FROM runs WHERE id = ${parsed.runId} AND workspace_id = ${event.workspaceId}`;
      if (run?.agent_id) actor = { type: 'agent', id: run.agent_id as string };
   }

   let issue: EventFacts['issue'] = null;
   let identifier: string | null = null;
   let title: string | null = null;
   if (parsed.issueId) {
      const [row] = await sql`
         SELECT i.id, i.status::text AS status, i.priority::text AS priority, i.assignee_type, i.assignee_id,
                i.title, berry_issue_identifier(b.workspace_id, i.number) AS identifier,
                (SELECT ip.project_id FROM issue_project_links AS ip WHERE ip.issue_id = i.id LIMIT 1) AS project_id,
                COALESCE((SELECT array_agg(l.name ORDER BY l.name)
                            FROM issue_label_memberships AS m
                            JOIN issue_labels AS l ON l.id = m.label_id
                           WHERE m.issue_id = i.id), '{}') AS labels
           FROM issues AS i JOIN boards AS b ON b.id = i.board_id
          WHERE i.id = ${parsed.issueId} AND b.workspace_id = ${event.workspaceId}`;
      if (row) {
         const snapshot = parsed.snapshot;
         const snapshotAssignee = obj(snapshot?.assignee);
         const snapshotProject = snapshot ? projectOf(snapshot.project) : undefined;
         identifier = str(snapshot?.identifier) ?? str(row.identifier);
         title = str(snapshot?.title) ?? str(row.title);
         issue = {
            id: row.id as string,
            projectId: snapshotProject !== undefined ? snapshotProject : ((row.project_id as string | null) ?? null),
            status: str(snapshot?.status) ?? apiStatus(str(row.status)),
            previousStatus: parsed.previousStatus,
            priority: str(snapshot?.priority) ?? str(row.priority),
            labels: (row.labels as string[] | null) ?? [],
            assignee: snapshot
               ? snapshotAssignee && str(snapshotAssignee.type) && str(snapshotAssignee.id)
                  ? { type: snapshotAssignee.type as string, id: snapshotAssignee.id as string }
                  : null
               : row.assignee_type && row.assignee_id
                 ? { type: row.assignee_type as string, id: row.assignee_id as string }
                 : null,
            changedFields: parsed.changedFields,
         };
      }
   }

   let pullRequestState: string | null = null;
   if (parsed.pullRequestId) {
      const [pr] = await sql`
         SELECT state FROM github_pull_requests WHERE id = ${parsed.pullRequestId} AND workspace_id = ${event.workspaceId}`;
      pullRequestState = str(pr?.state);
   }

   return {
      facts: {
         topic: event.topic,
         actor: actor ?? { type: 'system', id: null },
         issue,
         projectId: parsed.projectId,
         pullRequestState,
      },
      agentCaused: actor?.type === 'agent',
      runId: parsed.runId,
      issueId: parsed.issueId,
      summary: {
         eventId: event.id,
         occurredAt: event.occurredAt,
         actor: actor ?? { type: 'system', id: null },
         issue: parsed.issueId
            ? { id: parsed.issueId, identifier, title: title ? oneLine(title) : null, status: issue?.status ?? null }
            : null,
         commentId: parsed.commentId,
         runId: parsed.runId,
         projectId: parsed.projectId ?? issue?.projectId ?? null,
         pullRequestId: parsed.pullRequestId,
         approvalId: parsed.approvalId,
      },
   };
}

/** `project` in an issue snapshot: an object with an id, an id, or null. Undefined when absent. */
function projectOf(value: unknown): string | null | undefined {
   if (value === undefined) return undefined;
   if (value === null) return null;
   const asObject = obj(value);
   return uuid(asObject?.id ?? value);
}

/**
 * A title quoted into a prompt is one line and short. It is still someone
 * else's words; the prompt fences it as data (fire.ts).
 */
function oneLine(text: string): string {
   return text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function summaryFor(eventType: LoopEventKey, resolved: ResolvedEvent): EventPayloadSummary {
   return { eventType, ...resolved.summary };
}

// ---------------------------------------------------------------------------
// Lineage
// ---------------------------------------------------------------------------

export interface Lineage {
   /** The Loop run whose work caused this event, the deepest if several could have. */
   parentAutopilotRunId: string | null;
   parentDepth: number;
   /** Every Loop in that run's ancestry, itself included. */
   ancestry: Set<string>;
}

const NONE: Lineage = { parentAutopilotRunId: null, parentDepth: -1, ancestry: new Set() };

/**
 * Which Loop run, if any, this event came out of.
 *
 * Three ways a Loop's work shows up as an event:
 *  - the event names a run (a ledger write, a comment an agent posted from
 *    its run, a run finishing) and that run is a Loop's;
 *  - an agent caused it while running a Loop's run;
 *  - it is about a task a Loop run opened. That counts for the task's
 *    creation (whose actor is the Loop's owner, not an agent) and for any
 *    change no person made. A person editing a Loop's task later is a person
 *    acting, and starts fresh.
 */
export async function resolveLineage(
   sql: Queryable,
   workspaceId: string,
   topic: string,
   resolved: ResolvedEvent
): Promise<Lineage> {
   const candidates: string[] = [];
   if (resolved.runId) {
      const [row] = await sql`
         SELECT autopilot_run_id FROM runs WHERE id = ${resolved.runId} AND workspace_id = ${workspaceId}`;
      if (row?.autopilot_run_id) candidates.push(row.autopilot_run_id as string);
   }
   const actor = resolved.facts.actor;
   if (actor?.type === 'agent' && actor.id) {
      const rows = await sql`
         SELECT autopilot_run_id FROM runs
          WHERE agent_id = ${actor.id} AND workspace_id = ${workspaceId}
            AND autopilot_run_id IS NOT NULL AND status = 'running'`;
      for (const row of rows) candidates.push(row.autopilot_run_id as string);
   }
   if (resolved.issueId && (topic === 'issue.created' || actor?.type !== 'user')) {
      const rows = await sql`
         SELECT ar.id FROM autopilot_runs AS ar
           JOIN autopilots AS a ON a.id = ar.autopilot_id
          WHERE ar.workspace_id = ${workspaceId} AND ar.issue_id = ${resolved.issueId}
            AND a.execution_mode = 'create_issue'`;
      for (const row of rows) candidates.push(row.id as string);
   }
   if (candidates.length === 0) return NONE;

   // Walk each candidate's ancestry. Bounded: depth is at most 10 by
   // constraint, and the walk stops at 12 whatever the data says.
   const rows = await sql`
      WITH RECURSIVE chain AS (
         SELECT id, autopilot_id, parent_autopilot_run_id, depth, id AS root, 0 AS hops
           FROM autopilot_runs WHERE id = ANY(${[...new Set(candidates)]}::uuid[]) AND workspace_id = ${workspaceId}
         UNION ALL
         SELECT parent.id, parent.autopilot_id, parent.parent_autopilot_run_id, parent.depth, chain.root, chain.hops + 1
           FROM autopilot_runs AS parent JOIN chain ON parent.id = chain.parent_autopilot_run_id
          WHERE chain.hops < 12
      )
      SELECT root, autopilot_id, depth, hops FROM chain`;
   let parent: string | null = null;
   let parentDepth = -1;
   const ancestry = new Set<string>();
   for (const row of rows) {
      ancestry.add(row.autopilot_id as string);
      if ((row.hops as number) === 0 && (row.depth as number) > parentDepth) {
         parent = row.root as string;
         parentDepth = row.depth as number;
      }
   }
   return { parentAutopilotRunId: parent, parentDepth, ancestry };
}
