import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { openDatabase, closeDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { createLogger } from '../observability/log.ts';
import { enqueueTask } from './queue.ts';
import { FollowupWorker, scheduleMention, scheduleReview } from './followups.ts';

describe('durable run followups', { skip: !process.env.BERRY_TEST_DATABASE_URL }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;
   before(async () => { sql = openDatabase({ url: process.env.BERRY_TEST_DATABASE_URL ?? '' }); fixture = await seedFixture(sql, 'followup'); });
   after(async () => { await cleanupFixture(sql, fixture); await closeDatabase(sql); });
   test('review waits for parent success and survives a new worker instance', async () => {
      assert.ok(fixture);
      const issueId = await createIssue(sql, fixture);
      const { runId } = await enqueueTask(sql, { workspaceId: fixture.workspaceId, issueId, agentId: fixture.agentId, kind: 'agent', source: 'assignment' });
      await scheduleReview(sql, runId);
      await scheduleReview(sql, runId);
      let reviewed = 0;
      const worker = () => new FollowupWorker({ sql, workspaceIds: [fixture?.workspaceId ?? ''], review: async (id) => { assert.equal(id, runId); reviewed++; }, logger: createLogger('test') });
      await worker().tick();
      assert.equal(reviewed, 0);
      await sql`UPDATE runs SET status = 'succeeded', dispatch_state = 'succeeded', completed_at = now() WHERE id = ${runId}`;
      await worker().tick();
      await worker().tick();
      assert.equal(reviewed, 1);
   });
   test('duplicate mentions create exactly one downstream run', async () => {
      assert.ok(fixture);
      const issueId = await createIssue(sql, fixture);
      const { runId } = await enqueueTask(sql, { workspaceId: fixture.workspaceId, issueId, agentId: fixture.agentId, kind: 'agent', source: 'assignment' });
      const one = await scheduleMention(sql, runId, fixture.orchestratorId, 'Review this');
      const two = await scheduleMention(sql, runId, fixture.orchestratorId, 'Review this');
      assert.equal(one, two);
      await sql`UPDATE runs SET status = 'succeeded', dispatch_state = 'succeeded', completed_at = now() WHERE id = ${runId}`;
      const worker = new FollowupWorker({ sql, workspaceIds: [fixture?.workspaceId ?? ''], review: async () => {}, logger: createLogger('test') });
      await worker.tick(); await worker.tick();
      const rows = await sql`SELECT id FROM runs WHERE issue_id = ${issueId} AND source = 'mention'`;
      assert.equal(rows.length, 1);
   });
});
