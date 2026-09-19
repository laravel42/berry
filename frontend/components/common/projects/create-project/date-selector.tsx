'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, CalendarClock } from 'lucide-react';
import { useId, useState } from 'react';

interface ProjectDateSelectorProps {
   label: string;
   date?: Date;
   onChange: (date: Date | undefined) => void;
   /**
    * `chip` — create-dialog secondary button.
    * `row` — issue-properties style: icon + dashed "Set date" / formatted value.
    */
   layout?: 'chip' | 'row';
   /** Empty-state text for `row` layout. Defaults to "Set date". */
   emptyLabel?: string;
}

export function ProjectDateSelector({
   label,
   date,
   onChange,
   layout = 'chip',
   emptyLabel = 'Set date',
}: ProjectDateSelectorProps) {
   const id = useId();
   const [open, setOpen] = useState(false);
   const formattedShort = date ? format(date, 'MMM d') : label;
   const formattedLong = date ? format(date, 'd MMM yyyy') : null;
   const ariaLabel = date ? `${label}: ${format(date, 'MMM d, yyyy')}` : label;

   const popover = (
      <PopoverContent className="w-auto p-0" align="start">
         <Calendar
            mode="single"
            selected={date}
            onSelect={(next) => {
               onChange(next);
               setOpen(false);
            }}
            autoFocus
         />
         {date ? (
            <div className="border-t p-2">
               <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="w-full"
                  onClick={() => {
                     onChange(undefined);
                     setOpen(false);
                  }}
               >
                  Clear date
               </Button>
            </div>
         ) : null}
      </PopoverContent>
   );

   if (layout === 'row') {
      return (
         <Popover open={open} onOpenChange={setOpen}>
            <div className="flex items-center gap-2">
               <PopoverTrigger asChild>
                  <button
                     id={id}
                     type="button"
                     className="flex size-7 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                     aria-expanded={open}
                     aria-label={ariaLabel}
                  >
                     <CalendarClock className="size-4 text-status-info" aria-hidden />
                  </button>
               </PopoverTrigger>
               <PopoverTrigger asChild>
                  <button
                     type="button"
                     className={cn(
                        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        formattedLong
                           ? 'h-7 tabular-nums hover:bg-accent/40'
                           : 'border-b border-dashed border-muted-foreground/50 pb-px text-muted-foreground'
                     )}
                     aria-expanded={open}
                     aria-label={ariaLabel}
                  >
                     {formattedLong ?? emptyLabel}
                  </button>
               </PopoverTrigger>
            </div>
            {popover}
         </Popover>
      );
   }

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               id={id}
               className={date ? undefined : 'text-muted-foreground'}
               size="xs"
               variant="secondary"
               aria-expanded={open}
               aria-label={ariaLabel}
            >
               <CalendarIcon className="size-3.5" />
               <span>{formattedShort}</span>
            </Button>
         </PopoverTrigger>
         {popover}
      </Popover>
   );
}
