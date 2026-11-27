import { create } from 'zustand';

import type { BerryClient } from '@/api/client';
import {
  createAgentConversation,
  listConversationMessages,
  listConversations,
  markConversationRead,
  openAgentConversation,
  sendConversationMessage,
} from '@/api/conversations';
import type { ApiConversation, ApiConversationMessage } from '@/api/types';
import { useToastStore } from '@/store/toast-store';

type NotifyFn = (message: string, tone?: 'verdant' | 'danger' | 'amber') => void;

export type ChatState = {
  conversations: ApiConversation[];
  messagesById: Record<string, ApiConversationMessage[]>;
  pendingRunByChat: Record<string, string | null>;
  loading: boolean;
  refreshing: boolean;
  sending: boolean;
  error: string | null;
  loadConversations: (
    client: BerryClient,
    options?: { silent?: boolean; background?: boolean },
  ) => Promise<void>;
  loadMessages: (client: BerryClient, conversationId: string) => Promise<void>;
  openWithAgent: (client: BerryClient, agentId: string) => Promise<string | null>;
  createWithAgent: (client: BerryClient, agentId: string, title?: string) => Promise<string | null>;
  sendMessage: (client: BerryClient, conversationId: string, body: string) => Promise<boolean>;
  markRead: (client: BerryClient, conversationId: string) => Promise<void>;
  reset: () => void;
};

export function createChatStore(notify: NotifyFn = (m, t) => useToastStore.getState().showToast(m, t)) {
  return create<ChatState>((set, get) => ({
    conversations: [],
    messagesById: {},
    pendingRunByChat: {},
    loading: false,
    refreshing: false,
    sending: false,
    error: null,

    loadConversations: async (client, options) => {
      if (!options?.background) {
        set(options?.silent ? { refreshing: true, error: null } : { loading: true, error: null });
      }
      try {
        const conversations = await listConversations(client);
        set({ conversations, loading: false, refreshing: false, error: null });
      } catch (caught) {
        if (options?.background) return;
        set({
          loading: false,
          refreshing: false,
          error: caught instanceof Error ? caught.message : 'Could not load conversations.',
        });
      }
    },

    loadMessages: async (client, conversationId) => {
      try {
        const messages = await listConversationMessages(client, conversationId);
        const pendingRunId = get().pendingRunByChat[conversationId];
        const replyArrived =
          Boolean(pendingRunId) &&
          messages.some((msg) => msg.authorType === 'agent' && msg.runId === pendingRunId);
        set((state) => ({
          messagesById: { ...state.messagesById, [conversationId]: messages },
          pendingRunByChat: replyArrived
            ? { ...state.pendingRunByChat, [conversationId]: null }
            : state.pendingRunByChat,
        }));
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : 'Could not load messages.', 'danger');
      }
    },

    openWithAgent: async (client, agentId) => {
      try {
        const id = await openAgentConversation(client, agentId);
        await get().loadConversations(client, { silent: true });
        return id;
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : 'Could not open conversation.', 'danger');
        return null;
      }
    },

    createWithAgent: async (client, agentId, title) => {
      try {
        const id = await createAgentConversation(client, agentId, title);
        await get().loadConversations(client, { silent: true });
        return id;
      } catch (caught) {
        notify(caught instanceof Error ? caught.message : 'Could not create conversation.', 'danger');
        return null;
      }
    },

    sendMessage: async (client, conversationId, body) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      set({ sending: true });
      try {
        const sent = await sendConversationMessage(client, conversationId, trimmed);
        set((state) => ({
          sending: false,
          pendingRunByChat: { ...state.pendingRunByChat, [conversationId]: sent.runId },
        }));
        await get().loadMessages(client, conversationId);
        return true;
      } catch (caught) {
        set({ sending: false });
        notify(caught instanceof Error ? caught.message : 'Could not send message.', 'danger');
        // Refresh messages because Berry persists the user's message even when 503 AGENT_TASKS_UNAVAILABLE.
        await get().loadMessages(client, conversationId).catch(() => undefined);
        return false;
      }
    },

    markRead: async (client, conversationId) => {
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === conversationId ? { ...c, unread: 0 } : c,
        ),
      }));
      try {
        await markConversationRead(client, conversationId);
      } catch {
        // Non-fatal read receipt update.
      }
    },

    reset: () =>
      set({
        conversations: [],
        messagesById: {},
        pendingRunByChat: {},
        loading: false,
        refreshing: false,
        sending: false,
        error: null,
      }),
  }));
}

export const useChatStore = createChatStore();

export function chatUnreadTotal(conversations: ApiConversation[]): number {
  return conversations.reduce((total, c) => total + (c.unread > 0 ? 1 : 0), 0);
}
