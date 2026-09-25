import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { enqueueTask } from '../runs/queue.ts';
import { cleanupFixture, createIssue, seedFixture, type Fixture } from '../runtime/test-fixture.ts';
import { allocateDayFee, berryAutoFees } from './gateway-fees.ts';

/** BerryAuto's classifier fees: read from the account, spread over the day's BerryAuto usage. */

test('only BerryAuto\'s auto model is Berry\'s fee; another client\'s is not', () => {
   const row = (date: string, model: string, costMicros: number) => ({
      date, model, costMicros, requests: 1, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheHitTokens: 0,
   });
   const fees = berryAutoFees([
      row('2026-09-25', 'kilo-auto/efficient', 41),
      row('2026-09-25', 'kilo-auto/balanced', 30),
      row('2026-09-25', 'qwen/qwen3.8-max', 1966),
      row('2026-09-24', 'kilo-auto/efficient', 10),
   ]);
   assert.deepEqual([...fees], [['2026-09-25', 41], ['2026-09-24', 10]]);
});

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('gateway fee allocation', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let fixture: Fixture | null = null;

   before(async () => {
      sql = openDatabase({ url: url! });
      fixture = await seedFixture(sql, 'gateway-fees');
   });
   after(async () => {
      await sql`DELETE FROM task_usage WHERE workspace_id = ${fixture!.workspaceId}`;
      await sql`DELETE FROM runs WHERE workspace_id = ${fixture!.workspaceId}`;
      await cleanupFixture(sql, fixture);
      await closeDatabase(sql);
   });

   async function usage(tier: string | null, tokens: number, day: string): Promise<string> {
      const f = fixture!;
      const issueId = await createIssue(sql, f);
      const { runId } = await enqueueTask(sql, { workspaceId: f.workspaceId, agentId: f.agentId, issueId, kind: 'agent', source: 'mention', prompt: 'go' });
      const [row] = await sql`
         INSERT INTO task_usage (workspace_id, run_id, issue_id, agent_id, model, input_tokens, tier, occurred_at)
         VALUES (${f.workspaceId}, ${runId}, ${issueId}, ${f.agentId}, 'z-ai/glm-5.3-flash', ${tokens}, ${tier}, ${`${day}T12:00:00Z`})
         RETURNING id`;
      await sql`UPDATE issues SET active_run_id = NULL WHERE id = ${issueId}`;
      return row!.id as string;
   }
   const feeOf = async (id: string) => Number((await sql`SELECT gateway_fee_micros FROM task_usage WHERE id = ${id}`)[0]!.gateway_fee_micros);

   test('a day\'s fee is spread by tokens over that day\'s BerryAuto usage, summing exactly, and a rerun does not add', async () => {
      const big = await usage('berry_auto', 3000, '2026-09-20');
      const small = await usage('berry_auto', 1000, '2026-09-20');
      const other = await usage('berry_low', 5000, '2026-09-20');
      const nextDay = await usage('berry_auto', 1000, '2026-09-21');

      assert.equal(await allocateDayFee(sql, '2026-09-20', 41), 2);
      assert.equal(await feeOf(big), 31);
      assert.equal(await feeOf(small), 10);
      assert.equal((await sql`SELECT gateway_fee_micros FROM task_usage WHERE id = ${other}`)[0]!.gateway_fee_micros, null);
      assert.equal((await sql`SELECT gateway_fee_micros FROM task_usage WHERE id = ${nextDay}`)[0]!.gateway_fee_micros, null);

      await allocateDayFee(sql, '2026-09-20', 41);
      assert.equal((await feeOf(big)) + (await feeOf(small)), 41, 'recomputed, not added');
   });

   test('a day with no BerryAuto usage prices nothing', async () => {
      assert.equal(await allocateDayFee(sql, '2026-01-01', 99), 0);
   });
});
