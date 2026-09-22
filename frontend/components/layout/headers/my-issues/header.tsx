'use client';

import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { useIssueListView } from '@/components/common/issues/use-issue-list-view';
import { PageKpiHeader, type Kpi } from '@/components/common/page/page-parts';
import { KPI_DAYS, useWorkKpis } from '@/components/common/usage/use-work-kpis';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatAge, formatCost, formatSpan, formatSpanShort } from '@/lib/usage';
import { canEditProduct } from '@/lib/workspace-role';
import { cn } from '@/lib/utils';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import { useSessionStore } from '@/store/session-store';
import type { ViewType } from '@/store/view-store';
import { BarChart3, LayoutGrid, LayoutList, PanelRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The layouts the toolbar switches between. Table stays reachable by its link. */
const LAYOUTS: { value: ViewType; key: 'list' | 'board'; icon: React.ElementType }[] = [
   { value: 'list', key: 'list', icon: LayoutList },
   { value: 'grid', key: 'board', icon: LayoutGrid },
];

export default function Header() {
   const t = useTranslations('tasks.header');
   const openModal = useCreateIssueStore((state) => state.openModal);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const { openPanel, togglePanel } = useRightPanelStore();
   const { searchQuery, setSearchQuery, openSearch, closeSearch } = useSearchStore();
   const view = useIssueListView();
   const issues = useIssuesStore((state) => state.issues);
   const loaded = useIssuesStore((state) => state.loadState === 'ready');
   const data = useWorkKpis();

   const openIssues = issues.filter(
      (issue) => issue.status.category !== 'completed' && issue.status.category !== 'canceled'
   );
   const running = openIssues.filter((issue) => Boolean(issue.activeRunId)).length;
   const work = data?.work;
   const waiting = work ? work.waiting.reviews + work.waiting.decisions : undefined;

   const kpis: Kpi[] = [
      {
         label: t('kpi.open'),
         value: loaded ? openIssues.length : undefined,
         detail:
            loaded && waiting !== undefined ? t('kpi.openDetail', { waiting, running }) : undefined,
      },
      {
         label: t('kpi.oldestWait'),
         value: work
            ? work.waiting.oldestAt
               ? formatAge(work.waiting.oldestAt)
               : t('kpi.noWait')
            : undefined,
         detail: work
            ? t('kpi.oldestWaitDetail', {
                 reviews: work.waiting.reviews,
                 decisions: work.waiting.decisions,
              })
            : undefined,
         tone: work?.waiting.oldestAt ? 'text-status-warning' : undefined,
      },
      {
         label: t('kpi.done', { days: KPI_DAYS }),
         value: work?.tasksDone,
         detail: work
            ? t('kpi.doneDetail', { pullRequests: work.pullRequests, commits: work.commits })
            : undefined,
      },
      {
         label: t('kpi.leadTime'),
         value: work ? (work.duration ? formatSpanShort(work.duration.median) : '–') : undefined,
         detail: work?.duration
            ? t('kpi.leadTimeDetail', { p90: formatSpan(work.duration.p90) })
            : undefined,
      },
      {
         label: t('kpi.costPerTask'),
         value:
            data && work
               ? work.tasksDone > 0
                  ? formatCost(Math.round(data.costMicros / work.tasksDone))
                  : '–'
               : undefined,
         detail:
            work && work.tasksDone > 0
               ? t('kpi.costPerTaskDetail', { time: formatSpan(work.runSeconds / work.tasksDone) })
               : undefined,
      },
      {
         label: t('kpi.firstPass'),
         value: work
            ? work.firstPass.total > 0
               ? `${Math.round((work.firstPass.oneRun / work.firstPass.total) * 100)}%`
               : '–'
            : undefined,
         detail: work
            ? t('kpi.firstPassDetail', {
                 oneRun: work.firstPass.oneRun,
                 total: work.firstPass.total,
                 runs: work.runs,
              })
            : undefined,
      },
   ];

   return (
      <div className="flex w-full flex-col">
         <PageKpiHeader label={t('title')} kpis={kpis}>
            <Input
               className="h-9 w-64 max-sm:w-40"
               placeholder={t('search')}
               value={searchQuery}
               onChange={(event) => {
                  const value = event.target.value;
                  setSearchQuery(value);
                  if (value.trim() === '') closeSearch();
                  else openSearch();
               }}
            />
            {canEdit ? (
               <Button
                  size="xs"
                  className="h-9 shrink-0 gap-1.5 px-3"
                  aria-label={t('create')}
                  onClick={() => openModal()}
               >
                  <Plus className="size-4" />
                  <span className="max-sm:hidden">{t('create')}</span>
               </Button>
            ) : null}
         </PageKpiHeader>
         <div className="mb-1 flex w-full shrink-0 flex-wrap items-center gap-2 border-b px-6 py-[6px] [&_button]:!h-9">
            <div
               role="group"
               aria-label={t('layout.label')}
               className="flex items-center rounded-md border p-0.5"
            >
               {LAYOUTS.map((layout) => {
                  const on = view.mode === layout.value;
                  return (
                     <button
                        key={layout.value}
                        type="button"
                        aria-pressed={on}
                        aria-label={t(`layout.${layout.key}`)}
                        title={t(`layout.${layout.key}`)}
                        onClick={() => view.setMode(layout.value)}
                        className={cn(
                           'flex w-10 items-center justify-center rounded outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                           on
                              ? 'bg-secondary text-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                        )}
                     >
                        <layout.icon className="size-4" />
                     </button>
                  );
               })}
            </div>
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
               <IssueFilterTrigger />
               <IssueFilterBarActions />
               <Button
                  size="xs"
                  variant="outline"
                  className={cn(
                     // The panels these open are desktop-only; a button that does
                     // nothing on a phone is worse than no button.
                     'hidden border-muted-foreground/15 lg:inline-flex',
                     openPanel === 'insights' && 'bg-secondary hover:bg-secondary/80'
                  )}
                  onClick={() => togglePanel('insights')}
               >
                  <BarChart3 className="size-4" />
                  {t('insights')}
               </Button>
               <Button
                  size="xs"
                  variant="outline"
                  className={cn(
                     'hidden border-muted-foreground/15 lg:inline-flex',
                     openPanel === 'breakdown' && 'bg-secondary hover:bg-secondary/80'
                  )}
                  onClick={() => togglePanel('breakdown')}
               >
                  <PanelRight className="size-4" />
                  {t('breakdown')}
               </Button>
            </div>
         </div>
      </div>
   );
}
