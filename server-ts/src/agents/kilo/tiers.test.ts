import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AUTO_MODEL, isPaidEligible, rankTiers, tierOf, type GatewayModel, type UsageRow } from './tiers.ts';

/**
 * The ranking rule (ADR-0017): every paid tier from the ratings — Max the
 * best rated, Mid the best rated below Max's cheapest, Low the best rated
 * below Mid's cheapest — one tier per model.
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
   model('o/terra', 1.5, 7.5, bench(0.55, 30)),
   model('o/luna-5', 0.2, 1, bench(0.5, 5)),
   model('k/k25', 1, 3, bench(0.35, 20)),
   model('z/glm', 0.4, 1.6, bench(0.3, 10)),
   model('o/oss', 0.02, 0.1, bench(0.05, 1)),
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

test('Max is the best rated; Mid the best rated below Max\'s cheapest; Low below Mid\'s; one tier per model', () => {
   const pools = rankTiers(catalog, usage);
   // Blended (3 in : 1 out): astra and fable 20.00/M, sol 8.00/M.
   assert.deepEqual(pools.berry_max.map((m) => m.id), ['a/astra', 'a/fable', 'a/sol']);
   // Below 8.00: kimi 6.00, sonnet 4.00, terra 3.00.
   assert.deepEqual(pools.berry_mid.map((m) => m.id), ['m/kimi', 'a/sonnet', 'o/terra']);
   // Below 3.00: luna-5 0.40, k25 1.50, glm 0.70 — by rating, not per dollar.
   assert.deepEqual(pools.berry_low.map((m) => m.id), ['o/luna-5', 'k/k25', 'z/glm']);
   assert.equal(tierOf(pools, 'o/oss'), null, 'cheapest of all, but rated below every Low model');
   // Rated below Max and priced at or above its cheapest: never the better choice.
   assert.equal(tierOf(pools, 'a/gpt-55'), null);
   assert.equal(tierOf(pools, 'a/opus'), null);
   const all = [...pools.berry_max, ...pools.berry_mid, ...pools.berry_low].map((m) => m.id);
   assert.equal(new Set(all).size, all.length);
});

test('each paid tier costs less than the one above', () => {
   const pools = rankTiers(catalog, usage);
   const prices = (tier: 'berry_max' | 'berry_mid' | 'berry_low') => pools[tier].map((m) => m.blendedPricePerM!);
   assert.ok(Math.max(...prices('berry_mid')) < Math.min(...prices('berry_max')));
   assert.ok(Math.max(...prices('berry_low')) < Math.min(...prices('berry_mid')));
});

test('unrated models are in no paid tier, however much they are used', () => {
   const pools = rankTiers(catalog, usage);
   for (const id of ['o/luna', 'o/luna-old', 'o/sol-6', 'q/coder']) assert.equal(tierOf(pools, id), null, id);
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
   assert.deepEqual(
      pools.berry_auto.map((m) => [m.id, m.blendedPricePerM, m.inputPricePerM, m.outputPricePerM]),
      [[AUTO_MODEL, null, null, null]]
   );
   assert.deepEqual(rankTiers([], []).berry_auto.map((m) => m.id), [AUTO_MODEL]);
});

test('with no scores at all, Max and Mid are empty and Low ranks by usage per dollar, uncapped', () => {
   const pools = rankTiers(catalog.map((m) => ({ ...m, bench: null })), usage);
   assert.deepEqual(pools.berry_max, []);
   assert.deepEqual(pools.berry_mid, []);
   // luna (0.20/M, 2.77B) beats luna-old (0.45/M, 4.07B) per dollar.
   assert.deepEqual(pools.berry_low.map((m) => m.id), ['o/luna', 'o/luna-old', 'o/sol-6']);
});

test('a tier falls back to the nearest tier in price when empty today', async () => {
   const { modelForTier } = await import('./tiers.ts');
   const pools = rankTiers(catalog, usage);
   assert.equal(modelForTier(pools, 'berry_low'), 'o/luna-5');
   const noLow = { ...pools, berry_low: [] };
   assert.equal(modelForTier(noLow, 'berry_low'), 'm/kimi', 'empty Low falls to Mid, not Max');
   assert.equal(modelForTier({ ...noLow, berry_mid: [], berry_max: [] }, 'berry_low'), null);
});

test('a gateway id names a vendor; a Bedrock profile does not', async () => {
   const { isGatewayModelId } = await import('./tiers.ts');
   assert.equal(isGatewayModelId('anthropic/claude-haiku-4.5'), true);
   assert.equal(isGatewayModelId('us.anthropic.claude-haiku-4-5-20251001-v1:0'), false);
});

test('a tier picks among its top three by rank, the same seed always the same model', async () => {
   const { chooseForTier } = await import('./tiers.ts');
   const pools = rankTiers(catalog, usage);
   const seen = new Map<string, number>();
   for (let index = 0; index < 600; index += 1) {
      const choice = chooseForTier(pools, 'berry_max', `session-${index}`)!;
      seen.set(choice.model, (seen.get(choice.model) ?? 0) + 1);
   }
   // Weighted 3:2:1 across the top three; every one of them is used.
   assert.deepEqual([...seen.keys()].sort(), ['a/astra', 'a/fable', 'a/sol']);
   assert.ok(seen.get('a/astra')! > seen.get('a/sol')!, 'the first rank is chosen more than the third');
   assert.equal(chooseForTier(pools, 'berry_max', 'fixed')!.model, chooseForTier(pools, 'berry_max', 'fixed')!.model);
});

test('the default fallback is the top of the next tier down, never the model itself', async () => {
   const { chooseForTier } = await import('./tiers.ts');
   const pools = rankTiers(catalog, usage);
   assert.equal(chooseForTier(pools, 'berry_max', 's')!.fallback, 'm/kimi', 'Max falls back to Mid');
   assert.equal(chooseForTier(pools, 'berry_mid', 's')!.fallback, 'o/luna-5', 'Mid falls back to Low');
   const low = chooseForTier(pools, 'berry_low', 's')!;
   assert.notEqual(low.fallback, low.model, 'Low falls back to another Low model');
   assert.equal(chooseForTier(pools, 'berry_free', 's')!.fallback, 'o/luna-5', 'Free falls back to a paid Low model');
   assert.equal(chooseForTier(pools, 'berry_auto', 's')!.model, AUTO_MODEL);
   assert.equal(chooseForTier({ ...pools, berry_max: [], berry_mid: [], berry_low: [] }, 'berry_max', 's'), null);
});

test('a ranked model carries its input and output prices beside the blended one', () => {
   const pools = rankTiers(catalog, usage);
   assert.ok(pools.berry_max.length > 0);
   for (const model of pools.berry_max) {
      const listed = catalog.find((entry) => entry.id === model.id)!;
      assert.equal(model.inputPricePerM, listed.price.input, model.id);
      assert.equal(model.outputPricePerM, listed.price.output, model.id);
   }
});
