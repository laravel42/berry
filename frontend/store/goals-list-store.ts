import { create } from 'zustand';

/**
 * What the goals list is currently showing.
 *
 * Held outside the table because the toolbar that sets it and the list that
 * reads it are mounted separately — the page gives one to `MainLayout` as a
 * header and the other as its body.
 */

/** Open goals (not done yet), or every goal including completed. */
export type GoalsScope = 'open' | 'all';

interface GoalsListState {
   scope: GoalsScope;
   query: string;
   setScope: (scope: GoalsScope) => void;
   setQuery: (query: string) => void;
}

export const useGoalsListStore = create<GoalsListState>((set) => ({
   scope: 'open',
   query: '',
   setScope: (scope) => set({ scope }),
   setQuery: (query) => set({ query }),
}));
