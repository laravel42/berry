'use client';

import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { useIssueListView } from '@/components/common/issues/use-issue-list-view';
import { useMyIssuesTab } from '@/components/common/my-issues/use-my-issues';
import { PageKpiHeader } from '@/components/common/page/page-parts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canEditProduct } from '@/lib/workspace-role';
import { cn } from '@/lib/utils';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import { useSessionStore } from '@/store/session-store';
import type { ViewType } from '@/store/view-store';
import { BarChart3, LayoutGrid, LayoutList, PanelRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DisplayOptions } from '../display-options';

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
   const [tab] = useMyIssuesTab();

   return (
      <div className="flex w-full flex-col">
         <PageKpiHeader label={tab === 'assigned' ? t('titleMine') : t('title')}>
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
               <IssueFilterTrigger iconOnly />
               <IssueFilterBarActions />
               <Button
                  size="xs"
                  variant="outline"
                  aria-label={t('insights')}
                  title={t('insights')}
                  className={cn(
                     // Below `lg` the panels these open cover the list rather
                     // than sit beside it; the same button closes them.
                     'border-muted-foreground/15 px-2',
                     openPanel === 'insights' && 'bg-secondary hover:bg-secondary/80'
                  )}
                  onClick={() => togglePanel('insights')}
               >
                  <BarChart3 className="size-4" aria-hidden="true" />
               </Button>
               <DisplayOptions iconOnly />
               <Button
                  size="xs"
                  variant="outline"
                  aria-label={t('breakdown')}
                  title={t('breakdown')}
                  className={cn(
                     'border-muted-foreground/15 px-2',
                     openPanel === 'breakdown' && 'bg-secondary hover:bg-secondary/80'
                  )}
                  onClick={() => togglePanel('breakdown')}
               >
                  <PanelRight className="size-4" aria-hidden="true" />
               </Button>
            </div>
         </div>
      </div>
   );
}
