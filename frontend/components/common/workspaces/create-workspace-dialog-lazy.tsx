'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { useCreateWorkspaceStore } from '@/store/create-workspace-store';

const DynamicCreateWorkspaceDialog = dynamic(
   () =>
      import('@/components/common/workspaces/create-workspace-dialog').then(
         (m) => m.CreateWorkspaceDialog
      ),
   { ssr: false }
);

/**
 * The create-workspace dialog, fetched the first time the store opens it and
 * kept mounted afterwards so Radix can play its close animation.
 */
export function CreateWorkspaceDialogLazy() {
   const isOpen = useCreateWorkspaceStore((state) => state.isOpen);
   const [wanted, setWanted] = useState(false);

   useEffect(() => {
      if (isOpen) setWanted(true);
   }, [isOpen]);

   return wanted ? <DynamicCreateWorkspaceDialog /> : null;
}
