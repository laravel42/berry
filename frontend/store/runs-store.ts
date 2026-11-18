import type { RunRecord } from '@/lib/runs';
import { create } from 'zustand';

interface RunsState {
   runs: RunRecord[];
   /** False until the first fetch has answered, so an empty list is not mistaken for an empty workspace. */
   loaded: boolean;
   error: string | null;
   hydrateRuns: (runs: RunRecord[], error?: string | null) => void;
   upsertRun: (run: RunRecord) => void;
   removeRun: (runId: string) => void;
   getRunsByAgentId: (agentId: string) => RunRecord[];
}

function sortRuns(runs: RunRecord[]): RunRecord[] {
   return runs.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export const useRunsStore = create<RunsState>((set, get) => ({
   runs: [],
   error: null,
   loaded: false,
   hydrateRuns: (runs, error = null) => set({ runs: sortRuns(runs), error, loaded: true }),
   upsertRun: (run) =>
      set((state) => {
         const next = state.runs.filter((entry) => entry.id !== run.id);
         next.push(run);
         return { runs: sortRuns(next), error: null };
      }),
   removeRun: (runId) =>
      set((state) => ({
         runs: state.runs.filter((entry) => entry.id !== runId),
      })),
   getRunsByAgentId: (agentId) => get().runs.filter((run) => run.agentId === agentId),
}));
