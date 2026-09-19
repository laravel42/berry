'use client';

import {
   EmptyState,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no projects yet. */
export function EmptyProjects() {
   const t = useTranslations('projects.empty');

   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
      </EmptyState>
   );
}
