import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CatalogUnavailable } from '../catalog.ts';
import { borrowPredecessorRatings, KiloCatalog, modelDisplayName, modelVersion, parseGatewayModel } from './catalog.ts';
import type { GatewayModel } from './tiers.ts';

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

test("a workspace's placement replaces the deployment's for its runs only", async () => {
   const models = [
      raw('a/best', { terminalBench: { overallScore: 0.8, avgAttemptCostUsd: 50 } }),
      raw('a/good', { terminalBench: { overallScore: 0.6, avgAttemptCostUsd: 20 } }),
      raw('a/cheap', { terminalBench: { overallScore: 0.3, avgAttemptCostUsd: 2 } }),
   ];
   const fetch = (async (input: unknown) => (String(input).endsWith('/models') ? ok({ data: models }) : ok([]))) as typeof globalThis.fetch;
   const catalog = new KiloCatalog({
      apiKey: 'k', baseUrl: 'https://gw/', usageUrl: 'https://site/usage', ratingsUrl: null, fetch, clock: () => 0, ttlMs: 1000,
      policy: { place: { berry_mid: ['a/good'] } },
   });
   assert.deepEqual(catalog.deploymentPlacement, { berry_max: [], berry_mid: ['a/good'], berry_low: [] });
   assert.equal((await catalog.choose('berry_mid'))?.model, 'a/good');
   const own = { berry_max: [], berry_mid: ['a/cheap'], berry_low: [] };
   assert.equal((await catalog.choose('berry_mid', 0, own))?.model, 'a/cheap');
   assert.equal(await catalog.poolsFor(own), await catalog.poolsFor({ ...own }), 'ranked once per placement');
   assert.equal((await catalog.choose('berry_mid'))?.model, 'a/good', 'the deployment placement is untouched');
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

test('a model id splits into its family and version', () => {
   assert.deepEqual(modelVersion('anthropic/claude-opus-5.5'), { family: 'anthropic/claude-opus', version: [5, 5] });
   assert.deepEqual(modelVersion('openai/gpt-5.6-sol'), { family: 'openai/gpt-sol', version: [5, 6] });
   assert.deepEqual(modelVersion('deepseek/deepseek-v4.1-flash'), { family: 'deepseek/deepseek-flash', version: [4, 1] });
   assert.equal(modelVersion('~anthropic/claude-opus-latest'), null, 'an alias has no version');
   assert.equal(modelVersion('p/model-2:free'), null);
   assert.equal(modelVersion('kilo-auto/efficient'), null);
});

test('an unrated new version borrows its newest rated predecessor, only when it costs no more', () => {
   const gateway = (id: string, name: string, input: number, output: number, completion: number | null): GatewayModel => ({
      id,
      name,
      contextLength: 200_000,
      supportsTools: true,
      supportsVision: false,
      isFree: false,
      mayTrain: false,
      expiresAt: null,
      ownKey: true,
      price: { input, output, cacheRead: null, cacheWrite: null },
      bench: completion === null ? null : { completion, costPerAttemptUsd: 100, estimatedFrom: null },
   });
   const borrowed = borrowPredecessorRatings([
      gateway('anthropic/claude-opus-4.8', 'Anthropic: Claude Opus 4.8', 5, 25, 0.236),
      gateway('anthropic/claude-opus-5', 'Anthropic: Claude Opus 5', 5, 25, 0.539),
      gateway('anthropic/claude-opus-5.5', 'Anthropic: Claude Opus 5.5 (new)', 4, 20, null),
      gateway('anthropic/claude-opus-6', 'Anthropic: Claude Opus 6', 10, 50, null),
      gateway('anthropic/claude-sonnet-6', 'Anthropic: Claude Sonnet 6', 1, 5, null),
   ]);
   const bench = (id: string) => borrowed.find((model) => model.id === id)!.bench;
   assert.deepEqual(bench('anthropic/claude-opus-5.5'), { completion: 0.539, costPerAttemptUsd: null, estimatedFrom: ['Claude Opus 5'] });
   assert.equal(bench('anthropic/claude-opus-6'), null, 'dearer than its predecessor: not assumed to be worth it');
   assert.equal(bench('anthropic/claude-sonnet-6'), null, 'another family lends nothing');
   assert.equal(bench('anthropic/claude-opus-5')!.completion, 0.539, 'a rated model keeps its own rating');
});

test("a model's name drops Kilo's (new) marker", () => {
   assert.equal(modelDisplayName('Anthropic: Claude Opus 5.5 (new)'), 'Anthropic: Claude Opus 5.5');
   assert.equal(modelDisplayName('OpenAI: GPT-6 Astra'), 'OpenAI: GPT-6 Astra');
   assert.equal(parseGatewayModel(raw('anthropic/claude-opus-5.5', { name: 'Anthropic: Claude Opus 5.5 (new)' }))?.name, 'Anthropic: Claude Opus 5.5');
});
