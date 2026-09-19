'use client';

import {
   ListFilterTrigger,
   type ListFilterController,
} from '@/components/common/filters/list-filters';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InboxItem } from '@/data/inbox';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { INBOX_SHOW, type InboxShow, type InboxShowFilter } from './use-inbox';

interface InboxFilterBarProps {
   filter: ListFilterController<InboxItem>;
   show: InboxShowFilter;
   onShowChange: (show: InboxShowFilter) => void;
   /** Whether the archive list is on screen. */
   archivedView: boolean;
   /** Counts for the All / Unread / Archived menu, over each source list. */
   showCounts: Record<InboxShow, number>;
   onShowArchived: () => void;
   onShowActive: () => void;
}

/**
 * Which list (All / Unread / Archived), then the shared "Filter" menu over it.
 * The applied filters show as chips under the toolbar, in `ListFilterBar`.
 */
export function InboxFilterBar({
   filter,
   show,
   onShowChange,
   archivedView,
   showCounts,
   onShowArchived,
   onShowActive,
}: InboxFilterBarProps) {
   const t = useTranslations('inbox');

   const showLabel: Record<InboxShow, string> = {
      all: t('filters.showAll'),
      unread: t('filters.showUnread'),
      archived: t('filters.showArchived'),
   };

   const listMode: InboxShow = archivedView ? 'archived' : show;

   const setListMode = (value: InboxShow) => {
      if (value === 'archived') {
         onShowArchived();
         return;
      }
      onShowActive();
      onShowChange(value);
   };

   return (
      <div className="flex flex-wrap items-center gap-1.5">
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button size="xs" variant="outline" className="border-muted-foreground/15">
                  {showLabel[listMode]}
                  <ChevronDown className="size-3.5" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
               <DropdownMenuRadioGroup
                  value={listMode}
                  onValueChange={(value) => setListMode(value as InboxShow)}
               >
                  {INBOX_SHOW.map((value) => (
                     <DropdownMenuRadioItem key={value} value={value}>
                        <span className="flex-1 truncate">{showLabel[value]}</span>
                        <span
                           className={cn(
                              'ml-2 shrink-0 tabular-nums text-muted-foreground',
                              showCounts[value] === 0 && 'opacity-50'
                           )}
                        >
                           {showCounts[value]}
                        </span>
                     </DropdownMenuRadioItem>
                  ))}
               </DropdownMenuRadioGroup>
            </DropdownMenuContent>
         </DropdownMenu>
         <ListFilterTrigger filter={filter} />
      </div>
   );
}
