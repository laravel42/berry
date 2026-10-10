import type { Sql } from '../db/pool.ts';
import type { TierPlacement, TierPools } from '../agents/kilo/tiers.ts';
import { chooseForTier, isGatewayModelId } from '../agents/kilo/tiers.ts';
import type { Tier } from '../agents/model-tiers.ts';

/**
 * The gateway refused this key for the model that was called.
 *
 * Kilo's own wording, including the `[BYOK]` form. A 403 for any other
 * reason is left alone: walking the tier would not change it.
 */
export function isModelPermissionDenied(message: string): boolean {
   return /does not have permission to access this model/i.test(message);
}

/**
 * The gateway's auto route. A placed model the provider key refuses is not
 * made callable by trying the next id on that key; this route picks a model
 * the key can actually call. Same id Berry's usage ledger already knows.
 */
const GATEWAY_AUTO_MODEL = 'kilo-auto/efficient';

const AFTER: Record<Tier, readonly Tier[]> = {
   berry_low: ['berry_low', 'berry_mid', 'berry_max'],
   berry_mid: ['berry_mid', 'berry_low', 'berry_max'],
   berry_max: ['berry_max', 'berry_mid', 'berry_low'],
};

/**
 * Models still worth a completion after the runtime's one fallback also
 * failed this way.
 *
 * The runtime tries the tier's choice and then a single fallback. What
 * remains is the rest of that tier, then the neighbouring tiers, cheapest
 * direction first. The agent's own gateway fallback, when it has one, is
 * the fallback the runtime used and is not tried again here.
 */
export function modelsAfterPermissionDenial(pools: TierPools, tier: Tier, ownFallback: string | null): string[] {
   const choice = chooseForTier(pools, tier, 0);
   if (!choice) return [];
   const fallback = ownFallback && isGatewayModelId(ownFallback) && ownFallback !== choice.model ? ownFallback : choice.fallback;
   const tried = new Set([choice.model, ...(fallback ? [fallback] : [])]);
   const rest: string[] = [];
   // Ahead of the rest of the placement: those ids are often the same keys
   // that just refused, and the auto route is one call rather than a tour of them.
   if (!tried.has(GATEWAY_AUTO_MODEL)) rest.push(GATEWAY_AUTO_MODEL);
   for (const name of AFTER[tier]) {
      for (const model of pools[name]) {
         if (tried.has(model.id)) continue;
         tried.add(model.id);
         rest.push(model.id);
      }
   }
   return rest;
}

interface GatewayDenialSource {
   catalog: { poolsFor(place?: TierPlacement | null): Promise<TierPools> };
   placements: { get(workspaceId: string): Promise<TierPlacement | null> };
}

/**
 * The models a completion should try after a permission refusal, for this
 * workspace's placement. The call follows the Orchestrator's selected tier,
 * the same rule as the envelope.
 */
export async function gatewayModelsAfterDenial(
   sql: Sql,
   gateway: GatewayDenialSource,
   input: { workspaceId: string; purpose: string }
): Promise<string[]> {
   const place = await gateway.placements.get(input.workspaceId);
   const pools = await gateway.catalog.poolsFor(place);
   const [agent] = await sql`
      SELECT model_tier, fallback_model FROM agents
       WHERE workspace_id = ${input.workspaceId} AND protected AND archived_at IS NULL`;
   const stored = agent?.model_tier;
   const tier: Tier = stored === 'berry_max' || stored === 'berry_mid' || stored === 'berry_low' ? stored : 'berry_low';
   const own = (agent?.fallback_model as string | null | undefined) ?? null;
   return modelsAfterPermissionDenial(pools, tier, own);
}
