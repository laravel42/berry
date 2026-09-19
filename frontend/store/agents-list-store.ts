import type { FiltersState } from '@/components/data-table-filter/core/types';
import { create } from 'zustand';

/**
 * What the agents list is currently showing.
 *
 * Held outside the table because the toolbar that sets it and the table that
 * reads it are mounted separately — the page gives one to `MainLayout` as a
 * header and the other as its body, so they have no common parent to hold
 * this between them.
 */

/** Whose agents: every live one, or the archive. */
export type AgentsScope = 'all' | 'archived';

export type AgentsSortKey = 'activity' | 'name' | 'runs' | 'created';

export type AgentColumn = 'activity' | 'lastActive' | 'model' | 'access';

/** Every column the picker offers, in the order the table lays them out. */
export const AGENT_COLUMNS: AgentColumn[] = ['activity', 'lastActive', 'model', 'access'];

/** The columns a fresh workspace sees. */
const DEFAULT_COLUMNS: AgentColumn[] = ['activity', 'lastActive', 'model'];

interface AgentsListState {
   scope: AgentsScope;
   sortKey: AgentsSortKey;
   /** Descending is the useful default for activity and runs, not for a name. */
   sortDescending: boolean;
   /** The toolbar's filter chips (bazza/ui FiltersState). */
   filters: FiltersState;
   columns: AgentColumn[];
   /** Ids ticked for a bulk action. Cleared whenever the scope changes. */
   selected: string[];
   setScope: (scope: AgentsScope) => void;
   /** Clicking the column already sorted on flips the direction. */
   sortBy: (key: AgentsSortKey) => void;
   setFilters: React.Dispatch<React.SetStateAction<FiltersState>>;
   toggleColumn: (column: AgentColumn) => void;
   toggleSelected: (id: string) => void;
   setSelected: (ids: string[]) => void;
   clearSelection: () => void;
}

export const useAgentsListStore = create<AgentsListState>((set) => ({
   scope: 'all',
   sortKey: 'activity',
   sortDescending: true,
   filters: [],
   columns: DEFAULT_COLUMNS,
   selected: [],

   // A selection made in one scope means nothing in another: the rows it
   // referred to are not on screen to be unticked.
   setScope: (scope) => set({ scope, selected: [] }),

   sortBy: (key) =>
      set((state) =>
         state.sortKey === key
            ? { sortDescending: !state.sortDescending }
            : { sortKey: key, sortDescending: key !== 'name' }
      ),

   setFilters: (action) =>
      set((state) => ({
         filters: typeof action === 'function' ? action(state.filters) : action,
      })),

   toggleColumn: (column) =>
      set((state) => ({
         columns: state.columns.includes(column)
            ? state.columns.filter((entry) => entry !== column)
            : AGENT_COLUMNS.filter((entry) => entry === column || state.columns.includes(entry)),
      })),

   toggleSelected: (id) =>
      set((state) => ({
         selected: state.selected.includes(id)
            ? state.selected.filter((entry) => entry !== id)
            : [...state.selected, id],
      })),
   setSelected: (ids) => set({ selected: ids }),
   clearSelection: () => set({ selected: [] }),
}));

/** Read-only helper so callers do not repeat the scope comparison. */
export const isArchivedScope = (): boolean => useAgentsListStore.getState().scope === 'archived';
