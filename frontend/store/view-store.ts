import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ViewType = 'list' | 'grid' | 'table';

/** Maps a stored or linked layout onto one that still exists. */
export function normalizeViewType(value: string | null | undefined): ViewType {
   if (value === 'swimlane') return 'grid';
   // `gantt` was a layout once; a saved view or an old link that names it gets the list.
   if (value === 'list' || value === 'grid' || value === 'table') return value;
   return 'list';
}

interface ViewState {
   viewType: ViewType;
   setViewType: (viewType: ViewType) => void;
}

export const useViewStore = create<ViewState>()(
   persist(
      (set) => ({
         viewType: 'list',
         setViewType: (viewType) => set({ viewType }),
      }),
      {
         name: 'view-storage',
         storage: createJSONStorage(() => localStorage),
         merge: (persisted, current) => {
            const raw = persisted as Partial<ViewState> | undefined;
            return {
               ...current,
               ...raw,
               viewType: normalizeViewType(raw?.viewType),
            };
         },
      }
   )
);
