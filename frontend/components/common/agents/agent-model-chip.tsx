'use client';

import type { Agent } from '@/lib/agents';
import { cn } from '@/lib/utils';

import { agentModelName, MODEL_TIER_NEUTRAL, MODEL_TIER_STYLE, modelTier } from './model-name';

interface AgentModelChipProps {
   agent: Pick<Agent, 'modelName'>;
   className?: string;
}

/**
 * Coloured model badge: haiku / sonnet / opus map to low / mid / high tiers.
 * Density matches AutonomyLevelChip so the two chips sit together in a header.
 */
export function AgentModelChip({ agent, className }: AgentModelChipProps) {
   const tier = modelTier(agent.modelName);
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
