import { randomUUID } from 'node:crypto';
import { toRFC3339, type Sql } from '../db/pool.ts';
import { Conflict, Forbidden, NotFound } from '../identity/errors.ts';
import { allows, type Permission } from '../identity/roles.ts';
import type { Scope } from './boards.ts';
import { dbStatusToApi, escapeSearchLiteral } from './issues.ts';
import type { ActorRef } from './comments.ts';

/**
 * Milestones.
 *
 * Authored stages inside one project: title, optional description, optional
 * target date, manual sort order. Issues link to at most one. Progress percent
 * is derived from those issues (started work counts half, finished counts
 * full). Coarse `status` remains for SCM open/closed mapping.
 */

export type MilestoneStatus = 'draft' | 'planned' | 'active' | 'blocked' | 'completed' | 'cancelled';

const STATUSES: readonly MilestoneStatus[] = [
   'draft', 'planned', 'active', 'blocked', 'completed', 'cancelled',
];

/**
 * draft → planned → active ⇄ blocked → completed | cancelled.
 *
 * Terminal goals never move again, which is why `completed` and `cancelled`
 * name no successors: a goal that was cancelled and then reopened would leave
 * every count and every event describing it as finished wrong.
 */
const TRANSITIONS: Record<MilestoneStatus, readonly MilestoneStatus[]> = {
   draft: ['planned', 'active', 'cancelled'],
   planned: ['active', 'cancelled'],
   active: ['blocked', 'completed', 'cancelled'],
   blocked: ['active', 'completed', 'cancelled'],
   completed: [],
   cancelled: [],
};

export function isMilestoneStatus(value: string): value is MilestoneStatus {
   return (STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: MilestoneStatus, to: MilestoneStatus): boolean {
   return TRANSITIONS[from].includes(to);
}

export interface Milestone {
   id: string;
   workspaceId: string;
   projectId: string | null;
   title: string;
   description: string | null;
   status: MilestoneStatus;
   source: string;
   sourcePrompt: string | null;
   targetDate: string | null;
   sortOrder: number;
   createdBy: string | null;
   createdAt: string;
   updatedAt: string;
   startedAt: string | null;
   completedAt: string | null;
}

/** What the milestone's work adds up to. */
export interface Progress {
   issuesTotal: number;
   issuesDone: number;
   issuesCancelled: number;
   issuesWorking: number;
   approvalsPending: number;
   /** 0–100 from linked issues: finished + 0.5×working over total. */
   percent: number;
}

function emptyProgress(): Progress {
   return {
      issuesTotal: 0,
      issuesDone: 0,
      issuesCancelled: 0,
      issuesWorking: 0,
      approvalsPending: 0,
      percent: 0,
   };
}

export function progressPercent(progress: {
   issuesTotal: number;
   issuesDone: number;
   issuesCancelled: number;
   issuesWorking: number;
}): number {
   const total = progress.issuesTotal;
   if (total <= 0) return 0;
   const finished = progress.issuesDone + progress.issuesCancelled;
   return Math.round((100 * (finished + 0.5 * progress.issuesWorking)) / total);
}

export interface MilestoneCursor {
   updatedAt: string;
   id: string;
}

export interface MilestoneEvent {
   id: string;
   type: string;
   workspaceId: string;
   payload: string;
   occurredAt: Date;
}

export interface LinkedIssue {
   id: string;
   identifier: string;
   title: string;
   status: string;
   linkedAt: string;
}

/** A move the lifecycle does not allow, naming both ends. */
export class InvalidMilestoneTransition extends Error {
   readonly from: MilestoneStatus;
   readonly to: MilestoneStatus;

   constructor(from: MilestoneStatus, to: MilestoneStatus) {
      super(`goal cannot move from ${from} to ${to}`);
      this.name = 'InvalidMilestoneTransition';
      this.from = from;
      this.to = to;
   }
}

export interface MilestonePatch {
   title?: string;
   description?: string | null;
   descriptionSet?: boolean;
   projectId?: string | null;
   projectSet?: boolean;
   targetDate?: string | null;
   targetDateSet?: boolean;
   sortOrder?: number;
}

const MILESTONE_COLUMNS = `
   goal.id, goal.workspace_id, goal.project_id, goal.title, goal.description,
   goal.status, goal.source, goal.source_prompt, goal.target_date, goal.sort_order,
   goal.created_by, goal.created_at, goal.updated_at, goal.started_at, goal.completed_at`;

export class MilestoneRepository {
   private readonly sql: Sql;
   private readonly newId: () => string;

   constructor(sql: Sql, newId: () => string = randomUUID) {
      this.sql = sql;
      this.newId = newId;
   }

   async authorizeWorkspace(
      userId: string,
      workspaceId: string,
      permission: Permission
   ): Promise<Scope> {
      const [row] = await this.sql`
         SELECT membership.role::text AS role
           FROM workspace_memberships AS membership
           JOIN workspaces AS workspace
             ON workspace.id = membership.workspace_id AND workspace.deleted_at IS NULL
          WHERE membership.workspace_id = ${workspaceId} AND membership.user_id = ${userId}`;
      if (!row) throw new NotFound();
      const scope = { workspaceId, role: row.role as string };
      if (!allows(scope.role, permission)) throw new Forbidden();
      return scope;
   }

   /** Membership reached through the goal, so a caller cannot name a workspace. */
   async authorize(userId: string, milestoneId: string, permission: Permission): Promise<Scope> {
      const [row] = await this.sql`
         SELECT workspace_id FROM milestones WHERE id = ${milestoneId} AND deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return this.authorizeWorkspace(userId, row.workspace_id as string, permission);
   }

   /**
    * The people named as authors, resolved in one query.
    *
    * A list of twenty goals would otherwise be twenty lookups, and the answer
    * for most of them is the same handful of users.
    */
   async lookupAuthors(userIds: string[]): Promise<Map<string, ActorRef>> {
      const wanted = [...new Set(userIds.filter(Boolean))];
      if (wanted.length === 0) return new Map();
      const rows = await this.sql`
         SELECT id, name, avatar_url FROM users WHERE id = ANY(${wanted}::uuid[])`;
      return new Map(
         rows.map((row) => [
            row.id as string,
            {
               type: 'user',
               id: row.id as string,
               name: row.name as string,
               avatarUrl: (row.avatar_url as string | null) ?? null,
            } as ActorRef,
         ])
      );
   }

   async get(milestoneId: string): Promise<Milestone> {
      const [row] = await this.sql`
         SELECT ${this.sql.unsafe(MILESTONE_COLUMNS)}
           FROM milestones AS goal WHERE goal.id = ${milestoneId} AND goal.deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return toMilestone(row);
   }

   /**
    * One page. With a project filter, ordered by sort_order; otherwise most
    * recently updated first (workspace-wide reads).
    */
   async list(
      workspaceId: string,
      filter: { query: string; status: MilestoneStatus | null; projectId: string | null },
      after: MilestoneCursor | null,
      limit: number
   ): Promise<Milestone[]> {
      const like = escapeSearchLiteral(filter.query);
      // Project lists are short and ordered by hand; skip cursors and return
      // the ordered page. Workspace-wide lists stay cursor-paged by update time.
      if (filter.projectId !== null) {
         const rows = await this.sql`
            SELECT ${this.sql.unsafe(MILESTONE_COLUMNS)}
              FROM milestones AS goal
             WHERE goal.workspace_id = ${workspaceId}
               AND goal.deleted_at IS NULL
               AND (${filter.status ?? ''} = '' OR goal.status = ${filter.status ?? ''})
               AND goal.project_id = ${filter.projectId}::uuid
               AND (${filter.query} = '' OR goal.title ILIKE ${like} ESCAPE E'\\\\')
             ORDER BY goal.sort_order ASC, goal.id ASC
             LIMIT ${limit}`;
         return rows.map(toMilestone);
      }
      const rows = await this.sql`
         SELECT ${this.sql.unsafe(MILESTONE_COLUMNS)}
           FROM milestones AS goal
          WHERE goal.workspace_id = ${workspaceId}
            AND goal.deleted_at IS NULL
            AND (${filter.status ?? ''} = '' OR goal.status = ${filter.status ?? ''})
            AND (${filter.query} = '' OR goal.title ILIKE ${like} ESCAPE E'\\\\')
            AND (${after === null} OR (goal.updated_at, goal.id) < (${after?.updatedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
          ORDER BY goal.updated_at DESC, goal.id DESC
          LIMIT ${limit}`;
      return rows.map(toMilestone);
   }

   async create(params: {
      workspaceId: string;
      title: string;
      description?: string | null;
      projectId: string;
      targetDate?: string | null;
      sortOrder?: number;
      createdBy: string;
      createdAt: string;
   }): Promise<{ goal: Milestone; event: MilestoneEvent }> {
      const id = this.newId();
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const sortOrder =
            params.sortOrder ??
            (await nextSortOrder(tx, params.workspaceId, params.projectId));
         const [row] = await tx`
            INSERT INTO milestones AS goal (
               id, workspace_id, project_id, title, description, status, source,
               source_prompt, target_date, sort_order, created_by, created_at, updated_at, started_at
            ) VALUES (
               ${id}, ${params.workspaceId}, ${params.projectId}, ${params.title},
               ${params.description ?? null}, 'planned', 'manual', NULL,
               ${params.targetDate ?? null}, ${sortOrder}, ${params.createdBy},
               ${params.createdAt}, ${params.createdAt}, NULL
            )
            RETURNING ${tx.unsafe(MILESTONE_COLUMNS)}`.catch(classifyWrite);
         const goal = toMilestone(row!);
         const event = await this.writeEvent(tx, 'milestone.created', goal, [], params.createdBy, params.createdAt);
         return { goal, event };
      }) as Promise<{ goal: Milestone; event: MilestoneEvent }>;
   }

   /**
    * Applies a patch under a row lock and names what changed.
    *
    * The event carries the field names rather than the old values: a consumer
    * re-renders the goal it was just given, and the names are what tell it
    * whether it has to.
    */
   async update(
      milestoneId: string,
      patch: MilestonePatch,
      actorId: string,
      now: string
   ): Promise<{ goal: Milestone; event: MilestoneEvent }> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const current = await lockMilestone(tx, milestoneId);

         const changed: string[] = [];
         if (patch.title !== undefined && patch.title !== current.title) changed.push('title');
         if (patch.descriptionSet) changed.push('description');
         if (patch.projectSet) changed.push('project');
         if (patch.targetDateSet) changed.push('targetDate');
         if (patch.sortOrder !== undefined && patch.sortOrder !== current.sortOrder) {
            changed.push('sortOrder');
         }

         const [row] = await tx`
            UPDATE milestones AS goal SET
               title = COALESCE(${patch.title ?? null}, goal.title),
               description = CASE WHEN ${patch.descriptionSet === true}
                  THEN ${patch.description ?? null}::text ELSE goal.description END,
               project_id = CASE WHEN ${patch.projectSet === true}
                  THEN ${patch.projectId ?? null}::uuid ELSE goal.project_id END,
               target_date = CASE WHEN ${patch.targetDateSet === true}
                  THEN ${patch.targetDate ?? null}::date ELSE goal.target_date END,
               sort_order = COALESCE(${patch.sortOrder ?? null}::float8, goal.sort_order),
               updated_at = ${now}
             WHERE goal.id = ${milestoneId}
             RETURNING ${tx.unsafe(MILESTONE_COLUMNS)}`.catch(classifyWrite);
         const goal = toMilestone(row!);
         const event = await this.writeEvent(tx, 'milestone.updated', goal, changed, actorId, now);
         return { goal, event };
      }) as Promise<{ goal: Milestone; event: MilestoneEvent }>;
   }

   /**
    * Sets sort_order for every id in order (1..n) inside one project.
    * Unknown or foreign ids are refused.
    */
   async reorder(
      workspaceId: string,
      projectId: string,
      orderedIds: string[],
      actorId: string,
      now: string
   ): Promise<MilestoneEvent[]> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const existing = await tx`
            SELECT id FROM milestones
             WHERE workspace_id = ${workspaceId}
               AND project_id = ${projectId}
               AND deleted_at IS NULL
             FOR UPDATE`;
         const known = new Set(existing.map((row) => row.id as string));
         if (orderedIds.length !== known.size || orderedIds.some((id) => !known.has(id))) {
            throw new NotFound();
         }
         const events: MilestoneEvent[] = [];
         for (const [index, id] of orderedIds.entries()) {
            const sortOrder = index + 1;
            const [row] = await tx`
               UPDATE milestones AS goal
                  SET sort_order = ${sortOrder}, updated_at = ${now}
                WHERE goal.id = ${id}
                RETURNING ${tx.unsafe(MILESTONE_COLUMNS)}`;
            const goal = toMilestone(row!);
            events.push(await this.writeEvent(tx, 'milestone.updated', goal, ['sortOrder'], actorId, now));
         }
         return events;
      }) as Promise<MilestoneEvent[]>;
   }

   /**
    * Moves a goal along its lifecycle.
    *
    * Asking for the status it is already in is not a conflict — it is the
    * caller and the server agreeing — so it returns the goal with no event
    * rather than refusing.
    */
   async transition(
      milestoneId: string,
      to: MilestoneStatus,
      actorId: string | null,
      now: string
   ): Promise<{ goal: Milestone; event: MilestoneEvent | null }> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const current = await lockMilestone(tx, milestoneId);
         if (current.status === to) return { goal: current, event: null };
         if (!canTransition(current.status, to)) throw new InvalidMilestoneTransition(current.status, to);

         const [row] = await tx`
            UPDATE milestones AS goal SET
               status = ${to},
               started_at = CASE WHEN ${to} IN ('active', 'blocked')
                  THEN COALESCE(goal.started_at, ${now}) ELSE goal.started_at END,
               completed_at = CASE WHEN ${to} = 'completed' THEN ${now}::timestamptz ELSE NULL END,
               updated_at = ${now}
             WHERE goal.id = ${milestoneId}
             RETURNING ${tx.unsafe(MILESTONE_COLUMNS)}`.catch(classifyWrite);
         const goal = toMilestone(row!);

         // The topic says what happened, not merely that something did: a
         // consumer counting completions cannot get that from goal.updated.
         // `active` is only a start the first time — returning from blocked is
         // not a second beginning.
         let topic = 'milestone.updated';
         if (to === 'active' && current.startedAt === null) topic = 'milestone.started';
         else if (to === 'completed') topic = 'milestone.completed';
         else if (to === 'cancelled') topic = 'milestone.cancelled';

         const event = await this.writeEvent(tx, topic, goal, ['status'], actorId, now);
         return { goal, event };
      }) as Promise<{ goal: Milestone; event: MilestoneEvent | null }>;
   }

   /** Archives a goal. Soft, because issues and events still reference it. */
   async archive(milestoneId: string, actorId: string, now: string): Promise<MilestoneEvent> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const goal = await lockMilestone(tx, milestoneId);
         await tx`UPDATE milestones SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${milestoneId}`;
         return this.writeEvent(tx, 'milestone.archived', goal, [], actorId, now);
      }) as Promise<MilestoneEvent>;
   }

   /**
    * Attaches an issue, replacing any earlier goal.
    *
    * An issue belongs to at most one goal — the unique key is on the issue,
    * not on the pair — so linking is an upsert rather than an insert. A
    * trigger refuses an issue from another workspace.
    */
   async linkIssue(params: {
      workspaceId: string;
      milestoneId: string;
      issueId: string;
      actorId: string;
      now: string;
   }): Promise<void> {
      await this.sql`
         INSERT INTO milestone_issues (workspace_id, issue_id, milestone_id, linked_by, created_at)
         VALUES (${params.workspaceId}, ${params.issueId}, ${params.milestoneId}, ${params.actorId}, ${params.now})
         ON CONFLICT (issue_id) DO UPDATE
            SET milestone_id = EXCLUDED.milestone_id,
                workspace_id = EXCLUDED.workspace_id,
                linked_by = EXCLUDED.linked_by,
                created_at = EXCLUDED.created_at`.catch(classifyWrite);
   }

   async unlinkIssue(milestoneId: string, issueId: string): Promise<void> {
      const removed = await this.sql`
         DELETE FROM milestone_issues WHERE milestone_id = ${milestoneId} AND issue_id = ${issueId}`;
      if (removed.count === 0) throw new NotFound();
   }

   /** The live issues linked to a goal, oldest link first. */
   async listIssues(milestoneId: string, limit = 500): Promise<LinkedIssue[]> {
      const rows = await this.sql`
         SELECT issue.id, berry_issue_identifier(board.workspace_id, issue.number) AS identifier,
                issue.title, issue.status::text AS status, link.created_at
           FROM milestone_issues AS link
           JOIN issues AS issue ON issue.id = link.issue_id AND issue.deleted_at IS NULL
           JOIN boards AS board ON board.id = issue.board_id
          WHERE link.milestone_id = ${milestoneId}
          ORDER BY link.created_at ASC, issue.number ASC, issue.id ASC
          LIMIT ${limit}`;
      return rows.map((row) => ({
         id: row.id as string,
         identifier: row.identifier as string,
         title: row.title as string,
         status: dbStatusToApi(row.status as string),
         linkedAt: toRFC3339(row.created_at as string) ?? '',
      }));
   }

   /**
    * What the goal's work adds up to.
    *
    * Approvals count whether they target the goal directly or one of its
    * issues — a decision blocking an issue is blocking the goal.
    */
   async progress(milestoneId: string): Promise<Progress> {
      const counted = await this.progressMany([milestoneId]);
      return counted.get(milestoneId) ?? emptyProgress();
   }

   /**
    * Progress for a page of goals, in two queries rather than one per row.
    *
    * The list renders a bar beside every goal, so a listing that omitted the
    * counts would pay for a round trip per row later, or show a dash forever.
    */
   async progressMany(milestoneIds: string[]): Promise<Map<string, Progress>> {
      const wanted = [...new Set(milestoneIds.filter(Boolean))];
      const result = new Map(wanted.map((id) => [id, emptyProgress()]));
      if (wanted.length === 0) return result;

      const issueRows = await this.sql`
         SELECT link.milestone_id,
                count(*) AS issues_total,
                count(*) FILTER (WHERE issue.status = 'done') AS issues_done,
                count(*) FILTER (WHERE issue.status = 'cancelled') AS issues_cancelled,
                count(*) FILTER (WHERE issue.status IN ('in_progress', 'in_review')) AS issues_working
           FROM milestone_issues AS link
           JOIN issues AS issue ON issue.id = link.issue_id AND issue.deleted_at IS NULL
          WHERE link.milestone_id = ANY(${wanted}::uuid[])
          GROUP BY link.milestone_id`;
      for (const row of issueRows) {
         const current = result.get(row.milestone_id as string);
         if (!current) continue;
         current.issuesTotal = Number(row.issues_total);
         current.issuesDone = Number(row.issues_done);
         current.issuesCancelled = Number(row.issues_cancelled);
         current.issuesWorking = Number(row.issues_working);
         current.percent = progressPercent(current);
      }

      const approvalRows = await this.sql`
         SELECT pending.milestone_id, count(*) AS approvals_pending
           FROM (
              SELECT approval.id, approval.milestone_id
                FROM approvals AS approval
               WHERE approval.status = 'pending'
                 AND approval.milestone_id = ANY(${wanted}::uuid[])
              UNION
              SELECT approval.id, link.milestone_id
                FROM approvals AS approval
                JOIN milestone_issues AS link ON link.issue_id = approval.issue_id
               WHERE approval.status = 'pending'
                 AND link.milestone_id = ANY(${wanted}::uuid[])
           ) AS pending
          GROUP BY pending.milestone_id`;
      for (const row of approvalRows) {
         const current = result.get(row.milestone_id as string);
         if (!current) continue;
         current.approvalsPending = Number(row.approvals_pending);
      }
      return result;
   }

   /**
    * The goal's approvals and plans.
    *
    * Two reads of tables no mount here owns. That is fine because they depend
    * on the tables and not on that code: a goal has to be able to say what
    * points at it without owning any of it.
    */
   async listApprovals(milestoneId: string, workspaceId: string, limit = 100) {
      const rows = await this.sql`
         SELECT approval.id, approval.kind::text AS kind, approval.risk::text AS risk,
                approval.title, approval.status::text AS status,
                approval.issue_id, approval.requested_at
           FROM approvals AS approval
          WHERE approval.workspace_id = ${workspaceId}
            AND (approval.milestone_id = ${milestoneId}
                 OR approval.issue_id IN (SELECT issue_id FROM milestone_issues WHERE milestone_id = ${milestoneId}))
          ORDER BY approval.requested_at DESC, approval.id DESC
          LIMIT ${limit}`;
      return rows.map((row) => ({
         id: row.id as string,
         kind: row.kind as string,
         risk: row.risk as string,
         title: row.title as string,
         status: row.status as string,
         issueId: (row.issue_id as string | null) ?? null,
         requestedAt: toRFC3339(row.requested_at as string) ?? '',
      }));
   }

   async listPlans(milestoneId: string, limit = 100) {
      const rows = await this.sql`
         SELECT id, status::text AS status, source::text AS source, current_version,
                generation_status::text AS generation_status,
                validation_status::text AS validation_status,
                compile_status::text AS compile_status, created_at
           FROM plans
          WHERE milestone_id = ${milestoneId}
             -- A plan names one goal but can create several; the others
             -- reach it through their tasks, which remember both.
             OR EXISTS (SELECT 1 FROM plan_issues AS made
                          JOIN milestone_issues AS membership ON membership.issue_id = made.issue_id
                         WHERE made.plan_id = plans.id AND membership.milestone_id = ${milestoneId})
          ORDER BY created_at DESC, id DESC
          LIMIT ${limit}`;
      return rows.map((row) => ({
         id: row.id as string,
         // `pending_approval` is the only status spelled differently on the
         // wire, and it is the one a plan sits in longest.
         status: row.status === 'pending_approval' ? 'pendingApproval' : (row.status as string),
         source: row.source as string,
         version: Number(row.current_version),
         generationStatus: row.generation_status as string,
         validationStatus: row.validation_status as string,
         compileStatus: row.compile_status as string,
         createdAt: toRFC3339(row.created_at as string) ?? '',
      }));
   }

   /**
    * One goal fact, in the collaboration envelope every workspace-scoped event
    * uses: {id, type, occurredAt, workspaceId, aggregateType, aggregateId,
    * payload}.
    */
   private async writeEvent(
      tx: Sql,
      topic: string,
      goal: Milestone,
      changed: string[],
      actorId: string | null,
      occurredAt: string
   ): Promise<MilestoneEvent> {
      const eventId = this.newId();
      const payload = {
         milestone: serializeMilestone(goal),
         changedFields: changed,
         ...(actorId ? { actor: { type: 'user', id: actorId } } : {}),
      };
      const envelope = {
         id: eventId,
         type: topic,
         occurredAt: toRFC3339(occurredAt),
         workspaceId: goal.workspaceId,
         // A goal belongs to no board, which is what keeps it out of the board
         // replay's partial index and in the workspace stream.
         boardId: null,
         aggregateType: 'milestone',
         aggregateId: goal.id,
         payload,
      };
      await tx`
         INSERT INTO outbox_events (
            id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
            payload, occurred_at, available_at
         ) VALUES (
            ${eventId}, ${topic}, 'milestone', ${goal.id}, ${goal.workspaceId}, NULL,
            ${tx.json(envelope as never)}, ${occurredAt}, ${occurredAt}
         )`;
      return {
         id: eventId,
         type: topic,
         workspaceId: goal.workspaceId,
         payload: JSON.stringify(payload),
         occurredAt: new Date(occurredAt),
      };
   }
}

async function lockMilestone(tx: Sql, milestoneId: string): Promise<Milestone> {
   const [row] = await tx`
      SELECT ${tx.unsafe(MILESTONE_COLUMNS)}
        FROM milestones AS goal WHERE goal.id = ${milestoneId} AND goal.deleted_at IS NULL
        FOR UPDATE`;
   if (!row) throw new NotFound();
   return toMilestone(row);
}

function toMilestone(row: Record<string, unknown>): Milestone {
   const target = row.target_date;
   return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      projectId: (row.project_id as string | null) ?? null,
      title: row.title as string,
      description: (row.description as string | null) ?? null,
      status: row.status as MilestoneStatus,
      source: row.source as string,
      sourcePrompt: (row.source_prompt as string | null) ?? null,
      targetDate:
         target == null
            ? null
            : typeof target === 'string'
              ? target.slice(0, 10)
              : target instanceof Date
                ? target.toISOString().slice(0, 10)
                : String(target).slice(0, 10),
      sortOrder: Number(row.sort_order ?? 0),
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
      startedAt: toRFC3339(row.started_at as string | null),
      completedAt: toRFC3339(row.completed_at as string | null),
   };
}

/** The milestone as an event payload carries it: the same fields, no progress. */
export function serializeMilestone(goal: Milestone): Record<string, unknown> {
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
      createdBy: goal.createdBy,
      createdAt: goal.createdAt,
      updatedAt: goal.updatedAt,
      startedAt: goal.startedAt,
      completedAt: goal.completedAt,
   };
}

async function nextSortOrder(sql: Sql, workspaceId: string, projectId: string): Promise<number> {
   const [row] = await sql`
      SELECT coalesce(max(sort_order), 0) + 1 AS next
        FROM milestones
       WHERE workspace_id = ${workspaceId}
         AND project_id = ${projectId}
         AND deleted_at IS NULL`;
   return Number(row?.next ?? 1);
}

function classifyWrite(error: unknown): never {
   const code = (error as { code?: string })?.code;
   if (code === '23503' || code === '23514') throw new NotFound();
   if (code === '23505' || code === '23P01') throw new Conflict();
   throw error;
}
