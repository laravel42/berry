import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { pickupReadyAgentTasks } from './pickup.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('ready assigned pickup', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'pickup');
   });

   after(async () => {
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   test('an agent-assigned todo with no run is admitted', async () => {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      await sql`
         UPDATE issues
            SET assignee_type = 'agent', assignee_id = ${f.agentId}
          WHERE id = ${issueId}`;
      const started = await pickupReadyAgentTasks(sql, { workspaceIds: [f.workspaceId], limit: 8 });
      assert.equal(started, 1);
      const [issue] = await sql`SELECT active_run_id FROM issues WHERE id = ${issueId}`;
      assert.ok(issue?.active_run_id);
      const [run] = await sql`SELECT source, status FROM runs WHERE id = ${issue!.active_run_id}`;
      assert.equal(run?.source, 'assignment');
      assert.equal(run?.status, 'queued');
   });

   test('a backlog task is left for someone to pull forward', async () => {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      await sql`
         UPDATE issues
            SET status = 'backlog', assignee_type = 'agent', assignee_id = ${f.agentId},
                active_run_id = NULL
          WHERE id = ${issueId}`;
      const started = await pickupReadyAgentTasks(sql, { workspaceIds: [f.workspaceId], limit: 8 });
      assert.equal(started, 0);
      const [issue] = await sql`SELECT active_run_id FROM issues WHERE id = ${issueId}`;
      assert.equal(issue?.active_run_id, null);
   });
});
