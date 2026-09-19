'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCreateProjectStore } from '@/store/create-project-store';
import { Plus } from 'lucide-react';

export function CreateProjectButton({ className }: { className?: string }) {
   const openModal = useCreateProjectStore((state) => state.openModal);

   return (
      <Button
         className={cn('h-[34px] w-[42px] shrink-0 px-0', className)}
         size="xs"
         aria-label="New project"
         title="New project"
         onClick={() => openModal()}
      >
         <Plus className="size-4" />
      </Button>
   );
}
