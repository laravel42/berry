import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ApiClientError } from '@/api/client';
import {
  classifyEventRefresh,
  streamEvents,
  type EventEnvelope,
  type EventStreamScope,
  type StreamFetchLike,
} from '@/api/events';
import { useAuthStore } from '@/store/auth-store';
import { useChatStore } from '@/store/chat-store';
import { useEventStreamStore } from '@/store/event-stream-store';
import { useInboxStore } from '@/store/inbox-store';
import { useIssuesStore } from '@/store/issues-store';
import { useWorkspaceStore } from '@/store/workspace-store';

const REFRESH_DEBOUNCE_MS = 350;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const SINCE_MARGIN_MS = 5_000;

const expoStreamFetch: StreamFetchLike = (input, init) =>
  expoFetch(input, {
    method: init?.method,
    headers: init?.headers,
    signal: init?.signal,
  });

function sinceCursor(): string {
  return new Date(Date.now() - SINCE_MARGIN_MS).toISOString();
}

export function useWorkspaceEventStream(): void {
  const status = useAuthStore((state) => state.status);
  const baseUrl = useAuthStore((state) => state.baseUrl);
  const token = useAuthStore((state) => state.token);
  const client = useAuthStore((state) => state.client);
  const workspaceId = useAuthStore((state) => state.currentWorkspaceId);
  const realtimeEnabled = useAuthStore((state) => state.capabilities?.realtime !== false);
  const defaultBoardId = useWorkspaceStore((state) => state.defaultBoardId);
  const boards = useWorkspaceStore((state) => state.boards);

  const [appActive, setAppActive] = useState(() => (AppState.currentState ?? 'active') === 'active');
  const appStateRef = useRef<string>(AppState.currentState ?? 'active');

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current !== 'active';
      appStateRef.current = nextState;
      const isNowActive = nextState === 'active';
      setAppActive(isNowActive);

      if (wasBackground && isNowActive) {
        const auth = useAuthStore.getState();
        const wsState = useWorkspaceStore.getState();
        if (auth.status === 'signed_in' && auth.client && auth.currentWorkspaceId) {
          void useInboxStore
            .getState()
            .load(auth.client, auth.currentWorkspaceId, { background: true });
          if (wsState.boards.length > 0) {
            void useIssuesStore.getState().loadIssues(
              auth.client,
              wsState.boards.map((b) => b.id),
              { background: true, userId: auth.user?.id ?? null },
            );
          }
          void useChatStore.getState().loadConversations(auth.client, { background: true });
          useEventStreamStore.getState().bumpProjectSync();
        }
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (
      status !== 'signed_in' ||
      !client ||
      !baseUrl ||
      !token ||
      !workspaceId ||
      !realtimeEnabled ||
      !appActive
    ) {
      return;
    }

    const scopes: EventStreamScope[] = [{ kind: 'workspace', id: workspaceId }];
    if (defaultBoardId) {
      scopes.push({ kind: 'board', id: defaultBoardId });
    }

    const controller = new AbortController();
    let cancelled = false;

    const pendingFlags = {
      inbox: false,
      issues: false,
      directory: false,
      conversations: false,
      projectDetail: false,
    };
    const pendingIssueIds = new Set<string>();
    const pendingChatIds = new Set<string>();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;

    const flushRefresh = () => {
      if (cancelled) return;
      const flags = { ...pendingFlags };
      pendingFlags.inbox = false;
      pendingFlags.issues = false;
      pendingFlags.directory = false;
      pendingFlags.conversations = false;
      pendingFlags.projectDetail = false;
      const issueIds = Array.from(pendingIssueIds);
      const chatIds = Array.from(pendingChatIds);
      pendingIssueIds.clear();
      pendingChatIds.clear();

      if (flags.inbox) {
        void useInboxStore.getState().load(client, workspaceId, { background: true });
      }
      if (flags.issues && boards.length > 0) {
        const userId = useAuthStore.getState().user?.id ?? null;
        void useIssuesStore.getState().loadIssues(
          client,
          boards.map((b) => b.id),
          { background: true, userId },
        );
      }
      if (issueIds.length > 0) {
        const detailsById = useIssuesStore.getState().detailsById;
        for (const issueId of issueIds) {
          const isCached = Object.entries(detailsById).some(
            ([key, bundle]) => key === issueId || bundle.issue?.id === issueId,
          );
          if (isCached) {
            void useIssuesStore
              .getState()
              .loadIssueDetail(client, workspaceId, issueId, { background: true });
          }
        }
      }
      if (flags.directory) {
        void useWorkspaceStore.getState().refreshDirectory(client, workspaceId);
      }
      if (flags.conversations || chatIds.length > 0) {
        const chatState = useChatStore.getState();
        void chatState.loadConversations(client, { background: true });
        if (chatIds.length > 0) {
          for (const cid of chatIds) {
            if (cid in chatState.messagesById) {
              void chatState.loadMessages(client, cid);
            }
          }
        } else {
          for (const cid of Object.keys(chatState.messagesById)) {
            void chatState.loadMessages(client, cid);
          }
        }
      }
      if (flags.projectDetail) {
        useEventStreamStore.getState().bumpProjectSync();
      }
    };

    const scheduleEvent = (event: EventEnvelope) => {
      const plan = classifyEventRefresh(event);
      if (plan.inbox) pendingFlags.inbox = true;
      if (plan.issues) pendingFlags.issues = true;
      if (plan.directory) pendingFlags.directory = true;
      if (plan.conversations) pendingFlags.conversations = true;
      if (plan.projectDetail) pendingFlags.projectDetail = true;
      if (plan.issueId) pendingIssueIds.add(plan.issueId);
      if (plan.conversationId) pendingChatIds.add(plan.conversationId);

      if (
        !pendingFlags.inbox &&
        !pendingFlags.issues &&
        !pendingFlags.directory &&
        !pendingFlags.conversations &&
        !pendingFlags.projectDetail &&
        pendingIssueIds.size === 0 &&
        pendingChatIds.size === 0
      ) {
        return;
      }

      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(flushRefresh, REFRESH_DEBOUNCE_MS);
    };

    const timers: ReturnType<typeof setTimeout>[] = [];

    const runScopeLoop = (scope: EventStreamScope) => {
      const scopeKey = `${scope.kind}:${scope.id}`;
      let since = sinceCursor();
      let reconnectDelay = RECONNECT_MIN_MS;

      const consume = async () => {
        if (cancelled) return;
        try {
          const after = useEventStreamStore.getState().lastEventByScope[scopeKey] ?? null;
          const events = streamEvents({
            baseUrl,
            token,
            scope,
            after,
            since: after ? null : since,
            signal: controller.signal,
            fetchImpl: expoStreamFetch,
            onOpen: () => {
              if (cancelled) return;
              reconnectDelay = RECONNECT_MIN_MS;
              useEventStreamStore.getState().setStreamConnected(scopeKey, true);
            },
          });

          for await (const event of events) {
            if (cancelled) return;
            reconnectDelay = RECONNECT_MIN_MS;
            useEventStreamStore.getState().setScopeCursor(scopeKey, event.id);
            scheduleEvent(event);
          }
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiClientError) {
            if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
              useEventStreamStore.getState().setStreamConnected(scopeKey, false);
              void useAuthStore.getState().logout({ reason: 'expired' });
              return;
            }
            if (error.code === 'CURSOR_EXPIRED' || error.code === 'INVALID_CURSOR') {
              useEventStreamStore.getState().clearScopeCursor(scopeKey);
              since = sinceCursor();
            }
          }
        }

        if (cancelled) return;
        useEventStreamStore.getState().setStreamConnected(scopeKey, false);
        since = sinceCursor();
        const timer = setTimeout(() => {
          if (!cancelled) void consume();
        }, reconnectDelay);
        timers.push(timer);
        reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      };

      void consume();
    };

    for (const scope of scopes) {
      runScopeLoop(scope);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const timer of timers) clearTimeout(timer);
      for (const scope of scopes) {
        useEventStreamStore.getState().setStreamConnected(`${scope.kind}:${scope.id}`, false);
      }
    };
  }, [status, baseUrl, token, client, workspaceId, defaultBoardId, boards, realtimeEnabled, appActive]);
}
