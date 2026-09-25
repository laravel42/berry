import { z } from 'zod';
import { CatalogUnavailable, type CatalogModel } from '../catalog.ts';
import { AUTO_MODEL, isFreeEligible, isPaidEligible, modelForTier, rankTiers, tierOf, TIER_NAMES, type GatewayModel, type Tier, type TierPools, type UsageRow } from './tiers.ts';

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
 *   Kilo usage per model and mode, which ranks the models KiloBench has not
 *   scored.
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
}

export interface KiloCatalogOptions {
   apiKey: string;
   baseUrl: string;
   usageUrl?: string;
   fetch?: typeof globalThis.fetch;
   ttlMs?: number;
   clock?: () => number;
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
      name: model.name ?? model.id,
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

export class KiloCatalog {
   readonly #apiKey: string;
   readonly #baseUrl: string;
   readonly #usageUrl: string;
   readonly #fetch: typeof globalThis.fetch;
   readonly #ttlMs: number;
   readonly #clock: () => number;
   #snapshot: KiloSnapshot | null = null;
   #inFlight: Promise<KiloSnapshot> | null = null;

   constructor(options: KiloCatalogOptions) {
      this.#apiKey = options.apiKey;
      this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
      this.#usageUrl = options.usageUrl ?? DEFAULT_LEADERBOARD_USAGE_URL;
      this.#fetch = options.fetch ?? globalThis.fetch;
      this.#ttlMs = options.ttlMs ?? DEFAULT_KILO_TTL_MS;
      this.#clock = options.clock ?? Date.now;
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

   /** The models an agent can be set to: the paid tiers' eligible models, the free ones, and BerryAuto. */
   async list(): Promise<CatalogModel[]> {
      const { models, pools } = await this.snapshot();
      return models
         .filter((model) => isPaidEligible(model) || isFreeEligible(model) || model.id === AUTO_MODEL)
         .map((model) => toCatalogModel(model, pools));
   }

   /** The model a role on `tier` runs on today: the tier's first choice, or the nearest tier's. */
   async modelFor(tier: Tier): Promise<string | null> {
      return modelForTier((await this.snapshot()).pools, tier);
   }

   async #refresh(): Promise<KiloSnapshot> {
      const previous = this.#snapshot;
      const [models, usage] = await Promise.allSettled([this.#readModels(), this.#readUsage()]);
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
      this.#snapshot = {
         models: models.value,
         usage: usageRows,
         pools: rankTiers(models.value, usageRows),
         fetchedAt: this.#clock(),
         stale: false,
         usageStale: usage.status === 'rejected',
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
      inputCostPerM: Math.max(model.price.input, 0),
      outputCostPerM: Math.max(model.price.output, 0),
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
   };
}
