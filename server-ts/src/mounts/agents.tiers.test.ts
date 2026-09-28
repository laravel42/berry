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

/**
 * An agent's own tier and its fallback model (ADR-0017), written through
 * `PUT /:agentId/config`.
 */

const url = process.env.BERRY_TEST_DATABASE_URL;

const model = (id: string): CatalogModel => ({
   id, displayName: id, provider: 'kilo', tier: '', contextWindow: 0, inputCostPerM: 0, outputCostPerM: 0, supportsTools: true, supportsVision: false,
});
const catalog: ModelSource = { list: async () => [model('openai/gpt-6-luna'), model('anthropic/claude-haiku-4.5')] };

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
});
