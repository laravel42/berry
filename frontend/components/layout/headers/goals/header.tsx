'use client';

import { useTranslations } from 'next-intl';

import { SectionLabel } from '@/components/common/page/page-parts';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useGoalsStore } from '@/store/goals-store';
import { useGoalsListStore, type GoalsScope } from '@/store/goals-list-store';

const SCOPES: GoalsScope[] = ['open', 'all'];

function isOpenGoal(status: string): boolean {
   return status !== 'completed';
}

function HeaderOptions() {
   const t = useTranslations('goals');
   const goals = useGoalsStore((state) => state.goals);
   const { scope, query, setScope, setQuery } = useGoalsListStore();

   const counts: Record<GoalsScope, number> = {
      open: goals.filter((goal) => isOpenGoal(goal.status)).length,
      all: goals.length,
   };

   const scopeLabel: Record<GoalsScope, string> = {
      open: t('filter.open'),
      all: t('filter.all'),
   };

   return (
      <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[6px]">
         <div className="flex shrink-0 items-center gap-3">
            <Tabs value={scope} onValueChange={(value) => setScope(value as GoalsScope)}>
               <TabsList aria-label={t('header.title')}>
                  {SCOPES.map((entry) => (
                     <TabsTrigger key={entry} value={entry}>
                        {scopeLabel[entry]}
                        <span className="tabular-nums text-muted-foreground">{counts[entry]}</span>
                     </TabsTrigger>
                  ))}
               </TabsList>
            </Tabs>
         </div>

         <Input
            className="h-9 min-w-0 flex-1 basis-40"
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
   const t = useTranslations('goals.header');

   return (
      <div className="flex w-full shrink-0 flex-col">
         <div className="flex min-h-11 items-center px-4 pt-1">
            <SectionLabel as="h1">{t('title')}</SectionLabel>
         </div>
         <HeaderOptions />
      </div>
   );
}
