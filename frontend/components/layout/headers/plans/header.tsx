'use client';

import { Button } from '@/components/ui/button';
import { useCreatePlanStore } from '@/store/create-plan-store';
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageTitleBar } from '../page-title-bar';

/** Plans list header: the title and the way to ask for another plan. */
export default function Header() {
   const t = useTranslations('goals.plans.header');
   const openCreatePlan = useCreatePlanStore((state) => state.openModal);
   return (
      <PageTitleBar title={t('title')}>
         <Button size="xs" onClick={() => openCreatePlan()}>
            <Sparkles className="size-4" />
            New plan
         </Button>
      </PageTitleBar>
   );
}
