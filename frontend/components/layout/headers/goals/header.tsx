'use client';

import { useTranslations } from 'next-intl';

import { Input, searchFieldClass } from '@/components/ui/input';
import { useGoalsListStore } from '@/store/goals-list-store';

function HeaderOptions() {
   const t = useTranslations('goals');
   const query = useGoalsListStore((state) => state.query);
   const setQuery = useGoalsListStore((state) => state.setQuery);

   return (
      <div className="flex h-[52px] w-full items-center border-b px-5">
         <Input
            className={`${searchFieldClass} min-w-0 flex-1`}
            placeholder={t('list.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
         />
      </div>
   );
}

/**
 * Goals list header. No create action here: a goal belongs to a project, so
 * New goal lives on the project (and the command palette, which still requires
 * one). Offering it here would invite a goal with nowhere to hang off.
 */
export default function Header() {
   return (
      <div className="flex w-full shrink-0 flex-col">
         <HeaderOptions />
      </div>
   );
}
