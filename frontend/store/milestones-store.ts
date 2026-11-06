import type { Milestone } from '@/lib/milestones';
import { create } from 'zustand';

interface GoalsState {
   milestones: Milestone[];
   error: string | null;
   /** True once the workspace list has been read, so an empty list means empty. */
   loaded: boolean;
   hydrateGoals: (milestones: Milestone[], error?: string | null) => void;
   /** Merges a fuller read (one with progress) over the list row. */
   upsertMilestone: (goal: Milestone) => void;
   removeMilestone: (milestoneId: string) => void;
   getMilestoneById: (milestoneId: string) => Milestone | undefined;
}

function sortGoals(milestones: Milestone[]): Milestone[] {
   return milestones.slice().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export const useMilestonesStore = create<GoalsState>((set, get) => ({
   milestones: [],
   error: null,
   loaded: false,
   hydrateGoals: (milestones, error = null) =>
      set((state) => {
         // A list row without progress must not wipe a fuller single read.
         const merged = milestones.map((goal) => {
            const known = state.milestones.find((candidate) => candidate.id === goal.id);
            return goal.progress || !known?.progress ? goal : { ...goal, progress: known.progress };
         });
         return { milestones: sortGoals(merged), error, loaded: true };
      }),
   // A goal already listed keeps its place: opening one refetches it, and the
   // detail read's timestamp is not the list's, so re-sorting here sent the
   // goal a person had just clicked to the bottom of the list. Only a goal
   // the list did not know is sorted in.
   upsertMilestone: (goal) =>
      set((state) => {
         const known = state.milestones.find((candidate) => candidate.id === goal.id);
         const merged =
            goal.progress || !known?.progress ? goal : { ...goal, progress: known.progress };
         if (known) {
            return {
               milestones: state.milestones.map((candidate) =>
                  candidate.id === goal.id ? merged : candidate
               ),
               error: null,
            };
         }
         return { milestones: sortGoals([...state.milestones, merged]), error: null };
      }),
   removeMilestone: (milestoneId) =>
      set((state) => ({ milestones: state.milestones.filter((goal) => goal.id !== milestoneId) })),
   getMilestoneById: (milestoneId) => get().milestones.find((goal) => goal.id === milestoneId),
}));
