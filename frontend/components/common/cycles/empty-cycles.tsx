'use client';

import {
   EmptyState,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Full-page empty state when the workspace has no cycles yet. */
export function EmptyCycles({ onCreate }: { onCreate?: (() => void) | undefined }) {
   const t = useTranslations('cycles');

   return (
      <EmptyState icon={<EmptyStateMark label={t('empty.mark')} />}>
         <EmptyStateTitle className="mt-5">{t('empty.title')}</EmptyStateTitle>
         <EmptyStateText>{t('empty.body')}</EmptyStateText>
         {onCreate ? (
            <Button variant="soft" className="mt-3" onClick={onCreate}>
               <Plus className="size-3.5" aria-hidden />
               {t('empty.create')}
            </Button>
         ) : null}
      </EmptyState>
   );
}
