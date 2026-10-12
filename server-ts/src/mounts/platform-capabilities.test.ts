import assert from 'node:assert/strict';
import { test } from 'node:test';
import { platformMounts } from './platform.ts';

test('connecting or disconnecting a subscription updates execution capabilities without restart', async () => {
   let connected = false;
   const config = platformMounts({
      database: async () => {},
      capabilities: {
         agentExecution: async () => connected, planner: async () => connected,
         githubSignIn: false, metrics: false, realtime: true, storage: false, valkey: false,
      },
   }).find((mount) => mount.prefix === '/api/v1/config');
   assert.ok(config);
   for (const state of [false, true, false]) {
      connected = state;
      const response = await config.handler.request('/');
      const body = await response.json() as { capabilities: { agentExecution: boolean; planner: boolean } };
      assert.equal(body.capabilities.agentExecution, state);
      assert.equal(body.capabilities.planner, state);
   }
});

test('execution capabilities follow the requested workspace, not some other workspace', async () => {
   const connected = '11111111-1111-4111-8111-111111111111';
   const config = platformMounts({
      database: async () => {},
      capabilities: {
         agentExecution: async (request) => new URL(request.url).searchParams.get('workspaceId') === connected,
         planner: async (request) => new URL(request.url).searchParams.get('workspaceId') === connected,
         githubSignIn: false, metrics: false, realtime: true, storage: false, valkey: false,
      },
   }).find((mount) => mount.prefix === '/api/v1/config');
   assert.ok(config);
   const read = async (path: string) =>
      (await (await config.handler.request(path)).json()) as {
         capabilities: { agentExecution: boolean; planner: boolean };
      };
   const absent = await read('/');
   assert.equal(absent.capabilities.agentExecution, false);
   assert.equal(absent.capabilities.planner, false);
   const other = await read('/?workspaceId=22222222-2222-4222-8222-222222222222');
   assert.equal(other.capabilities.agentExecution, false);
   assert.equal(other.capabilities.planner, false);
   const mine = await read(`/?workspaceId=${connected}`);
   assert.equal(mine.capabilities.agentExecution, true);
   assert.equal(mine.capabilities.planner, true);
});
