import { create } from 'zustand';

import type { BerryClient } from '@/api/client';
import {
  applyInboxItemAction,
  bulkInboxAction,
  fetchInboxUnreadCount,
  listInbox,
  type InboxStateFilter,
} from '@/api/inbox';
import type { ApiInboxItem } from '@/api/types';
import { useToastStore } from '@/store/toast-store';

type NotifyFn = (message: string, tone?: 'verdant' | 'danger' | 'amber') => void;

export type InboxState = {
  items: ApiInboxItem[];
  unreadCount: number;
  view: InboxStateFilter;
  onlyNeeds: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasNextPage: boolean;
  endCursor: string | null;
  setView: (view: InboxStateFilter) => void;
  toggleOnlyNeeds: () => void;
  load: (client: BerryClient, workspaceId: string, options?: { silent?: boolean }) => Promise<void>;
  refreshUnread: (client: BerryClient, workspaceId: string) => Promise<void>;
  loadMore: (client: BerryClient, workspaceId: string) => Promise<void>;
  toggleRead: (client: BerryClient, workspaceId: string, itemId: string) => Promise<void>;
  setRead: (client: BerryClient, workspaceId: string, itemId: string, read: boolean) => Promise<void>;
  archive: (client: BerryClient, workspaceId: string, itemId: string) => Promise<void>;
  markAllRead: (client: BerryClient, workspaceId: string) => Promise<void>;
  reset: () => void;
};

export function createInboxStore(notify: NotifyFn = (m, t) => useToastStore.getState().showToast(m, t)) {
  let activeSeq = 0;

  return create<InboxState>((set, get) => ({
    items: [],
    unreadCount: 0,
    view: 'active',
    onlyNeeds: false,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    hasNextPage: false,
    endCursor: null,

    setView: (view) =>
      set((state) => ({
        view,
        onlyNeeds: view === 'archived' ? false : state.onlyNeeds,
      })),

    toggleOnlyNeeds: () => set((state) => ({ onlyNeeds: !state.onlyNeeds })),

    load: async (client, workspaceId, options) => {
      activeSeq += 1;
      const mySeq = activeSeq;
      const view = get().view;
      set(options?.silent ? { refreshing: true, error: null } : { loading: true, error: null });
      try {
        const [page, unreadCount] = await Promise.all([
          listInbox(client, { workspaceId, state: view }),
          fetchInboxUnreadCount(client, workspaceId),
        ]);
        if (mySeq !== activeSeq) return;
        set({
          items: page.nodes,
          unreadCount,
          hasNextPage: page.pageInfo.hasNextPage,
          endCursor: page.pageInfo.endCursor,
          loading: false,
          refreshing: false,
          error: null,
        });
      } catch (caught) {
        if (mySeq !== activeSeq) return;
        set({
          loading: false,
          refreshing: false,
          error: caught instanceof Error ? caught.message : 'Could not load inbox.',
        });
      }
    },

    refreshUnread: async (client, workspaceId) => {
      try {
        const unreadCount = await fetchInboxUnreadCount(client, workspaceId);
        set({ unreadCount });
      } catch {
        // Silent background badge refresh.
      }
    },

    loadMore: async (client, workspaceId) => {
      const { hasNextPage, endCursor, loadingMore, view } = get();
      if (!hasNextPage || !endCursor || loadingMore) return;
      set({ loadingMore: true });
      try {
        const page = await listInbox(client, { workspaceId, state: view, after: endCursor });
        set((state) => ({
          items: [...state.items, ...page.nodes],
          hasNextPage: page.pageInfo.hasNextPage,
          endCursor: page.pageInfo.endCursor,
          loadingMore: false,
        }));
      } catch (caught) {
        set({ loadingMore: false });
        notify(caught instanceof Error ? caught.message : 'Could not load more items.', 'danger');
      }
    },

    toggleRead: async (client, workspaceId, itemId) => {
      const current = get().items.find((entry) => entry.id === itemId);
      if (!current) return;
      await get().setRead(client, workspaceId, itemId, !current.read);
    },

    setRead: async (client, workspaceId, itemId, read) => {
      const snapshotItems = get().items;
      const snapshotUnread = get().unreadCount;
      const target = snapshotItems.find((entry) => entry.id === itemId);
      if (target && target.read === read) return;

      if (target) {
        const delta = target.archived ? 0 : read ? -1 : 1;
        set({
          items: snapshotItems.map((entry) => (entry.id === itemId ? { ...entry, read } : entry)),
          unreadCount: Math.max(0, snapshotUnread + delta),
        });
      }

      try {
        await applyInboxItemAction(client, itemId, read ? 'read' : 'unread', workspaceId);
        if (!read) {
          notify('Marked unread');
        }
      } catch (caught) {
        set({ items: snapshotItems, unreadCount: snapshotUnread });
        notify(caught instanceof Error ? caught.message : 'Could not update notification.', 'danger');
      }
    },

    archive: async (client, workspaceId, itemId) => {
      const snapshotItems = get().items;
      const snapshotUnread = get().unreadCount;
      const target = snapshotItems.find((entry) => entry.id === itemId);

      const archiving = target ? !target.archived : true;
      if (target) {
        const delta = !target.read ? (archiving ? -1 : 1) : 0;
        set({
          items: snapshotItems.filter((entry) => entry.id !== itemId),
          unreadCount: Math.max(0, snapshotUnread + delta),
        });
      }

      try {
        await applyInboxItemAction(client, itemId, archiving ? 'archive' : 'unarchive', workspaceId);
        notify(archiving ? 'Archived' : 'Moved back to inbox');
      } catch (caught) {
        set({ items: snapshotItems, unreadCount: snapshotUnread });
        notify(caught instanceof Error ? caught.message : 'Could not archive notification.', 'danger');
      }
    },

    markAllRead: async (client, workspaceId) => {
      const snapshotItems = get().items;
      const snapshotUnread = get().unreadCount;
      const unreadIds = snapshotItems.filter((entry) => !entry.archived && !entry.read).map((entry) => entry.id);
      if (unreadIds.length === 0) return;

      set({
        items: snapshotItems.map((entry) => ({ ...entry, read: true })),
        unreadCount: Math.max(0, snapshotUnread - unreadIds.length),
      });

      try {
        await bulkInboxAction(client, workspaceId, unreadIds, 'read');
        notify('Everything marked read');
      } catch (caught) {
        set({ items: snapshotItems, unreadCount: snapshotUnread });
        notify(caught instanceof Error ? caught.message : 'Could not mark notifications read.', 'danger');
      }
    },

    reset: () => {
      activeSeq += 1;
      set({
        items: [],
        unreadCount: 0,
        view: 'active',
        onlyNeeds: false,
        loading: false,
        refreshing: false,
        loadingMore: false,
        error: null,
        hasNextPage: false,
        endCursor: null,
      });
    },
  }));
}

export const useInboxStore = createInboxStore();
