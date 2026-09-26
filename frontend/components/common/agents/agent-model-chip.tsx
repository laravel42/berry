'use client';

import { useEffect, useState } from 'react';

import { useModelGateway } from '@/hooks/use-model-gateway';
import {
   agentTier,
   gatewayPin,
   listAgentModels,
   modelKey,
   type Agent,
   type AgentModel,
} from '@/lib/agents';
import { cn } from '@/lib/utils';

import { agentModelName, MODEL_TIER_NEUTRAL, MODEL_TIER_STYLE, modelTier } from './model-name';
import { TierChip } from './tier-chip';

interface AgentModelChipProps {
   agent: Pick<Agent, 'modelName' | 'modelProvider' | 'tier' | 'defaultTier' | 'contract'>;
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
 * What the agent runs on, as a chip.
 *
 * A pinned model is coloured by input $/MTok: ≤$1 low, ≤$2 mid, ≤$3 mid-high,
 * >$3 high. Under a gateway the chip is the agent's tier unless it is pinned
 * to a gateway model: a stored Bedrock id is ignored there, as runs ignore it.
 * Density matches AutonomyLevelChip.
 */
export function AgentModelChip({ agent, className }: AgentModelChipProps) {
   const gateway = useModelGateway();
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

   if (gateway === true && !gatewayPin(agent)) {
      return <TierChip tier={agentTier(agent)} className={className} />;
   }

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
