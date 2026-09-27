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
 * Every paid tier holds three models (decided 2026-09-26), from the models one
 * of the deployment's own keys serves — its Bedrock key — unless the policy
 * opens them to every provider Kilo bills to its credits (`anyProvider`). A tier is
 * defined by what it is for, not by the tier above's prices: with every
 * provider in, a few cheap models outrate almost everything priced between
 * them and the frontier, and "below the cheapest of the tier above" left Low
 * empty.
 *
 * - BerryMax: the three best rated, at any price.
 * - BerryLow: the best among the cheap, the cheapest third of rated models
 *   by price (`LOW_PRICE_SHARE`). Models that earn their place come first:
 *   not outclassed (no other eligible model rates at least as well for less —
 *   a price ceiling alone once put Sonnet 5 in Low beside a model rated
 *   higher at a ninth of its price), and at least a quarter of the best
 *   rating (`LOW_FLOOR`). Fewer than three of those, and the best rated of
 *   the rest fill it, so no role is left on one model.
 * - BerryMid: the best rated of the rest priced below Max's cheapest.
 *
 *   A model priced at or above Max's cheapest, and not in Max, is in no tier:
 *   a Max model is rated higher for no more money. Only when no model is
 *   rated at all: unrated models by real usage per dollar, so paid runs
 *   still have a model.
 * - BerryFree: free models by real usage, rating only breaking ties.
 * - BerryAuto: Kilo's own routing, `kilo-auto/efficient`, as a comparison.
 *
 * A model sits in one tier only, the highest it reaches.
 */

import { TIERS, type Tier } from '../model-tiers.ts';

export { TIERS, TIER_NAMES, type RoleTier, type Tier } from '../model-tiers.ts';

/**
 * A deployment's own say over the tiers (`BERRY_KILO_EXCLUDE`, `BERRY_KILO_PREFER`),
 * as model ids or id prefixes such as `z-ai/`. Excluded models are in no tier;
 * they still count as evidence when ratings are converted. A preferred model
 * goes first in the tier its rating and price reach, so it takes the largest
 * share of that tier's tasks, but it is not lifted into a tier it did not reach:
 * a tier still means what it says (2026-09-26: GLM out after a runaway reply,
 * Grok first).
 */
export interface TierPolicy {
   exclude?: readonly string[];
   prefer?: readonly string[];
   /**
    * Paid tiers take models Kilo bills to its credits as well as those one of
    * the deployment's own keys serves (`BERRY_KILO_ANY_PROVIDER=true`). Off by
    * default: the paid tiers are the models the Bedrock key serves (decided
    * 2026-09-27, reversing the day before).
    */
   anyProvider?: boolean;
   /**
    * Models a person placed in a paid tier (`BERRY_KILO_MAX|MID|LOW`): each
    * takes one of the tier's three places whatever its rating, and the rule
    * fills the rest. Placed models are in no other tier.
    */
   place?: Partial<Record<'berry_max' | 'berry_mid' | 'berry_low', readonly string[]>>;
}

/** Which of `patterns` an id is, by position, or -1: equal to one, or starting with one that ends in `/` or `-`. */
export function patternIndex(id: string, patterns: readonly string[] | undefined): number {
   const lower = id.toLowerCase();
   return (patterns ?? []).findIndex(
      (pattern) => lower === pattern || ((pattern.endsWith('/') || pattern.endsWith('-')) && lower.startsWith(pattern))
   );
}

/**
 * Whether an id is one of `patterns`. A full id names that model only, so
 * `anthropic/claude-sonnet-5` never takes in a later `claude-sonnet-5.5`; a
 * prefix ending in `/` or `-` (`z-ai/`) names every model under it.
 */
export function matchesAny(id: string, patterns: readonly string[] | undefined): boolean {
   return patternIndex(id, patterns) !== -1;
}

/** The model BerryAuto sends every call to. */
export const AUTO_MODEL = 'kilo-auto/efficient';

/** How many models a tier offers to choose between. */
export const TIER_SIZE = 3;

/** The rating a Low model must reach to earn its place, as a share of the best rating today. */
export const LOW_FLOOR = 0.25;

/** BerryLow's range: this share of the rated models, cheapest first. */
export const LOW_PRICE_SHARE = 1 / 3;

/**
 * How much an estimated rating counts for when models are ranked, against a
 * measured one: converted from another benchmark, it is a prediction, and a
 * measured score of similar value goes first. Shown as it is either way.
 */
export const ESTIMATE_WEIGHT = 0.85;

/** The rating models are ranked by: the measured one, or an estimate discounted by `ESTIMATE_WEIGHT`. */
export function rankingRating(model: GatewayModel): number {
   const bench = model.bench;
   if (!bench) return 0;
   return bench.estimatedFrom && bench.estimatedFrom.length > 0 ? bench.completion * ESTIMATE_WEIGHT : bench.completion;
}

/**
 * Whether another model rates at least as well and costs less: then this one
 * is never the model to pay for, whichever tier its price would put it in.
 */
export function isOutclassed(model: GatewayModel, rivals: GatewayModel[]): boolean {
   return rivals.some(
      (rival) =>
         rival.id !== model.id &&
         rankingRating(rival) >= rankingRating(model) &&
         blendedPrice(rival) < blendedPrice(model)
   );
}

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
    * `estimatedFrom` names the sources a rating was converted from; absent or
    * null when the scale's own leaderboard measured it.
    */
   bench: { completion: number; costPerAttemptUsd: number | null; estimatedFrom?: string[] | null } | null;
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
   /** The sources the rating was converted from; null when it was measured on the scale. */
   estimatedFrom: string[] | null;
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
 * Whether a paid model may serve a paid tier: a real id rather than a
 * `~…-latest` alias that changes model under it, able to call tools, not
 * being retired, and not training on prompts. Served by the deployment's own
 * key or billed to Kilo credits alike (decided 2026-09-26).
 */
export function isPaidEligible(model: GatewayModel): boolean {
   return (
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
      estimatedFrom: model.bench?.estimatedFrom ?? null,
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
export function rankTiers(
   allModels: GatewayModel[],
   usageRows: UsageRow[],
   mode: string | null = 'code',
   policy: TierPolicy = {}
): TierPools {
   const models = allModels.filter((model) => !matchesAny(model.id, policy.exclude));
   const usage = usageByModel(usageRows, mode);
   const used = (model: GatewayModel) => usage.get(model.id) ?? 0;
   const paid = models.filter((model) => isPaidEligible(model) && (policy.anyProvider === true || model.ownKey));
   const rated = paid.filter((model) => model.bench !== null);
   const byRating = (a: GatewayModel, b: GatewayModel) =>
      rankingRating(b) - rankingRating(a) || used(b) - used(a) || a.id.localeCompare(b.id);
   const best = rated.reduce((top, model) => Math.max(top, rankingRating(model)), 0);
   const earns = new Set(
      rated.filter((model) => rankingRating(model) >= best * LOW_FLOOR && !isOutclassed(model, rated)).map((model) => model.id)
   );
   // Placed by a person: set aside first, so no other tier takes them.
   // In the order the person listed them: the first is the tier's first
   // choice, and takes the largest share of its tasks.
   const placedIn = (patterns: readonly string[] | undefined) =>
      paid
         .filter((model) => matchesAny(model.id, patterns))
         .sort((a, b) => patternIndex(a.id, patterns) - patternIndex(b.id, patterns))
         .slice(0, TIER_SIZE);
   const placed = {
      berry_max: placedIn(policy.place?.berry_max),
      berry_mid: placedIn(policy.place?.berry_mid),
      berry_low: placedIn(policy.place?.berry_low),
   };
   const taken = new Set<string>(Object.values(placed).flat().map((model) => model.id));
   // Preferred first, then placed, then the rule's own picks; the rule fills
   // what the placed models leave.
   const compose = (tier: keyof typeof placed, chosen: GatewayModel[]) => {
      const all = [...placed[tier], ...chosen];
      const preferred = all.filter((model) => matchesAny(model.id, policy.prefer));
      return [...preferred, ...all.filter((model) => !preferred.includes(model))];
   };
   const pick = (
      tier: keyof typeof placed,
      inRange: (model: GatewayModel) => boolean,
      order: (a: GatewayModel, b: GatewayModel) => number
   ) => {
      const chosen = rated
         .filter((model) => !taken.has(model.id) && inRange(model))
         .sort(order)
         .slice(0, TIER_SIZE - placed[tier].length);
      for (const model of chosen) taken.add(model.id);
      return chosen;
   };

   const max = pick('berry_max', () => true, byRating);
   // The cheap end: the cheapest third of rated models. Models that earn
   // their place first, then the best rated, so Low is never short.
   const byPrice = rated.map(blendedPrice).sort((a, b) => a - b);
   const cheap = byPrice[Math.max(0, Math.ceil(byPrice.length * LOW_PRICE_SHARE) - 1)] ?? 0;
   const ratedLow = pick(
      'berry_low',
      (model) => blendedPrice(model) <= cheap,
      (a, b) => Number(earns.has(b.id)) - Number(earns.has(a.id)) || byRating(a, b)
   );
   const maxCheapest = max.length > 0 ? Math.min(...max.map(blendedPrice)) : Number.POSITIVE_INFINITY;
   const mid = pick('berry_mid', (model) => blendedPrice(model) < maxCheapest, byRating);

   // Only when no model is rated at all does Low rank the unrated by real
   // usage per dollar: every paid tier would otherwise be empty, and every
   // paid run would fail for want of a model.
   const perDollar = (model: GatewayModel) => used(model) / Math.max(blendedPrice(model), 1e-9);
   const low = (
      rated.length > 0
         ? ratedLow
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
      berry_max: compose('berry_max', max).map((model) => ranked(model, usage)),
      berry_mid: compose('berry_mid', mid).map((model) => ranked(model, usage)),
      berry_low: compose('berry_low', low).slice(0, TIER_SIZE).map((model) => ranked(model, usage)),
      berry_free: free.map((model) => ranked(model, usage)),
      berry_auto: [
         auto
            ? ranked(auto, usage)
            : {
                 id: AUTO_MODEL,
                 name: 'Auto Efficient',
                 completion: null,
                 estimatedFrom: null,
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
