'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';

import type { AgentRoster } from '@/lib/agents';
import { cn } from '@/lib/utils';

import { agentWorkload } from './agent-workload';

interface AgentWorkloadMarkProps {
   roster: AgentRoster | undefined;
   /** The dot's colour: the agent's own, where the page is tinted by it. */
   tint?: string;
   className?: string;
}

/**
 * What the agent is doing, set beside its name the way an exponent sits
 * beside a number: raised to the top of the title, in the mono face of a meta
 * line. Lay it out next to the heading, not inside it, so the heading stays
 * the agent's name alone.
 *
 * Working is the one state that moves: the dot keeps sending a ring outward
 * while a run is in flight. Queued holds the dot still, and Idle greys it.
 */
export function AgentWorkloadMark({
   roster,
   tint = 'var(--status-warning)',
   className,
}: AgentWorkloadMarkProps) {
   const t = useTranslations('agentsChat.list');
   const workload = agentWorkload(roster);
   if (!workload) return null;
   const working = workload.labelKey === 'workloadWorking';
   const idle = workload.labelKey === 'workloadIdle';
   const label =
      workload.labelKey === 'workloadQueued'
         ? t('workloadQueued', { count: workload.count ?? 0 })
         : t(workload.labelKey);

   return (
      <span
         data-workload={workload.labelKey}
         style={{ '--mark-tint': tint } as CSSProperties}
         className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-pill px-2 font-mono text-2xs leading-none',
            idle
               ? 'bg-muted text-muted-foreground'
               : 'bg-[color-mix(in_oklab,var(--mark-tint)_16%,transparent)] text-foreground',
            className
         )}
      >
         <span aria-hidden className="relative flex size-2 shrink-0">
            {working ? (
               <span className="absolute inset-0 animate-ping rounded-full bg-(--mark-tint) opacity-75" />
            ) : null}
            <span
               className={cn(
                  'relative size-2 rounded-full',
                  idle ? 'bg-muted-foreground/50' : 'bg-(--mark-tint)'
               )}
            />
         </span>
         {label}
      </span>
   );
}
