'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useFilterStore } from '@/store/filter-store';
import { useTranslations } from 'next-intl';

/** Empty workspace queue — invite creating the first task. */
export function EmptyQueue() {
   const t = useTranslations('tasks.empty');
   const { openModal } = useCreateIssueStore();

   return (
      <div className="flex min-h-64 w-full items-center justify-center px-6 py-12">
         <div className="flex max-w-sm flex-col items-center text-center">
            <BerryMark size="lg" tone="neutral" state="hollow" label={t('mark')} />
            <h2 className="mt-5">{t('title')}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{t('body')}</p>
            <p className="mt-1 leading-relaxed text-muted-foreground">{t('next')}</p>
            <Button className="mt-6 h-10 px-5" onClick={() => openModal()}>
               {t('cta')}
            </Button>
         </div>
      </div>
   );
}

/** Shown when filters are on and nothing is left to show. */
export function NoMatches() {
   const t = useTranslations('issueLists');
   const { clearFilters } = useFilterStore();

   return (
      <div className="flex min-h-64 w-full items-center justify-center px-6 py-12">
         <div className="flex max-w-sm flex-col items-center text-center">
            <BerryMark size="lg" tone="neutral" state="hollow" label="No matches" />
            <p className="mt-5 leading-relaxed text-muted-foreground">{t('states.noMatches')}</p>
            <Button variant="secondary" className="mt-5" onClick={clearFilters}>
               {t('states.clearFilters')}
            </Button>
         </div>
      </div>
   );
}

/** Pick EmptyQueue or NoMatches from whether the filter bar is narrowing the list. */
export function IssueListEmpty({ filtered }: { filtered: boolean }) {
   return filtered ? <NoMatches /> : <EmptyQueue />;
}
