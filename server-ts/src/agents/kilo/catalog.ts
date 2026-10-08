import { z } from 'zod';
import { CatalogUnavailable, type CatalogModel } from '../catalog.ts';
import { combineRatings, modelKey, readLeaderboard, TBENCH_LEADERBOARD_URL, TBENCH_LEADERBOARDS, type RatingSource, type Scores } from './ratings.ts';
import { blendedPrice, chooseForTier, type TierPolicy, isPaidEligible, rankTiers, tierOf, TIER_NAMES, TIERS, type GatewayModel, type Tier, type TierChoice, type TierPlacement, type TierPools, type UsageRow } from './tiers.ts';

/**
 * The Kilo gateway's models and leaderboard, read live (ADR-0017).
 *
 * Two reads, neither of which calls a model:
 *
 * - `GET {gateway}/models` with the API key. Authenticated, it marks each
 *   model `hasUserByokAvailable` — whether one of the account's own keys can
 *   serve it — which is exactly what a paid tier may use. It also carries
 *   prices (cache included), tool support, and the KiloBench scores.
 * - `GET {site}/api/public/leaderboard-model-usage`, public: a week of real
 *   Kilo usage per model and mode, which ranks the free models and breaks
 *   ties.
 * - The Terminal-Bench leaderboards (tbench.ai), public: the ratings, with
 *   Kilo's own benchmark scores filling gaps, on one scale (`ratings.ts`).
 *   A leaderboard that cannot be read keeps its last good copy.
 *
 * Refreshed hourly. A failed refresh keeps the last good snapshot and marks
 * it stale; with nothing to fall back on, the catalogue is unavailable rather
 * than empty, because "no models exist" would be a lie.
 */

export const DEFAULT_KILO_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_LEADERBOARD_USAGE_URL = 'https://kilo.ai/api/public/leaderboard-model-usage';
const TIMEOUT_MS = 15_000;

export interface KiloSnapshot {
   models: GatewayModel[];
   usage: UsageRow[];
   pools: TierPools;
   fetchedAt: number;
   /** The model list could not be refreshed; this is the last good one. */
   stale: boolean;
   /** The usage leaderboard could not be refreshed; the ranking uses the last good one (or none). */
   usageStale: boolean;
   /** The leaderboard whose scale ratings are given on; null when nothing is rated. */
   ratingScale: string | null;
   /** A Terminal-Bench leaderboard could not be refreshed; its last good copy (or none) is used. */
   ratingsStale: boolean;
   /** The Terminal-Bench leaderboards as last read, newest first. */
   leaderboards: RatingSource[];
}

export interface KiloCatalogOptions {
   apiKey: string;
   baseUrl: string;
   usageUrl?: string;
   /** Terminal-Bench's leaderboard read; null reads none, and Kilo's scores alone rate the models. */
   ratingsUrl?: string | null;
   fetch?: typeof globalThis.fetch;
   ttlMs?: number;
   clock?: () => number;
   /** Which models no tier offers, and which go first in theirs (`TierPolicy`). */
   policy?: TierPolicy;
}

const priceString = z.union([z.string(), z.number()]).transform((value) => Number(value));

const modelSchema = z.object({
   id: z.string().min(1),
   name: z.string().optional(),
   context_length: z.number().nullish(),
   architecture: z.object({ input_modalities: z.array(z.string()).nullish() }).nullish(),
   pricing: z.object({
      prompt: priceString,
      completion: priceString,
      input_cache_read: priceString.nullish(),
      input_cache_write: priceString.nullish(),
   }),
   supported_parameters: z.array(z.string()).nullish(),
   isFree: z.boolean().nullish(),
   mayTrainOnYourPrompts: z.boolean().nullish(),
   expiration_date: z.string().nullish(),
   hasUserByokAvailable: z.boolean().nullish(),
   terminalBench: z.object({ overallScore: z.number(), avgAttemptCostUsd: z.number() }).nullish(),
});

const usageSchema = z.object({
   usageDate: z.string(),
   model: z.string().min(1),
   mode: z.string().nullable(),
   tokens: z.number(),
});

const PER_MILLION = 1_000_000;

/**
 * A model's name as Berry shows it: Kilo's name without the marker it adds to a
 * recently listed model ("Claude Opus 5.5 (new)"). The marker goes stale while
 * the name stays, and every surface showed it.
 */
export function modelDisplayName(name: string): string {
   return name.replace(/\s*\(new\)\s*$/i, '').trim();
}

/** One catalogue entry, or null when it is malformed: one bad model must not empty the list. */
export function parseGatewayModel(raw: unknown): GatewayModel | null {
   const parsed = modelSchema.safeParse(raw);
   if (!parsed.success) return null;
   const model = parsed.data;
   // Rounded to a millionth of a dollar: the list gives per-token strings,
   // and multiplying them up leaves float dust ($0.09999… for $0.10).
   const perM = (value: number | null | undefined) =>
      value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * PER_MILLION * 1e6) / 1e6;
   return {
      id: model.id,
      name: modelDisplayName(model.name ?? model.id),
      contextLength: model.context_length ?? 0,
      supportsTools: (model.supported_parameters ?? []).includes('tools'),
      supportsVision: (model.architecture?.input_modalities ?? []).includes('image'),
      isFree: model.isFree === true || model.id.endsWith(':free'),
      mayTrain: model.mayTrainOnYourPrompts === true,
      expiresAt: model.expiration_date ?? null,
      ownKey: model.hasUserByokAvailable === true,
      price: {
         input: perM(model.pricing.prompt) ?? 0,
         output: perM(model.pricing.completion) ?? 0,
         cacheRead: perM(model.pricing.input_cache_read),
         cacheWrite: perM(model.pricing.input_cache_write),
      },
      bench: model.terminalBench
         ? { completion: model.terminalBench.overallScore, costPerAttemptUsd: model.terminalBench.avgAttemptCostUsd }
         : null,
   };
}

export function parseGatewayModels(body: unknown): GatewayModel[] {
   const data = (body as { data?: unknown })?.data;
   if (!Array.isArray(data)) throw new CatalogUnavailable('the Kilo model list had no data array');
   return data.map(parseGatewayModel).filter((model): model is GatewayModel => model !== null);
}

export function parseUsageRows(body: unknown): UsageRow[] {
   if (!Array.isArray(body)) throw new Error('the Kilo usage leaderboard was not a list');
   return body.flatMap((row) => {
      const parsed = usageSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
   });
}

/**
 * The models with their ratings: the Terminal-Bench leaderboards, newest
 * first, then Kilo's own scores, combined on one scale (`combineRatings`).
 * Kilo's cost per benchmark attempt is kept where it has one.
 */
/**
 * A model id split into its family and version: `anthropic/claude-opus-5.5`
 * is family `anthropic/claude-opus` at version [5, 5]. The version is the
 * first dash-separated part that is a number (`v4.1` too); an id without one
 * has no version and no predecessor.
 */
export function modelVersion(id: string): { family: string; version: number[] } | null {
   if (id.startsWith('~') || id.endsWith(':free') || !id.includes('/')) return null;
   const slash = id.indexOf('/');
   const parts = id.slice(slash + 1).split('-');
   const index = parts.findIndex((part) => /^v?\d+(\.\d+)*$/i.test(part));
   if (index === -1) return null;
   const version = parts[index]!.replace(/^v/i, '').split('.').map(Number);
   const family = `${id.slice(0, slash)}/${parts.filter((_, at) => at !== index).join('-')}`;
   return { family, version };
}

function compareVersions(a: number[], b: number[]): number {
   for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] ?? 0) - (b[index] ?? 0);
      if (difference !== 0) return difference;
   }
   return 0;
}

/**
 * A new version no leaderboard rates yet borrows the rating of the newest
 * rated earlier version of the same family (decided 2026-09-26): Opus 5.5
 * arrives unrated and would otherwise sit in no tier until a leaderboard
 * gets to it. Only when it costs no more than that predecessor, since a
 * dearer version is not assumed to be worth it. The rating is marked as
 * estimated from the predecessor, and ranked like any estimate
 * (`ESTIMATE_WEIGHT`); a rating is only ever borrowed from one of the
 * model's own, never from another borrowed one.
 */
export function borrowPredecessorRatings(models: GatewayModel[]): GatewayModel[] {
   const rated = models.filter((model) => model.bench !== null);
   return models.map((model) => {
      if (model.bench !== null) return model;
      const own = modelVersion(model.id);
      if (!own) return model;
      const predecessor = rated
         .map((candidate) => ({ candidate, version: modelVersion(candidate.id) }))
         .filter(
            ({ candidate, version }) =>
               version !== null &&
               version.family === own.family &&
               compareVersions(version.version, own.version) < 0 &&
               blendedPrice(model) <= blendedPrice(candidate)
         )
         .sort((a, b) => compareVersions(b.version!.version, a.version!.version))[0]?.candidate;
      if (!predecessor) return model;
      return {
         ...model,
         bench: {
            completion: predecessor.bench!.completion,
            costPerAttemptUsd: null,
            // Its display name without the vendor: "Claude Opus 5".
            estimatedFrom: [predecessor.name.replace(/^[^:]+:\s*/, '')],
         },
      };
   });
}

export function rateModels(models: GatewayModel[], leaderboards: RatingSource[]): { models: GatewayModel[]; scale: string | null } {
   const kilo: Scores = new Map();
   for (const model of models) {
      if (!model.bench) continue;
      const key = modelKey(model.id);
      kilo.set(key, Math.max(kilo.get(key) ?? 0, model.bench.completion));
   }
   const { scale, ratings, estimatedFrom } = combineRatings([...leaderboards, { title: 'Kilo', scores: kilo }]);
   return {
      scale,
      models: borrowPredecessorRatings(models.map((model) => {
         const rating = ratings.get(modelKey(model.id));
         return {
            ...model,
            bench:
               rating === undefined
                  ? null
                  : {
                       completion: rating,
                       costPerAttemptUsd: model.bench?.costPerAttemptUsd ?? null,
                       estimatedFrom: estimatedFrom.get(modelKey(model.id)) ?? null,
                    },
         };
      })),
   };
}

export class KiloCatalog {
   readonly #apiKey: string;
   readonly #baseUrl: string;
   readonly #usageUrl: string;
   readonly #ratingsUrl: string | null;
   readonly #fetch: typeof globalThis.fetch;
   readonly #ttlMs: number;
   readonly #clock: () => number;
   readonly #policy: TierPolicy;
   #snapshot: KiloSnapshot | null = null;
   #inFlight: Promise<KiloSnapshot> | null = null;
   readonly #placed = new WeakMap<KiloSnapshot, Map<string, TierPools>>();

   constructor(options: KiloCatalogOptions) {
      this.#apiKey = options.apiKey;
      this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
      this.#usageUrl = options.usageUrl ?? DEFAULT_LEADERBOARD_USAGE_URL;
      this.#ratingsUrl = options.ratingsUrl === undefined ? TBENCH_LEADERBOARD_URL : options.ratingsUrl;
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#ttlMs = options.ttlMs ?? DEFAULT_KILO_TTL_MS;
      this.#clock = options.clock ?? Date.now;
      this.#policy = options.policy ?? {};
   }

   /** Today's models, usage and tiers, refreshed when older than the TTL. */
   async snapshot(): Promise<KiloSnapshot> {
      const current = this.#snapshot;
      if (current && this.#clock() - current.fetchedAt < this.#ttlMs) return current;
      // One refresh however many requests arrive on a cold cache.
      this.#inFlight ??= this.#refresh().finally(() => {
         this.#inFlight = null;
      });
      return await this.#inFlight;
   }

   /** The models an agent can be set to: the paid tiers' eligible models. */
   async list(): Promise<CatalogModel[]> {
      const { models, pools } = await this.snapshot();
      return models
         .filter((model) => isPaidEligible(model))
         .map((model) => toCatalogModel(model, pools));
   }

   /** The model a task on `tier` runs on today after `rejections` rejected reviews, and its default fallback (`chooseForTier`). */
   async choose(tier: Tier, rejections = 0, place?: TierPlacement | null): Promise<TierChoice | null> {
      return chooseForTier(await this.poolsFor(place), tier, rejections);
   }

   /** What the deployment excludes, prefers and allows (`TierPolicy`). */
   get policy(): TierPolicy {
      return this.#policy;
   }

   /** The models the deployment placed in each tier (`BERRY_KILO_MAX|MID|LOW`): a workspace's own placement replaces them. */
   get deploymentPlacement(): TierPlacement {
      const place = this.#policy.place ?? {};
      return Object.fromEntries(TIERS.map((tier) => [tier, [...(place[tier] ?? [])]])) as TierPlacement;
   }

   /**
    * Today's tiers with `place` instead of the deployment's placement; the
    * deployment's own pools without one. Ranked once per placement and
    * snapshot, so each run's choice costs a lookup.
    */
   async poolsFor(place?: TierPlacement | null): Promise<TierPools> {
      const snapshot = await this.snapshot();
      if (!place) return snapshot.pools;
      let ranked = this.#placed.get(snapshot);
      if (!ranked) {
         ranked = new Map();
         this.#placed.set(snapshot, ranked);
      }
      const key = JSON.stringify(TIERS.map((tier) => place[tier]));
      let pools = ranked.get(key);
      if (!pools) {
         pools = rankTiers(snapshot.models, snapshot.usage, 'code', { ...this.#policy, place });
         ranked.set(key, pools);
      }
      return pools;
   }

   async #refresh(): Promise<KiloSnapshot> {
      const previous = this.#snapshot;
      // Read together; the leaderboards never fail the refresh.
      const reading = this.#readLeaderboards(previous?.leaderboards ?? []);
      const [models, usage] = await Promise.allSettled([this.#readModels(), this.#readUsage()]);
      const boards = await reading;
      if (models.status === 'rejected') {
         if (previous) {
            // Stale, and retried on the next read rather than an hour later.
            this.#snapshot = { ...previous, stale: true, fetchedAt: previous.fetchedAt };
            return this.#snapshot;
         }
         throw models.reason instanceof CatalogUnavailable
            ? models.reason
            : new CatalogUnavailable(`the Kilo model list could not be read: ${String((models.reason as Error)?.message ?? models.reason)}`);
      }
      const usageRows = usage.status === 'fulfilled' ? usage.value : (previous?.usage ?? []);
      const rated = rateModels(models.value, boards.leaderboards);
      this.#snapshot = {
         models: rated.models,
         usage: usageRows,
         pools: rankTiers(rated.models, usageRows, 'code', this.#policy),
         fetchedAt: this.#clock(),
         stale: false,
         usageStale: usage.status === 'rejected',
         ratingScale: rated.scale,
         ratingsStale: boards.stale,
         leaderboards: boards.leaderboards,
      };
      return this.#snapshot;
   }

   async #readModels(): Promise<GatewayModel[]> {
      const response = await this.#fetch(`${this.#baseUrl}/models`, {
         headers: { authorization: `Bearer ${this.#apiKey}` },
         signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new CatalogUnavailable(`the Kilo model list answered ${response.status}`);
      return parseGatewayModels(await response.json());
   }

   /** Every Terminal-Bench leaderboard, newest first; one that fails keeps its last good copy. */
   async #readLeaderboards(previous: RatingSource[]): Promise<{ leaderboards: RatingSource[]; stale: boolean }> {
      const url = this.#ratingsUrl;
      if (url === null) return { leaderboards: [], stale: false };
      const read = await Promise.allSettled(
         TBENCH_LEADERBOARDS.map((board) => readLeaderboard(this.#fetch, url, board, TIMEOUT_MS))
      );
      let stale = false;
      const leaderboards = TBENCH_LEADERBOARDS.map((board, index): RatingSource => {
         const result = read[index]!;
         if (result.status === 'fulfilled') return { title: board.title, scores: result.value };
         stale = true;
         return previous.find((entry) => entry.title === board.title) ?? { title: board.title, scores: new Map() };
      });
      return { leaderboards, stale };
   }

   async #readUsage(): Promise<UsageRow[]> {
      const response = await this.#fetch(this.#usageUrl, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error(`the Kilo usage leaderboard answered ${response.status}`);
      return parseUsageRows(await response.json());
   }
}

/** The picker's view of a gateway model; `tier` names the tier it sits in today, if any. */
export function toCatalogModel(model: GatewayModel, pools: TierPools): CatalogModel {
   const tier = tierOf(pools, model.id);
   return {
      id: model.id,
      displayName: model.name,
      provider: 'kilo',
      tier: tier ? TIER_NAMES[tier] : '',
      contextWindow: model.contextLength,
      // Negative is the gateway's "no fixed price" (a router): unknown, not free.
      inputCostPerM: model.price.input < 0 ? null : model.price.input,
      outputCostPerM: model.price.output < 0 ? null : model.price.output,
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
   };
}
