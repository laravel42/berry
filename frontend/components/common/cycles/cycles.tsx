'use client';

import { ActiveCycleCard } from '@/components/common/cycles/active-cycle-card';
import { CreateCycleDialog } from '@/components/common/cycles/create-cycle-dialog';
import { CycleGroup } from '@/components/common/cycles/cycle-group';
import { CycleTimeline } from '@/components/common/cycles/cycle-timeline';
import { EmptyCycles } from '@/components/common/cycles/empty-cycles';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { PageKpiHeader } from '@/components/common/page/page-parts';
import MainLayout from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Input, searchFieldClass } from '@/components/ui/input';
import { useCycleIssues } from '@/hooks/use-cycle-issues';
import { WORKSPACE_SLUG } from '@/lib/config';
import { formatRange } from '@/lib/cycle-math';
import type { Cycle } from '@/lib/cycles';
import { canEditProduct } from '@/lib/workspace-role';
import { useCyclesStore } from '@/store/cycles-store';
import { useSessionStore } from '@/store/session-store';
import { Plus } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

/** Groups below the active card, in reading order: what is next, then what is done. */
const GROUPS: Cycle['status'][] = ['upcoming', 'completed'];

/**
 * The workspace's cycles: a timeline of all of them, the active one with its
 * burn-up, and the upcoming and completed ones as tables. A cycle opens in
 * the drawer (`@drawer/(.)cycle/[cycleId]`), or full page from a direct link.
 */
export default function Cycles() {
   const t = useTranslations('cycles');
   const locale = useLocale();
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const cycles = useCyclesStore((state) => state.cycles);
   const loaded = useCyclesStore((state) => state.loaded);
   const [createOpen, setCreateOpen] = useState(false);
   const [query, setQuery] = useState('');

   const hrefFor = useCallback((cycle: Cycle) => `/${orgId}/cycle/${cycle.id}`, [orgId]);
   const cycleIds = useMemo(() => cycles.map((cycle) => cycle.id), [cycles]);
   const { issuesByCycle, loaded: issuesLoaded } = useCycleIssues(cycleIds);

   const shown = useMemo(() => {
      const term = query.trim().toLowerCase();
      if (!term) return cycles;
      return cycles.filter(
         (cycle) =>
            cycle.name.toLowerCase().includes(term) ||
            formatRange(cycle, locale).toLowerCase().includes(term)
      );
   }, [cycles, query, locale]);

   const active = shown.find((cycle) => cycle.status === 'active');
   const groups = GROUPS.map((status) => ({
      status,
      cycles: shown.filter((cycle) => cycle.status === status),
   })).filter((group) => group.cycles.length > 0);

   const openCreate = canEdit ? () => setCreateOpen(true) : undefined;

   const header = (
      <PageKpiHeader label={t('list.title')}>
         {cycles.length > 0 ? (
            <Input
               className={`${searchFieldClass} w-[clamp(160px,22vw,280px)]`}
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={t('list.search')}
               aria-label={t('list.search')}
               type="search"
            />
         ) : null}
         {canEdit ? (
            <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
               <Plus className="size-4" aria-hidden />
               {t('list.new')}
            </Button>
         ) : null}
      </PageKpiHeader>
   );

   let body: ReactNode;
   if (!loaded) {
      body = <EmptyStateLoading label={t('list.loading')} />;
   } else if (cycles.length === 0) {
      body = <EmptyCycles onCreate={openCreate} />;
   } else {
      body = (
         <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto p-5">
            <div className="flex w-full min-w-0 flex-col gap-5">
               {/* The calendar shows every cycle; the search narrows the lists below it. */}
               <CycleTimeline cycles={cycles} hrefFor={hrefFor} />
               {active ? (
                  <ActiveCycleCard
                     cycle={active}
                     issues={issuesLoaded ? issuesByCycle[active.id] : undefined}
                     href={hrefFor(active)}
                  />
               ) : null}
               {groups.map((group) => (
                  <CycleGroup
                     key={group.status}
                     status={group.status}
                     cycles={group.cycles}
                     issuesByCycle={issuesByCycle}
                     hrefFor={hrefFor}
                  />
               ))}
               {shown.length === 0 ? (
                  <p className="rounded-[10px] bg-accent px-4 py-7 text-center text-subtle-foreground">
                     {t('list.noneMatch')}
                  </p>
               ) : null}
            </div>
         </div>
      );
   }

   return (
      <MainLayout header={header}>
         {body}
         <CreateCycleDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            onCreated={(cycle) => router.push(hrefFor(cycle))}
         />
      </MainLayout>
   );
}
