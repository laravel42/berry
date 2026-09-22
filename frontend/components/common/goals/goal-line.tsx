'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { GOAL_STATUS, statusLook } from '@/lib/catalog';
import type { Goal } from '@/lib/goals';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/store/projects-store';
import { timeAgo } from '@/lib/time-ago';
import { GoalProgress } from './goal-progress';
import { GoalStatusBadge } from './goal-status-badge';

/** One goal in the rail. Selecting it opens the goal beside the list. */
export default function GoalLine({
   goal,
   selected,
   onSelect,
}: {
   goal: Goal;
   selected: boolean;
   onSelect: (goalId: string) => void;
}) {
   const look = statusLook(GOAL_STATUS, goal.status);
   const project = useProjectsStore((state) =>
      goal.projectId
         ? state.projects.find((candidate) => candidate.id === goal.projectId)
         : undefined
   );

   return (
      <button
         type="button"
         aria-current={selected ? 'true' : undefined}
         onClick={() => onSelect(goal.id)}
         className={cn(
            'flex w-full items-start gap-3 border-b border-muted-foreground/5 px-4 py-3 text-left outline-none last:border-b-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
            selected ? 'bg-accent' : 'hover:bg-sidebar/50'
         )}
      >
         <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/40">
            <BerryMark size="sm" tone={look.tone} state={look.state} label={look.label} />
         </span>
         <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-center gap-2">
               <GoalStatusBadge status={goal.status} />
               <span className="ml-auto shrink-0 text-muted-foreground">
                  {timeAgo(goal.updatedAt)}
               </span>
            </span>
            <span className="line-clamp-2 font-medium">{goal.title}</span>
            {project || goal.description ? (
               <span className="line-clamp-1 text-muted-foreground">
                  {project ? project.name : goal.description}
               </span>
            ) : null}
            <GoalProgress progress={goal.progress} compact />
         </span>
      </button>
   );
}
