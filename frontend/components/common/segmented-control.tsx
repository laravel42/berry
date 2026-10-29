'use client';

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
   /** `md` is the settings size: a 30px track with 26px segments. */
   'size'?: 'default' | 'md';
}

/**
 * Switches a view setting: a time range, a chart metric, a grouping. Track
 * and selected fill match the component dictionary's segmented control.
 *
 * Each segment is a toggle button with `aria-pressed`. It changes how data
 * is shown, never what is saved; for a setting that persists, use a `Select`.
 */
export function SegmentedControl<T extends string | number>({
   'aria-label': label,
   options,
   value,
   onValueChange,
   className,
   size = 'default',
}: SegmentedControlProps<T>) {
   return (
      <div
         role="group"
         aria-label={label}
         className={cn(
            'flex w-fit items-center rounded-[7px] bg-segment-track p-0.5',
            size === 'md' ? 'h-[30px] gap-0.5' : 'h-7',
            className
         )}
      >
         {options.map((option) => {
            const active = option.value === value;
            return (
               <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  data-settings-type={size === 'md' ? 'segment' : undefined}
                  onClick={() => onValueChange(option.value)}
                  className={cn(
                     'inline-flex items-center justify-center rounded-[5px] font-medium whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-primary/40',
                     size === 'md' ? 'h-[26px] gap-1.5 px-2.5' : 'h-6 px-3',
                     active
                        ? size === 'md'
                           ? 'bg-settings-segment-on text-foreground'
                           : 'bg-segment-selected text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                  )}
               >
                  {option.label}
               </button>
            );
         })}
      </div>
   );
}
