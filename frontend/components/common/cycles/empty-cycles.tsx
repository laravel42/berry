'use client';

import {
   EmptyState,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no cycles yet. */
export function EmptyCycles() {
   const t = useTranslations('cycles');

   return (
      <EmptyState icon={<EmptyStateMark label={t('empty.mark')} />}>
         <span className="mt-5 inline-flex h-[22px] items-center rounded-[6px] bg-settings-badge-warning px-2 font-medium text-status-warning">
            {t('empty.comingSoon')}
         </span>
         <EmptyStateTitle className="mt-2">{t('empty.title')}</EmptyStateTitle>
         <EmptyStateText>{t('empty.body')}</EmptyStateText>
      </EmptyState>
   );
}
