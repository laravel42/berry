'use client';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar-lazy';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, CalendarClock } from 'lucide-react';
import { useId, useState } from 'react';
import type { Matcher } from 'react-day-picker';

interface ProjectDateSelectorProps {
   label: string;
   date?: Date;
   onChange: (date: Date | undefined) => void;
   /**
    * `chip` — create-dialog secondary button.
    * `row` — issue-properties style: icon + dashed "Set date" / formatted value.
    * `plain` — list cell: date text only (or empty label), opens the calendar.
    */
   layout?: 'chip' | 'row' | 'plain';
   /** Empty-state text for `row` / `plain` layouts. Defaults to "Set date". */
   emptyLabel?: string;
   className?: string;
   /** Chip only: calendar glyph, no date text (aria-label still names the date). */
   iconOnly?: boolean;
   /** Days the calendar refuses, such as a start after the due date. */
   disabled?: Matcher | Matcher[];
}

export function ProjectDateSelector({
   label,
   date,
   onChange,
   layout = 'chip',
   emptyLabel = 'Set date',
   className,
   iconOnly = false,
   disabled,
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
            disabled={disabled}
            onSelect={(next) => {
               if (!next) return;
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
         <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
               <Button
                  id={id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn('w-full min-w-0 justify-start gap-2 px-0 font-medium', className)}
                  aria-expanded={open}
                  aria-label={ariaLabel}
               >
                  <span className="flex size-5 shrink-0 items-center justify-center p-0.5 text-status-info">
                     <CalendarClock className="size-4" aria-hidden />
                  </span>
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

   if (layout === 'plain') {
      return (
         <Popover open={open} onOpenChange={setOpen} modal>
            <PopoverTrigger asChild>
               <button
                  id={id}
                  type="button"
                  className={cn(
                     'hidden shrink-0 cursor-pointer tabular-nums text-muted-foreground hover:text-foreground sm:inline',
                     !date && 'opacity-0 group-hover:opacity-100',
                     className
                  )}
                  aria-expanded={open}
                  aria-label={ariaLabel}
               >
                  {date ? format(date, 'MMM d') : emptyLabel}
               </button>
            </PopoverTrigger>
            {popover}
         </Popover>
      );
   }

   return (
      <Popover open={open} onOpenChange={setOpen} modal>
         <PopoverTrigger asChild>
            <Button
               id={id}
               type="button"
               className={cn(
                  date ? undefined : 'text-muted-foreground',
                  iconOnly && 'size-6',
                  className
               )}
               size={iconOnly ? 'icon' : 'xs'}
               variant="secondary"
               aria-expanded={open}
               aria-label={ariaLabel}
            >
               <CalendarIcon className="size-3.5" />
               {iconOnly ? null : <span>{formattedShort}</span>}
            </Button>
         </PopoverTrigger>
         {popover}
      </Popover>
   );
}
