import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, describe, test } from 'node:test';
import type { EnqueueInput, EnqueueTask } from '../agents/seams.ts';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { ConversationRepository } from '../conversations/repository.ts';
import { BoardRepository } from '../core/boards.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import { RunLedger } from '../runs/ledger.ts';
import { RunRepository } from '../runs/repository.ts';
import { call, dropAgentLayerWorld, seedAgentLayerWorld, type AgentLayerWorld } from './agent-layer.fixture.ts';
import { streamCursor } from '../runs/event-stream.ts';
import { conversationMounts } from './conversations.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

function buildApp(sql: Sql, enqueue: EnqueueTask | null): BerryApp {
   const registry = new Registry();
   registry.registerAll(
      conversationMounts({
         sessions: new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] }),
         conversations: new ConversationRepository(sql),
         boards: new BoardRepository(sql),
         sql,
         enqueue,
         complete: null,
         ledger: new RunLedger({ sql }),
         runs: new RunRepository(sql),
      })
   );
   return createApp(registry);
}

describe('conversations mount', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let offline: BerryApp;
   let world: AgentLayerWorld;
   let hasChatColumn = false;
   const enqueued: EnqueueInput[] = [];

   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedAgentLayerWorld(sql);
      // The fake returns a real run row, because a session's active run is a
      // foreign key to runs.
      const enqueue: EnqueueTask = async (_sql, input) => {
         enqueued.push(input);
         const [run] = await sql`
            INSERT INTO runs (issue_id, board_id, agent_id, requested_by, status, completed_at)
            VALUES (${world.issueId}, ${world.boardId}, ${world.agentId}, ${world.ownerId}, 'cancelled', now())
            RETURNING id`;
         return { runId: run?.id as string };
      };
      app = buildApp(sql, enqueue);
      offline = buildApp(sql, null);
      const [column] = await sql`
         SELECT 1 FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'chat_session_id'`;
      hasChatColumn = Boolean(column);
   });
   after(async () => {
      await dropAgentLayerWorld(sql, world);
      await closeDatabase(sql);
   });

   afterEach(async () => {
      await sql`UPDATE runs SET status = 'cancelled', dispatch_state = 'cancelled', completed_at = now()
         WHERE issue_id = ${world.issueId} AND status IN ('queued', 'running')`;
   });

   const newSession = async (token = world.ownerToken): Promise<string> => {
      const res = await call(app, token, 'POST', '/api/v1/conversations', { agentId: world.agentId });
      assert.equal(res.status, 201);
      return res.body.id as string;
   };

   test('each new chat is its own session', async () => {
      assert.notEqual(await newSession(), await newSession());
   });

   test('a message is queued as a task and answered 202', async () => {
      const id = await newSession();
      const res = await call(app, world.ownerToken, 'POST', `/api/v1/conversations/${id}/messages`, { body: 'hi' });
      assert.equal(res.status, 202);
      assert.equal(res.body.queued, true);
      assert.equal(enqueued.at(-1)?.source, 'chat');
      assert.equal(enqueued.at(-1)?.chatSessionId, id);
   });

   test('without the runtime the message is kept and the send refused with a stable code', async () => {
      const id = await newSession();
      const res = await call(offline, world.ownerToken, 'POST', `/api/v1/conversations/${id}/messages`, { body: 'kept' });
      assert.equal(res.status, 503);
      assert.equal((res.body.error as { code: string }).code, 'AGENT_TASKS_UNAVAILABLE');
      const messages = await call(app, world.ownerToken, 'GET', `/api/v1/conversations/${id}/messages`);
      assert.deepEqual(
         (messages.body.nodes as { body: string }[]).map((m) => m.body),
         ['kept']
      );
   });

   test('a rename shows in the list, and a draft is kept per person', async () => {
      const id = await newSession();
      assert.equal((await call(app, world.ownerToken, 'PATCH', `/api/v1/conversations/${id}`, { title: 'Renamed' })).status, 204);
      assert.equal((await call(app, world.ownerToken, 'PUT', `/api/v1/conversations/${id}/draft`, { draft: 'wip' })).status, 204);
      const list = await call(app, world.ownerToken, 'GET', '/api/v1/conversations');
      const found = (list.body.nodes as { id: string; topic: string; draft: string }[]).find((c) => c.id === id);
      assert.equal(found?.topic, 'Renamed');
      assert.equal(found?.draft, 'wip');
   });

   test('a deleted session is gone', async () => {
      const id = await newSession();
      assert.equal((await call(app, world.ownerToken, 'DELETE', `/api/v1/conversations/${id}`)).status, 204);
      assert.equal((await call(app, world.ownerToken, 'GET', `/api/v1/conversations/${id}/messages`)).status, 404);
   });

   test('an outsider cannot read a session', async () => {
      const id = await newSession();
      assert.equal((await call(app, world.outsiderToken, 'GET', `/api/v1/conversations/${id}/messages`)).status, 404);
      assert.equal((await call(app, world.memberToken, 'GET', `/api/v1/conversations/${id}/messages`)).status, 404);
   });

   test('a chat with another workspace’s agent is not found', async () => {
      const res = await call(app, world.ownerToken, 'POST', '/api/v1/conversations', { agentId: world.otherAgentId });
      assert.equal(res.status, 404);
   });

   test('pinned agents are the caller’s own and stay inside the workspace', async () => {
      const put = await call(app, world.ownerToken, 'PUT', '/api/v1/conversations/pinned-agents', {
         agentIds: [world.agentId],
      });
      assert.equal(put.status, 200);
      const get = await call(app, world.ownerToken, 'GET', '/api/v1/conversations/pinned-agents');
      assert.deepEqual(get.body.agentIds, [world.agentId]);
      const foreign = await call(app, world.ownerToken, 'PUT', '/api/v1/conversations/pinned-agents', {
         agentIds: [world.otherAgentId],
      });
      assert.equal(foreign.status, 404);
      const member = await call(app, world.memberToken, 'GET', '/api/v1/conversations/pinned-agents');
      assert.deepEqual(member.body.agentIds, []);
   });

   test('suggestions are scoped to the caller’s workspace', async () => {
      const res = await call(app, world.ownerToken, 'GET', `/api/v1/conversations/suggestions?agentId=${world.agentId}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.nodes));
   });

   test('a task id from outside the session is not found', async (t) => {
      if (!hasChatColumn) {
         t.skip('runs.chat_session_id is not present (workstream A not merged)');
         return;
      }
      const id = await newSession();
      const res = await call(app, world.ownerToken, 'POST', `/api/v1/conversations/${id}/tasks/${randomUUID()}/cancel`);
      assert.equal(res.status, 404);
   });

   test('a session lists, prioritises and cancels its queued tasks', async (t) => {
      if (!hasChatColumn) {
         t.skip('runs.chat_session_id is not present (workstream A not merged)');
         return;
      }
      const id = await newSession();
      const [run] = await sql`
         INSERT INTO runs (issue_id, board_id, agent_id, requested_by, chat_session_id)
         VALUES (${world.issueId}, ${world.boardId}, ${world.agentId}, ${world.ownerId}, ${id}) RETURNING id`;
      const runId = run?.id as string;
      const tasks = await call(app, world.ownerToken, 'GET', `/api/v1/conversations/${id}/tasks`);
      assert.ok((tasks.body.nodes as { id: string }[]).some((task) => task.id === runId));
      const up = await call(app, world.ownerToken, 'POST', `/api/v1/conversations/${id}/tasks/${runId}/prioritize`);
      assert.equal(up.status, 204);
      const [row] = await sql`SELECT priority FROM runs WHERE id = ${runId}`;
      assert.equal(Number(row?.priority), 100);
      const cancel = await call(app, world.ownerToken, 'POST', `/api/v1/conversations/${id}/tasks/${runId}/cancel`);
      assert.equal(cancel.status, 202);
   });

   test('a task stream replays the run’s output and ends when the run does', async (t) => {
      if (!hasChatColumn) {
         t.skip('runs.chat_session_id is not present (workstream A not merged)');
         return;
      }
      const id = await newSession();
      const [run] = await sql`
         INSERT INTO runs (issue_id, board_id, agent_id, requested_by, chat_session_id, status)
         VALUES (${world.issueId}, ${world.boardId}, ${world.agentId}, ${world.ownerId}, ${id}, 'running')
         RETURNING id`;
      const runId = run?.id as string;
      // Two deltas and a terminal event, written straight to the ledger table:
      // what the runtime would have produced, without running an agent.
      await sql`
         INSERT INTO run_events (id, run_id, board_id, issue_id, sequence, event_type, payload, public, occurred_at)
         VALUES (${randomUUID()}, ${runId}, ${world.boardId}, ${world.issueId}, 1, 'run.output.delta',
                 ${sql.json({ channel: 'progress', text: 'Hello ' } as never)}, true, now()),
                (${randomUUID()}, ${runId}, ${world.boardId}, ${world.issueId}, 2, 'run.output.delta',
                 ${sql.json({ channel: 'progress', text: 'world' } as never)}, true, now()),
                (${randomUUID()}, ${runId}, ${world.boardId}, ${world.issueId}, 3, 'run.completed',
                 ${sql.json({} as never)}, true, now())`;

      const response = await app.request(`/api/v1/conversations/${id}/tasks/${runId}/stream`, {
         headers: { authorization: `Bearer ${world.ownerToken}` },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
      // The terminal event closes the stream, so reading to the end terminates.
      const body = await response.text();
      assert.match(body, /event: run\.output\.delta/);
      assert.match(body, /"text":"Hello "/);
      assert.match(body, /"text":"world"/);
      assert.match(body, /event: run\.completed/);
      // The sequence is the id a reconnecting client resumes from.
      assert.match(body, /^id: 3$/m);

      // Resuming past the first delta skips it rather than repeating it.
      const resumed = await app.request(
         `/api/v1/conversations/${id}/tasks/${runId}/stream?after=1`,
         { headers: { authorization: `Bearer ${world.ownerToken}` } }
      );
      const tail = await resumed.text();
      assert.doesNotMatch(tail, /"text":"Hello "/);
      assert.match(tail, /"text":"world"/);
   });

   test('a task stream is not reachable by an outsider, or across sessions', async (t) => {
      if (!hasChatColumn) {
         t.skip('runs.chat_session_id is not present (workstream A not merged)');
         return;
      }
      const id = await newSession();
      const [run] = await sql`
         INSERT INTO runs (issue_id, board_id, agent_id, requested_by, chat_session_id, status)
         VALUES (${world.issueId}, ${world.boardId}, ${world.agentId}, ${world.ownerId}, ${id}, 'running')
         RETURNING id`;
      const runId = run?.id as string;
      // Refused before a byte is written: a 200 with an event-stream body
      // cannot be taken back, so the check has to precede the stream.
      for (const token of [world.outsiderToken, world.memberToken]) {
         const res = await app.request(`/api/v1/conversations/${id}/tasks/${runId}/stream`, {
            headers: { authorization: `Bearer ${token}` },
         });
         assert.equal(res.status, 404);
      }
      // A run of another session is not reachable through this one.
      const other = await newSession();
      const foreign = await app.request(
         `/api/v1/conversations/${other}/tasks/${runId}/stream`,
         { headers: { authorization: `Bearer ${world.ownerToken}` } }
      );
      assert.equal(foreign.status, 404);
   });
});

/**
 * The resume cursor for a task stream, which needs no database.
 *
 * A sequence rather than an event id, and anything unparseable replays from
 * the start: a stream that silently skipped ahead would drop the very text it
 * exists to deliver.
 */
test('a task stream resumes from a sequence, and refuses to guess', () => {
   assert.equal(streamCursor('12', undefined), 12);
   assert.equal(streamCursor(null, '12'), 12);
   assert.equal(streamCursor('0', undefined), 0);
   // The query wins when both are present; the caller asked for it explicitly.
   assert.equal(streamCursor('7', '99'), 7);
   // Nothing to resume from, so the run replays whole.
   assert.equal(streamCursor(null, undefined), null);
   assert.equal(streamCursor('', ''), null);
   assert.equal(streamCursor('not-a-number', undefined), null);
   assert.equal(streamCursor('-3', undefined), null);
   assert.equal(streamCursor('1.5', undefined), null);
   // An event id from another stream is not a sequence.
   assert.equal(streamCursor(null, '3f1a6c2e-0000-4000-8000-000000000000'), null);
});
