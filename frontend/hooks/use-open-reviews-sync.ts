'use client';

import { subscribeWorkspaceEvents } from '@/lib/events';
import { loadReviews } from '@/lib/reviews';
import { useIssuesStore } from '@/store/issues-store';
import { useReviewsStore } from '@/store/reviews-store';
import { useSessionStore } from '@/store/session-store';
import { useEffect } from 'react';

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Keeps the open review queue current for the whole app.
 *
 * Loaded once the session is ready, then refreshed (debounced) on two signals.
 * The workspace stream, which says when a task is created, completed or
 * deleted. And the task list itself: a task moving into or out of "In review"
 * is an `issue.updated` on the board stream, which the workspace stream does
 * not carry, so listening there alone left the badge stale until a reload. The
 * board stream already keeps the task list fresh, so the set of tasks in
 * review is watched there rather than opening a second connection.
 *
 * A failed refresh keeps the last good list rather than blanking the badge.
 */
export function useOpenReviewsSync(): void {
   const status = useSessionStore((state) => state.status);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const setOpen = useReviewsStore((state) => state.setOpen);

   useEffect(() => {
      if (status !== 'ready' || !workspaceId) return;
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const refresh = () => {
         void loadReviews(workspaceId, 'open')
            .then((items) => {
               if (!cancelled) setOpen(items);
            })
            .catch(() => {
               /* Keep the last good list; the next event tries again. */
            });
      };
      refresh();

      const schedule = () => {
         if (timer) clearTimeout(timer);
         timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
      };

      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (/^(issue|review|run)\./.test(event.type)) schedule();
      });

      // Which tasks are in review, as one comparable value: the queue is asked
      // for again only when that set changes, not on every refresh of the list.
      const inReview = (issues: ReturnType<typeof useIssuesStore.getState>['issues']): string =>
         issues
            .filter((issue) => issue.status.id === 'in-review')
            .map((issue) => issue.id)
            .sort()
            .join(',');
      let seen = inReview(useIssuesStore.getState().issues);
      const unwatch = useIssuesStore.subscribe((state) => {
         const now = inReview(state.issues);
         if (now === seen) return;
         seen = now;
         schedule();
      });

      return () => {
         cancelled = true;
         if (timer) clearTimeout(timer);
         unsubscribe();
         unwatch();
      };
   }, [status, workspaceId, setOpen]);
}
