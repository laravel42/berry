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
import { WORKSPACE_SLUG } from '@/lib/config';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { listPlans, type PlanSummary } from '@/lib/plans';
import { timeAgo } from '@/lib/time-ago';
import { usePlansListStore } from '@/store/plans-list-store';
import { useSessionStore } from '@/store/session-store';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

function PlanRow({ plan, orgId }: { plan: PlanSummary; orgId: string }) {
   const t = useTranslations('goals.plans');
   const look = planSummaryLook(plan);
   const started = plan.createdTasks > 0;
   const percent = started ? Math.round((plan.finishedTasks / plan.createdTasks) * 100) : 0;
   return (
      <Link
         href={`/${orgId}/plan/${plan.id}`}
         className="flex w-full items-center border-b border-muted-foreground/5 px-6 py-3 last:border-b-0 hover:bg-sidebar/50"
      >
         <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/40">
               <BerryMark
                  size="sm"
                  tone={look.tone}
                  state={look.state}
                  pulse={look.pulse}
                  label={look.label}
               />
            </span>
            <div className="min-w-0 overflow-hidden">
               <span className="block truncate font-medium leading-none">{plan.title}</span>
               <p className="mt-0.5 line-clamp-1 text-muted-foreground">
                  {plan.projectName ?? t('list.noProject')}
               </p>
            </div>
         </div>

         <div className="w-32 shrink-0">
            <StatusBadge look={look} />
         </div>

         <div className="hidden w-40 shrink-0 sm:block">
            {started ? (
               <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground">
                     {t('tasks', { finished: plan.finishedTasks, created: plan.createdTasks })}
                  </span>
                  <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
                     <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${percent}%` }}
                     />
                  </span>
               </div>
            ) : (
               <span className="text-muted-foreground">
                  {plan.plannedTasks > 0 ? t('planned', { count: plan.plannedTasks }) : '—'}
               </span>
            )}
         </div>

         <div className="hidden w-36 shrink-0 text-muted-foreground md:block">
            {timeAgo(plan.updatedAt)}
         </div>
      </Link>
   );
}

/**
 * Every plan in the workspace that is still in play: generating, waiting on
 * answers or an approval, or started and working through its tasks. `All`
 * adds the rejected and superseded ones. A row opens the plan itself.
 */
export default function PlansList() {
   const t = useTranslations('goals.plans');
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
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

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         {failed && plans === null ? (
            <div className="px-6 py-10 text-muted-foreground" role="alert">
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
         ) : (
            <>
               <div className="sticky top-0 z-10 flex items-center border-b bg-container px-4 py-[6px] text-muted-foreground">
                  <div className="min-w-0 flex-1">{t('list.plan')}</div>
                  <div className="w-32 shrink-0">{t('list.status')}</div>
                  <div className="hidden w-40 shrink-0 sm:block">{t('list.tasks')}</div>
                  <div className="hidden w-36 shrink-0 md:block">{t('list.updated')}</div>
               </div>
               {displayed.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-muted-foreground">
                     {t('list.noneMatch')}
                  </div>
               ) : (
                  displayed.map((plan) => <PlanRow key={plan.id} plan={plan} orgId={orgId} />)
               )}
            </>
         )}
      </div>
   );
}
