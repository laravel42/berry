'use client';

import type { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { createContext, useContext, type ComponentProps } from 'react';

type CalendarProps = ComponentProps<typeof CalendarComponent>;

/**
 * The caller's props, handed to the placeholder: `loading` gets no props, and
 * the calendar's box depends on its root `className` and `numberOfMonths`.
 */
const PlaceholderProps = createContext<CalendarProps | null>(null);

/**
 * Holds the calendar's place until its chunk arrives, so the popover around it
 * does not change size when the calendar lands. It copies the calendar's box:
 * `p-3` around the months, each seven 32px day columns wide and, at its
 * tallest, a 28px caption, a 16px gap, one line of weekday names and six weeks
 * of an 8px gap above a 32px day. Several months stack, or sit side by side
 * from `sm`, 8px apart, as the calendar lays them out.
 */
function CalendarPlaceholder() {
   const props = useContext(PlaceholderProps);
   const months = props?.numberOfMonths ?? 1;
   return (
      <div aria-hidden className={cn('p-3', props?.className)}>
         <div className="flex flex-col gap-2 sm:flex-row">
            {Array.from({ length: months }, (_, index) => (
               <div key={index} className="w-56">
                  <div className="h-7" />
                  <div className="mt-4 h-lh" />
                  <div className="h-60" />
               </div>
            ))}
         </div>
      </div>
   );
}

const DynamicCalendar = dynamic(() => import('@/components/ui/calendar').then((m) => m.Calendar), {
   loading: CalendarPlaceholder,
});

/**
 * The date picker calendar, loaded the first time a popover shows it rather
 * than with the route.
 */
export function Calendar(props: CalendarProps) {
   return (
      <PlaceholderProps.Provider value={props}>
         <DynamicCalendar {...props} />
      </PlaceholderProps.Provider>
   );
}
