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
