import { create } from 'zustand';

/** What a caller can pre-fill when opening the new-goal dialog. */
export interface CreateGoalPrefill {
   projectId?: string;
   /** The project is the one on the page; the dialog does not offer another. */
   lockProject?: boolean;
}

interface CreateGoalState {
   isOpen: boolean;
   prefill: CreateGoalPrefill;
   openModal: (prefill?: CreateGoalPrefill) => void;
   closeModal: () => void;
}

export const useCreateGoalStore = create<CreateGoalState>((set) => ({
   isOpen: false,
   prefill: {},
   openModal: (prefill = {}) => set({ isOpen: true, prefill }),
   closeModal: () => set({ isOpen: false }),
}));
