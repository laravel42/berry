'use client';

import { planSummaryLook } from '@/components/common/plans/plan-status-badge';
import { StatusBadge } from '@/components/common/status-badge';
import { Progress } from '@/components/ui/progress';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { listPlans, type PlanSummary } from '@/lib/plans';
import { useSessionStore } from '@/store/session-store';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DetailSectionLabel } from './detail-section-label';

/** The same compact progress a goal row shows: a short bar and done/total. */
function PlanCardProgress({ plan }: { plan: PlanSummary }) {
   const t = useTranslations('goals.plans');
   if (plan.createdTasks > 0) {
      const percent = Math.round((plan.finishedTasks / plan.createdTasks) * 100);
      return (
         <span className="ml-auto inline-flex shrink-0 items-center gap-2">
            <Progress
               value={percent}
               className="h-1.5 w-20"
               aria-label={`${percent}% of tasks done`}
            />
            <span className="tabular-nums text-muted-foreground">
               {plan.finishedTasks}/{plan.createdTasks}
            </span>
         </span>
      );
   }
   if (plan.plannedTasks > 0) {
      return (
         <span className="ml-auto shrink-0 text-muted-foreground">
            {t('planned', { count: plan.plannedTasks })}
         </span>
      );
   }
   return null;
}

/**
 * The plans this project carries, above its goals. Rejected and superseded
 * plans are history and stay on the Plans page; with none left the section
 * is not drawn at all.
 */
export function ProjectPlanSection({ projectId }: { projectId: string }) {
   const { orgId } = useParams<{ orgId: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? null);
   const [plans, setPlans] = useState<PlanSummary[]>([]);

   const load = useCallback(async () => {
      if (!workspaceId) return;
      const all = await listPlans(workspaceId, 'all').catch(() => null);
      if (!all) return;
      setPlans(
         all.filter(
            (plan) =>
               plan.projectId === projectId &&
               !plan.archived &&
               plan.status !== 'rejected' &&
               plan.status !== 'superseded'
         )
      );
   }, [workspaceId, projectId]);

   useEffect(() => {
      void load();
   }, [load]);

   // A plan's progress moves with its tasks, so task events refresh it too.
   useEffect(
      () =>
         subscribeWorkspaceEvents((event) => {
            if (event.type.startsWith('plan.') || event.type.startsWith('issue.')) {
               void load();
            }
         }),
      [load]
   );

   if (plans.length === 0) return null;

   return (
      <div className="border-t border-border/60 pt-4">
         <DetailSectionLabel>{plans.length > 1 ? 'Plans' : 'Plan'}</DetailSectionLabel>
         <div className="flex flex-col gap-1.5">
            {plans.map((plan) => (
               <Link
                  key={plan.id}
                  href={`/${orgId}/plan/${plan.id}`}
                  className="flex items-center gap-2 rounded-sm border border-border/60 bg-card p-1 outline-none hover:bg-sidebar/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
               >
                  <StatusBadge look={planSummaryLook(plan)} />
                  <span className="min-w-0 truncate">{plan.title}</span>
                  <PlanCardProgress plan={plan} />
               </Link>
            ))}
         </div>
      </div>
   );
}
