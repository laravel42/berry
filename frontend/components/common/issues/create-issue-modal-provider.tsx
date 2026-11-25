'use client';

import { useCreateIssueStore } from '@/store/create-issue-store';
import { lazy, Suspense, useEffect, useState } from 'react';

const loadCreateNewIssue = () =>
   import('@/components/layout/sidebar/create-new-issue').then((module) => ({
      default: module.CreateNewIssue,
   }));
const CreateNewIssue = lazy(loadCreateNewIssue);

/**
 * The create-task dialog is downloaded the first time it is wanted, and
 * warmed in idle time after first paint so opening it is still immediate.
 * Once mounted it stays mounted.
 */
export function CreateIssueModalProvider() {
   const isOpen = useCreateIssueStore((state) => state.isOpen);
   const [wanted, setWanted] = useState(false);

   useEffect(() => {
      if (isOpen) setWanted(true);
   }, [isOpen]);

   useEffect(() => {
      const warm = () => void loadCreateNewIssue().catch(() => undefined);
      if (typeof window.requestIdleCallback === 'function') {
         const handle = window.requestIdleCallback(warm);
         return () => window.cancelIdleCallback(handle);
      }
      const handle = window.setTimeout(warm, 2000);
      return () => window.clearTimeout(handle);
   }, []);

   if (!wanted && !isOpen) return null;
   return (
      <div className="hidden">
         <Suspense fallback={null}>
            <CreateNewIssue />
         </Suspense>
      </div>
   );
}
