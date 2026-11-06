'use client';

import { CreateGoalDialog } from './create-milestone-dialog';

/** Keeps the new-goal dialog mounted beside the other create dialogs. */
export function CreateGoalModalProvider() {
   return <CreateGoalDialog />;
}
