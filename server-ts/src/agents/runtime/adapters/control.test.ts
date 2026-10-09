import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { AgentProcessAdapter } from './types.ts';
import { RuntimeAdapterError } from './types.ts';
import { RuntimeAdapterRegistry } from './registry.ts';
import { handleRuntimeControl } from './control.ts';

function adapter(): AgentProcessAdapter {
   return {
      identity: {
         id: 'test-agent',
         name: 'Test agent',
         kind: 'agent_process',
         provider: 'Test provider',
         billing: 'subscription',
         capabilities: {
            modelDiscovery: true,
            streaming: true,
            tools: true,
            sessions: true,
            cancellation: true,
            usage: true,
         },
      },
      checkAvailability: async () => ({
         available: true,
         version: '1',
         reason: null,
         protocolVersion: 1,
         principalIsolation: 'session_container',
      }),
      connectionStatus: async (credential) => ({
         status: credential ? 'connected' : 'missing',
         accountId: credential?.accountId ?? null,
         accountName: credential?.accountName ?? null,
         detail: null,
      }),
      disconnect: async () => undefined,
      discoverModels: async () => [
         { id: 'one', name: 'One', reasoning: true, tools: true, policy: null },
      ],
      start: async () => ({ text: '', sessionId: 'session' }),
      resume: async () => ({ text: '', sessionId: 'session' }),
      cancel: async () => undefined,
   };
}

const request = {
   runtimeSessionId: `berry-${'c'.repeat(64)}`,
   runtimeId: 'test-agent',
   credential: { type: 'oauth' as const, token: 'secret', accountId: '1', accountName: 'one' },
};

describe('runtime adapter control', () => {
   test('normalizes availability, authentication, and model discovery', async () => {
      const registry = new RuntimeAdapterRegistry([adapter()]);
      assert.deepEqual(
         await handleRuntimeControl(registry, { ...request, operation: 'availability' }),
         {
            ok: true,
            availability: {
               available: true,
               version: '1',
               reason: null,
               protocolVersion: 1,
               principalIsolation: 'session_container',
            },
         }
      );
      assert.deepEqual(
         await handleRuntimeControl(registry, { ...request, operation: 'connection' }),
         {
            ok: true,
            connection: { status: 'connected', accountId: '1', accountName: 'one', detail: null },
         }
      );
      assert.deepEqual(
         await handleRuntimeControl(registry, { ...request, operation: 'models' }),
         {
            ok: true,
            models: [{ id: 'one', name: 'One', reasoning: true, tools: true, policy: null }],
         }
      );
   });

   test('refuses missing adapters and missing credentials without a stub success', async () => {
      assert.equal(
         (await handleRuntimeControl(new RuntimeAdapterRegistry([]), { ...request, operation: 'models' })).ok,
         false
      );
      const noCredential = await handleRuntimeControl(new RuntimeAdapterRegistry([adapter()]), {
         ...request,
         operation: 'models',
         credential: null,
      });
      assert.deepEqual(noCredential, {
         ok: false,
         error: {
            code: 'AUTH_REQUIRED',
            message: 'Connect this runtime before listing models.',
            retryable: false,
         },
      });
   });

   test('preserves normalized adapter failures and hides unknown failures', async () => {
      const failing = adapter();
      failing.discoverModels = async () => {
         throw new RuntimeAdapterError('QUOTA_EXHAUSTED', 'Subscription limit reached.', false);
      };
      assert.deepEqual(
         await handleRuntimeControl(new RuntimeAdapterRegistry([failing]), {
            ...request,
            operation: 'models',
         }),
         {
            ok: false,
            error: {
               code: 'QUOTA_EXHAUSTED',
               message: 'Subscription limit reached.',
               retryable: false,
            },
         }
      );
   });
});
