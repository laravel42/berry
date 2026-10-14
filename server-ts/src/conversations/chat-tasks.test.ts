import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { EnqueueInput } from '../agents/seams.ts';
import { chatModePrompt, chatReplyBody, chatSuggestions, generateTitle, sendChatMessage, STARTER_SUGGESTIONS, titleFromMessage } from './chat-tasks.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { dropAgentLayerWorld, seedAgentLayerWorld, type AgentLayerWorld } from '../mounts/agent-layer.fixture.ts';
import type { Run } from '../runs/ledger.ts';
import { ConversationRepository } from './repository.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

test('a mode other than agent is an instruction in front of the typed text', () => {
   const agent = chatModePrompt('agent', 'Ship the login');
   assert.match(agent, /This is a conversation with a person/);
   assert.match(agent, /Ship the login$/);
   assert.doesNotMatch(agent, /Plan mode/);
   assert.equal(chatModePrompt(undefined, 'Ship the login'), agent);
   const planned = chatModePrompt('plan', 'Ship the login');
   assert.match(planned, /This is a conversation with a person/);
   assert.match(planned, /Plan mode\./);
   assert.match(planned, /Ship the login$/);
   assert.match(chatModePrompt('debug', 'The page is blank'), /runtime traces/);
   assert.match(chatModePrompt('ask', 'Where is auth?'), /Do not change it/);
});

test('a chosen repository is named in front of the typed text', () => {
   const prompted = chatModePrompt('agent', 'Where is login?', 'acme/api');
   assert.match(prompted, /This is a conversation with a person/);
   assert.match(prompted, /Repository: acme\/api\./);
   assert.match(prompted, /Where is login\?$/);
   const planned = chatModePrompt('plan', 'Where is login?', 'acme/api');
   assert.match(planned, /Plan mode\./);
   assert.match(planned, /Repository: acme\/api\./);
});

test('a chat title is the first few words of the message', () => {
   assert.equal(titleFromMessage('  Hello there  '), 'Hello there');
   assert.equal(titleFromMessage('one two three four five six seven'), 'one two three four five six');
   assert.equal(titleFromMessage(''), 'Chat');
});

test('a finished chat task’s reply is its summary, or says what happened', () => {
   const run = (status: Run['status'], message?: string) =>
      ({ status, failure: message ? { code: 'X', message, retryable: false } : null }) as Pick<
         Run,
         'status' | 'failure'
      >;
   assert.equal(chatReplyBody(run('succeeded'), ' Done. '), 'Done.');
   assert.equal(chatReplyBody(run('succeeded'), null), '(The agent finished without a reply.)');
   assert.equal(chatReplyBody(run('cancelled'), null), '(This task was cancelled.)');
   assert.equal(chatReplyBody(run('failed', 'boom'), null), '(The task failed: boom)');
});

describe('chat on tasks', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: AgentLayerWorld;
   let conversations: ConversationRepository;
   let conversationId: string;
   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedAgentLayerWorld(sql);
      conversations = new ConversationRepository(sql);
      conversationId = await conversations.createSession({
         workspaceId: world.workspaceId,
         userId: world.ownerId,
         agentId: world.agentId,
         title: null,
      });
   });
   after(async () => {
      await dropAgentLayerWorld(sql, world);
      await closeDatabase(sql);
   });

   test('a message is stored and queues a chat task for the session’s agent', async () => {
      const calls: EnqueueInput[] = [];
      const context = await conversations.context(conversationId, world.ownerId);
      // The fake has to hand back a real run id: the session's active run is a
      // foreign key to runs.
      const [run] = await sql`
         INSERT INTO runs (issue_id, board_id, agent_id, requested_by)
         VALUES (${world.issueId}, ${world.boardId}, ${world.agentId}, ${world.ownerId}) RETURNING id`;
      const sent = await sendChatMessage(
         {
            sql,
            conversations,
            enqueue: async (_sql, input) => {
               calls.push(input);
               return { runId: run?.id as string };
            },
         },
         { conversation: context, userId: world.ownerId, body: 'Summarise the open tasks' }
      );
      assert.equal(calls[0]?.source, 'chat');
      assert.equal(calls[0]?.kind, 'agent');
      assert.equal(calls[0]?.chatSessionId, conversationId);
      assert.equal(calls[0]?.agentId, world.agentId);
      assert.equal(calls[0]?.prompt, chatModePrompt('agent', 'Summarise the open tasks'));
      assert.equal(calls[0]?.issueId, undefined);
      // The sender asked for the run, so a project or a task the agent files
      // while answering is filed in their name and not in nobody's.
      assert.equal(calls[0]?.requestedBy, world.ownerId);
      const messages = await conversations.messages(conversationId);
      assert.equal(messages.at(-1)?.id, sent.messageId);
      const [summary] = await conversations.list(world.ownerId);
      // The queue's chat guard owns active_run_id (runs/queue.test.ts); a
      // fake enqueue sets nothing, and sending no longer writes it itself.
      assert.equal(summary?.activeRunId, null);
   });

   test('a generated title replaces the default once, and never a title a person set', async () => {
      assert.equal(
         await generateTitle({ sql }, { workspaceId: world.workspaceId, conversationId, firstMessage: 'x' }),
         'x'
      );
      await conversations.rename(conversationId, world.ownerId, 'Mine');
      assert.equal(
         await generateTitle({ sql }, { workspaceId: world.workspaceId, conversationId, firstMessage: 'x' }),
         null
      );
   });

   test('pin, archive and draft are per person', async () => {
      await conversations.setPinned(conversationId, world.ownerId, true);
      await conversations.saveDraft(conversationId, world.ownerId, 'half a thought');
      const [summary] = await conversations.list(world.ownerId);
      assert.equal(summary?.pinned, true);
      assert.equal(summary?.draft, 'half a thought');
      await conversations.setArchived(conversationId, world.ownerId, true);
      assert.equal((await conversations.list(world.ownerId)).length, 0);
      assert.equal((await conversations.list(world.ownerId, { archived: true })).length, 1);
      await assert.rejects(conversations.setPinned(conversationId, world.memberId, true));
   });

   test('unread counts agent messages after the last read, and history pages backwards', async () => {
      const id = await conversations.createSession({
         workspaceId: world.workspaceId,
         userId: world.ownerId,
         agentId: world.agentId,
         title: 'Paging',
      });
      const first = await conversations.append({ conversationId: id, authorType: 'user', authorId: world.ownerId, body: 'one' });
      await conversations.append({ conversationId: id, authorType: 'agent', authorId: world.agentId, body: 'two' });
      const third = await conversations.append({ conversationId: id, authorType: 'agent', authorId: world.agentId, body: 'three' });
      const unread = (await conversations.list(world.ownerId)).find((c) => c.id === id);
      assert.equal(unread?.unread, 2);
      await conversations.markRead(id, world.ownerId);
      assert.equal((await conversations.list(world.ownerId)).find((c) => c.id === id)?.unread, 0);
      const page = await conversations.messages(id, { before: third, limit: 1 });
      assert.deepEqual(
         page.map((m) => m.body),
         ['two']
      );
      assert.equal((await conversations.messages(id, { before: first })).length, 0);
   });

   test('a chat not yet opened gets the starters, then quick actions for the agent', async () => {
      await sql`INSERT INTO quick_action_definitions (workspace_id, name, target_agent_id, prompt, created_by)
                VALUES (${world.workspaceId}, 'Triage', ${world.agentId}, 'Triage the inbox', ${world.ownerId})`;
      const suggestions = await chatSuggestions(sql, { workspaceId: world.workspaceId, agentId: world.agentId });
      assert.deepEqual(suggestions.slice(0, 3), STARTER_SUGGESTIONS);
      assert.deepEqual(suggestions[3], { label: 'Triage', prompt: 'Triage the inbox' });
   });
});
