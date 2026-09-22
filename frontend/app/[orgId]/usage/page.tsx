'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback, useState } from 'react';

import UsageFilters from '@/components/common/usage/usage-filters';
import UsageSpend from '@/components/common/usage/usage-spend';
import UsageWork from '@/components/common/usage/usage-work';
import MainLayout from '@/components/layout/main-layout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { localTimezone } from '@/lib/cron-schedule';
import type { UsageQuery } from '@/lib/usage';

/**
 * One page for what the workspace's agents cost and what that produced, drawn
 * as charts. Spend is the window's cost, when it was spent and who and what
 * took which share of it; Work is what it bought: tasks done, what was
 * delivered, who finished them and how long a task takes.
 *
 * It replaced a three-tab page whose Overview repeated the Inbox and Reviews
 * (what waits on a person, what is in flight) and whose Runs tab led with
 * failed runs. Most failure causes are Berry's to fix, not the reader's, and a
 * retried run still ends in a finished task; Work counts those, and names only
 * the two causes a person can act on. The `/dashboard` route redirects here.
 */
const TABS = ['spend', 'work'] as const;
type Tab = (typeof TABS)[number];

/** A `?tab=` value to a tab. Links to the old tabs still land somewhere sensible. */
function tabFrom(raw: string | null): Tab {
   if (raw === 'work' || raw === 'runs' || raw === 'errors') return 'work';
   return 'spend';
}

function UsageScreen() {
   const t = useTranslations('areas.usage');
   const router = useRouter();
   const params = useSearchParams();
   const tab = tabFrom(params.get('tab'));

   const [query, setQuery] = useState<UsageQuery>({
      days: 30,
      timezone: localTimezone(),
      projectId: null,
   });
   const [state, setState] = useState<{
      lastUpdated: Date | null;
      loading: boolean;
      reload: () => void;
   }>({ lastUpdated: null, loading: false, reload: () => undefined });

   const onState = useCallback(
      (next: { lastUpdated: Date | null; loading: boolean; reload: () => void }) => {
         setState((current) =>
            current.lastUpdated?.getTime() === next.lastUpdated?.getTime() &&
            current.loading === next.loading
               ? current
               : next
         );
      },
      []
   );

   const open = (next: Tab) => {
      const search = new URLSearchParams(params.toString());
      if (next === 'spend') search.delete('tab');
      else search.set('tab', next);
      router.replace(search.size > 0 ? `?${search.toString()}` : '?', { scroll: false });
   };

   const header = (
      <div className="flex w-full flex-col items-center">
         <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b px-4 py-[6px]">
            <Tabs value={tab} onValueChange={(value) => open(value as Tab)}>
               <TabsList aria-label={t('tabs.label')}>
                  {TABS.map((name) => (
                     <TabsTrigger key={name} value={name}>
                        {t(`tabs.${name}`)}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </Tabs>
            <UsageFilters
               timeframe="window"
               query={query}
               onChange={setQuery}
               lastUpdated={state.lastUpdated}
               loading={state.loading}
               onRefresh={state.reload}
            />
         </div>
      </div>
   );

   return (
      <MainLayout header={header} headersNumber={1}>
         {tab === 'spend' ? <UsageSpend query={query} onState={onState} /> : null}
         {tab === 'work' ? <UsageWork query={query} onState={onState} /> : null}
      </MainLayout>
   );
}

export default function UsagePage() {
   return (
      <Suspense>
         <UsageScreen />
      </Suspense>
   );
}
