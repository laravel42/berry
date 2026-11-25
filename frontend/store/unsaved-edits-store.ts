import { useEffect } from 'react';
import { create } from 'zustand';

/**
 * Edits on the open task that would be lost by moving to another one.
 *
 * Each editor reports under its own key while it holds changes; the task
 * header asks before its previous / next arrows leave them behind. Not
 * persisted: it describes what is on screen now. Title and description save on
 * blur, and comment drafts are kept per task, so neither reports here.
 */

interface UnsavedEditsState {
   sources: Record<string, true>;
   mark: (key: string, unsaved: boolean) => void;
   clear: () => void;
}

export const useUnsavedEditsStore = create<UnsavedEditsState>()((set) => ({
   sources: {},
   mark: (key, unsaved) =>
      set((state) => {
         if (unsaved === Boolean(state.sources[key])) return state;
         const sources = { ...state.sources };
         if (unsaved) sources[key] = true;
         else delete sources[key];
         return { sources };
      }),
   clear: () => set({ sources: {} }),
}));

/** True while any editor on the task holds changes. */
export function hasUnsavedEdits(): boolean {
   return Object.keys(useUnsavedEditsStore.getState().sources).length > 0;
}

/** Report `unsaved` under `key`, and withdraw it when the editor goes away. */
export function useReportUnsavedEdits(key: string, unsaved: boolean) {
   const mark = useUnsavedEditsStore((state) => state.mark);
   useEffect(() => {
      mark(key, unsaved);
   }, [key, unsaved, mark]);
   useEffect(() => () => mark(key, false), [key, mark]);
}
