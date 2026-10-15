/**
 * The model picker catalogue.
 *
 * Native Bedrock and Kilo catalogues are gone. Subscription runtimes list
 * their own models. This module keeps the wire types and the pairing check
 * so stored agent rows still decode.
 */

/** One selectable model as the product sees it. */
export interface CatalogModel {
   id: string;
   displayName: string;
   provider: string;
   tier: string;
   contextWindow: number;
   inputCostPerM: number | null;
   outputCostPerM: number | null;
   supportsTools: boolean;
   supportsVision: boolean;
}

export interface ModelSource {
   list(): Promise<CatalogModel[]>;
}

export class CatalogUnavailable extends Error {
   constructor(message: string) {
      super(message);
      this.name = 'CatalogUnavailable';
   }
}

/**
 * Confirms a provider/model pair is one this list actually contains.
 */
export function resolveModel(
   models: CatalogModel[],
   provider: string,
   model: string
): CatalogModel | undefined {
   const wanted = normalizeModelId(provider, model);
   return models.find(
      (candidate) =>
         candidate.provider === provider &&
         normalizeModelId(candidate.provider, candidate.id) === wanted
   );
}

/**
 * Strips a provider prefix repeated inside a model id.
 */
export function normalizeModelId(provider: string, id: string): string {
   if (!provider || !id) return id;
   return id.startsWith(`${provider}/`) ? id.slice(provider.length + 1) : id;
}

/** @deprecated geo labels were a Bedrock picker concern; kept for stored names. */
export function stripGeoLabel(name: string): string {
   return name.replace(/^(US|EU|APAC|AP|Global)\s+/i, '');
}

/** @deprecated global profiles were a Bedrock catalogue filter. */
export function isGlobalProfile(id: string): boolean {
   return id.startsWith('global.');
}
