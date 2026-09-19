import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { LIMIT_CODE, continuationInstructions, continuationNote, continueAfterLimit } from './continuation.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

test('the next segment is told where the work is and not to start over', () => {
   const text = continuationInstructions({ branch: 'devops/l42-425', commit: 'e687a34aaaaaaaa', attempt: 2, of: 3 });
   assert.match(text, /continuation 2 of at most 3/);
   assert.match(text, /branch devops\/l42-425 \(commit e687a34\)/);
   assert.match(text, /Do not start over/);
});

test('the failed run’s comment says what happens next, or why nothing does', () => {
   assert.match(continuationNote({ continued: true, runId: 'r', attempt: 1, of: 3 }), /queued a continuation .*\(1 of 3\)/);
   assert.match(continuationNote({ continued: false, reason: 'cap_reached' }), /limit of automatic continuations/);
   assert.match(continuationNote({ continued: false, reason: 'no_progress' }), /no new commit/);
   assert.equal(continuationNote({ continued: false, reason: 'busy' }), '');
});

describe('continuation after a step limit', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;
   let clock = 0;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'continuation');
   });
   afterEach(async () => {
      await sql`DELETE FROM runs WHERE workspace_id = ${fixture!.workspaceId}`;
   });
   after(async () => {
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   /** A task assigned to the fixture's agent. */
   async function task(): Promise<string> {
      const issueId = await createIssue(sql, fixture!);
      await sql`UPDATE issues SET assignee_type = 'agent', assignee_id = ${fixture!.agentId} WHERE id = ${issueId}`;
      return issueId;
   }

   /** A finished run on the task, each later than the one before. */
   async function ended(issueId: string, input: { code: string | null; commit: string | null }): Promise<string> {
      const f = fixture!;
      const id = randomUUID();
      clock += 1;
      await sql`
         INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, status,
                           failure_code, failure_message, failure_retryable, head_commit, branch,
                           requested_by, created_at, completed_at)
         VALUES (${id}, ${f.workspaceId}, ${issueId}, ${f.boardId}, ${f.agentId}, 'agent', 'assignment',
                 ${input.code ? 'failed' : 'succeeded'}, ${input.code}, ${input.code ? 'stopped' : null},
                 ${input.code ? false : null}, ${input.commit}, 'agent/task', ${f.userId},
                 now() - interval '1 hour' + ${clock} * interval '1 minute', now())`;
      return id;
   }

   test('a limit stop that left a new commit queues the next segment on the same task', async () => {
      const issueId = await task();
      const runId = await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      const outcome = await continueAfterLimit(sql, { runId });
      assert.equal(outcome.continued, true);
      assert.deepEqual(outcome.continued && [outcome.attempt, outcome.of], [1, 3]);
      const [next] = await sql`
         SELECT status, agent_id, source, instructions, origin, requested_by FROM runs
          WHERE id = ${outcome.continued ? outcome.runId : ''}`;
      assert.equal(next!.status, 'queued');
      assert.equal(next!.agent_id, fixture!.agentId);
      assert.equal(next!.requested_by, fixture!.userId);
      assert.deepEqual(next!.origin, { runId });
      assert.match(next!.instructions as string, /continuation 1 of at most 3/);
      const [issue] = await sql`SELECT active_run_id FROM issues WHERE id = ${issueId}`;
      assert.equal(issue!.active_run_id, outcome.continued ? outcome.runId : null);
   });

   test('asked twice, it continues once', async () => {
      const issueId = await task();
      const runId = await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      assert.equal((await continueAfterLimit(sql, { runId })).continued, true);
      assert.deepEqual(await continueAfterLimit(sql, { runId }), { continued: false, reason: 'superseded' });
   });

   test('a run that left nothing new is not continued: that is what a loop looks like', async () => {
      const issueId = await task();
      const nothing = await ended(issueId, { code: LIMIT_CODE, commit: null });
      assert.deepEqual(await continueAfterLimit(sql, { runId: nothing }), { continued: false, reason: 'no_progress' });
      await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      const same = await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      assert.deepEqual(await continueAfterLimit(sql, { runId: same }), { continued: false, reason: 'no_progress' });
   });

   test('the chain is capped, and a run that ended any other way starts it again', async () => {
      const issueId = await task();
      await ended(issueId, { code: LIMIT_CODE, commit: 'c1' });
      await ended(issueId, { code: LIMIT_CODE, commit: 'c2' });
      const third = await ended(issueId, { code: LIMIT_CODE, commit: 'c3' });
      assert.deepEqual(
         await continueAfterLimit(sql, { runId: third }).then((o) => o.continued && o.attempt),
         3
      );
      await sql`DELETE FROM runs WHERE issue_id = ${issueId} AND status = 'queued'`;
      const fourth = await ended(issueId, { code: LIMIT_CODE, commit: 'c4' });
      assert.deepEqual(await continueAfterLimit(sql, { runId: fourth }), { continued: false, reason: 'cap_reached' });

      await ended(issueId, { code: null, commit: 'c5' });
      const later = await ended(issueId, { code: LIMIT_CODE, commit: 'c6' });
      assert.equal((await continueAfterLimit(sql, { runId: later })).continued, true);
   });

   test('other failures, a reassigned or closed task, and zero are all left alone', async () => {
      const issueId = await task();
      const other = await ended(issueId, { code: 'MODEL_ERROR', commit: 'c1' });
      assert.deepEqual(await continueAfterLimit(sql, { runId: other }), { continued: false, reason: 'not_a_limit_stop' });

      const stopped = await ended(issueId, { code: LIMIT_CODE, commit: 'c2' });
      assert.deepEqual(await continueAfterLimit(sql, { runId: stopped, maxContinuations: 0 }), { continued: false, reason: 'disabled' });

      await sql`UPDATE issues SET status = 'done' WHERE id = ${issueId}`;
      assert.deepEqual(await continueAfterLimit(sql, { runId: stopped }), { continued: false, reason: 'task_moved_on' });
      await sql`UPDATE issues SET status = 'todo', assignee_type = 'user', assignee_id = ${fixture!.userId} WHERE id = ${issueId}`;
      assert.deepEqual(await continueAfterLimit(sql, { runId: stopped }), { continued: false, reason: 'task_moved_on' });
      const [queued] = await sql`SELECT count(*)::int AS n FROM runs WHERE issue_id = ${issueId} AND status = 'queued'`;
      assert.equal(queued!.n, 0);
   });
});
