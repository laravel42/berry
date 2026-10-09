'use client';

import { BerryMark, type BerryMarkTone } from '@/components/brand/berry-mark';
import { readableModelName } from '@/components/common/agents/model-name';
import { formatRunDuration, isTerminalRunStatus, runTriggerKey, type RunRecord } from '@/lib/runs';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export function statusTone(status: RunRecord['status']): string {
   switch (status) {
      case 'succeeded':
         return 'text-status-success';
      case 'failed':
         return 'text-status-danger';
      case 'cancelled':
         return 'text-status-neutral';
      case 'running':
         return 'text-status-info';
      default:
         return 'text-muted-foreground';
   }
}

export function markTone(status: RunRecord['status']): BerryMarkTone {
   switch (status) {
      case 'succeeded':
         return 'complete';
      case 'failed':
         return 'danger';
      case 'cancelled':
         return 'neutral';
      default:
         return 'working';
   }
}

/**
 * A run in one line, in the console's bottom bar: its mark, status, and agent
 * on the left, and the model it is running on at the right.
 */
export function RunSummary({ run }: { run: RunRecord }) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const agent = getAgentById(run.agentId);
   const name = agent?.name ?? t('agent');
   const modelId = run.aiModelId?.trim() || agent?.modelName?.trim() || '';
   // Why it ran, when it says something: being assigned is how every run
   // starts unless something else started it, so that one goes unsaid.
   const triggerKey = runTriggerKey(run.source);
   const trigger =
      triggerKey === 'assignment' ? null : t(`trigger.${triggerKey}` as 'trigger.mention');
   const live = !isTerminalRunStatus(run.status);
   return (
      <>
         <span className="flex size-5 shrink-0 items-center justify-center bg-accent">
            <BerryMark size="sm" tone={markTone(run.status)} pulse={live} label={name} />
         </span>
         <span className="min-w-0 flex-1 truncate">
            <span className={cn('capitalize', statusTone(run.status))}>{run.status}</span>
            <span aria-hidden> · </span>
            <span className="text-actor-agent">{name}</span>
            {trigger ? (
               <>
                  <span aria-hidden> · </span>
                  <span>{trigger}</span>
               </>
            ) : null}
         </span>
         {modelId ? (
            <span className="ml-auto max-w-[45%] shrink-0 truncate text-foreground" title={modelId}>
               {readableModelName(modelId)}
            </span>
         ) : null}
      </>
   );
}

/**
 * How long a run took, or has taken so far: it counts up each second while
 * the run works, and a run that never started is measured from when it was
 * queued, so every run says how long it took.
 */
export function useRunDuration(run: RunRecord): number {
   const live = !isTerminalRunStatus(run.status);
   const [now, setNow] = useState(() => Date.now());
   useEffect(() => {
      if (!live) return;
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
   }, [live]);
   const end = run.completedAt ? new Date(run.completedAt).getTime() : now;
   return Math.max(0, end - new Date(run.startedAt ?? run.createdAt).getTime());
}

/**
 * A run as a tab of the task's console: "Run 3" and how long it took, after
 * its mark in the status' colour. The whole line is its tooltip, and the
 * console's bottom bar shows it.
 */
export function RunTab({
   run,
   ordinal,
   selected,
   panelId,
   onSelect,
}: {
   run: RunRecord;
   /** Its place among the task's runs, oldest first: Run 1, Run 2… */
   ordinal: number;
   selected: boolean;
   panelId: string;
   onSelect: () => void;
}) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const name = getAgentById(run.agentId)?.name ?? t('agent');
   // Why it ran, when it says something: being assigned is how every run
   // starts unless something else started it, so that one goes unsaid.
   const triggerKey = runTriggerKey(run.source);
   const trigger =
      triggerKey === 'assignment' ? null : t(`trigger.${triggerKey}` as 'trigger.mention');
   const duration = useRunDuration(run);
   const live = !isTerminalRunStatus(run.status);
   const when = timeAgo(run.completedAt ?? run.startedAt ?? run.createdAt, 'recently');
   return (
      <button
         type="button"
         role="tab"
         id={`run-tab-${run.id}`}
         aria-selected={selected}
         aria-controls={panelId}
         tabIndex={selected ? 0 : -1}
         title={[run.status, name, trigger, formatRunDuration(duration), when]
            .filter(Boolean)
            .join(' · ')}
         onClick={onSelect}
         // Editor tabs: flat, edge to edge, split by thin lines; the shown one
         // takes the panel's background.
         className={cn(
            'flex h-full shrink-0 items-center gap-1.5 border-r border-r-status-neutral/20 px-3 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
            selected ? 'bg-container text-foreground' : 'hover:bg-status-neutral/15'
         )}
      >
         <BerryMark size="sm" tone={markTone(run.status)} pulse={live} label={run.status} />
         <span>{t('tab', { n: ordinal })}</span>
         <span aria-hidden className="h-3 w-px shrink-0 bg-current opacity-30" />
         <span className={cn('tabular-nums', statusTone(run.status))}>
            {formatRunDuration(duration)}
         </span>
      </button>
   );
}
