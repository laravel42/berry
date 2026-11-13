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
import { useCyclesStore } from '@/store/cycles-store';
import { CalendarRange, CheckIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

interface CycleSelectorProps {
   cycleId: string | null;
   onChange: (cycleId: string | null) => void;
}

/**
 * The cycle a new task is scheduled in. Only cycles that are still running or
 * yet to start are offered: a new task does not belong in one that has ended.
 */
export function CycleSelector({ cycleId, onChange }: CycleSelectorProps) {
   const t = useTranslations('issueDetail.properties');
   const cycles = useCyclesStore((state) => state.cycles);
   const [open, setOpen] = useState(false);
   const offered = cycles.filter((cycle) => cycle.status !== 'completed');
   const selected = cycles.find((cycle) => cycle.id === cycleId);

   const choose = (next: string | null) => {
      onChange(next);
      setOpen(false);
   };

   return (
      <Popover open={open} onOpenChange={setOpen} modal>
         <PopoverTrigger asChild>
            <Button
               type="button"
               size="xs"
               variant="secondary"
               role="combobox"
               aria-expanded={open}
               aria-label={t('cycle')}
            >
               <CalendarRange className="size-3.5" aria-hidden />
               <span className="max-w-40 truncate">{selected?.name ?? t('cycle')}</span>
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <Command>
               <CommandInput placeholder={t('cycle')} aria-label={t('cycle')} />
               <CommandList>
                  <CommandEmpty>{t('noCycleMatches')}</CommandEmpty>
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
                     {offered.map((cycle) => (
                        <CommandItem
                           key={cycle.id}
                           value={`${cycle.name} ${cycle.id}`}
                           onSelect={() => choose(cycle.id)}
                           className="flex items-center gap-2"
                        >
                           <CalendarRange
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                           />
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
