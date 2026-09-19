'use client';

import {
   EmptyState,
   EmptyStateActions,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useCreateProjectStore } from '@/store/create-project-store';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no projects yet. */
export function EmptyProjects() {
   const t = useTranslations('projects.empty');
   const { openModal } = useCreateProjectStore();

   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
         <EmptyStateActions>
            <Button className="h-10 px-5" onClick={() => openModal()}>
               {t('cta')}
            </Button>
         </EmptyStateActions>
      </EmptyState>
   );
}
