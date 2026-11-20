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
      const update = () => {
         const start = Math.max(0, Math.floor(element.scrollTop / rowHeight) - effectiveOverscan);
         const end = Math.min(
            count,
            Math.ceil((element.scrollTop + element.clientHeight) / rowHeight) + effectiveOverscan
         );
         setRange((previous) =>
            previous.start === start && previous.end === end ? previous : { start, end }
         );
      };
      update();
      element.addEventListener('scroll', update, { passive: true });
      element.addEventListener('scrollend', update, { passive: true });
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => {
         element.removeEventListener('scroll', update);
         element.removeEventListener('scrollend', update);
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
