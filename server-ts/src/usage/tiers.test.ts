import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { recordTaskUsage } from './record.ts';
import { tierUsage, usageWindow } from './queries.ts';
import { addRun, cleanupUsageWorld, scopeOf, seedUsageWorld, type UsageWorld } from './test-fixtures.ts';

/** The tier comparison (ADR-0017): runs, cost with BerryAuto's fee, fallbacks, per tier. */

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('usage by tier', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let world: UsageWorld;
   let other: UsageWorld;

   async function record(w: UsageWorld, runId: string, extra: Record<string, unknown>) {
      await recordTaskUsage(sql, {
         runId, workspaceId: w.workspaceId, agentId: w.agentId, model: 'openai/gpt-6-luna',
         inputTokens: 100, outputTokens: 10, cacheReadTokens: 50, cacheWriteTokens: 0, ...extra,
      });
   }

   before(async () => {
      sql = openDatabase({ url: url! });
      world = await seedUsageWorld(sql, 'tiers');
      other = await seedUsageWorld(sql, 'tiers-other');
      const low1 = await addRun(sql, world);
      const low2 = await addRun(sql, world);
      const mid = await addRun(sql, world);
      await record(world, low1.runId, { tier: 'berry_low', reportedCostMicros: 40 });
      await record(world, low1.runId, { tier: 'berry_low', reportedCostMicros: 60, fellBack: true, model: 'openai/gpt-5.6-luna' });
      await record(world, low2.runId, { tier: 'berry_low', reportedCostMicros: null });
      await record(world, mid.runId, { tier: 'berry_mid', reportedCostMicros: 100, model: 'moonshotai/kimi-k3' });
      await sql`UPDATE task_usage SET gateway_fee_micros = 7 WHERE run_id = ${mid.runId}`;
      // A model the agent named: no tier, not compared.
      await record(world, (await addRun(sql, world)).runId, { reportedCostMicros: 999 });
      // Another workspace's tier usage is not this one's.
      await record(other, (await addRun(sql, other)).runId, { tier: 'berry_low', reportedCostMicros: 5 });
   });

   after(async () => {
      await cleanupUsageWorld(sql, world);
      await cleanupUsageWorld(sql, other);
      await closeDatabase(sql);
   });

   test('each tier sums its runs, reported cost plus fee, unpriced records and fallback runs', async () => {
      const rows = await tierUsage(scopeOf(sql, world.workspaceId), usageWindow(30));
      assert.deepEqual(
         rows.map((row) => [row.tier, row.runs, row.costMicros, row.unpricedRecords, row.fellBackRuns]),
         [
            ['berry_low', 2, 100, 1, 1],
            ['berry_mid', 1, 107, 0, 0],
         ]
      );
      assert.equal(rows.find((row) => row.tier === 'berry_low')!.inputTokens, 300);
   });
});
