'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCreateProjectStore } from '@/store/create-project-store';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function CreateProjectButton({ className }: { className?: string }) {
   const t = useTranslations('navigation.palette');
   const openModal = useCreateProjectStore((state) => state.openModal);

   return (
      <Button className={cn('shrink-0', className)} onClick={() => openModal()}>
         <Plus className="size-4" aria-hidden />
         {t('newProject')}
      </Button>
   );
}
