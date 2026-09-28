import { create } from 'zustand';

/**
 * Which run the task drawer's console shows, per task, and a request to bring
 * it into view. The transcript buttons on the task (the live chip in the
 * header, each run in the activity) point the console at their run rather
 * than opening a dialog over the task.
 */
interface RunConsoleState {
   /** The run a person picked, per task; absent means the console follows the live or latest run. */
   chosen: Record<string, string>;
   /** Bumped by `show`, so the console scrolls into view and opens even when the run was already chosen. */
   request: number;
   show: (issueId: string, runId: string) => void;
   follow: (issueId: string) => void;
}

export const useRunConsoleStore = create<RunConsoleState>((set) => ({
   chosen: {},
   request: 0,
   show: (issueId, runId) =>
      set((state) => ({
         chosen: { ...state.chosen, [issueId]: runId },
         request: state.request + 1,
      })),
   follow: (issueId) =>
      set((state) => ({
         chosen: Object.fromEntries(
            Object.entries(state.chosen).filter(([key]) => key !== issueId)
         ),
      })),
}));
