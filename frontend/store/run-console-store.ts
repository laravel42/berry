import { create } from 'zustand';

/**
 * Which run the task drawer's console shows, per task, and a request to bring
 * it into view. Agent work stays in the console; AutoGate reviews open their
 * transcript from the activity, not from here.
 */
interface RunConsoleState {
   /** The run a person picked, per task; absent means the console follows the live or latest run. */
   chosen: Record<string, string>;
   /** Bumped by `show`, so the console scrolls into view and opens even when the run was already chosen. */
   request: number;
   /** The task whose console is covering the page, so its header can step aside. */
   openIssueId: string | null;
   show: (issueId: string, runId: string) => void;
   follow: (issueId: string) => void;
   setOpenIssueId: (issueId: string | null) => void;
}

export const useRunConsoleStore = create<RunConsoleState>((set) => ({
   chosen: {},
   request: 0,
   openIssueId: null,
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
   setOpenIssueId: (issueId) => set({ openIssueId: issueId }),
}));
