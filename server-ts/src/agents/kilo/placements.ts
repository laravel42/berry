import type { Sql } from '../../db/pool.ts';
import { TIERS, type GatewayModel, type TierPlacement } from './tiers.ts';

/**
 * The models each workspace placed in its tiers (`workspace_model_tiers`).
 *
 * A workspace without a row runs on the deployment's placement
 * (`BERRY_KILO_MAX|MID|LOW`); with one, its own lists replace all three, and
 * an empty list leaves that tier to the leaderboard.
 */
export class TierPlacements {
   readonly #sql: Sql;

   constructor(sql: Sql) {
      this.#sql = sql;
   }

   async get(workspaceId: string): Promise<TierPlacement | null> {
      const [row] = await this.#sql<Array<Record<string, string[]>>>`
         SELECT berry_max, berry_mid, berry_low FROM workspace_model_tiers WHERE workspace_id = ${workspaceId}`;
      if (!row) return null;
      return Object.fromEntries(TIERS.map((tier) => [tier, row[tier] ?? []])) as TierPlacement;
   }

   async set(workspaceId: string, userId: string, placement: TierPlacement): Promise<void> {
      await this.#sql`
         INSERT INTO workspace_model_tiers (workspace_id, berry_max, berry_mid, berry_low, updated_by, updated_at)
         VALUES (${workspaceId}, ${placement.berry_max}, ${placement.berry_mid}, ${placement.berry_low}, ${userId}, now())
         ON CONFLICT (workspace_id) DO UPDATE
            SET berry_max = EXCLUDED.berry_max, berry_mid = EXCLUDED.berry_mid, berry_low = EXCLUDED.berry_low,
                updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
   }

   /** Back to the deployment's placement. */
   async clear(workspaceId: string): Promise<void> {
      await this.#sql`DELETE FROM workspace_model_tiers WHERE workspace_id = ${workspaceId}`;
   }

   /** One agent step in this workspace over the last week, on average; null before its agents have run. */
   async stepMix(workspaceId: string): Promise<StepMix | null> {
      const [row] = await this.#sql`
         SELECT count(*) AS steps,
                avg(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) AS context,
                avg(u.output_tokens) AS output,
                sum(u.cache_read_tokens) FILTER (WHERE u.cache_read_tokens > 0)::float8
                   / nullif(sum(u.input_tokens + u.cache_read_tokens + u.cache_write_tokens) FILTER (WHERE u.cache_read_tokens > 0), 0) AS hit
           FROM task_usage u
           JOIN runs r ON r.id = u.run_id AND r.kind = 'agent'
          WHERE u.workspace_id = ${workspaceId} AND u.occurred_at > now() - interval '7 days'`;
      if (!row || Number(row.steps) === 0) return null;
      return {
         contextTokens: Math.round(Number(row.context)),
         outputTokens: Math.round(Number(row.output)),
         cacheHitShare: row.hit === null ? 0 : Number(row.hit),
      };
   }
}

/**
 * What an agent step re-sends and writes. Each step sends the whole
 * conversation again, so context outweighs output a hundred to one, and a
 * model that caches bills most of it at its cache price.
 */
export interface StepMix {
   contextTokens: number;
   outputTokens: number;
   /** The share of context a caching model read from its cache. */
   cacheHitShare: number;
}

/** USD for one step at `mix`; a model with no cache price pays its input price on all of it. */
export function stepCost(model: GatewayModel, mix: StepMix): number | null {
   if (model.price.input < 0 || model.price.output < 0) return null;
   const cached = model.price.cacheRead !== null && model.price.cacheRead >= 0 ? model.price.cacheRead : model.price.input;
   const context = mix.contextTokens * (mix.cacheHitShare * cached + (1 - mix.cacheHitShare) * model.price.input);
   return (context + mix.outputTokens * model.price.output) / 1e6;
}
