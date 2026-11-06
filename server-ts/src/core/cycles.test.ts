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
   await deleteWorkspaceBoards(sql, [fixture.workspaceId]);
   await deleteWorkspaceAgents(sql, [fixture.workspaceId]);
   await sql`DELETE FROM workspace_memberships WHERE workspace_id = ${fixture.workspaceId}`;
   await sql`DELETE FROM workspaces WHERE id = ${fixture.workspaceId}`;
   await sql`DELETE FROM users WHERE id IN (${fixture.userId}, ${fixture.otherId})`;
}
