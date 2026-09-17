import { create } from 'zustand';

interface EventStreamState {
   /** True while the workspace stream is open; pages poll only when it is not. */
   connected: boolean;
   /** The last event id received, sent back as `after` on reconnect. */
   lastEventId: string | null;
   scope: string | null;
   setScope: (scope: string) => void;
   setConnected: (connected: boolean) => void;
   setLastEventId: (id: string | null) => void;
}

export const useEventStreamStore = create<EventStreamState>((set) => ({
   connected: false,
   lastEventId: null,
   scope: null,
   setScope: (scope) =>
      set((state) => (state.scope === scope ? {} : { scope, lastEventId: null, connected: false })),
   setConnected: (connected) => set({ connected }),
   setLastEventId: (lastEventId) => set({ lastEventId }),
}));
