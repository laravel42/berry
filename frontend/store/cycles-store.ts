import type { Cycle } from '@/lib/cycles';
import { create } from 'zustand';

interface CyclesState {
   cycles: Cycle[];
   error: string | null;
   loaded: boolean;
   hydrateCycles: (cycles: Cycle[], error?: string | null) => void;
   upsertCycle: (cycle: Cycle) => void;
   removeCycle: (cycleId: string) => void;
   getCycleById: (cycleId: string) => Cycle | undefined;
}

function sortCycles(cycles: Cycle[]): Cycle[] {
   return cycles.slice().sort((left, right) => {
      const byStart = right.startsOn.localeCompare(left.startsOn);
      if (byStart !== 0) return byStart;
      return right.number - left.number;
   });
}

export const useCyclesStore = create<CyclesState>((set, get) => ({
   cycles: [],
   error: null,
   loaded: false,
   hydrateCycles: (cycles, error = null) =>
      set((state) => {
         const merged = cycles.map((cycle) => {
            const known = state.cycles.find((candidate) => candidate.id === cycle.id);
            return cycle.progress || !known?.progress
               ? cycle
               : { ...cycle, progress: known.progress };
         });
         return { cycles: sortCycles(merged), error, loaded: true };
      }),
   upsertCycle: (cycle) =>
      set((state) => {
         const known = state.cycles.find((candidate) => candidate.id === cycle.id);
         const merged =
            cycle.progress || !known?.progress ? cycle : { ...cycle, progress: known.progress };
         if (known) {
            return {
               cycles: state.cycles.map((candidate) =>
                  candidate.id === cycle.id ? merged : candidate
               ),
               error: null,
            };
         }
         return { cycles: sortCycles([...state.cycles, merged]), error: null };
      }),
   removeCycle: (cycleId) =>
      set((state) => ({ cycles: state.cycles.filter((cycle) => cycle.id !== cycleId) })),
   getCycleById: (cycleId) => get().cycles.find((cycle) => cycle.id === cycleId),
}));
