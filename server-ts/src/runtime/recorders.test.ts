import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { RunTerminal, type Run } from '../runs/ledger.ts';
import { onRunTerminal } from '../runs/terminal-hooks.ts';
import { directRecorder } from './recorders.ts';
import { cleanupFixture, seedFixture, type Fixture } from './test-fixture.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('the direct recorder', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'recorders');
   });
   after(async () => {
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   /** A chat run: no issue, so it writes through the direct path. */
   async function chatRun(): Promise<string> {
      const conversationId = randomUUID();
      await sql`
         INSERT INTO conversations (id, workspace_id, kind, topic)
         VALUES (${conversationId}, ${fixture!.workspaceId}, 'direct', 'recorders')`;
      const runId = randomUUID();
      await sql`
         INSERT INTO runs (id, workspace_id, agent_id, chat_session_id, status, dispatch_state, kind, source)
         VALUES (${runId}, ${fixture!.workspaceId}, ${fixture!.agentId}, ${conversationId},
                 'queued', 'pending', 'agent', 'chat')`;
      return runId;
   }

   test('a finished run is announced, so a chat reply has something to post', async () => {
      const seen: Run[] = [];
      const stop = onRunTerminal(async (run) => void seen.push(run));
      try {
         const runId = await chatRun();
         const recorder = directRecorder(sql, runId);
         await recorder.started();
         await recorder.succeeded({
            summary: 'Hello again',
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, costMicros: null, currency: null },
            result: { text: 'Hello again', truncated: false, delivery: null },
         });

         assert.equal(seen.length, 1);
         assert.equal(seen[0]?.id, runId);
         assert.equal(seen[0]?.status, 'succeeded');
         assert.equal(seen[0]?.summary, 'Hello again');
      } finally {
         stop();
      }
   });

   test('writing the same ending twice announces once', async () => {
      let count = 0;
      const stop = onRunTerminal(async () => void count++);
      try {
         const runId = await chatRun();
         const recorder = directRecorder(sql, runId);
         const ending = {
            summary: 'done',
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: null, currency: null },
            result: { text: 'done', truncated: false, delivery: null },
         };
         await recorder.succeeded(ending);
         await recorder.succeeded(ending);
         assert.equal(count, 1);
      } finally {
         stop();
      }
   });

   test('a failed run is announced too, so the chat says so instead of waiting', async () => {
      const seen: Run[] = [];
      const stop = onRunTerminal(async (run) => void seen.push(run));
      try {
         const runId = await chatRun();
         await directRecorder(sql, runId).failed({
            failure: { code: 'RUNTIME_UNAVAILABLE', message: 'no runtime answered', retryable: true },
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costMicros: null, currency: null },
         });
         assert.equal(seen.length, 1);
         assert.equal(seen[0]?.status, 'failed');
         assert.equal(seen[0]?.failure?.code, 'RUNTIME_UNAVAILABLE');
      } finally {
         stop();
      }
   });
});

/**
 * A chat task's prose reaches the ledger, so the reply can be read while it is
 * written. Needs no database: `message` touches only the ledger.
 */
test('the direct recorder streams output deltas and ignores the rest', async () => {
   const appended: { runId: string; channel: string; text: string }[] = [];
   const ledger = {
      appendOutput: async (runId: string, channel: string, text: string) => {
         appended.push({ runId, channel, text });
      },
   };
   const recorder = directRecorder(null as unknown as Sql, 'run-1', ledger);

   await recorder.message({ kind: 'output', channel: 'progress', text: 'Hello ' });
   await recorder.message({ kind: 'output', channel: 'progress', text: 'world' });
   // A tool or command belongs to a board's run stream, which this run has not got.
   await recorder.message({ kind: 'tool.started', toolCallId: 't1', name: 'read_file' });
   await recorder.message({ kind: 'tool.completed', toolCallId: 't1', succeeded: true });

   assert.deepEqual(
      appended.map((entry) => entry.text),
      ['Hello ', 'world']
   );
   assert.deepEqual(appended[0], { runId: 'run-1', channel: 'progress', text: 'Hello ' });
});

test('the direct recorder without a ledger writes nothing, as a completion does', async () => {
   const recorder = directRecorder(null as unknown as Sql, 'run-1');
   // No ledger, no throw: a completion emits no output messages, and one that
   // did must not take the run down over it.
   await recorder.message({ kind: 'output', channel: 'progress', text: 'ignored' });
});

test('a run that ended mid-delta is not an error the task has to carry', async () => {
   const ledger = {
      appendOutput: async () => {
         throw new RunTerminal();
      },
   };
   const recorder = directRecorder(null as unknown as Sql, 'run-1', ledger);
   // The run's own ending is already recorded; a delta arriving after it is not
   // a failure of the task.
   await recorder.message({ kind: 'output', channel: 'progress', text: 'late' });
});

test('a real ledger failure still fails the task', async () => {
   const ledger = {
      appendOutput: async () => {
         throw new Error('storage is down');
      },
   };
   const recorder = directRecorder(null as unknown as Sql, 'run-1', ledger);
   await assert.rejects(
      () => recorder.message({ kind: 'output', channel: 'progress', text: 'x' }),
      /storage is down/
   );
});
