'use client';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
   value: T;
   label: ReactNode;
}

interface SegmentedControlProps<T extends string | number> {
   /** Names the choice for assistive tech ("Time range"); the group has no visible heading of its own. */
   'aria-label': string;
   'options': readonly SegmentedOption<T>[];
   'value': T;
   'onValueChange': (value: T) => void;
   'className'?: string;
}

/**
 * A small bordered strip of 24px buttons for switching one view setting: a
 * time range, a chart metric, a grouping. The current segment is filled.
 *
 * Each segment is a toggle button with `aria-pressed`, so a screen reader hears
 * which one is on, and Tab moves through them as it did through the plain
 * buttons this replaces. It changes how data is shown, never what is saved;
 * for a setting that persists, use a `Select` or a settings row.
 */
export function SegmentedControl<T extends string | number>({
   'aria-label': label,
   options,
   value,
   onValueChange,
   className,
}: SegmentedControlProps<T>) {
   return (
      <div
         role="group"
         aria-label={label}
         className={cn('flex w-fit items-center gap-1 rounded-md border p-0.5', className)}
      >
         {options.map((option) => {
            const active = option.value === value;
            return (
               <Button
                  key={option.value}
                  size="xxs"
                  variant={active ? 'secondary' : 'ghost'}
                  aria-pressed={active}
                  onClick={() => onValueChange(option.value)}
               >
                  {option.label}
               </Button>
            );
         })}
      </div>
   );
}
