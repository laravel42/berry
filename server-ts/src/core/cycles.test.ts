import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { CycleRepository } from './cycles.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { progressPercent } from './milestones.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

test('cycle progress uses the same weighting as milestones', () => {
   assert.equal(
      progressPercent({ issuesTotal: 4, issuesDone: 2, issuesCancelled: 0, issuesWorking: 2 }),
      75
   );
});

describe('cycles', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let cycles: CycleRepository;
   const fixture = { workspaceId: '', boardId: '', userId: '', otherId: '' };

   before(async () => {
      sql = openDatabase({ url: url! });
      cycles = new CycleRepository(sql);
      await seed(sql, fixture);
   });

   after(async () => {
      await cleanup(sql, fixture);
      await closeDatabase(sql);
   });

   const now = () => new Date().toISOString();

   test('creates numbered cycles and enforces one active', async () => {
      const first = await cycles.create({
         workspaceId: fixture.workspaceId,
         startsOn: '2026-01-01',
         endsOn: '2026-01-14',
         status: 'active',
         createdBy: fixture.userId,
         createdAt: now(),
      });
      assert.equal(first.cycle.number, 1);
      assert.equal(first.cycle.name, 'Cycle 1');
      assert.equal(first.cycle.status, 'active');
      assert.equal(first.event.type, 'cycle.created');

      const second = await cycles.create({
         workspaceId: fixture.workspaceId,
         name: 'Sprint B',
         startsOn: '2026-01-15',
         endsOn: '2026-01-28',
         status: 'active',
         createdBy: fixture.userId,
         createdAt: now(),
      });
      assert.equal(second.cycle.number, 2);
      assert.equal(second.cycle.status, 'active');

      const previous = await cycles.get(first.cycle.id);
      assert.equal(previous.status, 'completed');
   });

   test('lists and archives', async () => {
      const created = await cycles.create({
         workspaceId: fixture.workspaceId,
         startsOn: '2026-02-01',
         endsOn: '2026-02-14',
         createdBy: fixture.userId,
         createdAt: now(),
      });
      const listed = await cycles.list(
         fixture.workspaceId,
         { query: '', status: null },
         null,
         50
      );
      assert.ok(listed.some((row) => row.id === created.cycle.id));

      await cycles.archive(created.cycle.id, fixture.userId, now());
      await assert.rejects(() => cycles.get(created.cycle.id), NotFound);
   });

   test('lists a cycle’s tasks with their assignee and when each was done', async () => {
      const { cycle } = await cycles.create({
         workspaceId: fixture.workspaceId,
         startsOn: '2026-03-01',
         endsOn: '2026-03-14',
         createdBy: fixture.userId,
         createdAt: now(),
      });
      const open = await createIssue(sql, fixture, 'Still open', cycle.id);
      const finished = await createIssue(sql, fixture, 'Finished', cycle.id);
      const quiet = await createIssue(sql, fixture, 'Done without an event', cycle.id);
      await sql`
         UPDATE issues SET assignee_type = 'user', assignee_id = ${fixture.userId}
          WHERE id = ${open}`;
      await sql`UPDATE issues SET status = 'done' WHERE id IN (${finished}, ${quiet})`;
      const completedAt = '2026-03-04T10:00:00.000Z';
      await sql`
         INSERT INTO outbox_events (
            id, topic, aggregate_type, aggregate_id, workspace_id, board_id,
            payload, occurred_at, available_at
         ) VALUES (
            ${randomUUID()}, 'issue.completed', 'issue', ${finished}, ${fixture.workspaceId},
            ${fixture.boardId}, ${sql.json({ issueId: finished })}, ${completedAt}, ${completedAt}
         )`;

      const listed = await cycles.listIssues(cycle.id);
      const byTitle = new Map(listed.map((issue) => [issue.title, issue]));
      assert.equal(listed.length, 3);
      assert.equal(byTitle.get('Still open')?.completedAt, null);
      assert.deepEqual(byTitle.get('Still open')?.assignee, {
         type: 'user',
         id: fixture.userId,
         name: 'Cycle Owner',
         avatarUrl: null,
      });
      assert.equal(byTitle.get('Finished')?.status, 'done');
      assert.equal(
         new Date(byTitle.get('Finished')?.completedAt ?? '').toISOString(),
         completedAt
      );
      assert.equal(byTitle.get('Finished')?.assignee, null);
      // Done some other way: its last write stands in for the event.
      assert.ok(byTitle.get('Done without an event')?.completedAt);
   });

   test('authorize refuses outsiders', async () => {
      await assert.rejects(
         () => cycles.authorizeWorkspace(fixture.otherId, fixture.workspaceId, 'product.read'),
         Forbidden
      );
   });
});

async function seed(
   sql: Sql,
   fixture: { workspaceId: string; boardId: string; userId: string; otherId: string }
): Promise<void> {
   const workspaceId = randomUUID();
   const userId = randomUUID();
   const otherId = randomUUID();
   const boardId = randomUUID();
   await sql`INSERT INTO users (id, email, name) VALUES
      (${userId}, ${`cycle-${userId}@berry.test`}, 'Cycle Owner'),
      (${otherId}, ${`cycle-${otherId}@berry.test`}, 'Outsider')`;
   await sql`
      INSERT INTO workspaces (id, name, slug, created_by)
      VALUES (${workspaceId}, 'Cycles', ${`cyc-${workspaceId.slice(0, 8)}`}, ${userId})`;
   await sql`
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${userId}, 'owner')`;
   await sql`
      INSERT INTO boards (id, workspace_id, name, slug, created_by)
      VALUES (${boardId}, ${workspaceId}, 'Main', 'main', ${userId})`;
   fixture.workspaceId = workspaceId;
   fixture.boardId = boardId;
   fixture.userId = userId;
   fixture.otherId = otherId;
}

async function cleanup(
   sql: Sql,
   fixture: { workspaceId: string; boardId: string; userId: string; otherId: string }
): Promise<void> {
   await sql`DELETE FROM cycles WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM issues WHERE board_id = ${fixture.boardId}`;
   await sql`DELETE FROM outbox_events WHERE workspace_id = ${fixture.workspaceId}`;
   await deleteWorkspaceBoards(sql, [fixture.workspaceId]);
   await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
   await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
   await sql`DELETE FROM users WHERE id IN (${fixture.userId}, ${fixture.otherId})`;
}

async function createIssue(
   sql: Sql,
   fixture: { boardId: string; userId: string },
   title: string,
   cycleId: string
): Promise<string> {
   const id = randomUUID();
   const [counter] = await sql`
      UPDATE boards SET issue_counter = issue_counter + 1 WHERE id = ${fixture.boardId}
      RETURNING issue_counter`;
   await sql`
      INSERT INTO issues (id, board_id, number, title, created_by, cycle_id)
      VALUES (${id}, ${fixture.boardId}, ${Number(counter!.issue_counter)}, ${title},
              ${fixture.userId}, ${cycleId})`;
   return id;
}
