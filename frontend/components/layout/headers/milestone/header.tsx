'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { GoalActionsMenu } from '@/components/common/milestones/milestone-context-menu';
import { MilestoneStatusBadge } from '@/components/common/milestones/milestone-status-badge';
import { GOAL_STATUS, statusLook } from '@/lib/catalog';
import { WORKSPACE_SLUG } from '@/lib/config';
import { useMilestonesStore } from '@/store/milestones-store';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Milestone header: milestones › mark + title, and the status its tasks put it in.
 *
 * There are no status moves. A goal's state is read off its tasks, so the only
 * thing a person decides here is whether the grouping still belongs in the list.
 */
export default function Header({ milestoneId }: { milestoneId: string }) {
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const goal = useMilestonesStore((state) =>
      state.milestones.find((candidate) => candidate.id === milestoneId)
   );

   const look = goal ? statusLook(GOAL_STATUS, goal.status) : null;

   return (
      <div className="flex h-[52px] w-full items-center justify-between gap-4 border-b px-5 py-1.5">
         <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
            <Link
               href={`/${orgId}/milestones`}
               className="text-muted-foreground transition-colors hover:text-foreground"
            >
               Milestones
            </Link>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <BerryMark size="sm" tone={look?.tone ?? 'neutral'} state={look?.state ?? 'hollow'} />
            <span className="truncate font-medium">{goal?.title ?? 'Loading milestone…'}</span>
         </nav>
         <div className="flex shrink-0 items-center gap-2">
            {goal && (
               <MilestoneStatusBadge status={goal.status} className="hidden sm:inline-flex" />
            )}
            <GoalActionsMenu goal={goal} />
         </div>
      </div>
   );
}
