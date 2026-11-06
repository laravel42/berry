'use client';

import { Progress } from '@/components/ui/progress';
import {
   describeMilestoneProgress,
   type MilestoneProgress as MilestoneProgressData,
} from '@/lib/milestones';
import { cn } from '@/lib/utils';

interface MilestoneProgressProps {
   progress: MilestoneProgressData | null | undefined;
   /** Bar only, for a list row. */
   compact?: boolean;
   className?: string;
}

/** Tasks done over tasks total, with the approvals beside it. */
export function MilestoneProgress({
   progress,
   compact = false,
   className,
}: MilestoneProgressProps) {
   const total = progress?.issuesTotal ?? 0;
   const percent = progress?.percent ?? 0;
   if (compact) {
      if (total === 0)
         return <span className={cn('tabular-nums text-muted-foreground', className)}>0%</span>;
      return (
         <span className={cn('inline-flex items-center gap-2', className)}>
            <Progress value={percent} className="h-1.5 w-20" aria-label={`${percent}% complete`} />
            <span className="tabular-nums text-muted-foreground">{percent}%</span>
         </span>
      );
   }
   if (total === 0) return null;
   return (
      <div className={className}>
         <div className="flex items-center justify-between gap-3">
            <span className="font-medium">{percent}%</span>
            <span className="text-muted-foreground">{describeMilestoneProgress(progress)}</span>
         </div>
         <Progress value={percent} className="mt-2 h-2" aria-label={`${percent}% complete`} />
      </div>
   );
}
