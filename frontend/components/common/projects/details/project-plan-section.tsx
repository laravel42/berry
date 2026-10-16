'use client';

import { PlanRowBody } from '@/components/common/plans/plans-list';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { listPlans, type PlanSummary } from '@/lib/plans';
import { useSessionStore } from '@/store/session-store';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DetailSectionLabel } from './detail-section-label';

/**
 * The plans this project carries, below its updates. Rejected and superseded
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
      <div className="mt-4 border-t border-border/60 pt-4">
         <DetailSectionLabel>{plans.length > 1 ? 'Plans' : 'Plan'}</DetailSectionLabel>
         <div className="flex flex-col gap-1.5">
            {plans.map((plan) => (
               <Link
                  key={plan.id}
                  href={`/${orgId}/plan/${plan.id}`}
                  className="flex items-start gap-3 rounded-sm border border-border/60 bg-container p-3.5 outline-none hover:bg-sidebar/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
               >
                  <PlanRowBody plan={plan} showProject={false} />
               </Link>
            ))}
         </div>
      </div>
   );
}
