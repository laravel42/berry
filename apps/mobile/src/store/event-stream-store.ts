import { create } from 'zustand';

type EventStreamState = {
  connectedScopes: Record<string, boolean>;
  connected: boolean;
  lastEventByScope: Record<string, string>;
  projectSyncSeq: number;
  setStreamConnected: (scopeKey: string, connected: boolean) => void;
  setScopeCursor: (scopeKey: string, eventId: string) => void;
  clearScopeCursor: (scopeKey: string) => void;
  bumpProjectSync: () => void;
  reset: () => void;
};

export const useEventStreamStore = create<EventStreamState>((set) => ({
  connectedScopes: {},
  connected: false,
  lastEventByScope: {},
  projectSyncSeq: 0,

  setStreamConnected: (scopeKey, isConnected) =>
    set((state) => {
      const next = { ...state.connectedScopes, [scopeKey]: isConnected };
      return {
        connectedScopes: next,
        connected: Object.values(next).some(Boolean),
      };
    }),

  setScopeCursor: (scopeKey, eventId) =>
    set((state) => ({
      lastEventByScope: { ...state.lastEventByScope, [scopeKey]: eventId },
    })),

  clearScopeCursor: (scopeKey) =>
    set((state) => {
      const next = { ...state.lastEventByScope };
      delete next[scopeKey];
      return { lastEventByScope: next };
    }),

  bumpProjectSync: () => set((state) => ({ projectSyncSeq: state.projectSyncSeq + 1 })),

  reset: () =>
    set({
      connectedScopes: {},
      connected: false,
      lastEventByScope: {},
      projectSyncSeq: 0,
    }),
}));
