'use client';

import { useEffect, useRef, useState } from 'react';

const TOUCH_MIN_OVERSCAN = 24;

/**
 * Fixed-height row windowing for long tables and board columns: only the rows
 * in view (plus an overscan) are rendered, between top and bottom spacers.
 */
export function useVirtualRows(count: number, rowHeight: number, overscan = 8) {
   const ref = useRef<HTMLDivElement>(null);
   const [range, setRange] = useState({ start: 0, end: 60 });

   useEffect(() => {
      const element = ref.current;
      if (!element) return;
      const effectiveOverscan = window.matchMedia('(pointer: coarse)').matches
         ? Math.max(overscan, TOUCH_MIN_OVERSCAN)
         : overscan;
      const margin = Math.max(3, Math.floor(effectiveOverscan / 3));
      const update = (force = false) => {
         const visibleStart = Math.max(0, Math.floor(element.scrollTop / rowHeight));
         const visibleEnd = Math.min(
            count,
            Math.ceil((element.scrollTop + element.clientHeight) / rowHeight)
         );
         setRange((previous) => {
            if (!force && previous.end <= count) {
               const topSafe = previous.start === 0 || visibleStart >= previous.start + margin;
               const bottomSafe = previous.end === count || visibleEnd <= previous.end - margin;
               if (
                  topSafe &&
                  bottomSafe &&
                  previous.start <= visibleStart &&
                  previous.end >= visibleEnd
               ) {
                  return previous;
               }
            }
            const start = Math.max(0, visibleStart - effectiveOverscan);
            const end = Math.min(count, visibleEnd + effectiveOverscan);
            return previous.start === start && previous.end === end ? previous : { start, end };
         });
      };
      const onScroll = () => update(false);
      update(true);
      element.addEventListener('scroll', onScroll, { passive: true });
      element.addEventListener('scrollend', onScroll, { passive: true });
      const observer = new ResizeObserver(onScroll);
      observer.observe(element);
      return () => {
         element.removeEventListener('scroll', onScroll);
         element.removeEventListener('scrollend', onScroll);
         observer.disconnect();
      };
   }, [count, rowHeight, overscan]);

   return {
      ref,
      start: Math.min(range.start, count),
      end: Math.min(range.end, count),
      totalHeight: count * rowHeight,
      offset: Math.min(range.start, count) * rowHeight,
   };
}
