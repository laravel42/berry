import { create } from 'zustand';

/**
 * The catalogue list lives on a different route than an intercepted skill
 * drawer. A bump here is how a write in one refreshes the other. The ordered
 * ids are the rows the list is showing, so the detail header can step through
 * them the way the task header steps through the board.
 */
interface SkillsCatalogueState {
   revision: number;
   orderedIds: string[];
   bump: () => void;
   setOrderedIds: (ids: string[]) => void;
}

export const useSkillsCatalogueStore = create<SkillsCatalogueState>((set) => ({
   revision: 0,
   orderedIds: [],
   bump: () => set((state) => ({ revision: state.revision + 1 })),
   setOrderedIds: (orderedIds) => set({ orderedIds }),
}));
