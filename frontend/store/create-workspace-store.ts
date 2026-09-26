import { create } from 'zustand';

/** Whether the create-workspace dialog is open; the workspace menu opens it. */
interface CreateWorkspaceState {
   isOpen: boolean;
   openModal: () => void;
   closeModal: () => void;
}

export const useCreateWorkspaceStore = create<CreateWorkspaceState>((set) => ({
   isOpen: false,
   openModal: () => set({ isOpen: true }),
   closeModal: () => set({ isOpen: false }),
}));
