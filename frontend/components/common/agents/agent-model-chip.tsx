'use client';

import { agentTier, type Agent } from '@/lib/agents';

import { TierChip } from './tier-chip';

interface AgentModelChipProps {
   agent: Pick<Agent, 'modelName' | 'modelProvider' | 'tier' | 'defaultTier' | 'contract'>;
   /** `chip` for the agent's header, `compact` for a dense row. */
   variant?: 'compact' | 'chip';
   className?: string;
}

/** What the agent runs on, as a chip: its Berry tier. */
export function AgentModelChip({ agent, variant, className }: AgentModelChipProps) {
   return <TierChip tier={agentTier(agent)} variant={variant} className={className} />;
}
