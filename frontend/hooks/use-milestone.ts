'use client';

import { describeMilestoneFailure, getMilestone, type Milestone } from '@/lib/milestones';
import { payloadEntityId, subscribeWorkspaceEvents } from '@/lib/events';
import { useMilestonesStore } from '@/store/milestones-store';
import { useSessionStore } from '@/store/session-store';
import { useEffect, useState } from 'react';

interface GoalView {
   goal: Milestone | undefined;
   error: string | null;
   loading: boolean;
}

/**
 * One goal with its progress. The page always reads the record itself, and
 * reads it again when a task, approval or the goal changes — the counts are
 * what a person came here for.
 */
export function useMilestone(milestoneId: string): GoalView {
   const status = useSessionStore((state) => state.status);
   const goal = useMilestonesStore((state) =>
      state.milestones.find((candidate) => candidate.id === milestoneId)
   );
   const upsertMilestone = useMilestonesStore((state) => state.upsertMilestone);
   const [error, setError] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);

   useEffect(() => {
      if (status !== 'ready' || !milestoneId) return;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const read = (quiet: boolean) => {
         if (!quiet) setLoading(true);
         void getMilestone(milestoneId, controller.signal)
            .then((fetched) => {
               upsertMilestone(fetched);
               setError(null);
            })
            .catch((failure: unknown) => {
               if (controller.signal.aborted) return;
               if (!quiet) setError(describeMilestoneFailure(failure));
            })
            .finally(() => {
               if (!controller.signal.aborted && !quiet) setLoading(false);
            });
      };
      read(false);
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         const type = event.type;
         const relevant =
            ((type.startsWith('milestone.') || type.startsWith('goal.')) &&
               (event.milestoneId ??
                  payloadEntityId(event, 'milestone') ??
                  payloadEntityId(event, 'goal')) === milestoneId) ||
            type.startsWith('issue.') ||
            type.startsWith('approval.') ||
            type.startsWith('workflow.') ||
            type.startsWith('plan.');
         if (!relevant) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(() => read(true), 400);
      });
      return () => {
         unsubscribe();
         controller.abort();
         if (timer) clearTimeout(timer);
      };
   }, [status, milestoneId, upsertMilestone]);

   return { goal, error, loading: loading && !goal };
}
