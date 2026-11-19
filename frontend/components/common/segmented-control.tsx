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

/**
 * The track every segmented choice sits in. As tall as a field
 * (`--field-h`), so it lines up with the search and buttons of the line it
 * sits on. Dark: a hairline edge, so the box reads against the canvas.
 */
export const segmentTrackClass =
   'flex h-(--field-h) items-center rounded-[8px] bg-segment-track p-[3px] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]';

interface SegmentedControlProps<T extends string | number> {
   /** Names the choice for assistive tech ("Time range"); the group has no visible heading of its own. */
   'aria-label': string;
   'options': readonly SegmentedOption<T>[];
   'value': T;
   'onValueChange': (value: T) => void;
   'className'?: string;
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
}: SegmentedControlProps<T>) {
   const groupId = useSegmentGroupId();
   return (
      <div role="group" aria-label={label} className={cn(segmentTrackClass, 'w-fit', className)}>
         {options.map((option) => {
            const active = option.value === value;
            return (
               <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  aria-label={option.title}
                  title={option.title}
                  onClick={() => onValueChange(option.value)}
                  className={cn(
                     'relative isolate inline-flex items-center justify-center rounded-[5px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground/20',
                     'h-full px-3',
                     active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
               >
                  {active ? <SegmentIndicator layoutId={groupId} /> : null}
                  {option.label}
               </button>
            );
         })}
      </div>
   );
}
