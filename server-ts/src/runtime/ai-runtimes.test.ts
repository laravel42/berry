import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { enqueueTask } from '../runs/queue.ts';
import {
   AiRuntimeRepository,
   AiRuntimeSelectionError,
   NATIVE_AI_RUNTIME,
   resolveAiRuntimeSelection,
} from './ai-runtimes.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from './test-fixture.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('personal AI runtime connections', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;
   let repository: AiRuntimeRepository;
   const extraUsers: string[] = [];

   before(async () => {
      sql = openDatabase({ url: url as string });
      fixture = await seedFixture(sql, 'ai-runtime');
      repository = new AiRuntimeRepository(sql);
   });

   after(async () => {
      if (!sql) return;
      for (const userId of extraUsers) {
         await sql`DELETE FROM workspace_memberships WHERE user_id = ${userId}`;
         await sql`DELETE FROM users WHERE id = ${userId}`;
      }
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   function current(): Fixture {
      if (!fixture) throw new Error('fixture not initialized');
      return fixture;
   }

   async function connect() {
      const world = current();
      return repository.connect({
         workspaceId: world.workspaceId,
         userId: world.userId,
         runtimeId: 'kiro',
         authMethod: 'kiro_api_key',
         accountId: '42',
         accountName: 'berry-user',
         metadata: { models: [{ id: 'auto', name: 'Automatic' }] },
      });
   }

   test('preference resolution snapshots the requesting user connection', async () => {
      const world = current();
      const connection = await connect();
      await repository.savePreference(world.workspaceId, world.userId, {
         runtimeId: 'kiro',
         modelId: 'auto',
      });

      const selected = await resolveAiRuntimeSelection(sql, {
         workspaceId: world.workspaceId,
         userId: world.userId,
         overrideRuntimeId: null,
         overrideModelId: null,
      });
      assert.equal(selected.runtimeId, 'kiro');
      assert.equal(selected.modelId, 'auto');
      assert.equal(selected.connectionId, connection.connection.id);
      assert.equal(selected.userId, world.userId);
   });

   test('a connected runtime takes agent work when nobody set a preference', async () => {
      const world = current();
      const connection = await connect();
      await repository.savePreference(world.workspaceId, world.userId, { runtimeId: null, modelId: null });
      const selected = await resolveAiRuntimeSelection(sql, {
         workspaceId: world.workspaceId,
         userId: null,
         overrideRuntimeId: null,
         overrideModelId: null,
      });
      assert.equal(selected.runtimeId, 'kiro');
      assert.equal(selected.modelId, 'auto');
      assert.equal(selected.connectionId, connection.connection.id);
      assert.equal(selected.userId, world.userId);
   });

   test('one member cannot use another member subscription connection', async () => {
      const world = current();
      await connect();
      const userId = randomUUID();
      extraUsers.push(userId);
      await sql`
         INSERT INTO users (id, email, name)
         VALUES (${userId}, ${`other-${userId}@berry.test`}, 'Other member')`;
      await sql`
         INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES (${world.workspaceId}, ${userId}, 'member')`;

      await assert.rejects(
         resolveAiRuntimeSelection(sql, {
            workspaceId: world.workspaceId,
            userId,
            overrideRuntimeId: 'kiro',
            overrideModelId: 'auto',
         }),
         (error: unknown) =>
            error instanceof AiRuntimeSelectionError && error.code === 'AI_RUNTIME_NOT_CONNECTED'
      );
   });

   test('an explicit native override does not borrow the personal default', async () => {
      const world = current();
      await connect();
      await repository.savePreference(world.workspaceId, world.userId, {
         runtimeId: 'kiro',
         modelId: 'auto',
      });
      const selected = await resolveAiRuntimeSelection(sql, {
         workspaceId: world.workspaceId,
         userId: world.userId,
         overrideRuntimeId: NATIVE_AI_RUNTIME,
         overrideModelId: null,
      });
      assert.equal(selected.runtimeId, null);
      assert.equal(selected.connectionId, null);
   });

   test('disconnect returns active runs and clears the personal default', async () => {
      const world = current();
      const connection = await connect();
      await repository.savePreference(world.workspaceId, world.userId, {
         runtimeId: 'kiro',
         modelId: 'auto',
      });
      const issueId = await createIssue(sql, world, 'Personal runtime task');
      const queued = await enqueueTask(sql, {
         workspaceId: world.workspaceId,
         issueId,
         agentId: world.agentId,
         kind: 'agent',
         source: 'assignment',
         requestedBy: world.userId,
      });
      const [run] = await sql<Array<{ ai_runtime_connection_id: string | null }>>`
         SELECT ai_runtime_connection_id FROM runs WHERE id = ${queued.runId}`;
      assert.equal(run?.ai_runtime_connection_id, connection.connection.id);

      const result = await repository.disconnect(world.workspaceId, world.userId, 'kiro');
      assert.deepEqual(result.activeRunIds, [queued.runId]);
      assert.deepEqual(await repository.preference(world.workspaceId, world.userId), {
         runtimeId: null,
         modelId: null,
      });
   });

   test('a catalog stub cannot be connected as if it worked', async () => {
      const world = current();
      await assert.rejects(
         repository.connect({
            workspaceId: world.workspaceId,
            userId: world.userId,
            runtimeId: 'cursor',
            authMethod: 'local_login',
            accountId: null,
            accountName: null,
         }),
         (error: unknown) =>
            error instanceof AiRuntimeSelectionError && error.code === 'AI_RUNTIME_UNAVAILABLE'
      );
   });
});
