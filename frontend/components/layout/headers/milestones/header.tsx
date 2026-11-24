'use client';

import { useTranslations } from 'next-intl';

import { ToolbarSearch } from '@/components/common/page/toolbar-search';
import { useMilestonesListStore } from '@/store/milestones-list-store';

function HeaderOptions() {
   const t = useTranslations('milestones');
   const query = useMilestonesListStore((state) => state.query);
   const setQuery = useMilestonesListStore((state) => state.setQuery);

   return (
      <div className="flex min-h-[52px] w-full flex-wrap items-center border-b px-2 py-2 sm:px-5">
         <ToolbarSearch
            label={t('list.search')}
            value={query}
            onChange={setQuery}
            className="min-w-0 flex-1"
         />
      </div>
   );
}

/**
 * Milestones list header. No create action here: a goal belongs to a project, so
 * New milestone lives on the project (and the command palette, which still requires
 * one). Offering it here would invite a goal with nowhere to hang off.
 */
export default function Header() {
   return (
      <div className="flex w-full shrink-0 flex-col">
         <HeaderOptions />
      </div>
   );
}
