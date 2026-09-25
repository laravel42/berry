import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_MODEL, isPaidEligible, rankTiers, tierOf, type GatewayModel, type UsageRow } from './tiers.ts';

/**
 * The ranking rule (ADR-0017): Max and Mid from KiloBench, Low from real
 * coding usage per dollar below Mid's price, one tier per model.
 */

function model(id: string, input: number, output: number, extra: Partial<GatewayModel> = {}): GatewayModel {
   return {
      id,
      name: id,
      contextLength: 200_000,
      supportsTools: true,
      supportsVision: false,
      isFree: false,
      mayTrain: false,
      expiresAt: null,
      ownKey: true,
      price: { input, output, cacheRead: null, cacheWrite: null },
      bench: null,
      ...extra,
   };
}
const bench = (completion: number, costPerAttemptUsd: number) => ({ bench: { completion, costPerAttemptUsd } });
const code = (model: string, tokens: number): UsageRow => ({ usageDate: '2026-09-24', model, mode: 'code', tokens });

const catalog = [
   model('a/astra', 10, 50, bench(0.79, 107)),
   model('a/fable', 10, 50, bench(0.76, 91)),
   model('a/sol', 4, 20, bench(0.76, 87)),
   model('a/gpt-55', 5, 30, bench(0.74, 73)),
   model('m/kimi', 3, 15, bench(0.73, 48)),
   model('a/opus', 5, 25, bench(0.715, 113)),
   model('a/sonnet', 2, 10, bench(0.6, 36)),
   model('o/luna', 0.1, 0.5),
   model('o/luna-old', 0.2, 1.2),
   model('o/sol-6', 2, 10),
   model('q/coder', 0.3, 1.5),
   model('x/not-mine', 0.1, 0.1, { ownKey: false }),
   model('~a/sonnet-latest', 2, 10),
   model('d/retiring', 0.27, 0.4, { expiresAt: '2026-09-28' }),
   model('p/free-a:free', 0, 0, { isFree: true, mayTrain: true }),
   model('p/free-b:free', 0, 0, { isFree: true, mayTrain: true, ...bench(0.3, 2) }),
   model(AUTO_MODEL, -1, -1),
];
const usage = [code('o/luna', 2.77e9), code('o/luna-old', 4.07e9), code('o/sol-6', 3.15e9), code('q/coder', 0.2e9), code('x/not-mine', 9e9), code('p/free-a:free', 5e9)];

test('Max is the top completion; Mid is completion per dollar at or above the median; no model in two tiers', () => {
   const pools = rankTiers(catalog, usage);
   assert.deepEqual(pools.berry_max.map((m) => m.id), ['a/astra', 'a/fable', 'a/sol']);
   // Median completion of the 7 scored is 0.74: gpt-55 (0.74) and kimi (0.73 < bar) — kimi is below it.
   assert.deepEqual(pools.berry_mid.map((m) => m.id), ['a/gpt-55']);
   const all = [...pools.berry_max, ...pools.berry_mid, ...pools.berry_low].map((m) => m.id);
   assert.equal(new Set(all).size, all.length);
});

test('Low ranks unscored models by coding usage per dollar, below Mid\'s cheapest price', () => {
   const pools = rankTiers(catalog, usage);
   // gpt-55 blends to (5*3+30)/4 = 11.25/M; sol-6 at 4.00/M is under it and in;
   // luna (0.20/M, 2.77B) beats luna-old (0.45/M, 4.07B) per dollar.
   assert.deepEqual(pools.berry_low.map((m) => m.id), ['o/luna', 'o/luna-old', 'o/sol-6']);
   const capped = rankTiers(catalog.map((m) => (m.id === 'a/gpt-55' ? { ...m, price: { ...m.price, input: 1, output: 3 } } : m)), usage);
   assert.ok(!capped.berry_low.some((m) => m.id === 'o/sol-6'), 'a model priced above Mid is not Low');
});

test('the account\'s own key, a real id, tools, and no retirement are required for a paid tier', () => {
   assert.equal(isPaidEligible(model('x/not-mine', 1, 1, { ownKey: false })), false);
   assert.equal(isPaidEligible(model('~a/latest', 1, 1)), false);
   assert.equal(isPaidEligible(model('a/no-tools', 1, 1, { supportsTools: false })), false);
   assert.equal(isPaidEligible(model('a/retiring', 1, 1, { expiresAt: '2026-10-01' })), false);
   assert.equal(isPaidEligible(model('a/trains', 1, 1, { mayTrain: true })), false);
   const pools = rankTiers(catalog, usage);
   assert.equal(tierOf(pools, 'x/not-mine'), null);
   assert.equal(tierOf(pools, '~a/sonnet-latest'), null);
});

test('Free ranks by real usage, a weak benchmark only breaking ties; Auto is always Kilo\'s router, price unknown', () => {
   const pools = rankTiers(catalog, usage);
   assert.deepEqual(pools.berry_free.map((m) => m.id), ['p/free-a:free', 'p/free-b:free'], 'the used model outranks the scored one');
   assert.deepEqual(pools.berry_auto.map((m) => [m.id, m.blendedPricePerM]), [[AUTO_MODEL, null]]);
   assert.deepEqual(rankTiers([], []).berry_auto.map((m) => m.id), [AUTO_MODEL]);
});

test('with no scores at all, Max and Mid are empty and Low is uncapped', () => {
   const pools = rankTiers(catalog.map((m) => ({ ...m, bench: null })), usage);
   assert.deepEqual(pools.berry_max, []);
   assert.deepEqual(pools.berry_mid, []);
   assert.equal(pools.berry_low.length, 3);
});

test('a tier falls back to the nearest tier in price when empty today', async () => {
   const { modelForTier } = await import('./tiers.ts');
   const pools = rankTiers(catalog, usage);
   assert.equal(modelForTier(pools, 'berry_low'), 'o/luna');
   const noLow = { ...pools, berry_low: [] };
   assert.equal(modelForTier(noLow, 'berry_low'), 'a/gpt-55', 'empty Low falls to Mid, not Max');
   assert.equal(modelForTier({ ...noLow, berry_mid: [], berry_max: [] }, 'berry_low'), null);
});

test('a gateway id names a vendor; a Bedrock profile does not', async () => {
   const { isGatewayModelId } = await import('./tiers.ts');
   assert.equal(isGatewayModelId('anthropic/claude-haiku-4.5'), true);
   assert.equal(isGatewayModelId('us.anthropic.claude-haiku-4-5-20251001-v1:0'), false);
});
