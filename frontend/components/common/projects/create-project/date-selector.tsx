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
            <PopoverTrigger asChild>
               <Button
                  id={id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full min-w-0 justify-start gap-2 px-1.5"
                  aria-expanded={open}
                  aria-label={ariaLabel}
               >
                  <CalendarClock className="size-4 text-status-info" aria-hidden />
                  <span
                     className={cn(
                        'truncate',
                        formattedLong ? 'tabular-nums' : 'text-muted-foreground'
                     )}
                  >
                     {formattedLong ?? emptyLabel}
                  </span>
               </Button>
            </PopoverTrigger>
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
