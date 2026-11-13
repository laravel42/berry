'use client';

import { cn } from '@/lib/utils';
import { SegmentIndicator, useSegmentGroupId } from '@/components/ui/segment-indicator';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
   value: T;
   label: ReactNode;
   /** Accessible name and tooltip, for a segment whose label is only an icon. */
   title?: string;
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
 * The selected fill is one `SegmentIndicator` that slides between segments.
 */
export function SegmentedControl<T extends string | number>({
   'aria-label': label,
   options,
   value,
   onValueChange,
   className,
   size = 'default',
}: SegmentedControlProps<T>) {
   const groupId = useSegmentGroupId();
   return (
      <div
         role="group"
         aria-label={label}
         className={cn(
            // Dark: a hairline edge, so the box reads against the canvas.
            'flex w-fit items-center bg-segment-track dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]',
            size === 'md'
               ? 'h-[30px] gap-0.5 overflow-hidden rounded-[7px] p-0.5'
               : 'h-8 rounded-[8px] p-[3px]',
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
                  aria-label={option.title}
                  title={option.title}
                  data-settings-type={size === 'md' ? 'segment' : undefined}
                  onClick={() => onValueChange(option.value)}
                  className={cn(
                     'relative isolate inline-flex items-center justify-center rounded-[5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
                     size === 'md'
                        ? 'h-full gap-1.5 px-2.5 leading-none'
                        : 'h-[26px] px-3 [&[aria-pressed]]:!h-[26px]',
                     active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
               >
                  {active ? (
                     <SegmentIndicator
                        layoutId={groupId}
                        className={size === 'md' ? 'bg-settings-segment-on' : undefined}
                     />
                  ) : null}
                  {option.label}
               </button>
            );
         })}
      </div>
   );
}
