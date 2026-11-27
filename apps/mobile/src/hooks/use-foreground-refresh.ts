import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { useInboxStore } from '@/store/inbox-store';
import { useIssuesStore } from '@/store/issues-store';
import { useWorkspaceStore } from '@/store/workspace-store';

export function useForegroundRefresh(): void {
  const status = useAuthStore((state) => state.status);
  const client = useAuthStore((state) => state.client);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const boards = useWorkspaceStore((state) => state.boards);
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');

  useEffect(() => {
    if (status !== 'signed_in' || !client || !workspaceId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current !== 'active';
      appStateRef.current = nextState;
      if (wasBackground && nextState === 'active') {
        void useInboxStore.getState().load(client, workspaceId, { silent: true });
        if (boards.length > 0) {
          const userId = useAuthStore.getState().user?.id ?? null;
          void useIssuesStore.getState().loadIssues(
            client,
            boards.map((b) => b.id),
            { silent: true, userId },
          );
        }
        void useChatStore.getState().loadConversations(client, { silent: true });
      }
    });

    return () => subscription.remove();
  }, [status, client, workspaceId, boards]);
}
