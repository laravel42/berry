'use client';

import { useTranslations } from 'next-intl';

import type { AgentRoster } from '@/lib/agents';
import { cn } from '@/lib/utils';

import { agentWorkload } from './agent-workload';
import { PresenceDot } from './presence-dot';

interface AgentWorkloadChipProps {
   roster: AgentRoster | undefined;
   className?: string;
}

/** Idle / Working / N queued from the roster load. */
export function AgentWorkloadChip({ roster, className }: AgentWorkloadChipProps) {
   const t = useTranslations('agentsChat.list');
   const workload = agentWorkload(roster);
   if (!workload) return null;
   const label =
      workload.labelKey === 'workloadQueued'
         ? t('workloadQueued', { count: workload.count ?? 0 })
         : t(workload.labelKey);
   return (
      <span
         className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 py-1 text-muted-foreground',
            className
         )}
      >
         <PresenceDot tone={workload.tone} label={label} />
         {label}
      </span>
   );
}
