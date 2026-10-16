'use client';

import { BerryMark, type BerryMarkTone } from '@/components/brand/berry-mark';
import { readableModelName } from '@/components/common/agents/model-name';
import { MetaBadge } from '@/components/common/meta-badge';
import { RuntimeProviderBadge } from '@/components/common/runtimes/runtime-provider-badge';
import { aiRuntimeModelsFrom, loadAiRuntimeCatalog } from '@/lib/runtimes';
import type { AiRuntimeCatalog } from '@/lib/runtimes';
import { colorForAgent } from '@/lib/agent-color';
import {
   formatRunDuration,
   isReviewGateRun,
   isTerminalRunStatus,
   runTriggerKey,
   type RunRecord,
} from '@/lib/runs';
import { timeAgo } from '@/lib/time-ago';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import {
   AtSign,
   CornerDownRight,
   GitMerge,
   MessageSquare,
   ShieldCheck,
   Timer,
   Wand2,
   Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';

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

function triggerIcon(key: string): ReactNode {
   const className = 'size-3.5 shrink-0';
   switch (key) {
      case 'review':
         return <ShieldCheck className={className} aria-hidden />;
      case 'mention':
         return <AtSign className={className} aria-hidden />;
      case 'chat':
         return <MessageSquare className={className} aria-hidden />;
      case 'autopilot':
         return <Timer className={className} aria-hidden />;
      case 'quickAction':
         return <Zap className={className} aria-hidden />;
      case 'builder':
         return <Wand2 className={className} aria-hidden />;
      case 'completion':
         return <CornerDownRight className={className} aria-hidden />;
      case 'mergeFix':
         return <GitMerge className={className} aria-hidden />;
      default:
         return <Zap className={className} aria-hidden />;
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
 * A run in one line, in the console's bottom bar: which run, status, agent,
 * why it ran, and how long — one phrase, not a tab beside a summary.
 */
export function RunSummary({ run, runs }: { run: RunRecord; runs: readonly RunRecord[] }) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const agent = getAgentById(run.agentId);
   const name = agent?.name ?? t('agent');
   const triggerKey = runTriggerKey(run.source);
   const trigger = isReviewGateRun(run)
      ? t('trigger.review')
      : triggerKey === 'assignment'
        ? null
        : t(`trigger.${triggerKey}` as 'trigger.mention');
   const live = !isTerminalRunStatus(run.status);
   const duration = useRunDuration(run);
   const title = runConsoleTabLabel(run, runs, {
      run: (n) => t('tab', { n }),
      review: t('tabReview'),
      reviewN: (n) => t('tabReviewN', { n }),
   });
   return (
      <>
         <span className="flex size-5 shrink-0 items-center justify-center bg-accent">
            <BerryMark size="sm" tone={markTone(run.status)} pulse={live} label={name} />
         </span>
         <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">
               <span>{title}</span>
               <span aria-hidden> · </span>
               <span className={cn('capitalize', statusTone(run.status))}>{run.status}</span>
            </span>
            <span className={cn('shrink-0 tabular-nums', statusTone(run.status))}>
               {formatRunDuration(duration)}
            </span>
            <span aria-hidden className="h-3 w-px shrink-0 bg-current opacity-30" />
            <MetaBadge
               className="text-actor-agent"
               truncate={false}
               icon={
                  <BerryMark
                     size="sm"
                     tone="working"
                     dotColor={colorForAgent(run.agentId)}
                     className="size-3.5"
                     label={name}
                  />
               }
            >
               {name}
            </MetaBadge>
            <RunModel run={run} />
            {trigger ? (
               <MetaBadge
                  truncate={false}
                  className={
                     isReviewGateRun(run)
                        ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
                        : undefined
                  }
                  icon={triggerIcon(isReviewGateRun(run) ? 'review' : triggerKey)}
               >
                  {trigger}
               </MetaBadge>
            ) : null}
         </span>
      </>
   );
}

/** Berry stores `default` when the subscription CLI picks its own model. */
const CLI_DEFAULT_MODEL = 'default';

let modelCatalog: Promise<AiRuntimeCatalog | null> | null = null;

function modelCatalogOnce(): Promise<AiRuntimeCatalog | null> {
   modelCatalog ??= loadAiRuntimeCatalog().catch(() => null);
   return modelCatalog;
}

/**
 * The name a person would read for this run's model.
 *
 * A catalog entry wins over the id. The `default` sentinel is the CLI's own
 * choice, which Kiro advertises as Auto.
 */
export function runModelLabel(
   catalog: AiRuntimeCatalog | null,
   runtimeId: string | null | undefined,
   modelId: string
): string | null {
   const runtime = catalog?.nodes.find((node) => node.id === runtimeId);
   const models = runtime ? aiRuntimeModelsFrom(runtime) : [];
   const named = models.find((model) => model.id === modelId);
   if (named && modelId !== CLI_DEFAULT_MODEL) return named.name;
   if (modelId === CLI_DEFAULT_MODEL) {
      const chosen =
         models.find((model) => model.id === 'auto') ??
         models.find((model) => model.id !== CLI_DEFAULT_MODEL);
      return chosen?.name ?? null;
   }
   return readableModelName(modelId);
}

export function RunModel({ run }: { run: RunRecord }) {
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const agent = getAgentById(run.agentId);
   const modelId = run.aiModelId?.trim() || agent?.modelName?.trim() || '';
   const [label, setLabel] = useState<string | null>(() =>
      modelId && modelId !== CLI_DEFAULT_MODEL ? readableModelName(modelId) : null
   );

   useEffect(() => {
      if (!modelId) return;
      let cancelled = false;
      void modelCatalogOnce().then((catalog) => {
         if (cancelled) return;
         setLabel(runModelLabel(catalog, run.aiRuntimeId, modelId));
      });
      return () => {
         cancelled = true;
      };
   }, [modelId, run.aiRuntimeId]);

   if (!modelId || !label) return null;
   return (
      <RuntimeProviderBadge
         runtimeId={run.aiRuntimeId}
         label={label}
         title={label}
         truncate={false}
      />
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
 * A run as a tab of the task's console: "Run 3" or "Review", and how long it
 * took, after its mark in the status' colour. The whole line is its tooltip.
 * Lives in the console's bottom bar with the rest of the run's controls.
 */
export function runConsoleTabLabel(
   run: RunRecord,
   siblings: readonly RunRecord[],
   copy: { run: (n: number) => string; review: string; reviewN: (n: number) => string }
): string {
   if (isReviewGateRun(run)) {
      const reviews = siblings
         .filter(isReviewGateRun)
         .slice()
         .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      return reviews.length <= 1
         ? copy.review
         : copy.reviewN(reviews.findIndex((entry) => entry.id === run.id) + 1);
   }
   const authors = siblings
      .filter((entry) => !isReviewGateRun(entry))
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
   return copy.run(authors.findIndex((entry) => entry.id === run.id) + 1);
}

export function RunTab({
   run,
   runs,
   selected,
   panelId,
   onSelect,
}: {
   run: RunRecord;
   /** The task's runs, so a review tab is numbered among reviews. */
   runs: readonly RunRecord[];
   selected: boolean;
   panelId: string;
   onSelect: () => void;
}) {
   const t = useTranslations('issueDetail.log');
   const getAgentById = useAgentsStore((state) => state.getAgentById);
   const name = getAgentById(run.agentId)?.name ?? t('agent');
   const triggerKey = runTriggerKey(run.source);
   const trigger = isReviewGateRun(run)
      ? t('trigger.review')
      : triggerKey === 'assignment'
        ? null
        : t(`trigger.${triggerKey}` as 'trigger.mention');
   const duration = useRunDuration(run);
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
         className={cn(
            'flex h-full min-w-0 items-center gap-1.5 rounded px-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            selected ? 'text-foreground' : 'hover:bg-muted'
         )}
      >
         <RunSummary run={run} runs={runs} />
      </button>
   );
}
