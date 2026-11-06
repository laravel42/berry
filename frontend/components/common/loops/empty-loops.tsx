'use client';

import {
   EmptyState,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no loops yet. */
export function EmptyLoops() {
   const t = useTranslations('loops.empty');

   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <span className="mt-5 inline-flex h-[22px] items-center rounded-[6px] bg-settings-badge-warning px-2 font-medium text-status-warning">
            {t('comingSoon')}
         </span>
         <EmptyStateTitle className="mt-2">{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
      </EmptyState>
   );
}
