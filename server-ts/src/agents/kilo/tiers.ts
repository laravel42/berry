/**
 * The model tiers, ranked from the leaderboards (ADR-0017).
 *
 * A role picks a tier, not a model; Berry fills each tier from what the
 * leaderboards say today. Nothing here names a model: the pools move when
 * ratings, real usage or prices do.
 *
 * A model's rating is its Terminal-Bench score on one scale (`ratings.ts`).
 * The paid tiers hold only rated models, so every paid model an agent runs
 * on has a rating to show (decided 2026-09-25):
 *
 * - BerryMax: the best rated.
 * - BerryMid: the best rated of the rest priced below Max's cheapest.
 * - BerryLow: the best rated of the rest priced below Mid's cheapest.
 *
 *   So each tier costs less than the one above, and is the best that its
 *   price buys. A model priced at or above Max's cheapest, and not in Max,
 *   is in no tier: that Max model is rated higher for no more money. Rating
 *   per dollar is not the rule: with cheap, weak models rated, it would put
 *   the weakest in front. Only when no model is rated at all: unrated models
 *   by real usage per dollar, so paid runs still have a model.
 * - BerryFree: free models by real usage, rating only breaking ties.
 * - BerryAuto: Kilo's own routing, `kilo-auto/efficient`, as a comparison.
 *
 * A model sits in one tier only, the highest it reaches.
 */

import { TIERS, type Tier } from '../model-tiers.ts';

export { TIERS, TIER_NAMES, type RoleTier, type Tier } from '../model-tiers.ts';

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
   /**
    * The rating (0–1, `ratings.ts`), and Kilo's average cost of one benchmark
    * attempt where Kilo lists one. Null for a model no leaderboard rates.
    */
   bench: { completion: number; costPerAttemptUsd: number | null } | null;
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
   /** USD per million input and output tokens; null as for the blended price. */
   inputPricePerM: number | null;
   outputPricePerM: number | null;
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

function ranked(model: GatewayModel, usage: Map<string, number>): RankedModel {
   const unpriced = model.price.input < 0 || model.price.output < 0;
   return {
      id: model.id,
      name: model.name,
      completion: model.bench?.completion ?? null,
      costPerAttemptUsd: model.bench?.costPerAttemptUsd ?? null,
      usageTokens: usage.get(model.id) ?? 0,
      blendedPricePerM: unpriced ? null : blendedPrice(model),
      inputPricePerM: unpriced ? null : model.price.input,
      outputPricePerM: unpriced ? null : model.price.output,
   };
}

/**
 * The tiers for today's leaderboard. `mode` is the usage mode that ranks
 * free models and breaks ties — `code` for a coding role.
 */
export function rankTiers(models: GatewayModel[], usageRows: UsageRow[], mode: string | null = 'code'): TierPools {
   const usage = usageByModel(usageRows, mode);
   const used = (model: GatewayModel) => usage.get(model.id) ?? 0;
   const paid = models.filter(isPaidEligible);
   const rated = paid.filter((model) => model.bench !== null);
   const byRating = (a: GatewayModel, b: GatewayModel) =>
      b.bench!.completion - a.bench!.completion || used(b) - used(a) || a.id.localeCompare(b.id);

   const max = [...rated].sort(byRating).slice(0, TIER_SIZE);
   const taken = new Set(max.map((model) => model.id));

   // Blended token price: each tier stops below the cheapest of the one above.
   const floorOf = (tier: GatewayModel[]) =>
      tier.length > 0 ? Math.min(...tier.map(blendedPrice)) : Number.POSITIVE_INFINITY;
   const bestBelow = (price: number) =>
      rated.filter((model) => !taken.has(model.id) && blendedPrice(model) < price).sort(byRating).slice(0, TIER_SIZE);
   const mid = bestBelow(floorOf(max));
   for (const model of mid) taken.add(model.id);

   // Only when no model is rated at all does Low rank the unrated by real
   // usage per dollar: every paid tier would otherwise be empty, and every
   // paid run would fail for want of a model.
   const perDollar = (model: GatewayModel) => used(model) / Math.max(blendedPrice(model), 1e-9);
   const low = (
      rated.length > 0
         ? bestBelow(mid.length > 0 ? floorOf(mid) : floorOf(max))
         : paid.filter((model) => used(model) > 0).sort((a, b) => perDollar(b) - perDollar(a) || a.id.localeCompare(b.id))
   ).slice(0, TIER_SIZE);

   // Real usage first: few free models are rated, and a weak rating would
   // otherwise outrank the free models people actually run.
   const free = models
      .filter(isFreeEligible)
      .sort(
         (a, b) =>
            used(b) - used(a) || (b.bench?.completion ?? -1) - (a.bench?.completion ?? -1) || a.id.localeCompare(b.id)
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
            : {
                 id: AUTO_MODEL,
                 name: 'Auto Efficient',
                 completion: null,
                 costPerAttemptUsd: null,
                 usageTokens: 0,
                 blendedPricePerM: null,
                 inputPricePerM: null,
                 outputPricePerM: null,
              },
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

/** How much more often each rank of a tier is chosen than the next: first, second, third. */
export const RANK_WEIGHTS = [3, 2, 1] as const;

/**
 * Where a tier's default fallback comes from (decided 2026-09-25): the top of
 * the next tier down, so a failure costs less, not more. BerryLow has nothing
 * below it, so it falls back within itself, then up; BerryFree and BerryAuto
 * fall back to a paid model on BerryLow.
 */
export const FALLBACK_SOURCE: Record<Tier, Tier[]> = {
   berry_max: ['berry_mid', 'berry_low'],
   berry_mid: ['berry_low', 'berry_mid'],
   berry_low: ['berry_low', 'berry_mid'],
   berry_free: ['berry_low', 'berry_mid'],
   berry_auto: ['berry_low', 'berry_mid'],
};

/** A stable number in [0, 1) for a key: the same session lands on the same rank. */
export function unitHash(key: string): number {
   let hash = 2166136261;
   for (let index = 0; index < key.length; index += 1) {
      hash ^= key.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
   }
   return (hash >>> 0) / 4294967296;
}

export interface TierChoice {
   /** The tier the model came from: the requested one, or a fallback tier when it was empty. */
   tier: Tier;
   model: string;
   /** The default fallback, or null when the leaderboard offers none other than `model`. */
   fallback: string | null;
}

/**
 * Today's model for a tier, and its default fallback.
 *
 * The model is one of the tier's top three, weighted by rank, and picked by
 * `seed` rather than at random: a session (an agent on an issue) keeps its
 * model — and its prompt cache — for as long as the leaderboard does, while
 * different sessions spread across the tier. An empty tier falls to the
 * nearest one in price (`TIER_FALLBACK`).
 */
export function chooseForTier(pools: TierPools, tier: Tier, seed: string): TierChoice | null {
   const source = TIER_FALLBACK[tier].find((candidate) => pools[candidate].length > 0);
   if (!source) return null;
   const ranked = pools[source].slice(0, RANK_WEIGHTS.length);
   const weights = ranked.map((_, index) => RANK_WEIGHTS[index]!);
   const total = weights.reduce((sum, weight) => sum + weight, 0);
   let point = unitHash(seed) * total;
   let pick = ranked[0]!;
   for (let index = 0; index < ranked.length; index += 1) {
      point -= weights[index]!;
      if (point < 0) {
         pick = ranked[index]!;
         break;
      }
   }
   const fallback =
      FALLBACK_SOURCE[tier]
         .flatMap((candidate) => pools[candidate])
         .find((model) => model.id !== pick.id)?.id ?? null;
   return { tier: source, model: pick.id, fallback };
}
