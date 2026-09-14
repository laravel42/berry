'use client';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuCheckboxItem,
   DropdownMenuContent,
   DropdownMenuLabel,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InboxItem } from '@/data/inbox';
import { priorities } from '@/data/priorities';
import { status as statusCatalog } from '@/data/status';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import {
   countFacet,
   INBOX_SHOW,
   type FacetResolver,
   type InboxFilters,
   type InboxShow,
   type InboxShowFilter,
} from './use-inbox';

interface InboxFilterBarProps {
   /** The list before filtering, so counts describe what is available. */
   items: InboxItem[];
   facetsOf: FacetResolver;
   filters: InboxFilters;
   onChange: (next: InboxFilters) => void;
   /** Whether the archive list is on screen. */
   archivedView: boolean;
   /** Counts for the All / Unread / Archived menu, over each source list. */
   showCounts: Record<InboxShow, number>;
   onShowArchived: () => void;
   onShowActive: () => void;
}

function toggle(values: string[], value: string): string[] {
   return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

/**
 * Show, status and priority, over the list.
 *
 * Counts sit beside every value because the useful question is not "does this
 * status exist" but "is there anything here in it" — a filter that empties the
 * list is a dead end a reader should be able to see coming.
 */
export function InboxFilterBar({
   items,
   facetsOf,
   filters,
   onChange,
   archivedView,
   showCounts,
   onShowArchived,
   onShowActive,
}: InboxFilterBarProps) {
   const t = useTranslations('inbox');

   const statusCounts = useMemo(
      () => countFacet(items, facetsOf, (facets) => facets.status),
      [items, facetsOf]
   );
   const priorityCounts = useMemo(
      () => countFacet(items, facetsOf, (facets) => facets.priority),
      [items, facetsOf]
   );

   const showLabel: Record<InboxShow, string> = {
      all: t('filters.showAll'),
      unread: t('filters.showUnread'),
      archived: t('filters.showArchived'),
   };

   const listMode: InboxShow = archivedView ? 'archived' : filters.show;

   const setListMode = (value: InboxShow) => {
      if (value === 'archived') {
         onShowArchived();
         return;
      }
      onShowActive();
      onChange({ ...filters, show: value as InboxShowFilter });
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
               <DropdownMenuRadioGroup value={listMode} onValueChange={(value) => setListMode(value as InboxShow)}>
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
         <FilterMenu
            label={t('filters.status')}
            selected={filters.statuses}
            options={statusCatalog.map((entry) => ({
               value: entry.id,
               label: entry.name,
               count: statusCounts[entry.id] ?? 0,
            }))}
            onToggle={(value) =>
               onChange({ ...filters, statuses: toggle(filters.statuses, value) })
            }
         />
         <FilterMenu
            label={t('filters.priority')}
            selected={filters.priorities}
            options={priorities.map((entry) => ({
               value: entry.id,
               label: entry.name,
               count: priorityCounts[entry.id] ?? 0,
            }))}
            onToggle={(value) =>
               onChange({ ...filters, priorities: toggle(filters.priorities, value) })
            }
         />
      </div>
   );
}

interface FilterMenuProps {
   label: string;
   selected: string[];
   options: { value: string; label: string; count: number }[];
   onToggle: (value: string) => void;
   emptyLabel?: string;
}

function FilterMenu({ label, selected, options, onToggle, emptyLabel }: FilterMenuProps) {
   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild>
            <Button
               size="xs"
               variant={selected.length > 0 ? 'secondary' : 'outline'}
               className="border-muted-foreground/15"
            >
               {label}
               {selected.length > 0 ? (
                  <span className="text-muted-foreground">{selected.length}</span>
               ) : null}
               <ChevronDown className="size-3.5" />
            </Button>
         </DropdownMenuTrigger>
         <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {options.length === 0 ? (
               <div className="px-2 py-1.5 text-muted-foreground">{emptyLabel ?? '—'}</div>
            ) : (
               options.map((option) => (
                  <DropdownMenuCheckboxItem
                     key={option.value}
                     checked={selected.includes(option.value)}
                     onCheckedChange={() => onToggle(option.value)}
                  >
                     <span className="flex-1 truncate">{option.label}</span>
                     <span
                        className={cn(
                           'ml-2 shrink-0 tabular-nums text-muted-foreground',
                           option.count === 0 && 'opacity-50'
                        )}
                     >
                        {option.count}
                     </span>
                  </DropdownMenuCheckboxItem>
               ))
            )}
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
