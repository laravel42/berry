'use client';

import {
   EmptyState,
   EmptyStateActions,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { useFilterStore } from '@/store/filter-store';
import { useTranslations } from 'next-intl';

/** Empty workspace queue. Create lives in the toolbar. */
export function EmptyQueue() {
   const t = useTranslations('tasks.empty');

   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
         <EmptyStateText>{t('next')}</EmptyStateText>
      </EmptyState>
   );
}

/** Shown when filters are on and nothing is left to show. */
export function NoMatches() {
   const t = useTranslations('issueLists');
   const { clearFilters } = useFilterStore();

   return (
      <EmptyState icon={<EmptyStateMark label="No matches" />}>
         <EmptyStateText>{t('states.noMatches')}</EmptyStateText>
         <EmptyStateActions>
            <Button variant="secondary" onClick={clearFilters}>
               {t('states.clearFilters')}
            </Button>
         </EmptyStateActions>
      </EmptyState>
   );
}

/** Pick EmptyQueue or NoMatches from whether the filter bar is narrowing the list. */
export function IssueListEmpty({ filtered }: { filtered: boolean }) {
   return filtered ? <NoMatches /> : <EmptyQueue />;
}
