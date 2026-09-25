import { z } from 'zod';

/**
 * The Kilo account's own view of what it spent (ADR-0017).
 *
 * Berry records each call's cost as the gateway reports it. Two things that
 * report does not carry are read here instead, from the routes the Kilo
 * extension uses (they accept the gateway API key, but are not documented as
 * public API):
 *
 * - `GET {app}/api/profile/usage?groupByModel=true` — daily cost, requests
 *   and tokens per model. Its `kilo-auto/*` rows are exactly the auto-routing
 *   classifier's fees, which BerryAuto calls incur on Kilo credits and which
 *   no per-call report includes: routed calls are grouped under the model
 *   they resolved to.
 * - `GET {app}/api/profile/balance` — the credit balance, read hourly, so a
 *   fall that the reports do not explain is noticed, and BerryAuto's credit
 *   is watched before it runs out.
 *
 * The account may be shared with other Kilo clients; usage Berry did not
 * record is someone else's, not a mismatch. Either read failing keeps the
 * last one and marks it stale — reconciliation never blocks a run.
 */

export interface KiloBalance {
   usd: number;
   isDepleted: boolean;
   readAt: number;
   stale: boolean;
}

export interface KiloDailyUsage {
   date: string;
   model: string;
   costMicros: number;
   requests: number;
   inputTokens: number;
   outputTokens: number;
   cacheWriteTokens: number;
   cacheHitTokens: number;
}

export interface KiloUsageReading {
   rows: KiloDailyUsage[];
   readAt: number;
   stale: boolean;
}

export interface KiloAccountOptions {
   apiKey: string;
   appUrl: string;
   /** Sent as `X-KiloCode-OrganizationId` and used as the usage view when set. */
   organizationId?: string | undefined;
   fetch?: typeof globalThis.fetch;
   clock?: () => number;
}

const TIMEOUT_MS = 15_000;

const balanceSchema = z.object({ balance: z.number(), isDepleted: z.boolean() });
const usageRowSchema = z.object({
   date: z.string(),
   model: z.string().nullable(),
   total_cost: z.number(),
   request_count: z.number(),
   total_input_tokens: z.number().nullable(),
   total_output_tokens: z.number().nullable(),
   total_cache_write_tokens: z.number().nullable(),
   total_cache_hit_tokens: z.number().nullable(),
});

export function parseDailyUsage(body: unknown): KiloDailyUsage[] {
   const rows = (body as { usage?: unknown })?.usage;
   if (!Array.isArray(rows)) throw new Error('the Kilo usage report had no usage list');
   return rows.flatMap((raw) => {
      const parsed = usageRowSchema.safeParse(raw);
      if (!parsed.success) return [];
      const row = parsed.data;
      return [
         {
            date: row.date,
            model: row.model ?? '',
            // The route sums the usage table's cost column, which is microdollars.
            costMicros: Math.round(row.total_cost),
            requests: Math.round(row.request_count),
            inputTokens: Math.round(row.total_input_tokens ?? 0),
            outputTokens: Math.round(row.total_output_tokens ?? 0),
            cacheWriteTokens: Math.round(row.total_cache_write_tokens ?? 0),
            cacheHitTokens: Math.round(row.total_cache_hit_tokens ?? 0),
         },
      ];
   });
}

/** The auto-routing classifier's fees per day, in microdollars: the `kilo-auto/*` rows. */
export function classifierFeesByDay(rows: KiloDailyUsage[]): Map<string, { costMicros: number; requests: number }> {
   const fees = new Map<string, { costMicros: number; requests: number }>();
   for (const row of rows) {
      if (!row.model.startsWith('kilo-auto/')) continue;
      const day = fees.get(row.date) ?? { costMicros: 0, requests: 0 };
      day.costMicros += row.costMicros;
      day.requests += row.requests;
      fees.set(row.date, day);
   }
   return fees;
}

export class KiloAccount {
   readonly #apiKey: string;
   readonly #appUrl: string;
   readonly #organizationId: string | undefined;
   readonly #fetch: typeof globalThis.fetch;
   readonly #clock: () => number;
   #balance: KiloBalance | null = null;
   #usage: KiloUsageReading | null = null;

   constructor(options: KiloAccountOptions) {
      this.#apiKey = options.apiKey;
      this.#appUrl = options.appUrl.replace(/\/+$/, '');
      this.#organizationId = options.organizationId;
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#clock = options.clock ?? Date.now;
   }

   #headers(): Record<string, string> {
      return {
         authorization: `Bearer ${this.#apiKey}`,
         ...(this.#organizationId ? { 'X-KiloCode-OrganizationId': this.#organizationId } : {}),
      };
   }

   /** The credit balance now, or the last one read (stale) when Kilo cannot be reached. Null only before any read has worked. */
   async balance(): Promise<KiloBalance | null> {
      try {
         const response = await this.#fetch(`${this.#appUrl}/api/profile/balance`, {
            headers: this.#headers(),
            signal: AbortSignal.timeout(TIMEOUT_MS),
         });
         if (!response.ok) throw new Error(`balance answered ${response.status}`);
         const body = balanceSchema.parse(await response.json());
         this.#balance = { usd: body.balance, isDepleted: body.isDepleted, readAt: this.#clock(), stale: false };
      } catch {
         if (this.#balance) this.#balance = { ...this.#balance, stale: true };
      }
      return this.#balance;
   }

   /** Daily usage per model for the last week, or the last reading (stale). Null only before any read has worked. */
   async dailyUsage(): Promise<KiloUsageReading | null> {
      const view = this.#organizationId ?? 'personal';
      const url = `${this.#appUrl}/api/profile/usage?groupByModel=true&period=week&viewType=${encodeURIComponent(view)}`;
      try {
         const response = await this.#fetch(url, { headers: this.#headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
         if (!response.ok) throw new Error(`usage answered ${response.status}`);
         this.#usage = { rows: parseDailyUsage(await response.json()), readAt: this.#clock(), stale: false };
      } catch {
         if (this.#usage) this.#usage = { ...this.#usage, stale: true };
      }
      return this.#usage;
   }
}
