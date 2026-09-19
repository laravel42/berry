'use client';

import { useTranslations } from 'next-intl';

import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePlansListStore, type PlansScope } from '@/store/plans-list-store';

const SCOPES: PlansScope[] = ['open', 'all'];

function HeaderOptions() {
   const t = useTranslations('goals.plans');
   const { scope, query, counts, setScope, setQuery } = usePlansListStore();

   const scopeLabel: Record<PlansScope, string> = {
      open: t('filter.open'),
      all: t('filter.all'),
   };

   return (
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[6px]">
         <div className="flex shrink-0 items-center gap-3">
            <Tabs value={scope} onValueChange={(value) => setScope(value as PlansScope)}>
               <TabsList aria-label={t('header.title')}>
                  {SCOPES.map((entry) => (
                     <TabsTrigger key={entry} value={entry}>
                        {scopeLabel[entry]}
                        {counts[entry] === null ? null : (
                           <span className="tabular-nums text-muted-foreground">
                              {counts[entry]}
                           </span>
                        )}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </Tabs>
         </div>

         <Input
            className="h-9 max-w-64"
            placeholder={t('list.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
         />
      </div>
   );
}

/** Plans list header: Open / All scope tabs and search. */
export default function Header() {
   return (
      <div className="flex w-full flex-col items-center">
         <HeaderOptions />
      </div>
   );
}
