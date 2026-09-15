'use client';

import { subscribeWorkspaceEvents } from '@/lib/events';
import { loadReviews } from '@/lib/reviews';
import { useReviewsStore } from '@/store/reviews-store';
import { useSessionStore } from '@/store/session-store';
import { useEffect } from 'react';

const REFRESH_DEBOUNCE_MS = 400;

/**
 * Keeps the open review queue current for the whole app.
 *
 * Loaded once the session is ready, then refreshed (debounced) whenever the
 * workspace stream reports a task, run or review change, since any of those
 * can move a task into or out of "In review". A failed refresh keeps the last
 * good list rather than blanking the badge.
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

      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!/^(issue|review|run)\./.test(event.type)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
      });

      return () => {
         cancelled = true;
         if (timer) clearTimeout(timer);
         unsubscribe();
      };
   }, [status, workspaceId, setOpen]);
}
