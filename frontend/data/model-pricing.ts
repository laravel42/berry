/**
 * Published list prices for the models an AI provider serves.
 *
 * Berry has no price feed: subscription usage is recorded unpriced, and no
 * provider's model list carries a price. This table is what the provider
 * publishes, copied by hand, so it says when it was copied and where from.
 * A model that is not here has no price in Berry, which reads as a dash and
 * never as free.
 *
 * Prices are US dollars per million tokens, at the provider's first-party
 * standard rate (no batch, no fast mode, no regional uplift).
 */

export interface PublishedPrice {
   inputPerM: number;
   outputPerM: number;
   /** Null when the provider's published rate for cache reads is not in this table. */
   cacheReadPerM: number | null;
   /** A condition on the price, such as a higher rate for long prompts. */
   note?: string;
}

export interface PriceList {
   /** When the prices were copied (YYYY-MM-DD). */
   asOf: string;
   /** The provider's own pricing page. */
   source: string;
   models: Readonly<Record<string, PublishedPrice>>;
}

const ANTHROPIC: PriceList = {
   asOf: '2026-11-03',
   source: 'https://platform.claude.com/docs/en/about-claude/pricing',
   models: {
      'claude-fable-5-2': { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2 },
      'claude-mythos-5-2': { inputPerM: 8, outputPerM: 40, cacheReadPerM: 0.2 },
      'claude-fable-5-1': { inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25 },
      'claude-mythos-5-1': { inputPerM: 10, outputPerM: 50, cacheReadPerM: 0.25 },
      'claude-fable-5': { inputPerM: 10, outputPerM: 50, cacheReadPerM: 1 },
      'claude-mythos-5': { inputPerM: 10, outputPerM: 50, cacheReadPerM: 1 },
      'claude-opus-5-5': { inputPerM: 4, outputPerM: 20, cacheReadPerM: 0.2 },
      'claude-opus-5': { inputPerM: 5, outputPerM: 25, cacheReadPerM: null },
      'claude-opus-4-8': { inputPerM: 5, outputPerM: 25, cacheReadPerM: null },
      'claude-opus-4-7': { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5 },
      'claude-opus-4-6': { inputPerM: 5, outputPerM: 25, cacheReadPerM: 0.5 },
      'claude-sonnet-5-5': { inputPerM: 2, outputPerM: 10, cacheReadPerM: 0.1 },
      'claude-sonnet-5': { inputPerM: 2, outputPerM: 10, cacheReadPerM: null },
      'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3 },
      'claude-haiku-5-5': {
         inputPerM: 0.1,
         outputPerM: 0.5,
         cacheReadPerM: null,
         note: '$0.50 in and $2.50 out above 100K prompt tokens',
      },
      'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5, cacheReadPerM: 0.1 },
   },
};

/**
 * Pricing pages for the API providers whose prices are not copied here yet.
 * The drawer links to them so a dash still leads somewhere.
 */
const PRICING_PAGES: Readonly<Record<string, string>> = {
   anthropic: ANTHROPIC.source,
   openai: 'https://openai.com/api/pricing/',
   xai: 'https://docs.x.ai/docs/models',
   gemini: 'https://ai.google.dev/gemini-api/docs/pricing',
};

/** Price lists keyed by AI runtime id. */
const PRICE_LISTS: Readonly<Record<string, PriceList>> = {
   anthropic: ANTHROPIC,
};

/**
 * The id a price list is keyed by: no vendor path, no Bedrock prefix, no
 * snapshot date. `anthropic/claude-haiku-4-5-20251001` → `claude-haiku-4-5`.
 */
export function priceKey(modelId: string): string {
   let id = modelId.trim().toLowerCase();
   if (id.includes('/')) id = id.slice(id.lastIndexOf('/') + 1);
   id = id.replace(/^(?:us|eu|apac|global)\./, '').replace(/^anthropic\./, '');
   id = id.replace(/(?:@|-)\d{8}(?:-v\d+(?::\d+)?)?$/, '');
   return id;
}

/** How a provider charges for a model, as the drawer shows it. */
export type ModelPricing =
   /** Covered by the provider plan the CLI is signed in with. */
   | { kind: 'subscription' }
   /** Runs on hardware the person owns; nobody bills the tokens. */
   | { kind: 'local' }
   /** Billed per token at a published rate. */
   | { kind: 'metered'; price: PublishedPrice }
   /** Billed per token, at a rate Berry does not know. */
   | { kind: 'unknown' };

export function modelPricing(
   runtime: { id: string; billing: string },
   modelId: string
): ModelPricing {
   if (runtime.billing === 'subscription') return { kind: 'subscription' };
   if (runtime.id === 'lmstudio') return { kind: 'local' };
   const price = PRICE_LISTS[runtime.id]?.models[priceKey(modelId)];
   return price ? { kind: 'metered', price } : { kind: 'unknown' };
}

/** The list a runtime's prices come from, when Berry has one. */
export function priceListFor(runtimeId: string): PriceList | null {
   return PRICE_LISTS[runtimeId] ?? null;
}

/** The provider's pricing page, when it publishes one. */
export function pricingPageFor(runtimeId: string): string | null {
   return PRICING_PAGES[runtimeId] ?? null;
}
