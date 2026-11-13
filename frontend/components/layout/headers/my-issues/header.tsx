'use client';

import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { useIssueListView } from '@/components/common/issues/use-issue-list-view';
import { useMyIssuesTab } from '@/components/common/my-issues/use-my-issues';
import { PageKpiHeader } from '@/components/common/page/page-parts';
import { SegmentedControl } from '@/components/common/segmented-control';
import { Button } from '@/components/ui/button';
import { Input, searchFieldClass } from '@/components/ui/input';
import { canEditProduct } from '@/lib/workspace-role';
import { cn } from '@/lib/utils';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useSearchStore } from '@/store/search-store';
import { useSessionStore } from '@/store/session-store';
import type { ViewType } from '@/store/view-store';
import { LayoutGrid, LayoutList, Plus } from 'lucide-react';
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
   const { searchQuery, setSearchQuery, openSearch, closeSearch } = useSearchStore();
   const view = useIssueListView();
   const [tab] = useMyIssuesTab();

   return (
      <div className="flex w-full flex-col">
         <PageKpiHeader label={tab === 'assigned' ? t('titleMine') : t('title')}>
            {canEdit ? (
               <Button className="shrink-0" onClick={() => openModal()}>
                  <Plus className="size-4" aria-hidden />
                  {t('create')}
               </Button>
            ) : null}
         </PageKpiHeader>
         <div className="mb-1 flex h-[48px] w-full shrink-0 flex-wrap items-center gap-2 border-b px-5 py-[2px] [&_button]:!h-[30px]">
            <div className="flex flex-wrap items-center gap-1">
               <Input
                  className={cn(searchFieldClass, 'w-64 max-sm:w-40')}
                  placeholder={t('search')}
                  value={searchQuery}
                  onChange={(event) => {
                     const value = event.target.value;
                     setSearchQuery(value);
                     if (value.trim() === '') closeSearch();
                     else openSearch();
                  }}
               />
               <IssueFilterTrigger iconOnly />
               <IssueFilterBarActions />
               <DisplayOptions iconOnly />
            </div>
            <SegmentedControl
               className="ml-auto"
               aria-label={t('layout.label')}
               value={view.mode}
               onValueChange={view.setMode}
               options={LAYOUTS.map((layout) => ({
                  value: layout.value,
                  title: t(`layout.${layout.key}`),
                  label: <layout.icon className="size-4" aria-hidden />,
               }))}
            />
         </div>
      </div>
   );
}
