'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback, useState } from 'react';

import UsageErrors from '@/components/common/usage/usage-errors';
import UsageFilters from '@/components/common/usage/usage-filters';
import UsageNow from '@/components/common/usage/usage-now';
import UsageOverview from '@/components/common/usage/usage-overview';
import MainLayout from '@/components/layout/main-layout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { localTimezone } from '@/lib/cron-schedule';
import type { UsageQuery } from '@/lib/usage';

/**
 * One page for the workspace's activity and spend. Overview is what is
 * happening now; Spend is what a window of runs cost; Runs is how they ended.
 * It replaces the separate Dashboard (whose `/dashboard` route redirects here),
 * so each figure has exactly one home.
 */
const TABS = ['overview', 'spend', 'runs'] as const;
type Tab = (typeof TABS)[number];

/** A `?tab=` value to a tab; the old `usage` and `errors` links still land right. */
function tabFrom(raw: string | null): Tab {
   if (raw === 'spend' || raw === 'usage') return 'spend';
   if (raw === 'runs' || raw === 'errors') return 'runs';
   return 'overview';
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

   // The tab's own read reports when it landed; keeping it in a ref-like state
   // lets the filter bar above the tabs say so.
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
      if (next === 'overview') search.delete('tab');
      else search.set('tab', next);
      router.replace(search.size > 0 ? `?${search.toString()}` : '?', { scroll: false });
   };

   const header = (
      <div className="flex w-full flex-col gap-2 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         <div className="flex flex-wrap items-center gap-2">
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
               timeframe={tab === 'overview' ? 'live' : 'window'}
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
      <MainLayout header={header}>
         {tab === 'overview' ? <UsageNow query={query} onState={onState} /> : null}
         {tab === 'spend' ? <UsageOverview query={query} onState={onState} /> : null}
         {tab === 'runs' ? <UsageErrors query={query} onState={onState} /> : null}
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
