import type { Sql } from '../db/pool.ts';
import { classifierFeesByDay, type KiloAccount } from '../agents/kilo/account.ts';
import { AUTO_MODEL } from '../agents/kilo/tiers.ts';
import type { Logger } from '../observability/log.ts';

/**
 * Reconciling what the Kilo account says it spent with what Berry recorded
 * (ADR-0017), hourly.
 *
 * - BerryAuto's classifier fees. Kilo bills the auto-routing classifier per
 *   request and reports it only as a daily total per auto model, never in a
 *   call's own cost. Each day's `kilo-auto/efficient` total — the model
 *   BerryAuto uses; another client's `kilo-auto/balanced` is not Berry's — is
 *   spread over that day's BerryAuto usage records in proportion to their
 *   tokens, into `task_usage.gateway_fee_micros`. The day is recomputed
 *   whole each time, so a rerun never counts twice and today's figure
 *   settles when the day closes. The hourly rollup the charts read does not
 *   carry the fee: at about a hundred-thousandth of a dollar per request it
 *   would not move a chart, and the per-record figure is exact.
 * - The balance. BerryAuto is the only thing that spends Kilo credits; a
 *   balance below the floor is logged before its calls start failing.
 *
 * Neither ever blocks a run: a read that fails is logged and retried on the
 * next tick.
 */

/** The daily fee total for BerryAuto's model, by UTC date. */
export function berryAutoFees(rows: Parameters<typeof classifierFeesByDay>[0]): Map<string, number> {
   const fees = new Map<string, number>();
   for (const [date, fee] of classifierFeesByDay(rows.filter((row) => row.model === AUTO_MODEL))) {
      fees.set(date, fee.costMicros);
   }
   return fees;
}

/**
 * Spreads one day's fee over that day's BerryAuto usage, by tokens, in whole
 * microdollars: the shares always add up to the fee exactly, the remainder
 * going to the largest records first. Returns how many records it priced.
 */
export async function allocateDayFee(sql: Sql, date: string, feeMicros: number): Promise<number> {
   const rows = await sql`
      SELECT id, (input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)::float8 AS weight
        FROM task_usage
       WHERE tier = 'berry_auto'
         AND occurred_at >= ${date}::date AND occurred_at < (${date}::date + 1)
       ORDER BY weight DESC, id`;
   if (rows.length === 0) return 0;
   const weights = rows.map((row) => Math.max(Number(row.weight), 0));
   const total = weights.reduce((sum, weight) => sum + weight, 0);
   // With no tokens anywhere, an even split.
   const exact = weights.map((weight) => (total > 0 ? (feeMicros * weight) / total : feeMicros / rows.length));
   const shares = exact.map(Math.floor);
   let remainder = feeMicros - shares.reduce((sum, share) => sum + share, 0);
   for (let index = 0; remainder > 0; index = (index + 1) % shares.length, remainder -= 1) shares[index]! += 1;
   await sql.begin(async (transaction) => {
      const tx = transaction as unknown as Sql;
      for (let index = 0; index < rows.length; index += 1) {
         await tx`UPDATE task_usage SET gateway_fee_micros = ${shares[index]!} WHERE id = ${rows[index]!.id as string}`;
      }
   });
   return rows.length;
}

export interface ReconcileOptions {
   sql: Sql;
   account: KiloAccount;
   logger: Logger;
   /** Below this, the balance is logged as a warning. */
   minBalanceUsd: number;
}

export async function reconcileGateway(options: ReconcileOptions): Promise<void> {
   const { sql, account, logger } = options;
   const usage = await account.dailyUsage();
   if (!usage || usage.stale) {
      logger.warn('gateway usage could not be read; classifier fees not reconciled this hour');
   } else {
      for (const [date, fee] of berryAutoFees(usage.rows)) {
         const priced = await allocateDayFee(sql, date, fee);
         logger.info('gateway classifier fees reconciled', { date, feeMicros: fee, records: priced });
      }
   }
   const balance = await account.balance();
   if (!balance || balance.stale) {
      logger.warn('gateway balance could not be read');
   } else if (balance.usd < options.minBalanceUsd) {
      logger.warn('gateway credit balance is low; BerryAuto calls fail when it runs out', {
         balanceUsd: balance.usd,
         floorUsd: options.minBalanceUsd,
      });
   }
}
