import type { View } from '@/data/views';
import { create } from 'zustand';

interface ViewsState {
   views: View[];
   /** False until the first fetch has answered, so an empty list is not mistaken for an empty workspace. */
   loaded: boolean;
   hydrateViews: (views: View[]) => void;
   getViewById: (id: string) => View | undefined;
}

export const useViewsStore = create<ViewsState>((set, get) => ({
   views: [],
   loaded: false,

   hydrateViews: (views) => set({ views, loaded: true }),

   getViewById: (id) => get().views.find((view) => view.id === id),
}));
