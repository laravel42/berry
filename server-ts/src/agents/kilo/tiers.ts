/**
 * The model tiers, ranked from the Kilo leaderboard (ADR-0017).
 *
 * A role picks a tier, not a model; Berry fills each tier from what the
 * leaderboard says today. Nothing here names a model: the pools move when
 * Kilo's benchmarks, real usage or prices do.
 *
 * Only a minority of the models the account's own keys serve carry a
 * KiloBench score, and those are frontier-priced, so the ranking uses both
 * halves of the leaderboard (decided 2026-09-25):
 *
 * - BerryMax: highest KiloBench completion.
 * - BerryMid: completion per dollar (per benchmark attempt), among scored
 *   models at or above the median completion.
 * - BerryLow: real code-mode usage per dollar (blended token price), among
 *   unscored models cheaper than BerryMid's cheapest.
 * - BerryFree: free models, benchmark first, then real usage.
 * - BerryAuto: Kilo's own routing, `kilo-auto/efficient`, as a comparison.
 *
 * A model sits in one tier only, the highest it reaches.
 */

export const TIERS = ['berry_max', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_NAMES: Record<Tier, string> = {
   berry_max: 'BerryMax',
   berry_mid: 'BerryMid',
   berry_low: 'BerryLow',
   berry_free: 'BerryFree',
   berry_auto: 'BerryAuto',
};

/** The model BerryAuto sends every call to. */
export const AUTO_MODEL = 'kilo-auto/efficient';

/** How many models a tier offers to choose between. */
export const TIER_SIZE = 3;

/** One model as the gateway's catalogue describes it. */
export interface GatewayModel {
   id: string;
   name: string;
   contextLength: number;
   supportsTools: boolean;
   supportsVision: boolean;
   isFree: boolean;
   /** The provider may train on prompts. */
   mayTrain: boolean;
   /** Set when the model is being retired. */
   expiresAt: string | null;
   /** One of the account's own provider keys (BYOK) can serve it. */
   ownKey: boolean;
   /** USD per million tokens. */
   price: { input: number; output: number; cacheRead: number | null; cacheWrite: number | null };
   /** KiloBench: completion rate (0–1) and the average cost of one benchmark attempt. */
   bench: { completion: number; costPerAttemptUsd: number } | null;
}

/** One day of real Kilo usage for a model, as the public leaderboard reports it. */
export interface UsageRow {
   usageDate: string;
   model: string;
   mode: string | null;
   tokens: number;
}

export interface RankedModel {
   id: string;
   name: string;
   /** What placed it: the numbers the rule read. */
   completion: number | null;
   costPerAttemptUsd: number | null;
   usageTokens: number;
   /** Null when the gateway lists no price (a router such as `kilo-auto/*` reports -1). */
   blendedPricePerM: number | null;
}

export type TierPools = Record<Tier, RankedModel[]>;

/**
 * A blended USD-per-million price, three input tokens to one output: an
 * agent loop re-sends its context far more than it writes. Used only to
 * order and cap; estimates price a role's real token mix.
 */
export function blendedPrice(model: GatewayModel): number {
   return (model.price.input * 3 + model.price.output) / 4;
}

/**
 * Whether a paid model may serve a paid tier: served by the account's own key,
 * a real id rather than a `~…-latest` alias that changes model under it,
 * able to call tools, not being retired, and not training on prompts.
 */
export function isPaidEligible(model: GatewayModel): boolean {
   return (
      model.ownKey &&
      !model.isFree &&
      !model.id.startsWith('~') &&
      model.supportsTools &&
      model.expiresAt === null &&
      !model.mayTrain
   );
}

/** Whether a free model may serve BerryFree. Free models may train on prompts; that is the tier's known cost. */
export function isFreeEligible(model: GatewayModel): boolean {
   return model.isFree && model.id.endsWith(':free') && model.supportsTools && model.expiresAt === null;
}

/** Tokens per model over the usage window, in one mode (`null` counts every mode). */
export function usageByModel(rows: UsageRow[], mode: string | null): Map<string, number> {
   const totals = new Map<string, number>();
   for (const row of rows) {
      if (mode !== null && row.mode !== mode) continue;
      totals.set(row.model, (totals.get(row.model) ?? 0) + row.tokens);
   }
   return totals;
}

function median(values: number[]): number {
   const sorted = [...values].sort((a, b) => a - b);
   const middle = Math.floor(sorted.length / 2);
   return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function ranked(model: GatewayModel, usage: Map<string, number>): RankedModel {
   return {
      id: model.id,
      name: model.name,
      completion: model.bench?.completion ?? null,
      costPerAttemptUsd: model.bench?.costPerAttemptUsd ?? null,
      usageTokens: usage.get(model.id) ?? 0,
      blendedPricePerM: model.price.input < 0 || model.price.output < 0 ? null : blendedPrice(model),
   };
}

/**
 * The tiers for today's leaderboard. `mode` is the usage mode that ranks
 * unscored models and breaks ties — `code` for a coding role.
 */
export function rankTiers(models: GatewayModel[], usageRows: UsageRow[], mode: string | null = 'code'): TierPools {
   const usage = usageByModel(usageRows, mode);
   const used = (model: GatewayModel) => usage.get(model.id) ?? 0;
   const paid = models.filter(isPaidEligible);
   const scored = paid.filter((model) => model.bench !== null);
   const completion = (model: GatewayModel) => model.bench!.completion;
   const perDollar = (model: GatewayModel) => model.bench!.completion / Math.max(model.bench!.costPerAttemptUsd, 1e-9);

   const max = [...scored]
      .sort((a, b) => completion(b) - completion(a) || used(b) - used(a) || a.id.localeCompare(b.id))
      .slice(0, TIER_SIZE);
   const taken = new Set(max.map((model) => model.id));

   const bar = scored.length > 0 ? median(scored.map(completion)) : 0;
   const mid = scored
      .filter((model) => !taken.has(model.id) && completion(model) >= bar)
      .sort((a, b) => perDollar(b) - perDollar(a) || used(b) - used(a) || a.id.localeCompare(b.id))
      .slice(0, TIER_SIZE);
   for (const model of mid) taken.add(model.id);

   // Low is for work that should cost little, so it stops below Mid's
   // cheapest (or Max's, when Mid is empty): a popular model priced like a
   // frontier one does not belong in it.
   const above = mid.length > 0 ? mid : max;
   const ceiling = above.length > 0 ? Math.min(...above.map(blendedPrice)) : Number.POSITIVE_INFINITY;
   const low = paid
      .filter((model) => model.bench === null && !taken.has(model.id) && used(model) > 0 && blendedPrice(model) < ceiling)
      .sort(
         (a, b) =>
            used(b) / Math.max(blendedPrice(b), 1e-9) - used(a) / Math.max(blendedPrice(a), 1e-9) ||
            a.id.localeCompare(b.id)
      )
      .slice(0, TIER_SIZE);

   const free = models
      .filter(isFreeEligible)
      .sort(
         (a, b) =>
            (b.bench?.completion ?? -1) - (a.bench?.completion ?? -1) || used(b) - used(a) || a.id.localeCompare(b.id)
      )
      .slice(0, TIER_SIZE);

   const auto = models.find((model) => model.id === AUTO_MODEL);

   return {
      berry_max: max.map((model) => ranked(model, usage)),
      berry_mid: mid.map((model) => ranked(model, usage)),
      berry_low: low.map((model) => ranked(model, usage)),
      berry_free: free.map((model) => ranked(model, usage)),
      berry_auto: [
         auto
            ? ranked(auto, usage)
            : { id: AUTO_MODEL, name: 'Auto Efficient', completion: null, costPerAttemptUsd: null, usageTokens: 0, blendedPricePerM: null },
      ],
   };
}

/** The tier a model belongs to today, if any. */
export function tierOf(pools: TierPools, modelId: string): Tier | null {
   for (const tier of TIERS) {
      if (pools[tier].some((model) => model.id === modelId)) return tier;
   }
   return null;
}

/**
 * Where a role looks when its own tier is empty today: the nearest tier in
 * price first, so an empty BerryLow falls to Mid rather than to Max.
 */
export const TIER_FALLBACK: Record<Tier, Tier[]> = {
   berry_max: ['berry_max', 'berry_mid', 'berry_low'],
   berry_mid: ['berry_mid', 'berry_low', 'berry_max'],
   berry_low: ['berry_low', 'berry_mid', 'berry_max'],
   berry_free: ['berry_free', 'berry_low'],
   berry_auto: ['berry_auto'],
};

/** Today's first choice for a tier, falling back as `TIER_FALLBACK` says; null only when every fallback is empty. */
export function modelForTier(pools: TierPools, tier: Tier): string | null {
   for (const candidate of TIER_FALLBACK[tier]) {
      const first = pools[candidate][0];
      if (first) return first.id;
   }
   return null;
}

/**
 * Whether an id names a gateway model (`vendor/model`) rather than a Bedrock
 * inference profile (`us.anthropic.claude-…`), which the gateway refuses.
 */
export function isGatewayModelId(id: string): boolean {
   return id.includes('/');
}
