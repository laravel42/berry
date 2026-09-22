'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { StatusBadge } from '@/components/common/status-badge';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { listPlans, type PlanSummary } from '@/lib/plans';
import { timeAgo } from '@/lib/time-ago';
import { usePlansListStore } from '@/store/plans-list-store';
import { useSessionStore } from '@/store/session-store';
import { ChevronLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQueryState } from 'nuqs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SplitIndex, useSelectFirst } from '@/components/common/page/split-index';
import Header from '@/components/layout/headers/plans/header';
import { cn } from '@/lib/utils';
import PlanPreview from './plan-preview';
import { planSummaryLook } from './plan-status-badge';

function applySearch(list: PlanSummary[], query: string): PlanSummary[] {
   const term = query.trim().toLowerCase();
   if (!term) return list;
   return list.filter((plan) => {
      if (plan.title.toLowerCase().includes(term)) return true;
      return (plan.projectName ?? '').toLowerCase().includes(term);
   });
}

/** How often the list re-reads while a plan on it is generating or starting. */
const POLL_INTERVAL_MS = 4000;

function isLive(plan: PlanSummary): boolean {
   return plan.generation.status === 'running' || plan.compileStatus === 'running';
}

/** One plan in the rail. Selecting it opens the plan beside the list. */
function PlanRow({
   plan,
   selected,
   onSelect,
}: {
   plan: PlanSummary;
   selected: boolean;
   onSelect: (planId: string) => void;
}) {
   const t = useTranslations('goals.plans');
   const look = planSummaryLook(plan);
   const started = plan.createdTasks > 0;
   const percent = started ? Math.round((plan.finishedTasks / plan.createdTasks) * 100) : 0;
   return (
      <button
         type="button"
         aria-current={selected ? 'true' : undefined}
         onClick={() => onSelect(plan.id)}
         className={cn(
            'flex w-full items-start gap-3 border-b border-muted-foreground/5 px-4 py-3 text-left outline-none last:border-b-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
            selected ? 'bg-accent' : 'hover:bg-sidebar/50'
         )}
      >
         <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/40">
            <BerryMark
               size="sm"
               tone={look.tone}
               state={look.state}
               pulse={look.pulse}
               label={look.label}
            />
         </span>
         <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2">
               <StatusBadge look={look} />
               <span className="ml-auto shrink-0 text-muted-foreground">
                  {timeAgo(plan.updatedAt)}
               </span>
            </span>
            <span className="line-clamp-2 font-medium">{plan.title}</span>
            <span className="truncate text-muted-foreground">
               {plan.projectName ?? t('list.noProject')}
            </span>
            {started ? (
               <span className="flex items-center gap-2">
                  <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                     <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${percent}%` }}
                     />
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                     {t('tasks', { finished: plan.finishedTasks, created: plan.createdTasks })}
                  </span>
               </span>
            ) : plan.plannedTasks > 0 ? (
               <span className="text-muted-foreground">
                  {t('planned', { count: plan.plannedTasks })}
               </span>
            ) : null}
         </span>
      </button>
   );
}

/**
 * Every plan in the workspace that is still in play: generating, waiting on
 * answers or an approval, or started and working through its tasks. `All`
 * adds the rejected and superseded ones. A row opens the plan itself.
 */
export default function PlansList() {
   const t = useTranslations('goals.plans');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const scope = usePlansListStore((state) => state.scope);
   const query = usePlansListStore((state) => state.query);
   const setCount = usePlansListStore((state) => state.setCount);
   const [plans, setPlans] = useState<PlanSummary[] | null>(null);
   const [failed, setFailed] = useState(false);

   const load = useCallback(async () => {
      if (!workspaceId) return;
      try {
         const next = await listPlans(workspaceId, scope);
         setPlans(next);
         setCount(scope, next.length);
         setFailed(false);
      } catch {
         setFailed(true);
      }
   }, [workspaceId, scope, setCount]);

   useEffect(() => {
      void load();
   }, [load]);

   // Plans move when their tasks do: a finished task changes a row's progress.
   useEffect(
      () =>
         subscribeWorkspaceEvents((event) => {
            if (
               event.type.startsWith('plan.') ||
               event.type.startsWith('goal.') ||
               event.type.startsWith('issue.')
            ) {
               void load();
            }
         }),
      [load]
   );

   const live = plans?.some(isLive) ?? false;
   useEffect(() => {
      if (!live) return;
      const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
      return () => clearInterval(timer);
   }, [live, load]);

   const displayed = useMemo(
      () => (plans === null ? [] : applySearch(plans, query)),
      [plans, query]
   );

   const [selectedId, setSelectedId] = useQueryState('plan');
   const select = useCallback((id: string | null) => void setSelectedId(id), [setSelectedId]);
   const ids = useMemo(() => displayed.map((plan) => plan.id), [displayed]);
   useSelectFirst(selectedId, ids, select);
   const selected = selectedId !== null && ids.includes(selectedId) ? selectedId : null;

   const rail = (
      <>
         <Header />
         <div className="min-h-0 flex-1 overflow-y-auto">
            {failed && plans === null ? (
               <div className="px-4 py-10 text-muted-foreground" role="alert">
                  {t('list.failed')}
               </div>
            ) : plans === null ? (
               <EmptyStateLoading label={t('list.loading')} />
            ) : plans.length === 0 ? (
               <EmptyState icon={<EmptyStateMark label={t('empty.mark')} />}>
                  <EmptyStateTitle>
                     {scope === 'open' ? t('empty.title') : t('empty.titleAll')}
                  </EmptyStateTitle>
                  <EmptyStateText>{t('empty.body')}</EmptyStateText>
               </EmptyState>
            ) : displayed.length === 0 ? (
               <div className="flex h-40 items-center justify-center px-4 text-center text-muted-foreground">
                  {t('list.noneMatch')}
               </div>
            ) : (
               displayed.map((plan) => (
                  <PlanRow
                     key={plan.id}
                     plan={plan}
                     selected={plan.id === selected}
                     onSelect={select}
                  />
               ))
            )}
         </div>
      </>
   );

   return (
      <SplitIndex
         selected={selected !== null}
         rail={rail}
         detail={
            selected ? (
               <>
                  <button
                     type="button"
                     onClick={() => select(null)}
                     className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 text-muted-foreground md:hidden"
                  >
                     <ChevronLeft className="size-4" aria-hidden="true" />
                     {t('list.back')}
                  </button>
                  <div className="min-h-0 flex-1">
                     <PlanPreview key={selected} planId={selected} />
                  </div>
               </>
            ) : null
         }
      />
   );
}
