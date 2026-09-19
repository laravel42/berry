'use client';

import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { canEditProduct } from '@/lib/workspace-role';
import { cn } from '@/lib/utils';
import { useCreateIssueStore } from '@/store/create-issue-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import { useSessionStore } from '@/store/session-store';
import { BarChart3, PanelRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DisplayOptions } from '../display-options';

export default function Header() {
   const t = useTranslations('tasks');
   const openModal = useCreateIssueStore((state) => state.openModal);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const { openPanel, togglePanel } = useRightPanelStore();
   const { searchQuery, setSearchQuery, openSearch, closeSearch } = useSearchStore();

   return (
      <div className="mb-1 flex w-full shrink-0 items-center gap-2 border-b px-4 py-[6px] [&_button]:!h-9 [&_button[aria-label='Create task']]:!h-[34px] [&_button[aria-label='Create task']]:!w-[42px] [&_input]:!h-9">
         <Input
            className="h-9 max-w-64"
            placeholder={t('header.search')}
            value={searchQuery}
            onChange={(event) => {
               const value = event.target.value;
               setSearchQuery(value);
               if (value.trim() === '') closeSearch();
               else openSearch();
            }}
         />
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
            {canEdit ? (
               <Button
                  size="xs"
                  className="ml-1 h-[34px] w-[42px] shrink-0 px-0"
                  aria-label={t('header.create')}
                  title={t('header.create')}
                  onClick={() => openModal()}
               >
                  <Plus className="size-4" />
               </Button>
            ) : null}
         </div>
      </div>
   );
}
