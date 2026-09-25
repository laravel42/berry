import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogUnavailable } from '../catalog.ts';
import { KiloCatalog, parseGatewayModel } from './catalog.ts';

/** The gateway catalogue: parsed defensively, refreshed hourly, the last good one kept. */

const raw = (id: string, extra: Record<string, unknown> = {}) => ({
   id,
   name: id,
   context_length: 200000,
   pricing: { prompt: '0.000001', completion: '0.000005', input_cache_read: '0.0000001' },
   supported_parameters: ['tools', 'max_tokens'],
   hasUserByokAvailable: true,
   ...extra,
});

test('a model is read into per-million prices, tools, own-key and KiloBench', () => {
   const model = parseGatewayModel(raw('anthropic/claude-haiku-4.5', { terminalBench: { overallScore: 0.6, avgAttemptCostUsd: 12 } }));
   assert.ok(model);
   assert.equal(model.price.input, 1);
   assert.equal(model.price.output, 5);
   assert.equal(model.price.cacheRead, 0.1);
   assert.equal(model.price.cacheWrite, null);
   assert.equal(model.supportsTools, true);
   assert.equal(model.ownKey, true);
   assert.deepEqual(model.bench, { completion: 0.6, costPerAttemptUsd: 12 });
   assert.equal(parseGatewayModel({ id: 'broken' }), null);
});

function catalogWith(responses: { models: () => Response; usage: () => Response }, clock: () => number) {
   const seen: string[] = [];
   const fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push(`${url} ${new Headers(init?.headers).get('authorization') ?? '-'}`);
      return url.endsWith('/models') ? responses.models() : responses.usage();
   }) as typeof globalThis.fetch;
   return { catalog: new KiloCatalog({ apiKey: 'k', baseUrl: 'https://gw/', usageUrl: 'https://site/usage', fetch, clock, ttlMs: 1000 }), seen };
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

test('the model list is read with the key, the leaderboard without it, and tiers are ranked', async () => {
   const { catalog, seen } = catalogWith(
      { models: () => ok({ data: [raw('a/x', { terminalBench: { overallScore: 0.7, avgAttemptCostUsd: 50 } })] }), usage: () => ok([]) },
      () => 0
   );
   const snapshot = await catalog.snapshot();
   assert.deepEqual(seen.sort(), ['https://gw/models Bearer k', 'https://site/usage -']);
   assert.deepEqual(snapshot.pools.berry_max.map((m) => m.id), ['a/x']);
   const list = await catalog.list();
   assert.deepEqual(list.map((m) => [m.id, m.provider, m.tier]), [['a/x', 'kilo', 'BerryMax']]);
});

test('a failed refresh keeps the last snapshot as stale; with none, the catalogue is unavailable', async () => {
   let now = 0;
   let fail = false;
   const { catalog } = catalogWith(
      { models: () => (fail ? new Response('down', { status: 503 }) : ok({ data: [raw('a/x')] })), usage: () => new Response('down', { status: 500 }) },
      () => now
   );
   const first = await catalog.snapshot();
   assert.equal(first.stale, false);
   assert.equal(first.usageStale, true);
   fail = true;
   now = 5000;
   const second = await catalog.snapshot();
   assert.equal(second.stale, true);
   assert.deepEqual(second.models.map((m) => m.id), ['a/x']);

   const { catalog: cold } = catalogWith({ models: () => new Response('down', { status: 503 }), usage: () => ok([]) }, () => 0);
   await assert.rejects(cold.snapshot(), CatalogUnavailable);
});
