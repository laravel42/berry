'use client';

import { useCreateMilestoneStore } from '@/store/create-milestone-store';
import { lazy, Suspense, useEffect, useState } from 'react';

const loadCreateGoalDialog = () =>
   import('./create-milestone-dialog').then((module) => ({ default: module.CreateGoalDialog }));
const CreateGoalDialog = lazy(loadCreateGoalDialog);

/**
 * Loads the new-goal dialog on first use, warms it in idle time after first
 * paint, and keeps it mounted once it has been shown.
 */
export function CreateGoalModalProvider() {
   const isOpen = useCreateMilestoneStore((state) => state.isOpen);
   const [wanted, setWanted] = useState(false);

   useEffect(() => {
      if (isOpen) setWanted(true);
   }, [isOpen]);

   useEffect(() => {
      const warm = () => void loadCreateGoalDialog().catch(() => undefined);
      if (typeof window.requestIdleCallback === 'function') {
         const handle = window.requestIdleCallback(warm);
         return () => window.cancelIdleCallback(handle);
      }
      const handle = window.setTimeout(warm, 2000);
      return () => window.clearTimeout(handle);
   }, []);

   if (!wanted && !isOpen) return null;
   return (
      <Suspense fallback={null}>
         <CreateGoalDialog />
      </Suspense>
   );
}
