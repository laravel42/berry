import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AI_RUNTIME_CATALOG, AI_RUNTIME_IDS } from './ai-runtime-catalog.ts';

describe('AI runtime catalog', () => {
   test('lists only connectable runtimes, each exactly once', () => {
      assert.equal(AI_RUNTIME_CATALOG.length, 7);
      assert.deepEqual(
         [...AI_RUNTIME_CATALOG.map((runtime) => runtime.id)].sort(),
         [...AI_RUNTIME_IDS].sort()
      );
      assert.equal(new Set(AI_RUNTIME_CATALOG.map((runtime) => runtime.id)).size, 7);
   });

   test('advertises only a fully implemented integration', () => {
      assert.deepEqual(
         AI_RUNTIME_CATALOG.map((runtime) => runtime.id),
         ['claude', 'codex', 'cursor', 'grok', 'kiro', 'qoder', 'kimi']
      );
      for (const runtime of AI_RUNTIME_CATALOG) {
         assert.equal(runtime.availability, 'available', runtime.id);
         assert.equal(runtime.unavailableReason, null, runtime.id);
         assert.equal(runtime.executionMode, 'agent_process', runtime.id);
         assert.equal(runtime.billing, 'subscription', runtime.id);
      }
   });

   test('keeps identity, billing, and official evidence explicit', () => {
      for (const runtime of AI_RUNTIME_CATALOG) {
         assert.ok(runtime.provider.length > 0, runtime.id);
         assert.ok(runtime.billingDetail.length > 0, runtime.id);
         assert.ok(runtime.connectionMethods.length > 0, runtime.id);
         assert.ok(runtime.officialSources.length > 0, runtime.id);
         assert.ok(
            runtime.officialSources.every((source) => source.startsWith('https://')),
            runtime.id
         );
      }
   });

   test('omits products that are not yet connectable', () => {
      for (const id of ['opencode', 'openclaw', 'hermes', 'pi', 'antigravity', 'trae-cli', 'qwen']) {
         assert.equal(AI_RUNTIME_CATALOG.find((runtime) => runtime.id === id), undefined, id);
      }
   });
});
