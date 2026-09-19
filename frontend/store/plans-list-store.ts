import { create } from 'zustand';

/**
 * What the plans list is currently showing.
 *
 * Held outside the table because the toolbar that sets it and the list that
 * reads it are mounted separately — the page gives one to `MainLayout` as a
 * header and the other as its body.
 */

/** Open plans still in play, or every plan including rejected and superseded. */
export type PlansScope = 'open' | 'all';

interface PlansListState {
   scope: PlansScope;
   query: string;
   /** Known counts per scope; null until that scope has been loaded. */
   counts: Record<PlansScope, number | null>;
   setScope: (scope: PlansScope) => void;
   setQuery: (query: string) => void;
   setCount: (scope: PlansScope, count: number) => void;
}

export const usePlansListStore = create<PlansListState>((set) => ({
   scope: 'open',
   query: '',
   counts: { open: null, all: null },
   setScope: (scope) => set({ scope }),
   setQuery: (query) => set({ query }),
   setCount: (scope, count) => set((state) => ({ counts: { ...state.counts, [scope]: count } })),
}));
