import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { configurePlatformModel } from '../runtime/platform-model.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { holdsTask } from './held.ts';
import { RunLedger } from './ledger.ts';
import { pickupReadyAgentTasks } from './pickup.ts';
import { EnqueueRejected, enqueueTask } from './queue.ts';

describe('holdsTask', () => {
   test('a preparation failure that will repeat holds the task', () => {
      assert.equal(holdsTask({ code: 'TASK_PREPARATION_FAILED', retryable: false }), true);
      assert.equal(holdsTask({ code: 'AI_RUNTIME_UNAVAILABLE', retryable: false }), true);
   });

   test('a retryable failure, a model failure or a lapsed connection does not', () => {
      assert.equal(holdsTask({ code: 'TASK_PREPARATION_FAILED', retryable: true }), false);
      assert.equal(holdsTask({ code: 'RUNTIME_ERROR', retryable: false }), false);
      assert.equal(holdsTask({ code: 'AI_RUNTIME_AUTH_REQUIRED', retryable: false }), false);
   });
});

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('a task held by a failure that repeats', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let ledger: RunLedger;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url! });
      ledger = new RunLedger({ sql });
      fixture = await seedFixture(sql, 'held');
      // The test database connects no AI provider; with Berry's own model
      // named, pickup can queue a run, as it does on a deployment.
      configurePlatformModel({ provider: 'bedrock', model: 'test-model', region: 'us-east-1' });
   });

   after(async () => {
      configurePlatformModel(null);
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   /** An agent-assigned todo task holding one queued run, the way assignment leaves it. */
   const queuedTask = async (): Promise<{ issueId: string; runId: string }> => {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      const runId = randomUUID();
      await sql.begin(async (tx) => {
         await tx`UPDATE issues SET status = 'todo', assignee_type = 'agent', assignee_id = ${f.agentId} WHERE id = ${issueId}`;
         await tx`
            INSERT INTO runs (id, issue_id, board_id, agent_id, requested_by)
            VALUES (${runId}, ${issueId}, ${f.boardId}, ${f.agentId}, ${f.userId})`;
         await tx`UPDATE issues SET active_run_id = ${runId} WHERE id = ${issueId}`;
         await tx`
            INSERT INTO run_events (id, run_id, board_id, issue_id, sequence, event_type, payload, public)
            VALUES (${randomUUID()}, ${runId}, ${f.boardId}, ${issueId}, 0,
                    'run.created', ${tx.json({ run: { id: runId } } as never)}, true)`;
      });
      return { issueId, runId };
   };

   // Native, so the refusal under test is the only thing that can stop it:
   // the test database has no AI provider connected.
   const again = (issueId: string) =>
      enqueueTask(sql, {
         workspaceId: fixture!.workspaceId,
         agentId: fixture!.agentId,
         issueId,
         kind: 'agent',
         source: 'assignment',
         requestedBy: fixture!.userId,
         runtimeAuthorizedBy: fixture!.userId,
         forceNativeRuntime: true,
      });

   test('is blocked, and nothing starts it until a person moves it', async () => {
      const f = fixture!;
      const { issueId, runId } = await queuedTask();
      await ledger.claimDispatch(runId);
      await ledger.fail({
         runId,
         failure: {
            code: 'TASK_PREPARATION_FAILED',
            message: '"group/sub/project" is not an owner/name repository',
            retryable: false,
         },
      });

      const [issue] = await sql`SELECT status::text AS status, active_run_id FROM issues WHERE id = ${issueId}`;
      assert.equal(issue!.status, 'blocked');
      assert.equal(issue!.active_run_id, null);

      // Pickup and every other path into the queue leave it alone.
      assert.equal(await pickupReadyAgentTasks(sql, { workspaceIds: [f.workspaceId], limit: 8 }), 0);
      await assert.rejects(
         () => again(issueId),
         (error: unknown) => error instanceof EnqueueRejected && error.code === 'TASK_HELD'
      );
      const [count] = await sql`SELECT count(*)::int AS n FROM runs WHERE issue_id = ${issueId}`;
      assert.equal(count!.n, 1);

      // A person moves it back to To do: it is wanted again.
      await sql`
         UPDATE issues SET status = 'todo', updated_at = now() + interval '1 second'
          WHERE id = ${issueId}`;
      const { runId: next } = await again(issueId);
      assert.ok(next);
   });

   test('a failure the model had is released to todo, and pickup does not run it again', async () => {
      const f = fixture!;
      const { issueId, runId } = await queuedTask();
      await ledger.claimDispatch(runId);
      await ledger.markRunning(runId);
      await ledger.fail({
         runId,
         failure: { code: 'RUNTIME_ERROR', message: 'the model refused', retryable: false },
      });
      const [issue] = await sql`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
      assert.equal(issue!.status, 'todo');

      // The ledger's clock is not the database's: compared with completed_at,
      // this task looked touched after its run ended and was started again on
      // every tick.
      assert.equal(await pickupReadyAgentTasks(sql, { workspaceIds: [f.workspaceId], limit: 8 }), 0);

      // A person moves or reassigns it afterwards: it is wanted again.
      await sql`UPDATE issues SET title = 'Edited' WHERE id = ${issueId}`;
      assert.equal(await pickupReadyAgentTasks(sql, { workspaceIds: [f.workspaceId], limit: 8 }), 1);
   });
});
