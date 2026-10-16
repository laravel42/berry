'use client';

import { CreateGoalDialog } from './create-goal-dialog';

/** Keeps the new-goal dialog mounted beside the other create dialogs. */
export function CreateGoalModalProvider() {
   return <CreateGoalDialog />;
}
