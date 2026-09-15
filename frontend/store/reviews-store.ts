import type { ReviewItem } from '@/lib/reviews';
import { create } from 'zustand';

interface ReviewsState {
   /** Reviews waiting for a person, or null until the first load lands. */
   open: ReviewItem[] | null;
   setOpen: (items: ReviewItem[]) => void;
}

/**
 * The open review queue, shared so the rail can count it and a task page can
 * find its own review without either fetching the list again. Kept current by
 * `useOpenReviewsSync` (hooks/use-open-reviews-sync.ts), which is mounted with
 * the rest of the workspace hydration.
 */
export const useReviewsStore = create<ReviewsState>((set) => ({
   open: null,
   setOpen: (items) => set({ open: items }),
}));

/** How many reviews wait for a person; null before the first load. */
export function selectOpenReviewCount(state: ReviewsState): number | null {
   return state.open ? state.open.length : null;
}

/** The open review for a task, by the task's id or key (ELI-26). */
export function selectOpenReviewForIssue(
   state: ReviewsState,
   issueRef: string
): ReviewItem | undefined {
   return state.open?.find(
      (item) => item.issue.id === issueRef || item.issue.identifier === issueRef
   );
}
