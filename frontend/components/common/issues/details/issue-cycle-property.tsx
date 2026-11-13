'use client';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Issue } from '@/data/issues';
import { describePatchFailure, patchBoardIssue } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useCyclesStore } from '@/store/cycles-store';
import { useIssuesStore } from '@/store/issues-store';
import { CalendarRange, CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/** Which cycle this task is scheduled in. */
export function IssueCycleProperty({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.properties');
   const cycles = useCyclesStore((state) => state.cycles);
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [open, setOpen] = useState(false);
   const selected = cycles.find((cycle) => cycle.id === issue.cycleId);

   const choose = (cycleId: string | null) => {
      const previous = issue.cycleId;
      updateIssue(issue.id, { cycleId: cycleId ?? '' });
      setOpen(false);
      void patchBoardIssue(issue.id, { cycleId }).catch((cause: unknown) => {
         updateIssue(issue.id, { cycleId: previous });
         toast.error(describePatchFailure(cause) || t('saveFailed'));
      });
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               type="button"
               variant="ghost"
               size="sm"
               aria-haspopup="listbox"
               aria-expanded={open}
               aria-label={t('cycle')}
               className="w-full min-w-0 justify-start gap-2 px-0 font-medium"
            >
               <span className="flex size-5 shrink-0 items-center justify-center p-0.5 text-muted-foreground">
                  <CalendarRange className="size-4" aria-hidden />
               </span>
               <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
                  {selected?.name ?? t('noCycle')}
               </span>
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <Command>
               <CommandInput placeholder={t('cycle')} aria-label={t('cycle')} />
               <CommandList>
                  <CommandEmpty>No cycle matches.</CommandEmpty>
                  <CommandGroup>
                     <CommandItem
                        value="__none__"
                        onSelect={() => choose(null)}
                        className="flex items-center gap-2"
                     >
                        <CalendarRange className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t('noCycle')}</span>
                        {!selected ? (
                           <CheckIcon className="text-(--primary) size-4 shrink-0" />
                        ) : null}
                     </CommandItem>
                     {cycles.map((cycle) => (
                        <CommandItem
                           key={cycle.id}
                           value={`${cycle.name} ${cycle.id}`}
                           onSelect={() => choose(cycle.id)}
                           className="flex items-center gap-2"
                        >
                           <CalendarRange className="size-4 shrink-0 text-muted-foreground" />
                           <span className="min-w-0 flex-1 truncate">{cycle.name}</span>
                           {selected?.id === cycle.id ? (
                              <CheckIcon className="text-(--primary) size-4 shrink-0" />
                           ) : null}
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
