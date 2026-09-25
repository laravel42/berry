import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifierFeesByDay, KiloAccount, parseDailyUsage } from './account.ts';

/** The account's own spend: daily usage per model, the classifier's fees, and the balance. */

const usageBody = {
   usage: [
      { date: '2026-09-25', model: 'kilo-auto/efficient', total_cost: 41, request_count: 4, total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_hit_tokens: 0 },
      { date: '2026-09-25', model: 'kilo-auto/balanced', total_cost: 30, request_count: 3, total_input_tokens: 0, total_output_tokens: 0, total_cache_write_tokens: 0, total_cache_hit_tokens: 0 },
      { date: '2026-09-25', model: 'qwen/qwen3.8-max', total_cost: 1966, request_count: 1, total_input_tokens: 86, total_output_tokens: 299, total_cache_write_tokens: 0, total_cache_hit_tokens: 0 },
      { date: '2026-09-24', model: 'kilo-auto/efficient', total_cost: 10, request_count: 1, total_input_tokens: null, total_output_tokens: null, total_cache_write_tokens: null, total_cache_hit_tokens: null },
   ],
};

test('daily usage is read in microdollars; the kilo-auto rows are the classifier fees per day', () => {
   const rows = parseDailyUsage(usageBody);
   assert.equal(rows.length, 4);
   assert.equal(rows[2]!.costMicros, 1966);
   assert.deepEqual([...classifierFeesByDay(rows)], [
      ['2026-09-25', { costMicros: 71, requests: 7 }],
      ['2026-09-24', { costMicros: 10, requests: 1 }],
   ]);
});

test('balance and usage are read with the key, and kept as stale when Kilo cannot be reached', async () => {
   let down = false;
   const seen: string[] = [];
   const fetch = (async (input: unknown, init?: RequestInit) => {
      seen.push(`${String(input)} ${new Headers(init?.headers).get('authorization')}`);
      if (down) return new Response('down', { status: 502 });
      return new Response(JSON.stringify(String(input).includes('balance') ? { balance: 18.3, isDepleted: false } : usageBody), { status: 200 });
   }) as typeof globalThis.fetch;
   const account = new KiloAccount({ apiKey: 'k', appUrl: 'https://app/', fetch, clock: () => 7 });
   assert.deepEqual(await account.balance(), { usd: 18.3, isDepleted: false, readAt: 7, stale: false });
   assert.equal((await account.dailyUsage())?.rows.length, 4);
   assert.ok(seen.includes('https://app/api/profile/usage?groupByModel=true&period=week&viewType=personal Bearer k'));
   down = true;
   assert.equal((await account.balance())?.stale, true);
   assert.equal((await account.dailyUsage())?.stale, true);
   assert.equal(await new KiloAccount({ apiKey: 'k', appUrl: 'https://app', fetch }).balance(), null);
});
