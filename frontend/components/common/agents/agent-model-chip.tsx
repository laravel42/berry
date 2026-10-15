'use client';

import { agentTier, type Agent } from '@/lib/agents';

import { TierChip } from './tier-chip';

interface AgentModelChipProps {
   agent: Pick<Agent, 'modelName' | 'modelProvider' | 'tier' | 'defaultTier' | 'contract'>;
   className?: string;
}

/**
 * What the agent runs on, as a chip: its Berry tier.
 * Density matches AutonomyLevelChip.
 */
export function AgentModelChip({ agent, className }: AgentModelChipProps) {
   return <TierChip tier={agentTier(agent)} className={className} />;
}
