'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useCreateProjectStore } from '@/store/create-project-store';

export function CreateProjectButton() {
   const openModal = useCreateProjectStore((state) => state.openModal);

   return (
      <Button className="relative" size="xs" aria-label="New project" onClick={() => openModal()}>
         <Plus className="size-4" />
         <span className="ml-1 hidden sm:inline">New project</span>
      </Button>
   );
}
