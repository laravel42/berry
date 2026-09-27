'use client';

import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { canEditProduct } from '@/lib/workspace-role';
import { useCreatePlanStore } from '@/store/create-plan-store';
import { useSessionStore } from '@/store/session-store';

/**
 * The way out of an empty Plans or Goals page: both fill only from a plan,
 * so both offer to start one. Nothing for someone who cannot write.
 */
export function PlanWorkButton() {
   const t = useTranslations('goals.plans.empty');
   const openModal = useCreatePlanStore((state) => state.openModal);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   if (!canEdit) return null;
   return (
      <Button className="h-10 px-5" onClick={() => openModal()}>
         <Sparkles className="size-4" aria-hidden />
         {t('action')}
      </Button>
   );
}
