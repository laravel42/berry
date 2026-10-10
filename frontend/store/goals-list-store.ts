import { create } from 'zustand';

/**
 * What the goals list is currently showing.
 *
 * Held outside the table because the toolbar that sets it and the list that
 * reads it are mounted separately — the page gives one to `MainLayout` as a
 * header and the other as its body.
 */

interface GoalsListState {
   query: string;
   setQuery: (query: string) => void;
}

export const useGoalsListStore = create<GoalsListState>((set) => ({
   query: '',
   setQuery: (query) => set({ query }),
}));
