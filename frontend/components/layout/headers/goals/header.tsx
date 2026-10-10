'use client';

import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { useGoalsListStore } from '@/store/goals-list-store';

function HeaderOptions() {
   const t = useTranslations('goals');
   const query = useGoalsListStore((state) => state.query);
   const setQuery = useGoalsListStore((state) => state.setQuery);

   return (
      <div className="flex w-full items-center border-b px-4 py-[6px]">
         <Input
            className="h-9 min-w-0 flex-1"
            placeholder={t('list.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
         />
      </div>
   );
}

/**
 * Goals list header. No action, deliberately: planning is what makes a goal and
 * it starts in a project, so the button lives there. Offering it here would
 * invite a goal with no project to hang off.
 */
export default function Header() {
   return (
      <div className="flex w-full shrink-0 flex-col">
         <HeaderOptions />
      </div>
   );
}
