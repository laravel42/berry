/**
 * Usage pricing types.
 *
 * The Portkey Bedrock price feed is gone. Subscription usage is recorded
 * unpriced. This file keeps the types `record.ts` still imports so a later
 * priced source can plug in without changing the write path.
 */

export interface ModelPrice {
   inputPerM: number;
   outputPerM: number;
   cacheReadPerM: number | null;
   cacheWritePerM: number | null;
}

export interface PricingSource {
   priceFor(modelId: string): Promise<ModelPrice | null>;
}

export interface TokenCounts {
   inputTokens: number;
   outputTokens: number;
   cacheReadTokens: number;
   cacheWriteTokens: number;
}

export function costMicrosFor(price: ModelPrice, tokens: TokenCounts): number {
   return Math.round(
      tokens.inputTokens * price.inputPerM +
         tokens.outputTokens * price.outputPerM +
         tokens.cacheReadTokens * (price.cacheReadPerM ?? price.inputPerM) +
         tokens.cacheWriteTokens * (price.cacheWritePerM ?? price.inputPerM)
   );
}
