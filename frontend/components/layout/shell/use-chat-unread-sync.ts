'use client';

import { useCallback, useEffect } from 'react';

import { listThreads } from '@/lib/chat';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';

/** A burst of events settles before the list is asked for again. */
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Keeps `chatUnread` in the shell store current.
 *
 * Mounted once by the shell. The rail's Chat row and the strip's chat button
 * both show the figure, and one subscription feeding a store beats two
 * components each asking the server for the same list. It follows the
 * workspace event stream, so a reply that lands while you are reading
 * something else shows up without a refresh.
 */
export function useChatUnreadSync(): void {
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const setChatUnread = useShellStore((state) => state.setChatUnread);

   const refresh = useCallback(() => {
      if (!workspaceId) return;
      void listThreads()
         .then((threads) => setChatUnread(threads.reduce((sum, thread) => sum + thread.unread, 0)))
         .catch(() => setChatUnread(0));
   }, [workspaceId, setChatUnread]);

   useEffect(refresh, [refresh]);

   useEffect(() => {
      if (!workspaceId) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unsubscribe = subscribeWorkspaceEvents((event) => {
         if (!/^(conversation|chat|message)\./.test(event.type)) return;
         if (timer) clearTimeout(timer);
         timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
      });
      return () => {
         if (timer) clearTimeout(timer);
         unsubscribe();
      };
   }, [workspaceId, refresh]);
}
