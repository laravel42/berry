import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { LIMIT_CODE, continuationInstructions, continuationNote, continuedMessage, continueAfterLimit, retryAfterFault, retryNote, taskStillHeld } from './continuation.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

test('the next segment is told where the work is and not to start over', () => {
   const text = continuationInstructions({ branch: 'devops/l42-425', commit: 'e687a34aaaaaaaa', attempt: 2, of: 3 });
   assert.match(text, /continuation 2 of at most 3/);
   assert.match(text, /fresh run/);
   assert.match(text, /branch devops\/l42-425 \(commit e687a34\)/);
   assert.match(text, /Do not start over/);
});

test('a summary is the handover a fresh run starts from', () => {
   const text = continuationInstructions({
      branch: 'software-engineer/ber-103', commit: '6062e0caaaaaaa', attempt: 1, of: 3,
      summary: 'The shell is in. The drawer still needs a close button.',
   });
   assert.match(text, /empty conversation/);
   assert.match(text, /The shell is in\. The drawer still needs a close button\./);
});

test('the failed run’s comment says what happens next, or why nothing does', () => {
   assert.match(continuationNote({ continued: true, runId: 'r', attempt: 1, of: 3, branch: 'b', commit: 'c' }), /queued a fresh run .*\(1 of 3\)/);
   assert.match(continuationNote({ continued: false, reason: 'cap_reached' }), /limit of automatic continuations/);
   assert.match(continuationNote({ continued: false, reason: 'no_progress' }), /no new commit/);
   assert.equal(continuationNote({ continued: false, reason: 'busy' }), '');
});

test('a continued limit stop reads as paused, with nothing to do, not as a failure', () => {
   const text = continuedMessage({
      continued: true, runId: 'r', attempt: 1, of: 3,
      branch: 'product-designer/ber-3-imagery', commit: '2fe6276aaaaaaa',
   });
   assert.match(text, /^Paused at this agent's step limit\./);
   assert.match(text, /branch product-designer\/ber-3-imagery \(commit 2fe6276\)/);
   assert.match(text, /continuation 1 of 3\)\. Nothing needs to be done\.$/);
   assert.doesNotMatch(text, /Raise the step limit|failed/);
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
   async function ended(issueId: string, input: { code: string | null; commit: string | null; retryable?: boolean; prompt?: string }): Promise<string> {
      const f = fixture!;
      const id = randomUUID();
      clock += 1;
      await sql`
         INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, status,
                           failure_code, failure_message, failure_retryable, head_commit, branch,
                           requested_by, prompt, created_at, completed_at)
         VALUES (${id}, ${f.workspaceId}, ${issueId}, ${f.boardId}, ${f.agentId}, 'agent', 'assignment',
                 ${input.code ? 'failed' : 'succeeded'}, ${input.code}, ${input.code ? 'stopped' : null},
                 ${input.code ? (input.retryable ?? false) : null}, ${input.commit}, 'agent/task', ${f.userId},
                 ${input.prompt ?? null},
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

   test('a fault outside the task starts it once more, with the instructions it had', async () => {
      const issueId = await task();
      const runId = await ended(issueId, { code: 'RUNTIME_UNAVAILABLE', commit: null, retryable: true, prompt: 'Build the page' });
      const outcome = await retryAfterFault(sql, { runId });
      assert.equal(outcome.retried, true);
      const [next] = await sql`
         SELECT status, agent_id, source, instructions, origin, requested_by FROM runs
          WHERE id = ${outcome.retried ? outcome.runId : ''}`;
      assert.equal(next!.status, 'queued');
      assert.equal(next!.source, 'assignment');
      assert.equal(next!.instructions, 'Build the page');
      assert.deepEqual(next!.origin, { runId });
      assert.equal(next!.requested_by, fixture!.userId);
   });

   test('a second fault in a row stands, and a final failure is never retried', async () => {
      const issueId = await task();
      await ended(issueId, { code: 'RUNTIME_UNAVAILABLE', commit: null, retryable: true });
      const again = await ended(issueId, { code: 'RUNTIME_STREAM_ENDED', commit: null, retryable: true });
      assert.deepEqual(await retryAfterFault(sql, { runId: again }), { retried: false, reason: 'already_retried' });
      const final = await ended(issueId, { code: 'UPSTREAM_REJECTED', commit: null });
      assert.deepEqual(await retryAfterFault(sql, { runId: final }), { retried: false, reason: 'not_retryable' });
      await sql`UPDATE issues SET assignee_type = 'user', assignee_id = ${fixture!.userId} WHERE id = ${issueId}`;
      const moved = await ended(issueId, { code: 'RUNTIME_UNAVAILABLE', commit: null, retryable: true });
      assert.deepEqual(await retryAfterFault(sql, { runId: moved }), { retried: false, reason: 'task_moved_on' });
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

test('a blocked task is still held when the process stopped', () => {
   assert.equal(taskStillHeld('blocked'), true);
   assert.equal(taskStillHeld('todo'), true);
   assert.equal(taskStillHeld('in_progress'), true);
   assert.equal(taskStillHeld('done'), false);
   assert.equal(taskStillHeld('in_review'), false);
   assert.equal(taskStillHeld('cancelled'), false);
});

test('a failed run’s comment says Berry tried again, or why it stopped', () => {
   assert.match(retryNote({ retried: true, runId: 'r' }), /started it again; nothing needs to be done/);
   assert.match(retryNote({ retried: false, reason: 'already_retried' }), /already tried again/);
   assert.equal(retryNote({ retried: false, reason: 'busy' }), '');
});
