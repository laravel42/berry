'use client';

import { useEffect, useState } from 'react';

import { listAgentModels, modelKey, type Agent, type AgentModel } from '@/lib/agents';
import { cn } from '@/lib/utils';

import { agentModelName, MODEL_TIER_NEUTRAL, MODEL_TIER_STYLE, modelTier } from './model-name';

interface AgentModelChipProps {
   agent: Pick<Agent, 'modelName' | 'modelProvider'>;
   className?: string;
}

/** One shared catalog fetch so every chip on a roster pays one round trip. */
let pricesInflight: Promise<Map<string, AgentModel>> | null = null;

function loadModelPrices(): Promise<Map<string, AgentModel>> {
   pricesInflight ??= listAgentModels()
      .then((models) => new Map(models.map((model) => [modelKey(model), model])))
      .catch((error: unknown) => {
         pricesInflight = null;
         throw error;
      });
   return pricesInflight;
}

/**
 * Coloured model badge by input $/MTok: ≤$1 low, ≤$2 mid, ≤$3 mid-high,
 * >$3 high. Density matches AutonomyLevelChip.
 */
export function AgentModelChip({ agent, className }: AgentModelChipProps) {
   const [prices, setPrices] = useState<Map<string, AgentModel>>(() => new Map());
   useEffect(() => {
      let alive = true;
      loadModelPrices().then(
         (map) => {
            if (alive) setPrices(map);
         },
         () => {
            /* published Claude rates still colour known ids */
         }
      );
      return () => {
         alive = false;
      };
   }, []);

   const tier = modelTier(agent, prices);

   return (
      <span
         title={agent.modelName ?? undefined}
         className={cn(
            'shrink-0 rounded border px-1.5 py-px leading-none',
            tier ? MODEL_TIER_STYLE[tier] : MODEL_TIER_NEUTRAL,
            className
         )}
      >
         {agentModelName(agent)}
      </span>
   );
}
