import { create } from 'zustand';

/**
 * The catalogue list lives on a different route than an intercepted skill
 * drawer. A bump here is how a write in one refreshes the other.
 */
interface SkillsCatalogueState {
   revision: number;
   bump: () => void;
}

export const useSkillsCatalogueStore = create<SkillsCatalogueState>((set) => ({
   revision: 0,
   bump: () => set((state) => ({ revision: state.revision + 1 })),
}));
