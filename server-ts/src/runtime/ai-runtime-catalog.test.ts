import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AI_RUNTIME_CATALOG, AI_RUNTIME_IDS } from './ai-runtime-catalog.ts';

describe('AI runtime catalog', () => {
   test('contains every requested product exactly once', () => {
      assert.equal(AI_RUNTIME_CATALOG.length, 14);
      assert.deepEqual(
         [...AI_RUNTIME_CATALOG.map((runtime) => runtime.id)].sort(),
         [...AI_RUNTIME_IDS].sort()
      );
      assert.equal(new Set(AI_RUNTIME_CATALOG.map((runtime) => runtime.id)).size, 14);
   });

   test('advertises only a fully implemented integration as available', () => {
      const available = AI_RUNTIME_CATALOG.filter((runtime) => runtime.availability === 'available');
      assert.deepEqual(available.map((runtime) => runtime.id), ['claude', 'codex', 'kimi', 'kiro']);
      assert.equal(available[0]?.executionMode, 'agent_process');
      assert.equal(available[0]?.billing, 'subscription');
      assert.equal(available.find((runtime) => runtime.id === 'kiro')?.unavailableReason, null);
      assert.equal(available.find((runtime) => runtime.id === 'claude')?.unavailableReason, null);
      assert.equal(available.find((runtime) => runtime.id === 'codex')?.unavailableReason, null);
      assert.equal(available.find((runtime) => runtime.id === 'kimi')?.unavailableReason, null);

      for (const runtime of AI_RUNTIME_CATALOG.filter((entry) => entry.availability === 'blocked')) {
         assert.ok(runtime.unavailableReason && runtime.unavailableReason.length > 20, runtime.id);
      }
   });

   test('keeps frameworks, providers, and billing evidence explicit', () => {
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
      assert.equal(AI_RUNTIME_CATALOG.find((runtime) => runtime.id === 'opencode')?.billing, 'provider_dependent');
      assert.equal(AI_RUNTIME_CATALOG.find((runtime) => runtime.id === 'trae-cli')?.subscriptionAccess, 'unsupported');
      assert.equal(AI_RUNTIME_CATALOG.find((runtime) => runtime.id === 'antigravity')?.billing, 'unknown');
   });
});
