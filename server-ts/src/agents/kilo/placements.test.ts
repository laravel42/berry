import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stepCost } from './placements.ts';
import type { GatewayModel } from './tiers.ts';

const model = (price: GatewayModel['price']): GatewayModel => ({
   id: 'v/m', name: 'm', contextLength: 200000, supportsTools: true, supportsVision: false, isFree: false,
   mayTrain: false, expiresAt: null, ownKey: true, price, bench: null,
});

test('a step is priced at the cache price for what a caching model reads from its cache', () => {
   const mix = { contextTokens: 40_000, outputTokens: 400, cacheHitShare: 0.95 };
   // 38,000 cached at $0.30, 2,000 fresh at $3, 400 out at $15.
   assert.equal(stepCost(model({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: null }), mix)?.toFixed(4), '0.0234');
   // Cheaper per token, dearer per step: without a cache price all 40,000 pay full input.
   assert.equal(stepCost(model({ input: 0.3, output: 1.5, cacheRead: null, cacheWrite: null }), mix)?.toFixed(4), '0.0126');
   assert.equal(stepCost(model({ input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: null }), mix)?.toFixed(4), '0.0034');
   assert.equal(stepCost(model({ input: -1, output: -1, cacheRead: null, cacheWrite: null }), mix), null, 'a router has no fixed price');
});
