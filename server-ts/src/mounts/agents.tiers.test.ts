import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { AgentRepository } from '../agents/repository.ts';
import type { CatalogModel, ModelSource } from '../agents/catalog.ts';
import { personalTokenResolver } from '../auth/credentials.ts';
import { SessionService } from '../auth/sessions.ts';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { IdempotencyStore } from '../http/idempotency.ts';
import { Registry } from '../http/registry.ts';
import { call, dropAgentLayerWorld, seedAgentLayerWorld, type AgentLayerWorld } from './agent-layer.fixture.ts';
import { agentMounts } from './agents.ts';
import { KiloAccount } from '../agents/kilo/account.ts';
import { KiloCatalog } from '../agents/kilo/catalog.ts';
import { TierPlacements } from '../agents/kilo/placements.ts';

/**
 * An agent's own tier and its fallback model (ADR-0017), written through
 * `PUT /:agentId/config`.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

const model = (id: string): CatalogModel => ({
   id, displayName: id, provider: 'kilo', tier: '', contextWindow: 0, inputCostPerM: 0, outputCostPerM: 0, supportsTools: true, supportsVision: false,
});
const catalog: ModelSource = { list: async () => [model('openai/gpt-6-luna'), model('anthropic/claude-haiku-4.5')] };

const gatewayModel = (id: string, score: number, cacheRead: string | null) => ({
   id, name: id, context_length: 200000, supported_parameters: ['tools'], hasUserByokAvailable: true,
   pricing: { prompt: '0.000001', completion: '0.000005', ...(cacheRead ? { input_cache_read: cacheRead } : {}) },
   terminalBench: { overallScore: score, avgAttemptCostUsd: 1 },
});
const gateway = new KiloCatalog({
   apiKey: 'k', baseUrl: 'https://gw', usageUrl: 'https://site/usage', ratingsUrl: null,
   policy: { place: { berry_mid: ['v/mid'] } },
   fetch: (async (input: unknown) =>
      new Response(JSON.stringify(String(input).endsWith('/models')
         ? { data: [gatewayModel('v/top', 0.8, '0.0000001'), gatewayModel('v/mid', 0.5, '0.0000001'), gatewayModel('v/nocache', 0.4, null)] }
         : []))) as typeof fetch,
});

describe('agent tiers', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let app: BerryApp;
   let world: AgentLayerWorld;
   const config = (body: unknown) => call(app, world.ownerToken, 'PUT', `/api/v1/agents/${world.agentId}/config`, body);

   before(async () => {
      sql = openDatabase({ url: url as string });
      world = await seedAgentLayerWorld(sql);
      const registry = new Registry();
      registry.registerAll(
         agentMounts({
            sessions: new SessionService({ sql, auth: null, bearer: [personalTokenResolver(sql)] }),
            agents: new AgentRepository(sql),
            idempotency: new IdempotencyStore(sql),
            catalog,
            gateway: { catalog: gateway, account: new KiloAccount({ apiKey: 'k', appUrl: 'https://app' }), placements: new TierPlacements(sql) },
         })
      );
      app = createApp(registry);
   });

   after(async () => {
      await dropAgentLayerWorld(sql, world);
      await closeDatabase(sql);
   });

   test('an agent starts on its contract\'s tier, with no fallback of its own', async () => {
      const res = await call(app, world.ownerToken, 'GET', `/api/v1/agents/${world.agentId}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.tier, null);
      assert.equal(res.body.fallbackModel, null);
      assert.equal(res.body.defaultTier, 'berry_low', 'an agent outside the organization defaults to BerryLow');
   });

   test('a tier is set and cleared; anything else is refused', async () => {
      assert.equal((await config({ tier: 'berry_max' })).body.tier, 'berry_max');
      assert.equal((await config({ tier: null })).body.tier, null);
      // BerryFree and BerryAuto were removed (2026-09-27): no longer tiers.
      for (const tier of ['sonnet', 'berry_free', 'berry_auto']) {
         const refused = await config({ tier });
         assert.equal(refused.status, 400, tier);
         assert.equal((refused.body.error as { code: string }).code, 'TIER_INVALID');
      }
   });

   test('a fallback must be a gateway model the catalogue lists', async () => {
      assert.equal((await config({ fallbackModel: 'openai/gpt-6-luna' })).body.fallbackModel, 'openai/gpt-6-luna');
      const bedrock = await config({ fallbackModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' });
      assert.equal(bedrock.status, 400);
      assert.equal((bedrock.body.error as { code: string }).code, 'FALLBACK_MODEL_INVALID');
      const unlisted = await config({ fallbackModel: 'x-ai/grok-4.6' });
      assert.equal(unlisted.status, 400);
      assert.equal((unlisted.body.error as { code: string }).code, 'MODEL_UNAVAILABLE');
      assert.equal((await config({ fallbackModel: null })).body.fallbackModel, null);
   });

   test("a workspace places its own tier models, which only an admin may change, and can go back to the deployment's", async () => {
      const tiers = await call(app, world.ownerToken, 'GET', '/api/v1/agents/tiers');
      assert.equal(tiers.status, 200);
      assert.deepEqual(tiers.body.placement, { source: 'deployment', tiers: { berry_max: [], berry_mid: ['v/mid'], berry_low: [] } });

      const candidates = await call(app, world.ownerToken, 'GET', '/api/v1/agents/tiers/candidates');
      assert.deepEqual((candidates.body.models as Array<{ id: string }>).map((m) => m.id), ['v/top', 'v/mid', 'v/nocache']);
      const nocache = (candidates.body.models as Array<{ id: string; cacheReadPricePerM: number | null }>).find((m) => m.id === 'v/nocache');
      assert.equal(nocache?.cacheReadPricePerM, null);

      const put = (body: unknown, token = world.ownerToken) => call(app, token, 'PUT', '/api/v1/agents/tiers/placement', body);
      const placed = await put({ placement: { berry_max: [], berry_mid: ['v/nocache'], berry_low: [] } });
      assert.equal(placed.status, 200);
      assert.equal((placed.body.placement as { source: string }).source, 'workspace');
      const mid = (placed.body.tiers as Array<{ tier: string; models: Array<{ id: string }> }>).find((t) => t.tier === 'berry_mid');
      assert.equal(mid?.models[0]?.id, 'v/nocache');

      assert.equal((await put({ placement: { berry_max: ['v/top'], berry_mid: ['v/top'], berry_low: [] } })).status, 422, 'a model in two places');
      assert.equal((await put({ placement: { berry_max: ['x/unknown'], berry_mid: [], berry_low: [] } })).status, 422, 'a model the gateway does not list');
      assert.equal((await put({ placement: { berry_max: ['v/top', 'v/mid', 'v/nocache', 'v/x'], berry_mid: [], berry_low: [] } })).status, 422, 'more than a tier\'s three places');
      assert.equal((await put({ placement: null }, world.memberToken)).status, 403, 'a member cannot change what agents cost');

      const reset = await put({ placement: null });
      assert.equal((reset.body.placement as { source: string }).source, 'deployment');
   });
});
