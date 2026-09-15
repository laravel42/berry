'use client';

import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { Button } from '@/components/ui/button';
import { canEditProduct } from '@/lib/workspace-role';
import { cn } from '@/lib/utils';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSessionStore } from '@/store/session-store';
import { BarChart3, PanelRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DisplayOptions } from '../display-options';

function HeaderNav() {
   const t = useTranslations('tasks.header');
   const openModal = useCreateIssueStore((state) => state.openModal);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));

   return (
      <div className="flex w-full items-center justify-between gap-4 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{t('title')}</h1>
         {canEdit ? (
            <Button size="xs" variant="secondary" onClick={() => openModal()}>
               <Plus className="size-4" />
               {t('create')}
            </Button>
         ) : null}
      </div>
   );
}

function HeaderOptions() {
   const t = useTranslations('tasks');
   const { openPanel, togglePanel } = useRightPanelStore();

   return (
      <div className="mb-1 flex h-10 w-full items-center gap-2 border-b px-6 py-1.5">
         <IssueFilterBarActions />
         <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            <IssueFilterTrigger />
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
               {t('header.insights')}
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
               {t('header.breakdown')}
            </Button>
            <DisplayOptions />
         </div>
      </div>
   );
}

export default function Header() {
   return (
      <>
         <HeaderNav />
         <HeaderOptions />
      </>
   );
}
