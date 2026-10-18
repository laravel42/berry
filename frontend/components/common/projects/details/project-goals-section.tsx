'use client';

import { GoalStatusBadge } from '@/components/common/goals/goal-status-badge';
import { GoalProgress } from '@/components/common/goals/goal-progress';
import { Button } from '@/components/ui/button';
import { canEditProduct } from '@/lib/workspace-role';
import { useCreateGoalStore } from '@/store/create-goal-store';
import { useGoalsStore } from '@/store/goals-store';
import { useSessionStore } from '@/store/session-store';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { DetailSectionLabel } from './detail-section-label';

/**
 * The goals this project carries, below its plan. Always drawn so a project
 * with none still offers New goal — unlike plans, which hide when empty.
 */
export function ProjectGoalsSection({ projectId }: { projectId: string }) {
   const { orgId } = useParams<{ orgId: string }>();
   const role = useSessionStore((state) => state.workspace?.role);
   const goals = useGoalsStore((state) => state.goals);
   const canEdit = canEditProduct(role);
   const openModal = useCreateGoalStore((state) => state.openModal);

   const listed = useMemo(
      () => goals.filter((goal) => goal.projectId === projectId),
      [goals, projectId]
   );

   return (
      <div className="mt-4 border-t border-border/60 pt-4">
         <div className="mb-1 flex items-center justify-between gap-2">
            <DetailSectionLabel className="mb-0 pb-[7px]">Goals</DetailSectionLabel>
            {canEdit ? (
               <Button
                  type="button"
                  variant="ghost"
                  size="xxs"
                  className="-mt-1 text-muted-foreground hover:bg-card hover:text-foreground"
                  onClick={() => openModal({ projectId, lockProject: true })}
               >
                  <Plus className="size-3.5" />
                  New goal
               </Button>
            ) : null}
         </div>
         {listed.length === 0 ? (
            <p className="text-muted-foreground">No goals in this project yet.</p>
         ) : (
            <div className="flex flex-col gap-1.5">
               {listed.map((goal) => (
                  <Link
                     key={goal.id}
                     href={`/${orgId}/goal/${goal.id}`}
                     className="flex items-center gap-2 rounded-sm border border-border/60 bg-card p-1 outline-none hover:bg-sidebar/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                     <GoalStatusBadge status={goal.status} />
                     <span className="min-w-0 truncate">{goal.title}</span>
                     <GoalProgress progress={goal.progress} compact className="ml-auto shrink-0" />
                  </Link>
               ))}
            </div>
         )}
      </div>
   );
}
