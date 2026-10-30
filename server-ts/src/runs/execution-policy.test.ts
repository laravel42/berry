import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { cleanupWorkspace, seedWorkspace, type Fixture } from '../autopilots/test-fixture.ts';
import {
   agentExecutionAvailable,
   configureTaskExecution,
   requestedExecutionWorkspaceId,
   taskExecutionAllowed,
   WORKSTATION_RUNTIME_KEYS,
} from './execution-policy.ts';

after(() => configureTaskExecution(null));

test('subscription-only execution refuses native work instead of leaving it queued', () => {
   configureTaskExecution({ nativeExecution: false, workstationKeys: WORKSTATION_RUNTIME_KEYS });
   assert.equal(taskExecutionAllowed(null), false);
   for (const key of WORKSTATION_RUNTIME_KEYS) assert.equal(taskExecutionAllowed(key), true);
   assert.equal(taskExecutionAllowed('unknown'), false);
});

test('a native compute host admits native work, workstation CLIs, and API-token runtimes', () => {
   configureTaskExecution({ nativeExecution: true, workstationKeys: WORKSTATION_RUNTIME_KEYS });
   assert.equal(taskExecutionAllowed(null), true);
   for (const key of ['kiro', 'claude', 'codex', 'cursor', 'kimi', 'grok', 'qoder']) {
      assert.equal(taskExecutionAllowed(key), true);
   }
   for (const key of ['openai', 'xai', 'anthropic', 'gemini']) {
      assert.equal(taskExecutionAllowed(key), true);
   }
   assert.equal(taskExecutionAllowed('unknown'), false);
   assert.equal(taskExecutionAllowed('opencode'), false);
});

test('without a compute host an API-token runtime is not executable', () => {
   configureTaskExecution({ nativeExecution: false, workstationKeys: WORKSTATION_RUNTIME_KEYS });
   assert.equal(taskExecutionAllowed('gemini'), false);
   assert.equal(taskExecutionAllowed('openai'), false);
});

test('an execution capability names one workspace, never every workspace', () => {
   const selected = '11111111-1111-4111-8111-111111111111';
   const other = '22222222-2222-4222-8222-222222222222';
   const request = (workspaceId?: string) =>
      new Request(
         workspaceId === undefined
            ? 'http://localhost/api/v1/config'
            : `http://localhost/api/v1/config?workspaceId=${workspaceId}`
      );
   assert.equal(requestedExecutionWorkspaceId(request(), selected), selected);
   assert.equal(requestedExecutionWorkspaceId(request(other), selected), other);
   assert.equal(requestedExecutionWorkspaceId(request('not-a-workspace'), selected), null);
   assert.equal(requestedExecutionWorkspaceId(request(), null), null);
});

describe(
   'workspace execution availability',
   { skip: process.env.BERRY_TEST_DATABASE_URL ? false : 'BERRY_TEST_DATABASE_URL is not set' },
   () => {
   test('one workspace connection does not make execution available for every workspace', async () => {
      const sql = openDatabase({ url: process.env.BERRY_TEST_DATABASE_URL as string });
      const connected = await seedWorkspace(sql, 'exec-yes');
      const idle = await seedWorkspace(sql, 'exec-no');
      try {
         await connectRuntime(sql, connected, 'kiro');
         assert.equal(
            await agentExecutionAvailable(sql, {
               nativeExecution: false,
               workspaceId: connected.workspaceId,
               runtimeKeys: WORKSTATION_RUNTIME_KEYS,
            }),
            true
         );
         assert.equal(
            await agentExecutionAvailable(sql, {
               nativeExecution: false,
               workspaceId: idle.workspaceId,
               runtimeKeys: WORKSTATION_RUNTIME_KEYS,
            }),
            false
         );
         assert.equal(
            await agentExecutionAvailable(sql, {
               nativeExecution: false,
               workspaceId: null,
               runtimeKeys: WORKSTATION_RUNTIME_KEYS,
            }),
            false
         );
         assert.equal(
            await agentExecutionAvailable(sql, {
               nativeExecution: true,
               workspaceId: null,
               runtimeKeys: WORKSTATION_RUNTIME_KEYS,
            }),
            true
         );
      } finally {
         await cleanupWorkspace(sql, connected);
         await cleanupWorkspace(sql, idle);
         await closeDatabase(sql);
      }
   });
});

async function connectRuntime(sql: Sql, fixture: Fixture, runtimeKey: string): Promise<void> {
   await sql`
      INSERT INTO ai_runtime_connections (id, workspace_id, user_id, runtime_key, auth_method, status)
      VALUES (${randomUUID()}, ${fixture.workspaceId}, ${fixture.userId}, ${runtimeKey}, 'workstation', 'connected')`;
}
