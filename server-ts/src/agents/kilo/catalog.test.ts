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
   // Terminal-Bench is left out here: the test below reads it.
   return { catalog: new KiloCatalog({ apiKey: 'k', baseUrl: 'https://gw/', usageUrl: 'https://site/usage', ratingsUrl: null, fetch, clock, ttlMs: 1000 }), seen };
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

test('Terminal-Bench rates the models on its newest scale, Kilo filling gaps; a failed leaderboard keeps its last copy', async () => {
   let now = 0;
   let tbenchDown = false;
   const boards: string[] = [];
   const board = (rows: Array<[string, number]>) =>
      ok({ rows: rows.map(([label, accuracy]) => ({ metadata: { model_display: { label } }, metrics: { accuracy } })) });
   const fetch = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://tb/read') {
         const { name } = JSON.parse(String(init?.body)) as { name: string };
         boards.push(`${name} ${new Headers(init?.headers).get('authorization') ?? '-'}`);
         if (tbenchDown) return new Response('down', { status: 503 });
         // The newest leaderboard rates a, b, c; the oldest also rates d. Kilo scores e.
         return name === '4-0-0'
            ? board([['Model A', 60], ['Model B', 40], ['Model C', 20]])
            : name === '2-0'
              ? board([['Model A', 90], ['Model B', 70], ['Model C', 50], ['Model D', 30]])
              : ok({ rows: [] });
      }
      if (url.endsWith('/models')) {
         return ok({
            data: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
               raw(`v/model-${id}`, id === 'e' || id === 'a' ? { terminalBench: { overallScore: id === 'a' ? 0.8 : 0.5, avgAttemptCostUsd: 9 } } : {})
            ),
         });
      }
      return ok([]);
   }) as typeof globalThis.fetch;
   const catalog = new KiloCatalog({ apiKey: 'k', baseUrl: 'https://gw/', usageUrl: 'https://site/usage', ratingsUrl: 'https://tb/read', fetch, clock: () => now, ttlMs: 1000 });

   const snapshot = await catalog.snapshot();
   assert.ok(boards.every((entry) => entry.endsWith(' -')), 'read without the key');
   assert.equal(snapshot.ratingScale, 'Terminal-Bench 4.0');
   const rating = (id: string) => snapshot.models.find((m) => m.id === `v/model-${id}`)!.bench;
   assert.equal(rating('a')!.completion, 0.6, 'the newest score stands');
   assert.equal(rating('a')!.costPerAttemptUsd, 9, "Kilo's attempt cost is kept");
   assert.ok(rating('d')!.completion < rating('c')!.completion, 'the oldest-only model is converted below c');
   assert.equal(rating('e'), null, 'Kilo shares one model with the scale: too few to convert through');
   assert.equal(rating('f'), null);

   now = 5000;
   tbenchDown = true;
   const again = await catalog.snapshot();
   assert.equal(again.ratingsStale, true);
   assert.equal(again.models.find((m) => m.id === 'v/model-d')!.bench!.completion, rating('d')!.completion);
});
