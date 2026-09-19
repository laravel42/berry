'use client';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandGroup,
   CommandItem,
   CommandList,
   CommandSeparator,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useProjectsFilterStore, type ProjectsSort } from '@/store/projects-filter-store';
import { ArrowUpDown, CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';

/** The sort order of the Projects list, grouped by what it sorts on. */
export function ProjectsSortMenu() {
   const t = useTranslations('issueLists');
   const { sort, setSort } = useProjectsFilterStore();

   const groups: { heading: string; entries: { id: ProjectsSort; label: string }[] }[] = [
      {
         heading: 'Title',
         entries: [
            { id: 'title-asc', label: 'A → Z' },
            { id: 'title-desc', label: 'Z → A' },
         ],
      },
      {
         heading: 'Target date',
         entries: [
            { id: 'date-asc', label: 'Oldest to newest' },
            { id: 'date-desc', label: 'Newest to oldest' },
         ],
      },
      {
         heading: t('projects.status'),
         entries: [
            { id: 'status-asc', label: 'Lowest to highest' },
            { id: 'status-desc', label: 'Highest to lowest' },
         ],
      },
   ];

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button
               size="xs"
               variant="outline"
               className="border-muted-foreground/15"
               aria-label="Sort"
            >
               <ArrowUpDown className="size-4" />
               <span className="hidden sm:inline">Sort</span>
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-56 p-0" align="end">
            <Command>
               <CommandList>
                  {groups.map((group, index) => (
                     <div key={group.heading}>
                        {index > 0 ? <CommandSeparator /> : null}
                        <CommandGroup heading={group.heading}>
                           {group.entries.map((entry) => (
                              <CommandItem
                                 key={entry.id}
                                 onSelect={() => setSort(entry.id)}
                                 className="flex items-center justify-between"
                              >
                                 {entry.label}
                                 {sort === entry.id && <CheckIcon size={16} />}
                              </CommandItem>
                           ))}
                        </CommandGroup>
                     </div>
                  ))}
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
