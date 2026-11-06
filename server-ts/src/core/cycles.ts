import { randomUUID } from 'node:crypto';
import { toRFC3339, type Sql } from '../db/pool.ts';
import { Conflict, Forbidden, NotFound } from '../identity/errors.ts';
import { allows, type Permission } from '../identity/roles.ts';
import type { Scope } from './boards.ts';
import { dbStatusToApi, escapeSearchLiteral } from './issues.ts';
import type { ActorRef } from './comments.ts';
import { progressPercent } from './milestones.ts';

/**
 * Cycles — workspace-scoped timeboxes.
 *
 * An issue belongs to at most one cycle (`issues.cycle_id`). Progress percent
 * is derived from those issues the same way milestones do. At most one cycle
 * per workspace may be `active`.
 */

export type CycleStatus = 'upcoming' | 'active' | 'completed';

const STATUSES: readonly CycleStatus[] = ['upcoming', 'active', 'completed'];

export function isCycleStatus(value: string): value is CycleStatus {
   return (STATUSES as readonly string[]).includes(value);
}

export interface Cycle {
   id: string;
   workspaceId: string;
   number: number;
   name: string;
   startsOn: string;
   endsOn: string;
   status: CycleStatus;
   createdBy: string | null;
   createdAt: string;
   updatedAt: string;
}

export interface CycleProgress {
   issuesTotal: number;
   issuesDone: number;
   issuesCancelled: number;
   issuesWorking: number;
   percent: number;
}

export interface CycleCursor {
   updatedAt: string;
   id: string;
}

export interface CycleEvent {
   id: string;
   type: string;
   workspaceId: string;
   payload: string;
   occurredAt: Date;
}

export interface CycleLinkedIssue {
   id: string;
   identifier: string;
   title: string;
   status: string;
}

export interface CyclePatch {
   name?: string;
   startsOn?: string;
   endsOn?: string;
   startsOnSet?: boolean;
   endsOnSet?: boolean;
}

const CYCLE_COLUMNS = `
   cycle.id, cycle.workspace_id, cycle.number, cycle.name,
   cycle.starts_on, cycle.ends_on, cycle.status,
   cycle.created_by, cycle.created_at, cycle.updated_at`;

function emptyProgress(): CycleProgress {
   return {
      issuesTotal: 0,
      issuesDone: 0,
      issuesCancelled: 0,
      issuesWorking: 0,
      percent: 0,
   };
}

function asDateOnly(value: unknown): string {
   if (value == null) return '';
   if (typeof value === 'string') return value.slice(0, 10);
   if (value instanceof Date) return value.toISOString().slice(0, 10);
   return String(value).slice(0, 10);
}

export class CycleRepository {
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

   async authorize(userId: string, cycleId: string, permission: Permission): Promise<Scope> {
      const [row] = await this.sql`
         SELECT workspace_id FROM cycles WHERE id = ${cycleId} AND deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return this.authorizeWorkspace(userId, row.workspace_id as string, permission);
   }

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

   async get(cycleId: string): Promise<Cycle> {
      const [row] = await this.sql`
         SELECT ${this.sql.unsafe(CYCLE_COLUMNS)}
           FROM cycles AS cycle WHERE cycle.id = ${cycleId} AND cycle.deleted_at IS NULL`;
      if (!row) throw new NotFound();
      return toCycle(row);
   }

   async list(
      workspaceId: string,
      filter: { query: string; status: CycleStatus | null },
      after: CycleCursor | null,
      limit: number
   ): Promise<Cycle[]> {
      const like = escapeSearchLiteral(filter.query);
      const rows = await this.sql`
         SELECT ${this.sql.unsafe(CYCLE_COLUMNS)}
           FROM cycles AS cycle
          WHERE cycle.workspace_id = ${workspaceId}
            AND cycle.deleted_at IS NULL
            AND (${filter.status ?? ''} = '' OR cycle.status = ${filter.status ?? ''})
            AND (${filter.query} = '' OR cycle.name ILIKE ${like} ESCAPE E'\\\\')
            AND (
               ${after === null}
               OR (cycle.updated_at, cycle.id)
                   < (${after?.updatedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid)
            )
          ORDER BY cycle.updated_at DESC, cycle.id DESC
          LIMIT ${limit}`;
      return rows.map(toCycle);
   }

   async create(params: {
      workspaceId: string;
      name?: string | null;
      startsOn: string;
      endsOn: string;
      status?: CycleStatus;
      createdBy: string;
      createdAt: string;
   }): Promise<{ cycle: Cycle; event: CycleEvent }> {
      const id = this.newId();
      const status = params.status ?? 'upcoming';
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         if (status === 'active') {
            await clearActive(tx, params.workspaceId, null);
         }
         const number = await nextNumber(tx, params.workspaceId);
         const name = (params.name ?? '').trim() || `Cycle ${number}`;
         const [row] = await tx`
            INSERT INTO cycles AS cycle (
               id, workspace_id, number, name, starts_on, ends_on, status,
               created_by, created_at, updated_at
            ) VALUES (
               ${id}, ${params.workspaceId}, ${number}, ${name},
               ${params.startsOn}::date, ${params.endsOn}::date, ${status},
               ${params.createdBy}, ${params.createdAt}, ${params.createdAt}
            )
            RETURNING ${tx.unsafe(CYCLE_COLUMNS)}`.catch(classifyWrite);
         const cycle = toCycle(row!);
         const event = await this.writeEvent(tx, 'cycle.created', cycle, [], params.createdBy, params.createdAt);
         return { cycle, event };
      }) as Promise<{ cycle: Cycle; event: CycleEvent }>;
   }

   async update(
      cycleId: string,
      patch: CyclePatch,
      actorId: string,
      now: string
   ): Promise<{ cycle: Cycle; event: CycleEvent }> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const current = await lockCycle(tx, cycleId);
         const changed: string[] = [];
         if (patch.name !== undefined && patch.name !== current.name) changed.push('name');
         if (patch.startsOnSet) changed.push('startsOn');
         if (patch.endsOnSet) changed.push('endsOn');

         const startsOn = patch.startsOnSet ? patch.startsOn ?? current.startsOn : current.startsOn;
         const endsOn = patch.endsOnSet ? patch.endsOn ?? current.endsOn : current.endsOn;
         if (endsOn < startsOn) throw new Conflict();

         const [row] = await tx`
            UPDATE cycles AS cycle SET
               name = COALESCE(${patch.name ?? null}, cycle.name),
               starts_on = CASE WHEN ${patch.startsOnSet === true}
                  THEN ${patch.startsOn ?? null}::date ELSE cycle.starts_on END,
               ends_on = CASE WHEN ${patch.endsOnSet === true}
                  THEN ${patch.endsOn ?? null}::date ELSE cycle.ends_on END,
               updated_at = ${now}
             WHERE cycle.id = ${cycleId}
             RETURNING ${tx.unsafe(CYCLE_COLUMNS)}`.catch(classifyWrite);
         const cycle = toCycle(row!);
         const event = await this.writeEvent(tx, 'cycle.updated', cycle, changed, actorId, now);
         return { cycle, event };
      }) as Promise<{ cycle: Cycle; event: CycleEvent }>;
   }

   async transition(
      cycleId: string,
      to: CycleStatus,
      actorId: string,
      now: string
   ): Promise<{ cycle: Cycle; event: CycleEvent | null }> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const current = await lockCycle(tx, cycleId);
         if (current.status === to) return { cycle: current, event: null };
         if (to === 'active') {
            await clearActive(tx, current.workspaceId, cycleId);
         }
         const [row] = await tx`
            UPDATE cycles AS cycle SET status = ${to}, updated_at = ${now}
             WHERE cycle.id = ${cycleId}
             RETURNING ${tx.unsafe(CYCLE_COLUMNS)}`.catch(classifyWrite);
         const cycle = toCycle(row!);
         const event = await this.writeEvent(tx, 'cycle.updated', cycle, ['status'], actorId, now);
         return { cycle, event };
      }) as Promise<{ cycle: Cycle; event: CycleEvent | null }>;
   }

   async archive(cycleId: string, actorId: string, now: string): Promise<CycleEvent> {
      return this.sql.begin(async (transaction) => {
         const tx = transaction as unknown as Sql;
         const cycle = await lockCycle(tx, cycleId);
         await tx`UPDATE cycles SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${cycleId}`;
         await tx`UPDATE issues SET cycle_id = NULL, updated_at = ${now} WHERE cycle_id = ${cycleId}`;
         return this.writeEvent(tx, 'cycle.archived', cycle, [], actorId, now);
      }) as Promise<CycleEvent>;
   }

   async listIssues(cycleId: string, limit = 500): Promise<CycleLinkedIssue[]> {
      const rows = await this.sql`
         SELECT issue.id, berry_issue_identifier(board.workspace_id, issue.number) AS identifier,
                issue.title, issue.status::text AS status
           FROM issues AS issue
           JOIN boards AS board ON board.id = issue.board_id
          WHERE issue.cycle_id = ${cycleId} AND issue.deleted_at IS NULL
          ORDER BY issue.number ASC, issue.id ASC
          LIMIT ${limit}`;
      return rows.map((row) => ({
         id: row.id as string,
         identifier: row.identifier as string,
         title: row.title as string,
         status: dbStatusToApi(row.status as string),
      }));
   }

   async progress(cycleId: string): Promise<CycleProgress> {
      const counted = await this.progressMany([cycleId]);
      return counted.get(cycleId) ?? emptyProgress();
   }

   async progressMany(cycleIds: string[]): Promise<Map<string, CycleProgress>> {
      const wanted = [...new Set(cycleIds.filter(Boolean))];
      const result = new Map(wanted.map((id) => [id, emptyProgress()]));
      if (wanted.length === 0) return result;

      const issueRows = await this.sql`
         SELECT issue.cycle_id,
                count(*) AS issues_total,
                count(*) FILTER (WHERE issue.status = 'done') AS issues_done,
                count(*) FILTER (WHERE issue.status = 'cancelled') AS issues_cancelled,
                count(*) FILTER (WHERE issue.status IN ('in_progress', 'in_review')) AS issues_working
           FROM issues AS issue
          WHERE issue.cycle_id = ANY(${wanted}::uuid[])
            AND issue.deleted_at IS NULL
          GROUP BY issue.cycle_id`;
      for (const row of issueRows) {
         const current = result.get(row.cycle_id as string);
         if (!current) continue;
         current.issuesTotal = Number(row.issues_total);
         current.issuesDone = Number(row.issues_done);
         current.issuesCancelled = Number(row.issues_cancelled);
         current.issuesWorking = Number(row.issues_working);
         current.percent = progressPercent(current);
      }
      return result;
   }

   private async writeEvent(
      tx: Sql,
      topic: string,
      cycle: Cycle,
      changed: string[],
      actorId: string | null,
      occurredAt: string
   ): Promise<CycleEvent> {
      const eventId = this.newId();
      const payload = {
         cycle: serializeCycle(cycle),
         changedFields: changed,
         ...(actorId ? { actor: { type: 'user', id: actorId } } : {}),
      };
      const envelope = {
         id: eventId,
         type: topic,
         occurredAt: toRFC3339(occurredAt),
         workspaceId: cycle.workspaceId,
         boardId: null,
         aggregateType: 'cycle',
         aggregateId: cycle.id,
         payload,
      };
      await tx`
         INSERT INTO outbox_events (
            id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
            payload, occurred_at, available_at
         ) VALUES (
            ${eventId}, ${topic}, 'cycle', ${cycle.id}, ${cycle.workspaceId}, NULL,
            ${tx.json(envelope as never)}, ${occurredAt}, ${occurredAt}
         )`;
      return {
         id: eventId,
         type: topic,
         workspaceId: cycle.workspaceId,
         payload: JSON.stringify(payload),
         occurredAt: new Date(occurredAt),
      };
   }
}

async function lockCycle(tx: Sql, cycleId: string): Promise<Cycle> {
   const [row] = await tx`
      SELECT ${tx.unsafe(CYCLE_COLUMNS)}
        FROM cycles AS cycle WHERE cycle.id = ${cycleId} AND cycle.deleted_at IS NULL
        FOR UPDATE`;
   if (!row) throw new NotFound();
   return toCycle(row);
}

async function clearActive(tx: Sql, workspaceId: string, exceptId: string | null): Promise<void> {
   await tx`
      UPDATE cycles
         SET status = 'completed', updated_at = now()
       WHERE workspace_id = ${workspaceId}
         AND deleted_at IS NULL
         AND status = 'active'
         AND (${exceptId === null} OR id <> ${exceptId}::uuid)`;
}

async function nextNumber(sql: Sql, workspaceId: string): Promise<number> {
   const [row] = await sql`
      SELECT coalesce(max(number), 0) + 1 AS next
        FROM cycles
       WHERE workspace_id = ${workspaceId}`;
   return Number(row?.next ?? 1);
}

function toCycle(row: Record<string, unknown>): Cycle {
   return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      number: Number(row.number),
      name: row.name as string,
      startsOn: asDateOnly(row.starts_on),
      endsOn: asDateOnly(row.ends_on),
      status: row.status as CycleStatus,
      createdBy: (row.created_by as string | null) ?? null,
      createdAt: toRFC3339(row.created_at as string) ?? '',
      updatedAt: toRFC3339(row.updated_at as string) ?? '',
   };
}

export function serializeCycle(cycle: Cycle): Record<string, unknown> {
   return {
      id: cycle.id,
      workspaceId: cycle.workspaceId,
      number: cycle.number,
      name: cycle.name,
      startsOn: cycle.startsOn,
      endsOn: cycle.endsOn,
      status: cycle.status,
      createdBy: cycle.createdBy,
      createdAt: cycle.createdAt,
      updatedAt: cycle.updatedAt,
   };
}

function classifyWrite(error: unknown): never {
   const code = (error as { code?: string })?.code;
   if (code === '23503' || code === '23514') throw new NotFound();
   if (code === '23505' || code === '23P01') throw new Conflict();
   throw error;
}
