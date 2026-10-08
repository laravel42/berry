import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { LIMIT_CODE, continuationInstructions, continuationNote, continuedMessage, continueAfterLimit, recoveryInstructions, restartTask, retryAfterFault, retryNote, runIsStalled, taskCanBeRestarted, taskStillHeld } from './continuation.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

test('the next segment is told where the work is and not to start over', () => {
   const text = continuationInstructions({ branch: 'devops/l42-425', commit: 'e687a34aaaaaaaa', attempt: 2, of: 3 });
   assert.match(text, /continuation 2 of at most 3/);
   assert.match(text, /fresh run/);
   assert.match(text, /branch devops\/l42-425 \(commit e687a34\)/);
   assert.match(text, /Do not start over/);
   const again = continuationInstructions({ branch: 'devops/l42-425', commit: null, attempt: 1, of: 3 });
   assert.match(again, /branch devops\/l42-425/);
   assert.doesNotMatch(again, /commit /);
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
      assert.deepEqual(next!.origin, { runId, fresh: true });
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

   test('a limit stop with no new commit still starts a fresh run', async () => {
      const issueId = await task();
      const nothing = await ended(issueId, { code: LIMIT_CODE, commit: null });
      const outcome = await continueAfterLimit(sql, { runId: nothing, summary: 'The shell is in. The drawer is not.' });
      assert.equal(outcome.continued, true);
      const [next] = await sql`
         SELECT instructions, origin FROM runs WHERE id = ${outcome.continued ? outcome.runId : ''}`;
      assert.match(next!.instructions as string, /fresh run/);
      assert.match(next!.instructions as string, /The shell is in\. The drawer is not\./);
      assert.deepEqual(next!.origin, { runId: nothing, fresh: true });
      await sql`DELETE FROM runs WHERE issue_id = ${issueId} AND status = 'queued'`;
      await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      const same = await ended(issueId, { code: LIMIT_CODE, commit: 'aaaaaaa1' });
      assert.equal((await continueAfterLimit(sql, { runId: same })).continued, true);
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

   test('a person can restart an agent task the automatic retry already gave up on', async () => {
      const issueId = await task();
      await ended(issueId, { code: 'RUNTIME_UNAVAILABLE', commit: 'aaaaaaa1', retryable: true, prompt: 'Build the page' });
      const again = await ended(issueId, {
         code: 'DISPATCH_ABANDONED',
         commit: 'bbbbbbb2',
         retryable: true,
         prompt: 'Build the page',
      });
      assert.deepEqual(await retryAfterFault(sql, { runId: again }), { retried: false, reason: 'already_retried' });
      const outcome = await restartTask(sql, { issueId, requestedBy: fixture!.userId });
      assert.equal(outcome.restarted, true);
      const [next] = await sql`
         SELECT status, instructions, origin, requested_by FROM runs
          WHERE id = ${outcome.restarted ? outcome.runId : ''}`;
      assert.equal(next!.status, 'queued');
      assert.match(next!.instructions as string, /do not start over/i);
      assert.match(next!.instructions as string, /commit bbbbbbb/);
      assert.match(next!.instructions as string, /Build the page/);
      assert.deepEqual(next!.origin, { runId: again });
      assert.equal(next!.requested_by, fixture!.userId);
   });

   test('a queued or running run is left as it is', async () => {
      const issueId = await task();
      const runId = randomUUID();
      const f = fixture!;
      await sql`
         INSERT INTO runs (id, workspace_id, issue_id, board_id, agent_id, kind, source, status,
                           branch, head_commit, requested_by, created_at, started_at)
         VALUES (${runId}, ${f.workspaceId}, ${issueId}, ${f.boardId}, ${f.agentId}, 'agent', 'assignment',
                 'running', 'agent/task', 'ccccccc3', ${f.userId}, now() - interval '10 minutes', now() - interval '10 minutes')`;
      await sql`UPDATE issues SET status = 'in_progress', active_run_id = ${runId} WHERE id = ${issueId}`;
      assert.deepEqual(await restartTask(sql, { issueId, requestedBy: f.userId }), { restarted: false, reason: 'busy' });
      const [still] = await sql`SELECT status FROM runs WHERE id = ${runId}`;
      assert.equal(still!.status, 'running');

      await sql`UPDATE runs SET status = 'queued', started_at = NULL WHERE id = ${runId}`;
      await sql`UPDATE issues SET status = 'todo' WHERE id = ${issueId}`;
      assert.deepEqual(await restartTask(sql, { issueId, requestedBy: f.userId }), { restarted: false, reason: 'busy' });
      const [queued] = await sql`SELECT count(*)::int AS n FROM runs WHERE issue_id = ${issueId}`;
      assert.equal(queued!.n, 1);
   });

   test('a task in review starts again from the run that finished', async () => {
      const issueId = await task();
      const runId = await ended(issueId, { code: null, commit: 'ddddddd4', prompt: 'Keep going' });
      await sql`UPDATE issues SET status = 'in_review' WHERE id = ${issueId}`;
      const outcome = await restartTask(sql, { issueId, requestedBy: fixture!.userId });
      assert.equal(outcome.restarted, true);
      const [next] = await sql`SELECT instructions, origin FROM runs WHERE id = ${outcome.restarted ? outcome.runId : ''}`;
      assert.match(next!.instructions as string, /commit ddddddd/);
      assert.match(next!.instructions as string, /Keep going/);
      assert.deepEqual(next!.origin, { runId });
   });

   test('a task that has never run is queued for its agent', async () => {
      const issueId = await task();
      const outcome = await restartTask(sql, { issueId, requestedBy: fixture!.userId });
      assert.equal(outcome.restarted, true);
      const [next] = await sql`
         SELECT status, agent_id, source, prompt, origin FROM runs
          WHERE id = ${outcome.restarted ? outcome.runId : ''}`;
      assert.equal(next!.status, 'queued');
      assert.equal(next!.agent_id, fixture!.agentId);
      assert.equal(next!.source, 'assignment');
      assert.equal(next!.prompt, null);
      assert.deepEqual(next!.origin, {});
   });

   test('a done task or a task assigned to a person is not restarted', async () => {
      const issueId = await task();
      await sql`UPDATE issues SET status = 'done' WHERE id = ${issueId}`;
      assert.deepEqual(await restartTask(sql, { issueId, requestedBy: fixture!.userId }), {
         restarted: false,
         reason: 'task_moved_on',
      });
      await sql`
         UPDATE issues SET status = 'in_progress', assignee_type = 'user', assignee_id = ${fixture!.userId}
          WHERE id = ${issueId}`;
      assert.deepEqual(await restartTask(sql, { issueId, requestedBy: fixture!.userId }), {
         restarted: false,
         reason: 'task_moved_on',
      });
      const [queued] = await sql`SELECT count(*)::int AS n FROM runs WHERE issue_id = ${issueId} AND status = 'queued'`;
      assert.equal(queued!.n, 0);
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

test('a recovering run is told where the work is and not to start over', () => {
   const text = recoveryInstructions({
      branch: 'software-engineer/ber-106',
      commit: '0d4c86caaaaaaa',
      prior: 'Fix the merge.',
   });
   assert.match(text, /starts again from the work already saved/);
   assert.match(text, /do not start over/i);
   assert.match(text, /branch software-engineer\/ber-106 \(commit 0d4c86c\)/);
   assert.match(text, /Fix the merge\./);
   const again = recoveryInstructions({ branch: null, commit: null, prior: text });
   assert.equal(again.split('This run starts again').length, 2);
});

test('restart is for a task in to do, in progress, or in review', () => {
   assert.equal(taskCanBeRestarted('todo'), true);
   assert.equal(taskCanBeRestarted('in_progress'), true);
   assert.equal(taskCanBeRestarted('in_review'), true);
   assert.equal(taskCanBeRestarted('blocked'), false);
   assert.equal(taskCanBeRestarted('backlog'), false);
   assert.equal(taskCanBeRestarted('done'), false);
   assert.equal(taskCanBeRestarted('cancelled'), false);
});

test('a stall is a retryable failure, or a run that has gone quiet', () => {
   const now = new Date('2026-10-08T03:00:00Z');
   const recent = new Date('2026-10-08T02:59:30Z');
   const quiet = new Date('2026-10-08T02:57:00Z');
   assert.equal(runIsStalled({ status: 'failed', retryable: true, lastActivityAt: recent, now }), true);
   assert.equal(runIsStalled({ status: 'failed', retryable: false, lastActivityAt: quiet, now }), false);
   assert.equal(runIsStalled({ status: 'running', retryable: false, lastActivityAt: quiet, now }), true);
   assert.equal(runIsStalled({ status: 'running', retryable: false, lastActivityAt: recent, now }), false);
   assert.equal(runIsStalled({ status: 'queued', retryable: false, lastActivityAt: quiet, now }), false);
   assert.equal(runIsStalled({ status: 'succeeded', retryable: false, lastActivityAt: quiet, now }), false);
});
