'use client';

import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@/lib/utils';

/**
 * The selected fill of a segmented control, drawn once per group and slid
 * between segments rather than switched on and off in each.
 *
 * Every segment that is selected renders one of these with the group's
 * `layoutId`; motion sees the same id leave one segment and appear in the
 * next, and animates the box across. The id has to be unique per group
 * (`useSegmentGroupId`), or two controls on one page would trade fills.
 *
 * The segment that holds it must be `relative isolate`: the fill sits at
 * `-z-10` inside that stacking context, so it paints over the segment's own
 * (transparent) background and under its label without the label needing a
 * wrapper. With reduced motion asked for, it moves without travelling.
 */
export function SegmentIndicator({
   layoutId,
   className,
}: {
   layoutId: string;
   className?: string;
}) {
   const reduce = useReducedMotion();
   return (
      <motion.span
         aria-hidden
         layoutId={layoutId}
         transition={
            reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 40, mass: 0.8 }
         }
         className={cn(
            // Dark: a clearly lighter grey than the track with a lit top
            // edge, or the selection all but disappears into it.
            'pointer-events-none absolute inset-0 -z-10 rounded-[5px] bg-segment-selected shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)] dark:bg-[#3a3a40] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_1px_3px_rgb(0_0_0/0.5)]',
            className
         )}
      />
   );
}

/** A `layoutId` that belongs to one group only. */
export function useSegmentGroupId() {
   return `segment-${React.useId()}`;
}
