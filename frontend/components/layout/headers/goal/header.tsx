'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { GoalActionsMenu } from '@/components/common/goals/goal-context-menu';
import { GoalStatusBadge } from '@/components/common/goals/goal-status-badge';
import { GOAL_STATUS, statusLook } from '@/lib/catalog';
import { WORKSPACE_SLUG } from '@/lib/config';
import { useGoalsStore } from '@/store/goals-store';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Goal header: goals › mark + title, and the status its tasks put it in.
 *
 * There are no status moves. A goal's state is read off its tasks, so the only
 * thing a person decides here is whether the grouping still belongs in the list.
 */
export default function Header({ goalId }: { goalId: string }) {
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const goal = useGoalsStore((state) => state.goals.find((candidate) => candidate.id === goalId));

   const look = goal ? statusLook(GOAL_STATUS, goal.status) : null;

   return (
      <div className="flex h-[52px] w-full items-center justify-between gap-4 border-b px-5 py-1.5">
         <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
            <Link
               href={`/${orgId}/goals`}
               className="text-muted-foreground transition-colors hover:text-foreground"
            >
               Goals
            </Link>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <BerryMark size="sm" tone={look?.tone ?? 'neutral'} state={look?.state ?? 'hollow'} />
            <span className="truncate font-medium">{goal?.title ?? 'Loading goal…'}</span>
         </nav>
         <div className="flex shrink-0 items-center gap-2">
            {goal && <GoalStatusBadge status={goal.status} className="hidden sm:inline-flex" />}
            <GoalActionsMenu goal={goal} />
         </div>
      </div>
   );
}
